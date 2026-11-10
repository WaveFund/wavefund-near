// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {Test} from "forge-std/Test.sol";
import {AuroraTestToken} from "../src/testnet/AuroraTestToken.sol";

contract AuroraTestTokenTest is Test {
    function testMintOnlyOperatorWithExpectedPrecision() public {
        vm.chainId(1313161555);
        AuroraTestToken t = new AuroraTestToken("Wavefund Test USDC", "wfUSDC", 6, address(this));
        t.mint(address(9), 10e6);
        assertEq(t.balanceOf(address(9)), 10e6);
        assertEq(t.decimals(), 6);
        vm.prank(address(9));
        vm.expectRevert(AuroraTestToken.OnlyOperator.selector);
        t.mint(address(9), 1);
    }

    function testMainnetDeploymentAndMintAreRejected() public {
        vm.chainId(1);
        vm.expectRevert(AuroraTestToken.TestnetOnly.selector);
        new AuroraTestToken("Test", "TEST", 18, address(this));
        vm.chainId(31337);
        AuroraTestToken t = new AuroraTestToken("Test", "TEST", 18, address(this));
        vm.chainId(1313161554);
        vm.expectRevert(AuroraTestToken.TestnetOnly.selector);
        t.mint(address(9), 1);
    }

    function testInvalidConfigurationRejected() public {
        vm.chainId(1313161555);
        vm.expectRevert(AuroraTestToken.InvalidConfiguration.selector);
        new AuroraTestToken("Test", "TEST", 8, address(this));
        vm.expectRevert(AuroraTestToken.InvalidConfiguration.selector);
        new AuroraTestToken("Test", "TEST", 18, address(0));
    }
}
