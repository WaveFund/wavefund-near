// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {QuantumRound} from "../src/QuantumRound.sol";
import {ProposalTokens} from "../src/ProposalTokens.sol";
import {ProposerRegistry} from "../src/ProposerRegistry.sol";
import {WaveHook} from "../src/WaveHook.sol";
import {WaveV4ProposalMarket} from "../src/WaveV4ProposalMarket.sol";
import {RoundStatus} from "../src/interfaces/IQuantumRoundControl.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/// @dev Only integration identity callbacks are mocked; actual v4 liquidity/trading/accounting execute.
contract RoundModuleFixture {
    QuantumRound public immutable engine;
    uint256 public baseline;
    uint256 public grace = 60;
    bytes32 public commitment = keccak256("policy");

    constructor(QuantumRound e) {
        engine = e;
    }

    function currentTEthBps() external view returns (uint256) {
        return baseline;
    }

    function setGrace(uint256 value) external {
        grace = value;
    }

    function setCommitment(bytes32 value) external {
        commitment = value;
    }

    function prepareRound(uint256, uint256 end, uint256, uint256, uint256, uint256)
        external
        view
        returns (bytes32, uint256)
    {
        require(msg.sender == address(engine), "engine only");
        return (commitment, end + grace);
    }

    function execute(uint256 r) external {
        engine.markExecuted(r);
    }

    function abort(uint256 r) external {
        engine.cancelRound(r);
    }
}

contract RoundTrackerFixture {
    QuantumRound public immutable engine;

    constructor(QuantumRound e) {
        engine = e;
    }

    function report(uint256 r, uint256 ratio) external {
        engine.settle(r, ratio);
    }
}

contract RoundIntegrationTest is Test {
    QuantumRound internal engine;
    ProposalTokens internal tokens;
    ProposerRegistry internal registry;
    WaveV4ProposalMarket internal market;
    MockUSDC internal usdc;
    RoundModuleFixture internal module;
    RoundTrackerFixture internal tracker;
    address internal alice = address(0xa11ce);
    address internal bob = address(0xb0b);
    address internal keeper = address(0xcafe);
    address internal proposer = address(0x1234);
    uint256 internal end;
    uint256 internal evaluation;
    address internal constant HOOK = address(uint160(uint256(0x4444) << 144) | 2752);

    function setUp() public {
        vm.warp(1_000_000);
        IPoolManager manager = IPoolManager(deployCode("PoolManager.sol:PoolManager", abi.encode(address(this))));
        usdc = new MockUSDC();
        tokens = ProposalTokens(deployCode("ProposalTokens.sol:ProposalTokens", abi.encode(address(this))));
        tokens.setCreditDecimals(6);
        registry = new ProposerRegistry(address(this), usdc);
        market = WaveV4ProposalMarket(
            deployCode("WaveV4ProposalMarket.sol:WaveV4ProposalMarket", abi.encode(manager, tokens, address(this)))
        );
        deployCodeTo("WaveHook.sol:WaveHook", abi.encode(manager, address(market)), HOOK);
        engine = new QuantumRound(address(this), usdc, tokens, registry, market);
        market.setQuantumRound(address(engine));
        market.setWaveHook(HOOK);
        tokens.grantRole(tokens.QUANTUM_ROUND_ROLE(), address(engine));
        registry.grantRole(registry.QUANTUM_ROUND_ROLE(), address(engine));
        engine.grantRole(engine.KEEPER_ROLE(), keeper);
        module = new RoundModuleFixture(engine);
        tracker = new RoundTrackerFixture(engine);
        engine.bindExecution(address(module), address(tracker));
        usdc.mint(address(this), 100e6);
        usdc.approve(address(engine), type(uint256).max);
        engine.addProtocolLiquiditySeed(100e6);
        vm.startPrank(proposer);
        registry.registerAgent("proposer");
        usdc.approve(address(registry), type(uint256).max);
        vm.stopPrank();
        usdc.mint(proposer, 10e6);
        end = block.timestamp + 1 hours;
        evaluation = end + 1 days;
    }

    function _open() internal returns (uint256 r) {
        vm.prank(keeper);
        return engine.openRound(end, 1 days, 0.95e18, 1.05e18, 10 minutes);
    }

    function _fund(address user, uint256 r, uint256 amount) internal {
        usdc.mint(user, amount);
        vm.startPrank(user);
        usdc.approve(address(engine), type(uint256).max);
        engine.deposit(r, amount);
        vm.stopPrank();
    }

    function _collapse(uint256 r) internal {
        vm.warp(end);
        engine.collapse(r);
    }

    function _settle(uint256 r, uint256 ratio) internal {
        vm.warp(evaluation);
        tracker.report(r, ratio);
    }

    function testCannotOpenBeforeBinding() public {
        QuantumRound unbound = new QuantumRound(address(this), usdc, tokens, registry, market);
        unbound.grantRole(unbound.KEEPER_ROLE(), address(this));
        vm.expectRevert(QuantumRound.ExecutionNotBound.selector);
        unbound.openRound(end, 1 days, 0.95e18, 1.05e18, 10 minutes);
    }

    function testBindingRejectsEOA() public {
        QuantumRound unbound = new QuantumRound(address(this), usdc, tokens, registry, market);
        vm.expectRevert(QuantumRound.InvalidParameters.selector);
        unbound.bindExecution(alice, address(tracker));
    }

    function testCannotOpenOverActiveRound() public {
        uint256 r = _open();
        vm.expectRevert(abi.encodeWithSelector(QuantumRound.PreviousRoundActive.selector, r));
        _open();
    }

    function testCommitsPolicyAndExecutionDeadline() public {
        uint256 r = _open();
        assertEq(engine.policyHash(r), module.commitment());
        assertEq(engine.executionDeadline(r), end + 60);
        assertEq(engine.allocationSource(), address(module));
    }

    function testCannotRebind() public {
        vm.expectRevert(QuantumRound.ExecutionAlreadyBound.selector);
        engine.bindExecution(address(module), address(tracker));
    }

    function testCannotChangeSourceAfterBinding() public {
        vm.expectRevert(QuantumRound.ExecutionAlreadyBound.selector);
        engine.setAllocationSource(address(0xdead));
    }

    function testInvalidPreparedDeadlineRevertsWholeOpen() public {
        module.setGrace(0);
        vm.expectRevert(QuantumRound.InvalidParameters.selector);
        _open();
        assertEq(engine.currentRoundId(), 0);
        assertEq(engine.protocolLiquiditySeed(), 100e6);
    }

    function testDeadlineCannotReachEvaluation() public {
        module.setGrace(1 days);
        vm.expectRevert(QuantumRound.InvalidParameters.selector);
        _open();
    }

    function testEmptyPolicyCommitmentRejected() public {
        module.setCommitment(bytes32(0));
        vm.expectRevert(QuantumRound.InvalidParameters.selector);
        _open();
    }

    function testUnauthorizedExecutionEvenWithVaultRole() public {
        uint256 r = _open();
        _collapse(r);
        engine.grantRole(engine.VAULT_ROLE(), address(this));
        vm.expectRevert(abi.encodeWithSelector(QuantumRound.UnauthorizedExecutionModule.selector, address(this)));
        engine.markExecuted(r);
    }

    function testExecutionOnceOnly() public {
        uint256 r = _open();
        _collapse(r);
        module.execute(r);
        assertTrue(engine.roundExecuted(r));
        vm.expectRevert(abi.encodeWithSelector(QuantumRound.AlreadyExecuted.selector, r));
        module.execute(r);
    }

    function testExecutionAtExactDeadlineAccepted() public {
        uint256 r = _open();
        _collapse(r);
        vm.warp(end + 60);
        module.execute(r);
        assertTrue(engine.roundExecuted(r));
    }

    function testLateExecutionRejected() public {
        uint256 r = _open();
        _collapse(r);
        vm.warp(end + 61);
        vm.expectRevert(abi.encodeWithSelector(QuantumRound.ExecutionDeadlinePassed.selector, r));
        module.execute(r);
    }

    function testCancellationWaitsForDeadline() public {
        uint256 r = _open();
        _collapse(r);
        vm.warp(end + 60);
        vm.expectRevert(abi.encodeWithSelector(QuantumRound.ExecutionWindowOpen.selector, r));
        module.abort(r);
        vm.warp(end + 61);
        module.abort(r);
        assertEq(uint256(engine.roundStatus(r)), uint256(RoundStatus.Cancelled));
    }

    function testExecutedRoundCannotCancelAfterLoss() public {
        uint256 r = _open();
        _collapse(r);
        module.execute(r);
        vm.warp(end + 61);
        vm.expectRevert(abi.encodeWithSelector(QuantumRound.AlreadyExecuted.selector, r));
        module.abort(r);
    }

    function testTrackerCannotSettleUnexecutedRound() public {
        uint256 r = _open();
        _collapse(r);
        vm.warp(evaluation);
        vm.expectRevert(abi.encodeWithSelector(QuantumRound.RoundNotExecuted.selector, r));
        tracker.report(r, 1e18);
    }

    function testResolverRoleDoesNotBypassTrackerIdentity() public {
        uint256 r = _open();
        _collapse(r);
        module.execute(r);
        engine.grantRole(engine.RESOLVER_ROLE(), address(this));
        vm.warp(evaluation);
        vm.expectRevert(QuantumRound.NotAuthorizedToSettle.selector);
        engine.settle(r, 2e18);
    }

    function testEmergencyUnexecutedCancellationReturnsPrincipal() public {
        uint256 r = _open();
        _fund(alice, r, 10e6);
        _collapse(r);
        vm.warp(evaluation + engine.EMERGENCY_SETTLE_DELAY());
        engine.settle(r, type(uint256).max);
        vm.prank(alice);
        engine.redeem(r);
        assertEq(usdc.balanceOf(alice), 10e6);
    }

    function testEmergencyMidpointCannotOverflowForLargeAuthorizedBounds() public {
        vm.prank(keeper);
        uint256 r = engine.openRound(end, 1 days, type(uint256).max - 2, type(uint256).max, 10 minutes);
        _collapse(r);
        module.execute(r);
        vm.warp(evaluation + engine.EMERGENCY_SETTLE_DELAY());
        engine.settle(r, 0);
        assertEq(uint256(engine.roundStatus(r)), uint256(RoundStatus.Settled));
    }

    function testEmergencyExecutedSettlementIgnoresCallerValue() public {
        uint256 r = _open();
        _fund(alice, r, 10e6);
        vm.prank(alice);
        engine.claimCredits(r, 0, 10e6);
        vm.prank(alice);
        engine.buyLong(r, 0, 5e6, 0);
        _collapse(r);
        module.execute(r);
        vm.warp(evaluation + engine.EMERGENCY_SETTLE_DELAY());
        engine.settle(r, type(uint256).max);
        uint256 preview = engine.previewRedeem(r, alice);
        assertGt(preview, 5e6);
        vm.prank(alice);
        uint256 paid = engine.redeem(r);
        assertEq(paid, preview);
        assertLe(paid, 15e6);
    }

    function testRealV4WinningWorldAndUnclaimedPrincipalRedeem() public {
        uint256 r = _open();
        vm.prank(proposer);
        uint256 p = engine.propose(r, QuantumRound.Allocation(10_000), "full asset");
        _fund(alice, r, 10e6);
        _fund(bob, r, 7e6);
        vm.warp(end - 10 minutes);
        vm.startPrank(alice);
        engine.claimCredits(r, p, 10e6);
        engine.buyLong(r, p, 5e6, 0);
        vm.stopPrank();
        _collapse(r);
        (uint256 winner,) = engine.winningAllocation(r);
        assertEq(winner, p);
        module.execute(r);
        _settle(r, 1.05e18);
        uint256 expected = engine.previewRedeem(r, alice);
        vm.prank(alice);
        assertEq(engine.redeem(r), expected);
        vm.prank(bob);
        assertEq(engine.redeem(r), 7e6);
        assertGe(expected, 10e6);
        assertLe(usdc.balanceOf(alice) + usdc.balanceOf(bob), 22e6);
        assertTrue(engine.liabilitiesClear(r));
    }

    function testLosingWorldDoesNotAddPayout() public {
        uint256 r = _open();
        vm.prank(proposer);
        uint256 p = engine.propose(r, QuantumRound.Allocation(10_000), "challenger");
        _fund(alice, r, 10e6);
        vm.startPrank(alice);
        engine.claimCredits(r, p, 10e6);
        engine.buyShort(r, p, 5e6, 0);
        vm.stopPrank();
        _collapse(r);
        (uint256 winner,) = engine.winningAllocation(r);
        assertEq(winner, 0);
        module.execute(r);
        _settle(r, 1e18);
        vm.prank(alice);
        assertEq(engine.redeem(r), 10e6);
        vm.expectRevert(QuantumRound.NothingToRedeem.selector);
        vm.prank(alice);
        engine.redeem(r);
    }

    function testFuzzPayoutBoundedForWinningLong(uint96 raw, uint256 ratio) public {
        uint256 deposit = bound(uint256(raw), 1e6, 20e6);
        ratio = bound(ratio, 0, 2e18);
        uint256 r = _open();
        _fund(alice, r, deposit);
        vm.startPrank(alice);
        engine.claimCredits(r, 0, deposit);
        engine.buyLong(r, 0, deposit, 0);
        vm.stopPrank();
        _collapse(r);
        module.execute(r);
        _settle(r, ratio);
        uint256 preview = engine.previewRedeem(r, alice);
        assertLe(preview, deposit + 5e6);
        vm.prank(alice);
        engine.redeem(r);
        assertEq(usdc.balanceOf(alice), preview);
    }

    function testManagerCannotChangeSeedDepthDuringTrading() public {
        uint256 r = _open();
        vm.expectRevert(abi.encodeWithSelector(QuantumRound.PreviousRoundActive.selector, r));
        engine.setInitialLiquidityPerProposal(100e6);
        assertEq(engine.initialLiquidityPerProposal(), 5e6);
    }

    function testDeferredPayoutStaysBackedAfterSeedRescue() public {
        uint256 r = _open();
        _fund(alice, r, 10e6);
        _fund(bob, r, 7e6);
        _collapse(r);
        module.execute(r);
        _settle(r, 1e18);
        vm.mockCall(address(usdc), abi.encodeCall(IERC20.transfer, (alice, 10e6)), abi.encode(false));
        engine.redeemFor(r, alice);
        assertEq(engine.pendingPayout(alice), 10e6);
        assertEq(usdc.balanceOf(alice), 0);
        engine.redeemFor(r, bob);
        assertTrue(engine.liabilitiesClear(r));
        engine.rescueProtocolSeed(engine.protocolLiquiditySeed());
        assertEq(usdc.balanceOf(address(engine)), 10e6, "pending payout cannot become seed");
        vm.clearMockedCalls();
        vm.prank(alice);
        engine.claimPayout();
        assertEq(usdc.balanceOf(alice), 10e6);
        assertEq(engine.pendingPayout(alice), 0);
        assertEq(usdc.balanceOf(address(engine)), 0);
    }

    function _fullyLong(uint256 ratio) internal returns (uint256 received, uint256 longTokens) {
        uint256 r = _open();
        _fund(alice, r, 10e6);
        vm.startPrank(alice);
        engine.claimCredits(r, 0, 10e6);
        engine.buyLong(r, 0, 10e6, 0);
        vm.stopPrank();
        longTokens = IERC20(tokens.longToken(r, 0)).balanceOf(alice);
        assertGt(longTokens, 10e18, "trade must discriminate full LONG payout from principal");
        _collapse(r);
        module.execute(r);
        _settle(r, ratio);
        received = engine.redeemFor(r, alice);
    }

    function testReturnBelowLowerBoundPaysWinningLongZero() public {
        (uint256 paid,) = _fullyLong(0.9e18);
        assertEq(paid, 0);
    }

    function testReturnAboveUpperBoundPaysWinningLongInFull() public {
        (uint256 paid, uint256 longTokens) = _fullyLong(1.1e18);
        assertEq(paid, longTokens / 1e12);
    }

    function testMidpointPaysWinningLongHalf() public {
        (uint256 paid, uint256 longTokens) = _fullyLong(1e18);
        assertEq(paid, longTokens / (2e12));
    }

    function testTransferredWinningTokensRemainBackedForNonDepositor() public {
        uint256 r = _open();
        _fund(alice, r, 10e6);
        vm.startPrank(alice);
        engine.claimCredits(r, 0, 10e6);
        engine.buyLong(r, 0, 10e6, 0);
        IERC20 longToken = IERC20(tokens.longToken(r, 0));
        uint256 amount = longToken.balanceOf(alice);
        longToken.transfer(bob, amount);
        vm.stopPrank();
        _collapse(r);
        module.execute(r);
        _settle(r, 1.05e18);
        assertEq(engine.redeemFor(r, alice), 0);
        assertFalse(engine.liabilitiesClear(r), "external winning tokens prevent seed release");
        assertEq(engine.deposits(r, bob), 0);
        assertEq(engine.redeemFor(r, bob), amount / 1e12);
        assertTrue(engine.liabilitiesClear(r));
    }
}
