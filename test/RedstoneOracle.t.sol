// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {RedstoneSignatureProbe} from "./helpers/RedstoneSignatureProbe.sol";
import {Test} from "forge-std/Test.sol";
import {RedstonePortfolioOracle} from "../src/oracle/RedstonePortfolioOracle.sol";
import {RedstoneConstants} from "@redstone-finance/evm-connector/contracts/core/RedstoneConstants.sol";
import {SignatureLib} from "@redstone-finance/evm-connector/contracts/libs/SignatureLib.sol";
import {PerformanceTracker, IPerformanceRound} from "../src/PerformanceTracker.sol";
import {IPortfolioOracle} from "../src/interfaces/ISafeIntegration.sol";

/// @dev TEST ONLY. Trivial public local keys replace the signer policy only in this test subclass.
contract LocalSignerOracle is RedstonePortfolioOracle {
    address private immutable a;
    address private immutable b;
    address private immutable c;

    constructor(address a_, address b_, address c_) RedstonePortfolioOracle(60) {
        a = a_;
        b = b_;
        c = c_;
    }

    function getAuthorisedSignerIndex(address signer) public view override returns (uint8) {
        if (signer == a) return 0;
        if (signer == b) return 1;
        if (signer == c) return 2;
        revert SignerNotAuthorised(signer);
    }
}

contract RedstoneRoundFixture {
    uint256 public end;
    bool public executed = true;
    uint256 public result;

    constructor(uint256 end_) {
        end = end_;
    }

    function settle(uint256, uint256 value) external {
        result = value;
    }

    // Selectors in the actual engine take an id.
    function evaluationEnd(uint256) external view returns (uint256) {
        return end;
    }

    function roundExecuted(uint256) external view returns (bool) {
        return executed;
    }
}

contract RedstoneModuleFixture {
    address public engine;
    address public oracle;
    address public tracker;

    constructor(address e, address o, address t) {
        engine = e;
        oracle = o;
        tracker = t;
    }

    function record(uint256 id, uint256 entry, uint256 stable, uint256 asset) external {
        PerformanceTracker(tracker).recordExecution(id, entry, stable, asset);
    }
}

contract RedstoneOracleTest is Test {
    LocalSignerOracle internal oracle;
    uint256 internal constant TIME = 1_000_000;
    uint256 internal constant MS = TIME * 1000;

    function setUp() public {
        vm.warp(TIME);
        oracle = new LocalSignerOracle(vm.addr(1), vm.addr(2), vm.addr(3));
    }

    function _body(uint256 stable, uint256 asset, uint256 timestamp) internal pure returns (bytes memory) {
        return
            abi.encodePacked(bytes32("ETH"), asset, bytes32("USDC"), stable, uint48(timestamp), uint32(32), uint24(2));
    }

    function _package(uint256 key, uint256 stable, uint256 asset, uint256 timestamp) internal returns (bytes memory) {
        bytes memory body = _body(stable, asset, timestamp);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, keccak256(body));
        return abi.encodePacked(body, r, s, v);
    }

    function _tail(uint16 count) internal pure returns (bytes memory) {
        return abi.encodePacked(count, uint24(0), hex"000002ed57011e0000");
    }

    function _payload(uint256 timestamp, uint256 stable, uint256 asset) internal returns (bytes memory) {
        return abi.encodePacked(
            _package(1, stable, asset, timestamp),
            _package(2, stable, asset, timestamp),
            _package(3, stable, asset, timestamp),
            _tail(3)
        );
    }

    function _send(address target, bytes memory payload) internal {
        (bool ok, bytes memory reason) = target.call(abi.encodePacked(RedstonePortfolioOracle.update.selector, payload));
        if (!ok) assembly ("memory-safe") { revert(add(reason, 32), mload(reason)) }
    }

    function testProductionPolicyAcceptsAuthenticHistoricalPackages() public {
        RedstonePortfolioOracle production = new RedstonePortfolioOracle(60);
        vm.warp(1719856901);
        _send(address(production), vm.readFileBinary("test/fixtures/redstone-primary-historical.bin"));
        (uint256 stable, uint256 asset, uint256 at) = production.read();
        assertEq(stable, 99_988_697 * 1e10);
        assertEq(asset, 348_695_203_485 * 1e10);
        assertEq(at, 1719856900);
        assertEq(production.getUniqueSignersThreshold(), 3);
        assertEq(production.getDataServiceId(), "redstone-primary-prod");
    }

    function testHistoricalProductionDataCannotPassAsCurrent() public {
        RedstonePortfolioOracle production = new RedstonePortfolioOracle(60);
        vm.warp(1794228034);
        vm.expectRevert(abi.encodeWithSelector(RedstonePortfolioOracle.StalePublication.selector, 1719856900000));
        _send(address(production), vm.readFileBinary("test/fixtures/redstone-primary-historical.bin"));
    }

    function testThreeUniqueSignersPopulateReadInterface() public {
        _send(address(oracle), _payload(MS, 1e8, 2_000e8));
        (uint256 stable, uint256 asset, uint256 at) = oracle.read();
        assertEq(stable, 1e18);
        assertEq(asset, 2_000e18);
        assertEq(at, TIME);
    }

    function testMedianIsTakenAcrossSigners() public {
        bytes memory p = abi.encodePacked(
            _package(1, 1e8, 1_900e8, MS), _package(2, 1e8, 2_100e8, MS), _package(3, 1e8, 2_000e8, MS), _tail(3)
        );
        _send(address(oracle), p);
        (, uint256 asset,) = oracle.read();
        assertEq(asset, 2_000e18);
    }

    function testReadBeforeVerifiedUpdateRejected() public {
        vm.expectRevert(RedstonePortfolioOracle.NoVerifiedPrices.selector);
        oracle.read();
    }

    function testTwoSignersCannotMeetQuorum() public {
        bytes memory p = abi.encodePacked(_package(1, 1e8, 2_000e8, MS), _package(2, 1e8, 2_000e8, MS), _tail(2));
        vm.expectRevert(abi.encodeWithSelector(RedstoneConstants.InsufficientNumberOfUniqueSigners.selector, 2, 3));
        _send(address(oracle), p);
    }

    function testDuplicateSignerCannotMeetQuorum() public {
        bytes memory p = abi.encodePacked(
            _package(1, 1e8, 2_000e8, MS), _package(1, 1e8, 2_000e8, MS), _package(1, 1e8, 2_000e8, MS), _tail(3)
        );
        vm.expectRevert(abi.encodeWithSelector(RedstoneConstants.InsufficientNumberOfUniqueSigners.selector, 1, 3));
        _send(address(oracle), p);
    }

    function testUnauthorizedSignerRejected() public {
        bytes memory p = abi.encodePacked(
            _package(1, 1e8, 2_000e8, MS), _package(2, 1e8, 2_000e8, MS), _package(4, 1e8, 2_000e8, MS), _tail(3)
        );
        vm.expectRevert(abi.encodeWithSelector(RedstoneConstants.SignerNotAuthorised.selector, vm.addr(4)));
        _send(address(oracle), p);
    }

    function testTamperedPriceRejectedBySignature() public {
        bytes memory body = _body(1e8, 2_000e8, MS);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(1, keccak256(body));
        body[63] = bytes1(uint8(body[63]) ^ 1);
        address recovered = ecrecover(keccak256(body), v, r, s);
        assertTrue(recovered != vm.addr(1) && recovered != vm.addr(2) && recovered != vm.addr(3));
        bytes memory p = abi.encodePacked(body, r, s, v, _tail(1));
        vm.expectRevert(abi.encodeWithSelector(RedstoneConstants.SignerNotAuthorised.selector, recovered));
        _send(address(oracle), p);
    }

    function testInvalidRecoveryByteRejected() public {
        bytes memory body = _body(1e8, 2_000e8, MS);
        (, bytes32 r, bytes32 s) = vm.sign(1, keccak256(body));
        bytes memory p = abi.encodePacked(body, r, s, uint8(0), _tail(1));
        vm.expectRevert(abi.encodeWithSelector(SignatureLib.InvalidSignature.selector, keccak256(body)));
        _send(address(oracle), p);
    }

    function testStaleSignedUpdateRejected() public {
        bytes memory p = _payload(MS - 61_000, 1e8, 2_000e8);
        vm.expectRevert(abi.encodeWithSelector(RedstonePortfolioOracle.StalePublication.selector, MS - 61_000));
        _send(address(oracle), p);
    }

    function testFutureSignedUpdateRejected() public {
        bytes memory p = _payload(MS + 1_000, 1e8, 2_000e8);
        vm.expectRevert(abi.encodeWithSelector(RedstonePortfolioOracle.InvalidPublicationTime.selector, MS + 1_000));
        _send(address(oracle), p);
    }

    function testMismatchedPackageTimesRejected() public {
        bytes memory p = abi.encodePacked(
            _package(1, 1e8, 2_000e8, MS), _package(2, 1e8, 2_000e8, MS + 1), _package(3, 1e8, 2_000e8, MS), _tail(3)
        );
        vm.expectRevert(RedstoneConstants.TimestampsMustBeEqual.selector);
        _send(address(oracle), p);
    }

    function testReplayCannotReplaceVerifiedPrice() public {
        bytes memory p = _payload(MS, 1e8, 2_000e8);
        _send(address(oracle), p);
        vm.expectRevert(abi.encodeWithSelector(RedstonePortfolioOracle.NonIncreasingPublication.selector, MS));
        _send(address(oracle), p);
    }

    function testOlderFreshUpdateCannotRollBackPrice() public {
        _send(address(oracle), _payload(MS, 1e8, 2_000e8));
        bytes memory old = _payload(MS - 1_000, 1e8, 1_900e8);
        vm.expectRevert(abi.encodeWithSelector(RedstonePortfolioOracle.NonIncreasingPublication.selector, MS - 1_000));
        _send(address(oracle), old);
        (, uint256 asset,) = oracle.read();
        assertEq(asset, 2_000e18);
    }

    function testCacheExpiresEvenWithoutAnotherUpdate() public {
        _send(address(oracle), _payload(MS, 1e8, 2_000e8));
        vm.warp(TIME + 61);
        vm.expectRevert(abi.encodeWithSelector(RedstonePortfolioOracle.StalePublication.selector, MS));
        oracle.read();
    }

    function testZeroPriceRejectedWithoutMutatingCache() public {
        bytes memory p = _payload(MS, 0, 2_000e8);
        vm.expectRevert(RedstonePortfolioOracle.InvalidPrice.selector);
        _send(address(oracle), p);
        assertEq(oracle.lastTimestampMilliseconds(), 0);
    }

    function testNoPayloadRejected() public {
        vm.expectRevert(RedstoneConstants.CalldataMustHaveValidPayload.selector);
        oracle.update();
    }

    function testVerifiedCacheSettlesActualPerformanceTracker() public {
        _send(address(oracle), _payload(MS, 1e8, 2_000e8));
        RedstoneRoundFixture round = new RedstoneRoundFixture(TIME + 100);
        PerformanceTracker tracker =
            new PerformanceTracker(IPerformanceRound(address(round)), oracle, address(this), 300);
        RedstoneModuleFixture module = new RedstoneModuleFixture(address(round), address(oracle), address(tracker));
        tracker.bindModule(address(module));
        module.record(1, 2_000e18, 0, 1e18);
        vm.warp(TIME + 100);
        _send(address(oracle), _payload((TIME + 100) * 1000, 1e8, 2_100e8));
        assertEq(tracker.settle(1), 1.05e18);
        assertEq(round.result(), 1.05e18);
    }

    function testOnlyAssetSignaturesCannotSupplyStablePrice() public {
        bytes memory p;
        for (uint256 key = 1; key <= 3; ++key) {
            bytes memory body = abi.encodePacked(bytes32("ETH"), uint256(2_000e8), uint48(MS), uint32(32), uint24(1));
            (uint8 v, bytes32 r, bytes32 sigS) = vm.sign(key, keccak256(body));
            p = abi.encodePacked(p, body, r, sigS, v);
        }
        p = abi.encodePacked(p, _tail(3));
        vm.expectRevert(abi.encodeWithSelector(RedstoneConstants.InsufficientNumberOfUniqueSigners.selector, 0, 3));
        _send(address(oracle), p);
    }

    function testDiagnosticProbeDoesNotClaimFreshness() public {
        RedstoneSignatureProbe probe = new RedstoneSignatureProbe();
        bytes memory payload = vm.readFileBinary("test/fixtures/redstone-primary-historical.bin");
        (bool ok, bytes memory output) = address(probe).staticcall(abi.encodePacked(probe.inspect.selector, payload));
        assertTrue(ok);
        (uint256 stable, uint256 asset, uint256 timestamp) = abi.decode(output, (uint256, uint256, uint256));
        assertEq(stable, 99_988_697);
        assertEq(asset, 348_695_203_485);
        assertEq(timestamp, 1719856900000);
    }
}
