// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {SafeEndToEndTest} from "./SafeEndToEnd.t.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {QuantumRound} from "../src/QuantumRound.sol";
import {PerformanceTracker} from "../src/PerformanceTracker.sol";
import {TradingSafeModule} from "../src/safe/TradingSafeModule.sol";
import {RoundStatus} from "../src/interfaces/IQuantumRoundControl.sol";

/// @notice Deliberate scenarios, NOT real AI responses or forecasts of profitable trading.
/// Genuine Safe/v4/round/module/tracker; the investment router and oracle remain explicit fixtures.
contract ProductScenariosTest is SafeEndToEndTest {
    address internal constant CAROL = address(0xca701);
    address internal constant DAVE = address(0xda7e);

    function _proposer(uint256 index) internal pure returns (address) {
        return index == 0 ? address(0x1234) : address(uint160(0x2200 + index));
    }

    function _forecaster(uint256 index) internal view returns (address) {
        if (index == 0) return alice;
        if (index == 1) return bob;
        return index == 2 ? CAROL : DAVE;
    }

    function _roundState(uint256 r) internal view returns (QuantumRound.Round memory result) {
        (bool ok, bytes memory data) = address(engine).staticcall(abi.encodeWithSignature("rounds(uint256)", r));
        require(ok, "round getter failed");
        return abi.decode(data, (QuantumRound.Round));
    }

    function _portfolioState(uint256 r) internal view returns (PerformanceTracker.Portfolio memory result) {
        (bool ok, bytes memory data) = address(tracker).staticcall(abi.encodeWithSignature("portfolios(uint256)", r));
        require(ok, "portfolio getter failed");
        return abi.decode(data, (PerformanceTracker.Portfolio));
    }

    function _claim(address user, uint256 r, uint256 proposalId, uint256 amount) internal {
        vm.prank(user);
        engine.claimCredits(r, proposalId, amount);
    }

    function _openBookAndTrade(uint256 selected) internal returns (uint256 r) {
        _ownerCall(
            address(module),
            abi.encodeCall(module.authorizeRound, (1, end, evaluation, deadline, 0.95e18, 1.05e18, 600))
        );
        r = engine.openRound(end, 1 hours, 0.95e18, 1.05e18, 600);
        uint16[4] memory weights = [uint16(0), 2500, 6000, 9000];
        for (uint256 i; i < weights.length; ++i) {
            address author = _proposer(i);
            stable.mint(author, 1e6);
            vm.startPrank(author);
            if (i != 0) registry.registerAgent("Deliberate scenario proposer; not AI");
            stable.approve(address(registry), type(uint256).max);
            uint256 id = engine.propose(r, QuantumRound.Allocation(weights[i]), "Scripted product test strategy");
            vm.stopPrank();
            assertEq(id, i + 1);
        }
        assertEq(_roundState(r).proposalCount, 5, "Hold plus four distinct strategy mandates");

        for (uint256 i; i < 4; ++i) {
            address user = _forecaster(i);
            stable.mint(user, 10e6);
            vm.startPrank(user);
            stable.approve(address(engine), type(uint256).max);
            engine.deposit(r, 10e6);
            vm.stopPrank();
        }
        _claim(alice, r, selected, 10e6);
        _claim(bob, r, selected, 10e6);
        // CAROL claims only part of the winning world and also trades in a losing world.
        // Her winning CREDIT plus unclaimed winning principal must still sum to her one deposit.
        _claim(CAROL, r, selected, 4e6);
        uint256 losingLong = selected == 1 ? 2 : 1;
        _claim(CAROL, r, losingLong, 10e6);
        _claim(DAVE, r, 4, 10e6);

        vm.warp(end - 600);
        vm.prank(alice);
        engine.buyLong(r, selected, 4e6, 4e18);
        vm.prank(bob);
        engine.buyShort(r, selected, 0.5e6, 0.5e18);
        vm.prank(CAROL);
        engine.buyLong(r, losingLong, 0.5e6, 0.5e18);
        vm.prank(DAVE);
        engine.buyShort(r, 4, 0.5e6, 0.5e18);
        assertGt(IERC20(tokens.longToken(r, selected)).balanceOf(alice), 4e18);
        assertGt(IERC20(tokens.shortToken(r, selected)).balanceOf(bob), 0.5e18);
        assertGt(IERC20(tokens.longToken(r, losingLong)).balanceOf(CAROL), 0.5e18);
        assertEq(stable.balanceOf(address(engine)), 140e6, "100 sponsor + four separate 10 deposits");
    }

    function _collapseBook(uint256 r, uint256 selected) internal {
        vm.warp(end);
        engine.collapse(r);
        (uint256 winner, uint16 weight) = engine.winningAllocation(r);
        assertEq(winner, selected, "Deliberate trades must select the intended test world");
        assertEq(weight, selected == 2 ? 2500 : 6000);
        for (uint256 i; i < 4; ++i) {
            assertEq(registry.lockedBond(_proposer(i)), 0);
        }
    }

    function _expectedWinningPayout(uint256 r, uint256 selected, address user, uint256 pi)
        internal
        view
        returns (uint256)
    {
        uint256 principal = engine.deposits(r, user) - engine.creditsClaimed(r, selected, user);
        uint256 credit = IERC20(tokens.creditToken(r, selected)).balanceOf(user);
        uint256 longBalance = IERC20(tokens.longToken(r, selected)).balanceOf(user);
        uint256 shortBalance = IERC20(tokens.shortToken(r, selected)).balanceOf(user);
        return principal + credit + longBalance * pi / 1e30 + shortBalance * (1e18 - pi) / 1e30;
    }

    function _settleAndRedeem(uint256 r, uint256 selected, uint256 assetPrice, uint256 expectedReturn, uint256 pi)
        internal
    {
        vm.warp(evaluation);
        oracle.setPrices(1e18, assetPrice);
        assertEq(tracker.settle(r), expectedReturn);
        assertEq(_roundState(r).pi, pi);
        assertEq(_portfolioState(r).realisedReturn, expectedReturn);
        assertEq(_portfolioState(r).oraclePublishedAt, evaluation);

        uint256 safeStable = stable.balanceOf(address(safe));
        uint256 safeAsset = asset.balanceOf(address(safe));
        uint256[4] memory expected;
        uint256 total;
        for (uint256 i; i < 4; ++i) {
            expected[i] = _expectedWinningPayout(r, selected, _forecaster(i), pi);
            assertEq(engine.previewRedeem(r, _forecaster(i)), expected[i]);
            total += expected[i];
        }
        assertEq(expected[2], 10e6, "Partial winning CREDIT + unclaimed principal, not losing-world value");
        assertEq(expected[3], 10e6, "Untouched winning-world principal survives a losing-world SHORT");
        assertLe(total, 45e6, "All payouts must fit deposits plus winning seed");
        for (uint256 i; i < 4; ++i) {
            address user = _forecaster(i);
            assertEq(stable.balanceOf(user), 0);
            vm.prank(user);
            assertEq(engine.redeem(r), expected[i]);
            assertEq(stable.balanceOf(user), expected[i]);
            assertEq(engine.previewRedeem(r, user), 0);
        }
        assertTrue(engine.liabilitiesClear(r));
        QuantumRound.Round memory state = _roundState(r);
        assertTrue(state.seedReleased);
        assertEq(state.depositsOutstanding, 0);
        assertEq(state.totalPaid, total);
        assertEq(stable.balanceOf(address(engine)), engine.protocolLiquiditySeed());
        assertEq(total + engine.protocolLiquiditySeed(), 140e6, "Forecast funds must reconcile exactly");
        assertEq(stable.balanceOf(address(safe)), safeStable, "Forecast payouts cannot spend investments");
        assertEq(asset.balanceOf(address(safe)), safeAsset);
        vm.prank(alice);
        vm.expectRevert(QuantumRound.NothingToRedeem.selector);
        engine.redeem(r);
    }

    function _exercise6000(uint256 endPrice, uint256 ratio, uint256 pi) internal {
        uint256 r = _openBookAndTrade(3);
        _collapseBook(r, 3);
        module.execute(r, 0, deadline);
        assertTrue(engine.roundExecuted(r));
        assertEq(stable.balanceOf(address(safe)), 800e6);
        assertEq(asset.balanceOf(address(safe)), 0.6e18);
        assertEq(stable.allowance(address(safe), address(router)), 0);
        _settleAndRedeem(r, 3, endPrice, ratio, pi);
    }

    function testProductFourStrategiesBothSidesInteriorGainAndSolvency() public {
        _exercise6000(2_050e18, 1.015e18, 0.65e18);
    }

    function testProductBothSidesInteriorLossAndSolvency() public {
        _exercise6000(1_950e18, 0.985e18, 0.35e18);
    }

    function testProductReturnAboveUpperBoundPaysLongInFull() public {
        _exercise6000(2_300e18, 1.09e18, 1e18);
    }

    function testProductReturnBelowLowerBoundPaysShortInFull() public {
        _exercise6000(1_700e18, 0.91e18, 0);
    }

    function testProductRealEngineMixedPortfolioSellsAssetToSelectedQuarterWeight() public {
        asset.mint(address(safe), 1e18);
        uint256 r = _openBookAndTrade(2);
        _collapseBook(r, 2);
        module.execute(r, 0, deadline);
        assertTrue(engine.roundExecuted(r));
        assertEq(stable.balanceOf(address(safe)), 3_000e6);
        assertEq(asset.balanceOf(address(safe)), 0.5e18);
        assertEq(asset.balanceOf(address(router)), 0.5e18);
        assertEq(asset.allowance(address(safe), address(router)), 0);
        assertEq(stable.allowance(address(safe), address(router)), 0);
        _settleAndRedeem(r, 2, 2_080e18, 1.01e18, 0.6e18);
    }

    function testProductFailedInvestmentSlippageIsAtomicThenCancelsAtPar() public {
        uint256 r = _openBookAndTrade(3);
        _collapseBook(r, 3);
        router.setOutputBps(9800);
        vm.expectRevert(abi.encodeWithSelector(TradingSafeModule.SafeCallFailed.selector, address(router)));
        module.execute(r, 0, deadline);
        assertFalse(engine.roundExecuted(r));
        assertEq(_portfolioState(r).startingValueX18, 0);
        assertEq(stable.balanceOf(address(safe)), 2_000e6);
        assertEq(asset.balanceOf(address(safe)), 0);
        assertEq(stable.balanceOf(address(router)), 0);
        assertEq(stable.allowance(address(safe), address(router)), 0);
        assertEq(uint256(engine.roundStatus(r)), uint256(RoundStatus.Collapsed));

        vm.warp(deadline + 1);
        module.abortExpired(r);
        for (uint256 i; i < 4; ++i) {
            vm.prank(_forecaster(i));
            assertEq(engine.redeem(r), 10e6);
        }
        assertEq(uint256(engine.roundStatus(r)), uint256(RoundStatus.Cancelled));
        assertEq(stable.balanceOf(address(engine)), 100e6);
        assertEq(engine.protocolLiquiditySeed(), 100e6);
        assertTrue(_roundState(r).seedReleased);
        assertEq(stable.balanceOf(address(safe)), 2_000e6);
    }

    function testProductPreDeadlineSettlementObservationFailsWithoutPoisoningRecovery() public {
        uint256 r = _openBookAndTrade(3);
        _collapseBook(r, 3);
        module.execute(r, 0, deadline);
        vm.warp(evaluation);
        vm.mockCall(address(oracle), abi.encodeWithSignature("read()"), abi.encode(1e18, 2_050e18, evaluation - 1));
        vm.expectRevert(PerformanceTracker.InvalidObservation.selector);
        tracker.settle(r);
        assertEq(_portfolioState(r).observedAt, 0);
        assertEq(uint256(engine.roundStatus(r)), uint256(RoundStatus.Collapsed));
        assertTrue(engine.roundExecuted(r));
        assertEq(engine.previewRedeem(r, alice), 0);
        vm.clearMockedCalls();
        _settleAndRedeem(r, 3, 2_050e18, 1.015e18, 0.65e18);
    }

    function testProductDepositEntitlementIsPerWorldButSpendingDoesNotResetClaimCap() public {
        uint256 r = _openBookAndTrade(3);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(QuantumRound.ClaimExceedsDeposit.selector, 10e6, 10e6 + 1));
        engine.claimCredits(r, 3, 1);
        for (uint256 p; p < 5; ++p) {
            if (p != 3) _claim(bob, r, p, 10e6);
            assertEq(engine.creditsClaimed(r, p, bob), 10e6);
        }
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(QuantumRound.ClaimExceedsDeposit.selector, 10e6, 10e6 + 1));
        engine.claimCredits(r, 0, 1);
        assertEq(stable.balanceOf(address(engine)), 140e6, "Counterfactual claims do not create USDC collateral");
        _collapseBook(r, 3);
        module.execute(r, 0, deadline);
        _settleAndRedeem(r, 3, 2_050e18, 1.015e18, 0.65e18);
    }
}
