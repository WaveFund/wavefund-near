// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {ISafeAccount as Safe} from "./helpers/ISafeAccount.sol";
import {SafeProxy} from "../lib/safe-contracts/contracts/proxies/SafeProxy.sol";
import {Enum} from "../lib/safe-contracts/contracts/common/Enum.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {QuantumRound} from "../src/QuantumRound.sol";
import {ProposalTokens} from "../src/ProposalTokens.sol";
import {ProposerRegistry} from "../src/ProposerRegistry.sol";
import {WaveV4ProposalMarket} from "../src/WaveV4ProposalMarket.sol";
import {TradingSafeModule} from "../src/safe/TradingSafeModule.sol";
import {PerformanceTracker, IPerformanceRound} from "../src/PerformanceTracker.sol";
import {IQuantumRoundControl, RoundStatus} from "../src/interfaces/IQuantumRoundControl.sol";
import {IPerformanceTracker} from "../src/interfaces/ISafeIntegration.sol";
import {ModuleTestToken, ModuleTestOracle, ModuleTestRouter} from "./SafeModule.t.sol";

/// @notice Real Safe + real v4 + actual engine/module/tracker. Only prices and investment venue are fixtures.
contract SafeEndToEndTest is Test {
    Safe internal safe;
    QuantumRound internal engine;
    ProposalTokens internal tokens;
    ProposerRegistry internal registry;
    TradingSafeModule internal module;
    PerformanceTracker internal tracker;
    ModuleTestToken internal stable;
    ModuleTestToken internal asset;
    ModuleTestOracle internal oracle;
    ModuleTestRouter internal router;
    address internal alice = address(0xa11ce);
    address internal bob = address(0xb0b);
    address internal proposer = address(0x1234);
    uint256 internal end;
    uint256 internal evaluation;
    uint256 internal deadline;
    address internal constant HOOK = address(uint160(uint256(0x7777) << 144) | 2752);

    function setUp() public {
        vm.warp(1_000_000);
        stable = new ModuleTestToken(6);
        asset = new ModuleTestToken(18);
        address singleton = deployCode("Safe.sol:Safe");
        safe = Safe(payable(address(new SafeProxy(address(singleton)))));
        address[] memory owners = new address[](1);
        owners[0] = address(this);
        safe.setup(owners, 1, address(0), "", address(0), address(0), 0, payable(address(0)));
        oracle = new ModuleTestOracle();
        router = new ModuleTestRouter(stable, asset);
        IPoolManager pm = IPoolManager(deployCode("PoolManager.sol:PoolManager", abi.encode(address(this))));
        tokens = ProposalTokens(deployCode("ProposalTokens.sol:ProposalTokens", abi.encode(address(this))));
        tokens.setCreditDecimals(6);
        registry = new ProposerRegistry(address(this), stable);
        WaveV4ProposalMarket market = WaveV4ProposalMarket(
            deployCode("WaveV4ProposalMarket.sol:WaveV4ProposalMarket", abi.encode(pm, tokens, address(this)))
        );
        deployCodeTo("WaveHook.sol:WaveHook", abi.encode(pm, address(market)), HOOK);
        engine = new QuantumRound(address(this), stable, tokens, registry, market);
        market.setQuantumRound(address(engine));
        market.setWaveHook(HOOK);
        tokens.grantRole(tokens.QUANTUM_ROUND_ROLE(), address(engine));
        registry.grantRole(registry.QUANTUM_ROUND_ROLE(), address(engine));
        tracker = new PerformanceTracker(IPerformanceRound(address(engine)), oracle, address(this), 300);
        module = new TradingSafeModule(
            address(safe),
            IQuantumRoundControl(address(engine)),
            stable,
            asset,
            address(router),
            oracle,
            IPerformanceTracker(address(tracker))
        );
        tracker.bindModule(address(module));
        engine.bindExecution(address(module), address(tracker));
        engine.grantRole(engine.KEEPER_ROLE(), address(this));
        _ownerCall(address(safe), abi.encodeWithSignature("enableModule(address)", address(module)));
        stable.mint(address(safe), 2_000e6);
        stable.mint(address(this), 100e6);
        stable.approve(address(engine), type(uint256).max);
        engine.addProtocolLiquiditySeed(100e6);
        vm.prank(proposer);
        registry.registerAgent("proposer");
        stable.mint(proposer, 10e6);
        vm.prank(proposer);
        stable.approve(address(registry), type(uint256).max);
        end = block.timestamp + 1 hours;
        evaluation = end + 1 hours;
        deadline = end + 60;
    }

    function _ownerCall(address to, bytes memory data) internal {
        bytes memory signature = abi.encodePacked(bytes32(uint256(uint160(address(this)))), bytes32(0), uint8(1));
        assertTrue(
            safe.execTransaction(to, 0, data, Enum.Operation.Call, 0, 0, 0, address(0), payable(address(0)), signature)
        );
    }

    function _open(bool challenger) internal returns (uint256 r, uint256 p) {
        _ownerCall(
            address(module),
            abi.encodeCall(module.authorizeRound, (1, end, evaluation, deadline, 0.95e18, 1.05e18, 600))
        );
        r = engine.openRound(end, 1 hours, 0.95e18, 1.05e18, 600);
        if (challenger) {
            vm.prank(proposer);
            p = engine.propose(r, QuantumRound.Allocation(10_000), "full asset");
        }
        stable.mint(alice, 10e6);
        vm.startPrank(alice);
        stable.approve(address(engine), type(uint256).max);
        engine.deposit(r, 10e6);
        engine.claimCredits(r, p, 10e6);
        vm.stopPrank();
        stable.mint(bob, 7e6);
        vm.startPrank(bob);
        stable.approve(address(engine), type(uint256).max);
        engine.deposit(r, 7e6);
        vm.stopPrank();
    }

    function _selectAndExecute() internal returns (uint256 r) {
        uint256 p;
        (r, p) = _open(true);
        vm.warp(end - 600);
        vm.prank(alice);
        engine.buyLong(r, p, 5e6, 0);
        vm.warp(end);
        engine.collapse(r);
        (uint256 winner,) = engine.winningAllocation(r);
        assertEq(winner, p);
        module.execute(r, 0, deadline);
    }

    function testFullRoundSeparatesInvestmentCapitalAndForecastPayouts() public {
        uint256 r = _selectAndExecute();
        assertTrue(engine.roundExecuted(r));
        assertEq(stable.balanceOf(address(safe)), 0);
        assertEq(asset.balanceOf(address(safe)), 1e18);
        assertEq(stable.allowance(address(safe), address(router)), 0);
        vm.warp(evaluation);
        oracle.setPrices(1e18, 2_100e18);
        assertEq(tracker.settle(r), 1.05e18);
        uint256 aliceExpected = engine.previewRedeem(r, alice);
        vm.prank(alice);
        assertEq(engine.redeem(r), aliceExpected);
        vm.prank(bob);
        assertEq(engine.redeem(r), 7e6);
        assertEq(asset.balanceOf(address(safe)), 1e18, "forecast payouts cannot spend investments");
        assertLe(aliceExpected + 7e6, 22e6, "escrow backing bound");
    }

    function testOwnerWithdrawalAndDonationDoNotRewriteStrategyReturn() public {
        uint256 r = _selectAndExecute();
        _ownerCall(address(asset), abi.encodeCall(asset.transfer, (address(this), 0.5e18)));
        stable.mint(address(safe), 100_000e6);
        vm.warp(evaluation);
        oracle.setPrices(1e18, 2_080e18);
        assertEq(tracker.settle(r), 1.04e18);
        assertEq(asset.balanceOf(address(safe)), 0.5e18);
    }

    function testDisableAfterExecutionDoesNotBlockSettlement() public {
        uint256 r = _selectAndExecute();
        _ownerCall(
            address(safe), abi.encodeWithSignature("disableModule(address,address)", address(1), address(module))
        );
        vm.warp(evaluation);
        assertEq(tracker.settle(r), 1e18);
        assertEq(uint256(engine.roundStatus(r)), uint256(RoundStatus.Settled));
    }

    function testDisabledUnexecutedRoundCancelsAtPar() public {
        (uint256 r,) = _open(false);
        vm.warp(end);
        engine.collapse(r);
        _ownerCall(
            address(safe), abi.encodeWithSignature("disableModule(address,address)", address(1), address(module))
        );
        vm.warp(deadline + 1);
        module.abortExpired(r);
        vm.prank(alice);
        assertEq(engine.redeem(r), 10e6);
        assertEq(stable.balanceOf(address(safe)), 2_000e6);
    }

    function testSafeRejectsKeeperChangingAuthorizedPayoutBounds() public {
        _ownerCall(
            address(module),
            abi.encodeCall(module.authorizeRound, (1, end, evaluation, deadline, 0.95e18, 1.05e18, 600))
        );
        vm.expectRevert(abi.encodeWithSelector(TradingSafeModule.UnauthorizedRound.selector, 1));
        engine.openRound(end, 1 hours, 0.99e18, 1.01e18, 600);
        assertEq(engine.currentRoundId(), 0);
    }
}
