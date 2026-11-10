// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {LocalDemo, ILocalDemoSafe} from "../script/LocalDemo.s.sol";
import {LocalDemoToken, LocalDemoOracle, LocalDemoRouter, LocalChainOnly} from "../src/demo/LocalDemoFixtures.sol";
import {QuantumRound} from "../src/QuantumRound.sol";
import {RoundStatus} from "../src/interfaces/IQuantumRoundControl.sol";

contract LocalDemoTest is LocalDemo, Test {
    Demo internal demo;
    address internal proposer = address(0x111);
    address internal forecaster = address(0x222);

    function setUp() public {
        vm.chainId(31337);
        vm.warp(1_000_000);
        address[] memory proposers = new address[](1);
        proposers[0] = proposer;
        address[] memory forecasters = new address[](1);
        forecasters[0] = forecaster;
        demo = _bootstrap(address(this), address(this), address(this), proposers, forecasters);
    }

    function testBootstrapFundsSeparateSafeAndForecastSeed() public view {
        assertEq(demo.stable.balanceOf(demo.safe), 2_000e6);
        assertEq(demo.stack.engine.protocolLiquiditySeed(), 100e6);
        assertEq(demo.stable.balanceOf(proposer), 100e6);
        assertEq(demo.stable.balanceOf(forecaster), 100e6);
        assertEq(demo.asset.balanceOf(address(demo.router)), 100e18);
        assertEq(demo.stable.balanceOf(address(demo.router)), 200_000e6);
        assertEq(demo.stack.engine.currentRoundId(), 0);
        assertTrue(ILocalDemoSafe(demo.safe).isModuleEnabled(address(demo.stack.module)));
        assertFalse(demo.stack.tokens.hasRole(bytes32(0), demo.safe));
        assertFalse(demo.stack.registry.hasRole(bytes32(0), demo.safe));
        assertTrue(demo.stack.engine.hasRole(bytes32(0), demo.safe));
    }

    function testMockOracleCannotBeChangedByForecaster() public {
        vm.expectRevert(LocalDemoOracle.OnlyOperator.selector);
        vm.prank(forecaster);
        demo.oracle.setPrices(1e18, 10_000e18);
    }

    function testMockTokenCannotBeMintedByForecaster() public {
        vm.expectRevert(LocalDemoToken.OnlyOperator.selector);
        vm.prank(forecaster);
        demo.stable.mint(forecaster, 1_000e6);
    }

    function testLocalFixturesRejectWritesOnPublicChain() public {
        vm.chainId(1313161555);
        vm.expectRevert(abi.encodeWithSelector(LocalChainOnly.LocalNetworkOnly.selector, 1313161555));
        demo.stable.mint(address(this), 1e6);
        vm.expectRevert(abi.encodeWithSelector(LocalChainOnly.LocalNetworkOnly.selector, 1313161555));
        demo.oracle.setPrices(1e18, 1e18);
        vm.expectRevert(abi.encodeWithSelector(LocalChainOnly.LocalNetworkOnly.selector, 1313161555));
        demo.stable.approve(address(demo.router), 1);
    }

    function testLocalRunRejectsPublicNetworkBeforeUsingDisposableKeys() public {
        vm.chainId(1313161555);
        vm.expectRevert(abi.encodeWithSelector(LocalDemo.LocalNetworkOnly.selector, 1313161555));
        this.run();
    }

    function testVenueTransfersRealReservesAndChargesFee() public {
        demo.stable.mint(address(this), 2_000e6);
        demo.stable.approve(address(demo.router), 2_000e6);
        address[] memory route = new address[](2);
        route[0] = address(demo.stable);
        route[1] = address(demo.asset);
        uint256 supplyBefore = demo.asset.totalSupply();
        uint256 reserveBefore = demo.asset.balanceOf(address(demo.router));
        uint256[] memory result =
            demo.router.swapExactTokensForTokens(2_000e6, 0.99e18, route, address(this), block.timestamp);
        assertEq(result[1], 0.997e18);
        assertEq(demo.asset.balanceOf(address(this)), 0.997e18);
        assertEq(demo.asset.balanceOf(address(demo.router)), reserveBefore - 0.997e18);
        assertEq(demo.asset.totalSupply(), supplyBefore, "swaps must not mint synthetic liquidity");
    }

    function testVenueFailsWhenReserveIsInsufficient() public {
        LocalDemoRouter empty = new LocalDemoRouter(demo.stable, demo.asset, demo.oracle);
        address[] memory route = new address[](2);
        route[0] = address(demo.stable);
        route[1] = address(demo.asset);
        demo.stable.mint(address(this), 2_000e6);
        demo.stable.approve(address(empty), 2_000e6);
        vm.expectRevert(
            abi.encodeWithSelector(LocalDemoRouter.InsufficientReserve.selector, address(demo.asset), 0.997e18, 0)
        );
        empty.swapExactTokensForTokens(2_000e6, 0, route, address(this), block.timestamp);
    }

    function testSimulatedOracleActuallyExpires() public {
        uint256 observed = demo.oracle.updatedAt();
        vm.warp(observed + 301);
        vm.expectRevert(abi.encodeWithSelector(LocalDemoOracle.StalePrice.selector, observed));
        demo.oracle.read();
    }

    function testRealForecastSafeExecutionAndMeasuredFeeAdjustedReturn() public {
        uint256 tradingEnd = block.timestamp + 120;
        uint256 evaluationEnd = tradingEnd + 180;
        _ownerCall(
            demo.safe,
            address(this),
            address(demo.stack.module),
            abi.encodeCall(
                demo.stack.module.authorizeRound, (1, tradingEnd, evaluationEnd, tradingEnd + 60, 0.95e18, 1.05e18, 30)
            )
        );
        uint256 round = demo.stack.engine.openRound(tradingEnd, 180, 0.95e18, 1.05e18, 30);
        vm.startPrank(proposer);
        demo.stack.registry.registerAgent("Local proposer");
        demo.stable.approve(address(demo.stack.registry), 1e6);
        uint256 proposal =
            demo.stack.engine.propose(round, QuantumRound.Allocation(10_000), "SIMULATED strategy evidence");
        vm.stopPrank();
        vm.startPrank(forecaster);
        demo.stable.approve(address(demo.stack.engine), 10e6);
        demo.stack.engine.deposit(round, 10e6);
        demo.stack.engine.claimCredits(round, proposal, 10e6);
        demo.stack.engine.buyLong(round, proposal, 5e6, 0);
        vm.stopPrank();
        vm.warp(tradingEnd);
        demo.stack.engine.collapse(round);
        (uint256 winner,) = demo.stack.engine.winningAllocation(round);
        assertEq(winner, proposal);
        demo.stack.module.execute(round, 0, tradingEnd + 60);
        assertEq(demo.asset.balanceOf(demo.safe), 0.997e18);
        assertEq(demo.stable.balanceOf(demo.safe), 0);
        assertEq(demo.stable.allowance(demo.safe, address(demo.router)), 0);
        vm.warp(evaluationEnd);
        demo.oracle.setPrices(1e18, 2_100e18);
        assertEq(demo.stack.tracker.settle(round), 1.04685e18);
        uint256 expected = demo.stack.engine.previewRedeem(round, forecaster);
        vm.prank(forecaster);
        assertEq(demo.stack.engine.redeem(round), expected);
        assertEq(uint256(demo.stack.engine.roundStatus(round)), uint256(RoundStatus.Settled));
        assertEq(demo.asset.balanceOf(demo.safe), 0.997e18, "forecast payouts cannot spend Safe assets");
    }
}
