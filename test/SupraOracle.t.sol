// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {SupraPortfolioOracle, ISupraPullV2} from "../src/oracle/SupraPortfolioOracle.sol";

/// @dev Tests consumer validation only; authentic proofs are checked separately against public Supra.
contract SupraVerifierFixture is ISupraPullV2 {
    PriceInfo private answer;
    bool private invalid;
    error InvalidSignedProof();

    function set(PriceInfo memory p) external {
        answer = p;
    }

    function setInvalid(bool flag) external {
        invalid = flag;
    }

    function verifyOracleProofV2(bytes calldata proof) external view returns (PriceInfo memory) {
        if (invalid || keccak256(proof) != keccak256(hex"1234")) revert InvalidSignedProof();
        return answer;
    }
}

contract SupraOracleTest is Test {
    SupraVerifierFixture internal verifier;
    SupraPortfolioOracle internal oracle;

    function setUp() public {
        vm.warp(1_000_000);
        verifier = new SupraVerifierFixture();
        oracle = new SupraPortfolioOracle(verifier, 60, 15);
        verifier.set(valid());
    }

    function valid() internal view returns (ISupraPullV2.PriceInfo memory p) {
        p.pairs = new uint256[](2);
        p.prices = new uint256[](2);
        p.timestamp = new uint256[](2);
        p.decimal = new uint256[](2);
        p.round = new uint256[](2);
        p.pairs[0] = 19;
        p.pairs[1] = 89;
        p.prices[0] = 1999_90000000;
        p.prices[1] = 99_000000;
        p.timestamp[0] = (block.timestamp - 10) * 1000;
        p.timestamp[1] = (block.timestamp - 5) * 1000;
        p.decimal[0] = 8;
        p.decimal[1] = 8;
        p.round[0] = 100;
        p.round[1] = 100;
    }

    function testExactFeedMappingScalingAndOldestTimestamp() public {
        oracle.update(hex"1234");
        (uint256 s, uint256 a, uint256 t) = oracle.read();
        assertEq(s, 0.99e18);
        assertEq(a, 1999.9e18);
        assertEq(t, block.timestamp - 10);
        assertGt(a, s);
        assertEq(oracle.assetTimestampMs(), (block.timestamp - 10) * 1000);
    }

    function testReverseOrderIsAcceptedWithoutSwappingAssetMeaning() public {
        ISupraPullV2.PriceInfo memory p = valid();
        (p.pairs[0], p.pairs[1]) = (p.pairs[1], p.pairs[0]);
        (p.prices[0], p.prices[1]) = (p.prices[1], p.prices[0]);
        (p.timestamp[0], p.timestamp[1]) = (p.timestamp[1], p.timestamp[0]);
        verifier.set(p);
        oracle.update(hex"1234");
        (uint256 s, uint256 a,) = oracle.read();
        assertEq(s, 0.99e18);
        assertEq(a, 1999.9e18);
    }

    function testRejectsInvalidVerifierAndBounds() public {
        vm.expectRevert(SupraPortfolioOracle.InvalidConfiguration.selector);
        new SupraPortfolioOracle(ISupraPullV2(address(1)), 60, 0);
        vm.expectRevert(SupraPortfolioOracle.InvalidConfiguration.selector);
        new SupraPortfolioOracle(verifier, 0, 0);
        vm.expectRevert(SupraPortfolioOracle.InvalidConfiguration.selector);
        new SupraPortfolioOracle(verifier, 301, 0);
        vm.expectRevert(SupraPortfolioOracle.InvalidConfiguration.selector);
        new SupraPortfolioOracle(verifier, 60, 61);
    }

    function testReadBeforeVerificationFails() public {
        vm.expectRevert(SupraPortfolioOracle.NoVerifiedPrices.selector);
        oracle.read();
    }

    function testBadProofCannotPopulateCache() public {
        vm.expectRevert(SupraVerifierFixture.InvalidSignedProof.selector);
        oracle.update(hex"1235");
        assertEq(oracle.stableTimestampMs(), 0);
    }

    function testEveryMalformedArrayFails() public {
        for (uint256 i; i < 5; i++) {
            ISupraPullV2.PriceInfo memory p = valid();
            if (i == 0) p.pairs = new uint256[](1);
            if (i == 1) p.prices = new uint256[](1);
            if (i == 2) p.timestamp = new uint256[](1);
            if (i == 3) p.decimal = new uint256[](1);
            if (i == 4) p.round = new uint256[](1);
            verifier.set(p);
            vm.expectRevert(SupraPortfolioOracle.InvalidProofShape.selector);
            oracle.update(hex"1234");
        }
    }

    function testWrongOrDuplicateFeedFails() public {
        ISupraPullV2.PriceInfo memory p = valid();
        p.pairs[1] = 48;
        verifier.set(p);
        vm.expectRevert(abi.encodeWithSelector(SupraPortfolioOracle.UnexpectedFeed.selector, 48));
        oracle.update(hex"1234");
        p.pairs[1] = 19;
        verifier.set(p);
        vm.expectRevert(abi.encodeWithSelector(SupraPortfolioOracle.UnexpectedFeed.selector, 19));
        oracle.update(hex"1234");
    }

    function testRejectsSecondsInsteadOfMilliseconds() public {
        ISupraPullV2.PriceInfo memory p = valid();
        p.timestamp[0] = block.timestamp;
        verifier.set(p);
        vm.expectRevert(abi.encodeWithSelector(SupraPortfolioOracle.StalePrice.selector, block.timestamp));
        oracle.update(hex"1234");
    }

    function testRejectsFutureAndZeroTimes() public {
        ISupraPullV2.PriceInfo memory p = valid();
        p.timestamp[0] = block.timestamp * 1000 + 1;
        verifier.set(p);
        vm.expectRevert(abi.encodeWithSelector(SupraPortfolioOracle.InvalidTimestamp.selector, p.timestamp[0]));
        oracle.update(hex"1234");
        p.timestamp[0] = 0;
        verifier.set(p);
        vm.expectRevert(abi.encodeWithSelector(SupraPortfolioOracle.InvalidTimestamp.selector, 0));
        oracle.update(hex"1234");
    }

    function testMillisecondAgeBoundaryAndReadExpiry() public {
        ISupraPullV2.PriceInfo memory p = valid();
        p.timestamp[0] = (block.timestamp - 60) * 1000;
        p.timestamp[1] = p.timestamp[0];
        verifier.set(p);
        oracle.update(hex"1234");
        oracle.read();
        vm.warp(block.timestamp + 1);
        vm.expectRevert(abi.encodeWithSelector(SupraPortfolioOracle.StalePrice.selector, p.timestamp[0]));
        oracle.read();
        p = valid();
        p.timestamp[0] = block.timestamp * 1000 - 60001;
        verifier.set(p);
        vm.expectRevert(abi.encodeWithSelector(SupraPortfolioOracle.StalePrice.selector, p.timestamp[0]));
        oracle.update(hex"1234");
    }

    function testSkewIsCheckedInMilliseconds() public {
        ISupraPullV2.PriceInfo memory p = valid();
        p.timestamp[0] = p.timestamp[1] - 15001;
        verifier.set(p);
        vm.expectRevert(SupraPortfolioOracle.TimestampSkew.selector);
        oracle.update(hex"1234");
    }

    function testReplayFailsAndOneUnchangedFeedCanAdvance() public {
        oracle.update(hex"1234");
        vm.expectRevert(SupraPortfolioOracle.NonIncreasingObservation.selector);
        oracle.update(hex"1234");
        ISupraPullV2.PriceInfo memory p = valid();
        p.timestamp[0] += 1000;
        p.round[0]++;
        verifier.set(p);
        oracle.update(hex"1234");
        assertEq(oracle.assetTimestampMs(), p.timestamp[0]);
    }

    function testTimestampAndRoundRollbackFail() public {
        oracle.update(hex"1234");
        ISupraPullV2.PriceInfo memory p = valid();
        p.timestamp[0]--;
        p.timestamp[1]++;
        verifier.set(p);
        vm.expectRevert(SupraPortfolioOracle.NonIncreasingObservation.selector);
        oracle.update(hex"1234");
        p = valid();
        p.timestamp[0]++;
        p.round[0]--;
        verifier.set(p);
        vm.expectRevert(SupraPortfolioOracle.NonIncreasingObservation.selector);
        oracle.update(hex"1234");
    }

    function testBadPricesDecimalsAndRoundsFail() public {
        ISupraPullV2.PriceInfo memory p = valid();
        p.prices[0] = 0;
        verifier.set(p);
        vm.expectRevert(SupraPortfolioOracle.InvalidPrice.selector);
        oracle.update(hex"1234");
        p = valid();
        p.decimal[0] = 37;
        verifier.set(p);
        vm.expectRevert(SupraPortfolioOracle.InvalidPrice.selector);
        oracle.update(hex"1234");
        p = valid();
        p.decimal[0] = 36;
        p.prices[0] = 1;
        verifier.set(p);
        vm.expectRevert(SupraPortfolioOracle.InvalidPrice.selector);
        oracle.update(hex"1234");
        p = valid();
        p.round[0] = 0;
        verifier.set(p);
        vm.expectRevert(SupraPortfolioOracle.InvalidProofShape.selector);
        oracle.update(hex"1234");
    }

    function testRejectedUpdatePreservesAcceptedCache() public {
        oracle.update(hex"1234");
        verifier.setInvalid(true);
        vm.expectRevert(SupraVerifierFixture.InvalidSignedProof.selector);
        oracle.update(hex"1234");
        (uint256 s, uint256 a,) = oracle.read();
        assertEq(s, 0.99e18);
        assertEq(a, 1999.9e18);
    }

    function testDifferentFeedDecimalsAreNormalizedIndependently() public {
        ISupraPullV2.PriceInfo memory p = valid();
        p.decimal[0] = 6;
        p.prices[0] = 1999_900000;
        p.decimal[1] = 18;
        p.prices[1] = 0.99e18;
        verifier.set(p);
        oracle.update(hex"1234");
        (uint256 s, uint256 a,) = oracle.read();
        assertEq(s, 0.99e18);
        assertEq(a, 1999.9e18);
    }
}
