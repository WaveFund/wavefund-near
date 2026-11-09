// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Test} from "forge-std/Test.sol";
import {ISafeAccount as Safe} from "./helpers/ISafeAccount.sol";
import {SafeProxy} from "../lib/safe-contracts/contracts/proxies/SafeProxy.sol";
import {DeployTradingSafe} from "../script/DeployTradingSafe.s.sol";
import {ModuleTestToken, ModuleTestOracle, ModuleTestRouter} from "./SafeModule.t.sol";

/// @dev Inherit the script to exercise the exact local wiring path without deploying its large orchestration bytecode.
contract DeploymentTest is DeployTradingSafe, Test {
    Safe internal tradingSafe;
    ModuleTestToken internal stableToken;
    ModuleTestToken internal investmentToken;
    ModuleTestOracle internal portfolioOracle;
    ModuleTestRouter internal investmentRouter;
    address internal keeper = address(0xcafe);

    function setUp() public {
        vm.chainId(31337);
        vm.warp(1_000);
        address singleton = deployCode("Safe.sol:Safe");
        tradingSafe = Safe(payable(address(new SafeProxy(address(singleton)))));
        address[] memory owners = new address[](1);
        owners[0] = address(this);
        tradingSafe.setup(owners, 1, address(0), "", address(0), address(0), 0, payable(address(0)));
        stableToken = new ModuleTestToken(6);
        investmentToken = new ModuleTestToken(18);
        portfolioOracle = new ModuleTestOracle();
        investmentRouter = new ModuleTestRouter(stableToken, investmentToken);
    }

    function _config() internal view returns (Config memory c) {
        return Config(
            address(tradingSafe),
            address(stableToken),
            address(investmentToken),
            address(investmentRouter),
            address(portfolioOracle),
            keeper,
            address(0),
            true,
            15 minutes
        );
    }

    function testDeployWiresActualHookAndTransfersAdministration() public {
        Stack memory s = this.deployLocal(_config());
        assertEq(address(s.module.engine()), address(s.engine));
        assertEq(s.module.safe(), address(tradingSafe));
        assertEq(s.engine.executionModule(), address(s.module));
        assertEq(s.engine.performanceTracker(), address(s.tracker));
        assertEq(s.tracker.module(), address(s.module));
        assertEq(s.tokens.creditDecimals(), 6);
        assertTrue(s.tokens.hasRole(s.tokens.QUANTUM_ROUND_ROLE(), address(s.engine)));
        assertTrue(s.registry.hasRole(s.registry.QUANTUM_ROUND_ROLE(), address(s.engine)));
        assertTrue(s.engine.hasRole(s.engine.KEEPER_ROLE(), keeper));
        bytes32 adminRole = s.engine.DEFAULT_ADMIN_ROLE();
        assertTrue(s.engine.hasRole(adminRole, address(tradingSafe)));
        assertFalse(s.tokens.hasRole(adminRole, address(tradingSafe)));
        assertFalse(s.registry.hasRole(adminRole, address(tradingSafe)));
        assertFalse(s.engine.hasRole(adminRole, address(this)));
        assertFalse(s.tokens.hasRole(adminRole, address(this)));
        assertFalse(s.registry.hasRole(adminRole, address(this)));
        assertEq(s.market.owner(), address(s.engine));
        assertEq(s.market.waveHook(), address(s.hook));
        assertEq(address(s.hook.poolManager()), address(s.poolManager));
        assertEq(s.hook.adapter(), address(s.market));
        assertEq(uint160(address(s.hook)) & uint160((1 << 14) - 1), 2752);
        assertEq(s.engine.protocolLiquiditySeed(), 0);
        assertFalse(tradingSafe.isModuleEnabled(address(s.module)));
        bytes32 tokenControllerRole = s.tokens.QUANTUM_ROUND_ROLE();
        bytes32 registryControllerRole = s.registry.QUANTUM_ROUND_ROLE();
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, address(tradingSafe), adminRole
            )
        );
        vm.prank(address(tradingSafe));
        s.tokens.grantRole(tokenControllerRole, address(tradingSafe));
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, address(tradingSafe), adminRole
            )
        );
        vm.prank(address(tradingSafe));
        s.registry.grantRole(registryControllerRole, address(tradingSafe));
    }

    function testExistingPoolManagerPath() public {
        Stack memory first = this.deployLocal(_config());
        Config memory c = _config();
        c.deployPoolManager = false;
        c.poolManager = address(first.poolManager);
        Stack memory second = this.deployLocal(c);
        assertEq(address(second.poolManager), address(first.poolManager));
        assertTrue(address(second.engine) != address(first.engine));
        assertTrue(address(second.tokens) != address(first.tokens));
    }

    function testMissingPoolManagerRejected() public {
        Config memory c = _config();
        c.deployPoolManager = false;
        vm.expectRevert(DeployTradingSafe.InvalidDeploymentConfig.selector);
        this.deployLocal(c);
    }

    function testLocalDeploymentEntryRejectsPublicNetwork() public {
        Config memory c = _config();
        vm.chainId(1313161555);
        vm.expectRevert(abi.encodeWithSelector(DeployTradingSafe.UnsupportedChain.selector, 1313161555));
        this.deployLocal(c);
    }

    function testInvalidOracleBlocksDeployment() public {
        Config memory c = _config();
        portfolioOracle.setPrices(0, 2_000e18);
        vm.expectRevert(DeployTradingSafe.InvalidDeploymentConfig.selector);
        this.deployLocal(c);
    }
}
