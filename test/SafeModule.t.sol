// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {ISafeAccount as Safe} from "./helpers/ISafeAccount.sol";
import {SafeProxy} from "../lib/safe-contracts/contracts/proxies/SafeProxy.sol";
import {Enum} from "../lib/safe-contracts/contracts/common/Enum.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TradingSafeModule} from "../src/safe/TradingSafeModule.sol";
import {IQuantumRoundControl, RoundStatus} from "../src/interfaces/IQuantumRoundControl.sol";
import {IPortfolioOracle, IPerformanceTracker} from "../src/interfaces/ISafeIntegration.sol";

contract ModuleTestToken is ERC20 {
    uint8 private immutable precision;
    bool public falseApprove;

    constructor(uint8 precision_) ERC20("test", "TEST") {
        precision = precision_;
    }

    function decimals() public view override returns (uint8) {
        return precision;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setFalseApprove(bool value) external {
        falseApprove = value;
    }

    function approve(address spender, uint256 amount) public override returns (bool) {
        if (falseApprove) return false;
        return super.approve(spender, amount);
    }
}

contract ModuleTestOracle is IPortfolioOracle {
    uint256 public stablePrice = 1e18;
    uint256 public assetPrice = 2_000e18;

    function setPrices(uint256 s, uint256 a) external {
        stablePrice = s;
        assetPrice = a;
    }

    function read() external view returns (uint256, uint256, uint256) {
        return (stablePrice, assetPrice, block.timestamp);
    }
}

contract ModuleTestTracker is IPerformanceTracker {
    address public engine;
    address public oracle;

    function bind(address e, address o) external {
        engine = e;
        oracle = o;
    }
    uint256 public id;
    uint256 public entryValue;
    uint256 public stableQuantity;
    uint256 public assetQuantity;
    bool public fail;
    error TrackerFailure();

    function setFail(bool value) external {
        fail = value;
    }

    function recordExecution(uint256 r, uint256 v, uint256 s, uint256 a) external {
        if (fail) revert TrackerFailure();
        id = r;
        entryValue = v;
        stableQuantity = s;
        assetQuantity = a;
    }
}

contract ModuleTestEngine {
    uint256 public currentRoundId;
    mapping(uint256 => RoundStatus) public roundStatus;
    mapping(uint256 => bool) public roundExecuted;
    uint16 public target;
    bool public hold;

    function setHold(bool value) external {
        hold = value;
    }
    address public module;

    function bind(address m) external {
        module = m;
    }

    function setTarget(uint16 t) external {
        target = t;
    }

    function open(uint256 end, uint256 eval) external {
        currentRoundId++;
        TradingSafeModule(module).prepareRound(currentRoundId, end, eval, 0.95e18, 1.05e18, 60);
        roundStatus[currentRoundId] = RoundStatus.Trading;
    }

    function setStatus(RoundStatus status) external {
        roundStatus[currentRoundId] = status;
    }

    function winningAllocation(uint256) external view returns (uint256, uint16) {
        return (hold ? 0 : 1, target);
    }

    function markExecuted(uint256 id) external {
        require(msg.sender == module);
        roundExecuted[id] = true;
    }

    function cancelRound(uint256 id) external {
        require(msg.sender == module);
        roundStatus[id] = RoundStatus.Cancelled;
    }
}

contract ModuleTestRouter {
    ModuleTestToken public stable;
    ModuleTestToken public asset;
    uint256 public outputBps = 10_000;
    bool public ignoreMinimum;
    address public callbackTarget;
    bytes public callbackData;
    bool public callbackSucceeded;
    bytes4 public callbackError;

    function setCallback(address target, bytes calldata data) external {
        callbackTarget = target;
        callbackData = data;
    }

    function setIgnoreMinimum(bool enabled) external {
        ignoreMinimum = enabled;
    }
    error InsufficientOutput(uint256 actual, uint256 minimum);

    constructor(ModuleTestToken s, ModuleTestToken a) {
        stable = s;
        asset = a;
    }

    function setOutputBps(uint256 bps) external {
        outputBps = bps;
    }

    function swapExactTokensForTokens(
        uint256 amount,
        uint256 minOut,
        address[] calldata route,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory values) {
        require(route.length == 2 && block.timestamp <= deadline);
        if (callbackTarget != address(0)) {
            (bool ok, bytes memory reason) = callbackTarget.call(callbackData);
            callbackSucceeded = ok;
            if (reason.length >= 4) callbackError = bytes4(reason);
        }

        uint256 expected = route[0] == address(stable) ? amount * 1e12 / 2_000 : amount * 2_000 / 1e12;
        uint256 output = expected * outputBps / 10_000;
        if (!ignoreMinimum && output < minOut) revert InsufficientOutput(output, minOut);
        require(IERC20(route[0]).transferFrom(msg.sender, address(this), amount));
        ModuleTestToken(route[1]).mint(to, output);
        values = new uint256[](2);
        values[0] = amount;
        values[1] = output;
    }
}

contract SafeModuleTest is Test {
    ModuleTestToken internal stable;
    ModuleTestToken internal asset;
    Safe internal safe;
    ModuleTestOracle internal oracle;
    ModuleTestTracker internal tracker;
    ModuleTestEngine internal engine;
    ModuleTestRouter internal router;
    TradingSafeModule internal module;
    uint256 internal end;
    uint256 internal eval;
    uint256 internal deadline;

    function setUp() public {
        vm.warp(1_000);
        stable = new ModuleTestToken(6);
        asset = new ModuleTestToken(18);
        address singleton = deployCode("Safe.sol:Safe");
        safe = Safe(payable(address(new SafeProxy(singleton))));
        address[] memory owners = new address[](1);
        owners[0] = address(this);
        safe.setup(owners, 1, address(0), "", address(0), address(0), 0, payable(address(0)));
        oracle = new ModuleTestOracle();
        tracker = new ModuleTestTracker();
        engine = new ModuleTestEngine();
        tracker.bind(address(engine), address(oracle));
        router = new ModuleTestRouter(stable, asset);
        module = new TradingSafeModule(
            address(safe), IQuantumRoundControl(address(engine)), stable, asset, address(router), oracle, tracker
        );
        engine.bind(address(module));
        _ownerCall(address(safe), abi.encodeWithSignature("enableModule(address)", address(module)));
        stable.mint(address(safe), 1_000e6);
        end = 1_100;
        deadline = 1_160;
        eval = 2_000;
    }

    function _ownerCall(address to, bytes memory data) internal {
        bytes memory signature = abi.encodePacked(bytes32(uint256(uint160(address(this)))), bytes32(0), uint8(1));
        assertTrue(
            safe.execTransaction(to, 0, data, Enum.Operation.Call, 0, 0, 0, address(0), payable(address(0)), signature)
        );
    }

    function _open(uint16 target) internal {
        vm.prank(address(safe));
        module.authorizeRound(1, end, eval, deadline, 0.95e18, 1.05e18, 60);
        engine.open(end, eval);
        engine.setTarget(target);
        engine.setHold(target == 0);
        engine.setStatus(RoundStatus.Collapsed);
        vm.warp(end);
    }

    function testOnlySafeConfiguresPolicy() public {
        vm.expectRevert(TradingSafeModule.OnlySafe.selector);
        module.configurePolicy(20);
        vm.prank(address(safe));
        module.configurePolicy(20);
        assertEq(module.maxSlippageBps(), 20);
    }

    function testOnlySafeAuthorizes() public {
        vm.expectRevert(TradingSafeModule.OnlySafe.selector);
        module.authorizeRound(1, end, eval, deadline, 0.95e18, 1.05e18, 60);
    }

    function testSlippageCannotExceedPolicyCap() public {
        vm.prank(address(safe));
        vm.expectRevert(abi.encodeWithSelector(TradingSafeModule.InvalidSlippage.selector, 1_001));
        module.configurePolicy(1_001);
    }

    function testExactScheduleIsRequired() public {
        vm.prank(address(safe));
        module.authorizeRound(1, end, eval, deadline, 0.95e18, 1.05e18, 60);
        vm.expectRevert(abi.encodeWithSelector(TradingSafeModule.UnauthorizedRound.selector, 1));
        engine.open(end + 1, eval);
        assertEq(engine.currentRoundId(), 0);
    }

    function testWrongNextIdRejected() public {
        vm.prank(address(safe));
        vm.expectRevert(abi.encodeWithSelector(TradingSafeModule.UnauthorizedRound.selector, 2));
        module.authorizeRound(2, end, eval, deadline, 0.95e18, 1.05e18, 60);
    }

    function testDeadlineMustPrecedeEvaluation() public {
        vm.prank(address(safe));
        vm.expectRevert(TradingSafeModule.InvalidSchedule.selector);
        module.authorizeRound(1, end, eval, eval, 0.95e18, 1.05e18, 60);
    }

    function testOnlyEngineCanPrepare() public {
        vm.expectRevert(TradingSafeModule.OnlyEngine.selector);
        module.prepareRound(1, end, eval, 0.95e18, 1.05e18, 60);
    }

    function testRequiresOwnerAuthorization() public {
        vm.expectRevert(abi.encodeWithSelector(TradingSafeModule.UnauthorizedRound.selector, 1));
        engine.open(end, eval);
    }

    function testAuthorizationCanBeRevokedBeforeOpen() public {
        vm.startPrank(address(safe));
        module.authorizeRound(1, end, eval, deadline, 0.95e18, 1.05e18, 60);
        module.revokeAuthorization();
        vm.stopPrank();
        vm.expectRevert(abi.encodeWithSelector(TradingSafeModule.UnauthorizedRound.selector, 1));
        engine.open(end, eval);
    }

    function testPolicyCannotChangeAfterAuthorization() public {
        vm.startPrank(address(safe));
        module.authorizeRound(1, end, eval, deadline, 0.95e18, 1.05e18, 60);
        vm.expectRevert(TradingSafeModule.AuthorizationPending.selector);
        module.configurePolicy(500);
        vm.stopPrank();
    }

    function testActiveRoundLocksPolicy() public {
        _open(5_000);
        vm.prank(address(safe));
        vm.expectRevert(abi.encodeWithSelector(TradingSafeModule.ActiveRound.selector, 1));
        module.configurePolicy(500);
    }

    function testFullCapitalCanBeInvested() public {
        _open(10_000);
        module.execute(1, 0, deadline);
        assertEq(stable.balanceOf(address(safe)), 0);
        assertEq(asset.balanceOf(address(safe)), 0.5e18);
        assertEq(stable.allowance(address(safe), address(router)), 0);
        assertEq(tracker.entryValue(), 1_000e18);
        assertEq(tracker.assetQuantity(), 0.5e18);
        assertTrue(engine.roundExecuted(1));
    }

    function testHalfAllocationUsesHalfCapital() public {
        _open(5_000);
        module.execute(1, 0, deadline);
        assertEq(stable.balanceOf(address(safe)), 500e6);
        assertEq(asset.balanceOf(address(safe)), 0.25e18);
    }

    function testHoldStillAcknowledgesExecution() public {
        _open(0);
        module.execute(1, 0, deadline);
        assertEq(stable.balanceOf(address(safe)), 1_000e6);
        assertEq(tracker.entryValue(), 1_000e18);
        assertTrue(engine.roundExecuted(1));
    }

    function testSellsAssetIntoStable() public {
        asset.mint(address(safe), 0.5e18);
        _open(0);
        engine.setHold(false);
        module.execute(1, 0, deadline);
        assertEq(stable.balanceOf(address(safe)), 2_000e6);
        assertEq(asset.balanceOf(address(safe)), 0);
        assertEq(asset.allowance(address(safe), address(router)), 0);
    }

    function testHoldDoesNotRebalanceAfterPriceDrift() public {
        asset.mint(address(safe), 0.5e18);
        _open(5_000);
        engine.setHold(true);
        oracle.setPrices(1e18, 4_000e18);
        router.setOutputBps(20_000); // match the moved price so a wrong rebalance reaches balance assertions
        module.execute(1, 0, deadline);
        assertEq(stable.balanceOf(address(safe)), 1_000e6);
        assertEq(asset.balanceOf(address(safe)), 0.5e18);
        assertEq(tracker.entryValue(), 3_000e18);
        assertTrue(engine.roundExecuted(1));
    }

    function testReplayRejected() public {
        _open(10_000);
        module.execute(1, 0, deadline);
        vm.expectRevert(abi.encodeWithSelector(TradingSafeModule.NotExecutable.selector, 1));
        module.execute(1, 0, deadline);
    }

    function testPreparedBalancesCannotChange() public {
        _open(10_000);
        stable.mint(address(safe), 1);
        vm.expectRevert(TradingSafeModule.SnapshotChanged.selector);
        module.execute(1, 0, deadline);
    }

    function testExecutingBeforeCloseRejected() public {
        _open(10_000);
        vm.warp(end - 1);
        vm.expectRevert(abi.encodeWithSelector(TradingSafeModule.NotExecutable.selector, 1));
        module.execute(1, 0, deadline);
    }

    function testTradingStatusCannotExecute() public {
        _open(10_000);
        engine.setStatus(RoundStatus.Trading);
        vm.expectRevert(abi.encodeWithSelector(TradingSafeModule.NotExecutable.selector, 1));
        module.execute(1, 0, deadline);
    }

    function testUnknownRoundCannotExecute() public {
        _open(10_000);
        vm.expectRevert(abi.encodeWithSelector(TradingSafeModule.NotExecutable.selector, 2));
        module.execute(2, 0, deadline);
    }

    function testExpiredExecutionRejected() public {
        _open(10_000);
        vm.warp(deadline + 1);
        vm.expectRevert(abi.encodeWithSelector(TradingSafeModule.ExecutionExpired.selector, deadline));
        module.execute(1, 0, deadline);
    }

    function testCallerCannotExtendDeadline() public {
        _open(10_000);
        vm.expectRevert(abi.encodeWithSelector(TradingSafeModule.ExecutionExpired.selector, deadline));
        module.execute(1, 0, deadline + 1);
    }

    function testDisabledModuleCannotExecuteHold() public {
        _open(0);
        _ownerCall(
            address(safe), abi.encodeWithSignature("disableModule(address,address)", address(1), address(module))
        );
        vm.expectRevert(abi.encodeWithSelector(TradingSafeModule.NotExecutable.selector, 1));
        module.execute(1, 0, deadline);
    }

    function testLowCallerMinimumCannotBypassOracleFloor() public {
        _open(10_000);
        router.setOutputBps(9_000);
        vm.expectRevert(abi.encodeWithSelector(TradingSafeModule.SafeCallFailed.selector, address(router)));
        module.execute(1, 0, deadline);
        assertEq(stable.balanceOf(address(safe)), 1_000e6);
        assertEq(asset.balanceOf(address(safe)), 0);
        assertEq(stable.allowance(address(safe), address(router)), 0);
        assertFalse(engine.roundExecuted(1));
    }

    function testDishonestRouterCannotSkipBalancePostcondition() public {
        _open(10_000);
        router.setOutputBps(9_000);
        router.setIgnoreMinimum(true);
        vm.expectRevert(TradingSafeModule.UnexpectedBalanceChange.selector);
        module.execute(1, 0, deadline);
        assertEq(stable.balanceOf(address(safe)), 1_000e6);
        assertEq(asset.balanceOf(address(safe)), 0);
        assertFalse(engine.roundExecuted(1));
    }

    function testTrackerBindingsCannotDiffer() public {
        tracker.bind(address(0x1234), address(oracle));
        vm.expectRevert(TradingSafeModule.TrackerBindingMismatch.selector);
        new TradingSafeModule(
            address(safe), IQuantumRoundControl(address(engine)), stable, asset, address(router), oracle, tracker
        );
    }

    function testCannotPrepareDisabledModule() public {
        _ownerCall(
            address(safe), abi.encodeWithSignature("disableModule(address,address)", address(1), address(module))
        );
        vm.prank(address(safe));
        module.authorizeRound(1, end, eval, deadline, 0.95e18, 1.05e18, 60);
        vm.expectRevert(abi.encodeWithSelector(TradingSafeModule.NotExecutable.selector, 1));
        engine.open(end, eval);
    }

    function testStricterCallerMinimumIsEnforced() public {
        _open(10_000);
        vm.expectRevert(abi.encodeWithSelector(TradingSafeModule.SafeCallFailed.selector, address(router)));
        module.execute(1, 0.6e18, deadline);
        assertEq(stable.balanceOf(address(safe)), 1_000e6);
    }

    function testFalseReturningApproveCannotSucceed() public {
        _open(10_000);
        stable.setFalseApprove(true);
        vm.expectRevert(abi.encodeWithSelector(TradingSafeModule.TokenOperationFailed.selector, address(stable)));
        module.execute(1, 0, deadline);
        assertFalse(engine.roundExecuted(1));
    }

    function testTrackerFailureRollsBackSwap() public {
        _open(10_000);
        tracker.setFail(true);
        vm.expectRevert(ModuleTestTracker.TrackerFailure.selector);
        module.execute(1, 0, deadline);
        assertEq(stable.balanceOf(address(safe)), 1_000e6);
        assertEq(asset.balanceOf(address(safe)), 0);
        assertEq(stable.allowance(address(safe), address(router)), 0);
        assertFalse(engine.roundExecuted(1));
    }

    function testExpiredUnexecutedRoundCanCancel() public {
        _open(10_000);
        vm.warp(deadline + 1);
        module.abortExpired(1);
        assertEq(uint256(engine.roundStatus(1)), uint256(RoundStatus.Cancelled));
        assertEq(stable.balanceOf(address(safe)), 1_000e6);
    }

    function testDisablingModuleDoesNotBlockExpiredCancellation() public {
        _open(10_000);
        _ownerCall(
            address(safe), abi.encodeWithSignature("disableModule(address,address)", address(1), address(module))
        );
        vm.warp(deadline + 1);
        module.abortExpired(1);
        assertEq(uint256(engine.roundStatus(1)), uint256(RoundStatus.Cancelled));
    }

    function testFuzzAllocationUsesFullEligibleBudget(uint16 target) public {
        target = uint16(bound(uint256(target), 0, 10_000));
        _open(target);
        engine.setHold(false);
        module.execute(1, 0, deadline);
        uint256 spentStable = uint256(target) * 1_000e6 / 10_000;
        assertEq(stable.balanceOf(address(safe)), 1_000e6 - spentStable);
        assertEq(asset.balanceOf(address(safe)), spentStable * 1e12 / 2_000);
        assertEq(stable.allowance(address(safe), address(router)), 0);
        assertTrue(engine.roundExecuted(1));
    }

    function testCancellationBeforeExpiryRejected() public {
        _open(10_000);
        vm.expectRevert(abi.encodeWithSelector(TradingSafeModule.DeadlineNotExpired.selector, deadline));
        module.abortExpired(1);
    }

    function testExecutedRoundCannotCancel() public {
        _open(10_000);
        module.execute(1, 0, deadline);
        vm.warp(deadline + 1);
        vm.expectRevert(abi.encodeWithSelector(TradingSafeModule.NotExecutable.selector, 1));
        module.abortExpired(1);
    }

    function testOracleZeroPriceRejected() public {
        _open(10_000);
        oracle.setPrices(1e18, 0);
        vm.expectRevert(TradingSafeModule.InvalidOraclePrice.selector);
        module.execute(1, 0, deadline);
    }

    function testAllocationSourceValuesBothAssets() public {
        asset.mint(address(safe), 0.5e18);
        assertEq(module.currentTEthBps(), 5_000);
        oracle.setPrices(2e18, 2_000e18);
        assertEq(module.currentTEthBps(), 3_333);
    }

    function testNextRoundAllowedAfterTerminalStatus() public {
        _open(0);
        module.execute(1, 0, deadline);
        engine.setStatus(RoundStatus.Settled);
        vm.prank(address(safe));
        module.configurePolicy(50);
        vm.prank(address(safe));
        module.authorizeRound(2, 2_100, 3_000, 2_160, 0.95e18, 1.05e18, 60);
        engine.open(2_100, 3_000);
        assertEq(module.activeRoundId(), 2);
    }

    function testRouterCannotReenterExecution() public {
        _open(10_000);
        router.setCallback(address(module), abi.encodeCall(module.execute, (1, 0, deadline)));
        module.execute(1, 0, deadline);
        assertFalse(router.callbackSucceeded());
        assertEq(router.callbackError(), bytes4(keccak256("ReentrancyGuardReentrantCall()")));
        assertTrue(engine.roundExecuted(1));
        assertEq(asset.balanceOf(address(safe)), 0.5e18);
        assertEq(stable.balanceOf(address(safe)), 0);
    }
}
