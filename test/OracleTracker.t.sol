// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {FeedPortfolioOracle, IAggregatorFeed} from "../src/oracle/FeedPortfolioOracle.sol";
import {DiaPortfolioOracle, IDiaFeed} from "../src/oracle/DiaPortfolioOracle.sol";
import {IPortfolioOracle} from "../src/interfaces/ISafeIntegration.sol";
import {PerformanceTracker, IPerformanceRound} from "../src/PerformanceTracker.sol";

contract FeedFixture is IAggregatorFeed {
    uint8 public immutable decimals;
    int256 public answer;
    uint256 public timestamp;
    uint80 public roundId = 1;
    uint80 public answeredInRound = 1;

    constructor(uint8 d) {
        decimals = d;
    }

    function set(int256 value, uint256 time) external {
        answer = value;
        timestamp = time;
    }

    function setRound(uint80 r, uint80 a) external {
        roundId = r;
        answeredInRound = a;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (roundId, answer, timestamp, timestamp, answeredInRound);
    }
}

contract DiaFixture is IDiaFeed {
    mapping(bytes32 => uint128) public values;
    mapping(bytes32 => uint128) public times;

    function set(string calldata key, uint128 value, uint128 time) external {
        values[keccak256(bytes(key))] = value;
        times[keccak256(bytes(key))] = time;
    }

    function getValue(string memory key) external view returns (uint128, uint128) {
        return (values[keccak256(bytes(key))], times[keccak256(bytes(key))]);
    }
}

contract PerformanceRoundFixture is IPerformanceRound {
    uint256 public end;
    bool public executed;
    uint256 public result;
    bool public shouldFail;

    function setEnd(uint256 e) external {
        end = e;
    }

    function setExecuted(bool e) external {
        executed = e;
    }

    function setShouldFail(bool e) external {
        shouldFail = e;
    }

    function evaluationEnd(uint256) external view returns (uint256) {
        return end;
    }

    function roundExecuted(uint256) external view returns (bool) {
        return executed;
    }

    function settle(uint256, uint256 r) external {
        require(!shouldFail, "settlement failure");
        result = r;
    }
}

contract ModuleFixture {
    address public immutable engine;
    address public immutable oracle;
    address public immutable tracker;

    constructor(address engine_, address oracle_, address tracker_) {
        engine = engine_;
        oracle = oracle_;
        tracker = tracker_;
    }

    function record(PerformanceTracker tracker_, uint256 id, uint256 start, uint256 stable, uint256 asset) external {
        tracker_.recordExecution(id, start, stable, asset);
    }
}

contract OracleTrackerTest is Test {
    FeedFixture internal stable;
    FeedFixture internal asset;
    FeedPortfolioOracle internal oracle;
    PerformanceRoundFixture internal round;
    PerformanceTracker internal tracker;
    ModuleFixture internal module;

    function setUp() public {
        vm.warp(100_000);
        stable = new FeedFixture(8);
        asset = new FeedFixture(8);
        stable.set(1e8, block.timestamp);
        asset.set(2_000e8, block.timestamp);
        oracle = new FeedPortfolioOracle(stable, asset, 60, 15);
        round = new PerformanceRoundFixture();
        round.setEnd(block.timestamp + 1 hours);
        tracker = new PerformanceTracker(round, oracle, address(this), 10 minutes);
        module = new ModuleFixture(address(round), address(oracle), address(tracker));
        tracker.bindModule(address(module));
    }

    function testFeedNormalizesBothDecimalsAndReturnsOldestTimestamp() public {
        asset.set(2_000e8, block.timestamp - 5);
        (uint256 s, uint256 a, uint256 t) = oracle.read();
        assertEq(s, 1e18);
        assertEq(a, 2_000e18);
        assertEq(t, block.timestamp - 5);
    }

    function testRejectsNegativePrice() public {
        asset.set(-1, block.timestamp);
        vm.expectRevert(abi.encodeWithSelector(FeedPortfolioOracle.InvalidPrice.selector, address(asset)));
        oracle.read();
    }

    function testRejectsZeroPrice() public {
        stable.set(0, block.timestamp);
        vm.expectRevert(abi.encodeWithSelector(FeedPortfolioOracle.InvalidPrice.selector, address(stable)));
        oracle.read();
    }

    function testRejectsFuturePrice() public {
        stable.set(1e8, block.timestamp + 1);
        vm.expectRevert(
            abi.encodeWithSelector(FeedPortfolioOracle.InvalidTimestamp.selector, address(stable), block.timestamp + 1)
        );
        oracle.read();
    }

    function testRejectsZeroPublicationTimestamp() public {
        stable.set(1e8, 0);
        vm.expectRevert(abi.encodeWithSelector(FeedPortfolioOracle.InvalidTimestamp.selector, address(stable), 0));
        oracle.read();
    }

    function testFeedDecimalsAreIndependent() public {
        FeedFixture stable6 = new FeedFixture(6);
        FeedFixture asset18 = new FeedFixture(18);
        stable6.set(0.99e6, block.timestamp);
        asset18.set(2_345.123e18, block.timestamp);
        FeedPortfolioOracle differentDecimals = new FeedPortfolioOracle(stable6, asset18, 60, 15);
        (uint256 s, uint256 a,) = differentDecimals.read();
        assertEq(s, 0.99e18);
        assertEq(a, 2_345.123e18);
    }

    function testRejectsStalePrice() public {
        stable.set(1e8, block.timestamp - 61);
        vm.expectRevert(
            abi.encodeWithSelector(FeedPortfolioOracle.StalePrice.selector, address(stable), block.timestamp - 61)
        );
        oracle.read();
    }

    function testRejectsIncompleteRound() public {
        stable.setRound(2, 1);
        vm.expectRevert(abi.encodeWithSelector(FeedPortfolioOracle.IncompleteRound.selector, address(stable)));
        oracle.read();
    }

    function testRejectsSkewedPrices() public {
        asset.set(2_000e8, block.timestamp - 16);
        vm.expectRevert(
            abi.encodeWithSelector(FeedPortfolioOracle.TimestampSkew.selector, block.timestamp, block.timestamp - 16)
        );
        oracle.read();
    }

    function testRejectsExcessiveFeedDecimals() public {
        FeedFixture invalid = new FeedFixture(19);
        vm.expectRevert(FeedPortfolioOracle.InvalidConfiguration.selector);
        new FeedPortfolioOracle(stable, invalid, 60, 15);
    }

    function testTrackerOnlyBoundModuleRecords() public {
        vm.expectRevert(PerformanceTracker.Unauthorized.selector);
        tracker.recordExecution(1, 1_000e18, 1_000e6, 0);
    }

    function testTrackerBindingIsOneTime() public {
        vm.expectRevert(PerformanceTracker.AlreadyBound.selector);
        tracker.bindModule(address(module));
    }

    function testTrackerRejectsMismatchedModuleEngine() public {
        PerformanceTracker fresh = new PerformanceTracker(round, oracle, address(this), 600);
        ModuleFixture wrong = new ModuleFixture(address(0xBAD), address(oracle), address(fresh));
        vm.expectRevert(PerformanceTracker.InvalidConfiguration.selector);
        fresh.bindModule(address(wrong));
    }

    function testTrackerRejectsMismatchedModuleOracle() public {
        PerformanceTracker fresh = new PerformanceTracker(round, oracle, address(this), 600);
        ModuleFixture wrong = new ModuleFixture(address(round), address(0xBAD), address(fresh));
        vm.expectRevert(PerformanceTracker.InvalidConfiguration.selector);
        fresh.bindModule(address(wrong));
    }

    function testTrackerRejectsMismatchedModuleTracker() public {
        PerformanceTracker fresh = new PerformanceTracker(round, oracle, address(this), 600);
        ModuleFixture wrong = new ModuleFixture(address(round), address(oracle), address(tracker));
        vm.expectRevert(PerformanceTracker.InvalidConfiguration.selector);
        fresh.bindModule(address(wrong));
    }

    function testTrackerRejectsDuplicateExecution() public {
        module.record(tracker, 1, 1_000e18, 0, 0.5e18);
        vm.expectRevert(abi.encodeWithSelector(PerformanceTracker.AlreadyRecorded.selector, 1));
        module.record(tracker, 1, 1_000e18, 1_000e6, 0);
    }

    function testTrackerRejectsZeroEntryValue() public {
        vm.expectRevert(PerformanceTracker.InvalidObservation.selector);
        module.record(tracker, 1, 0, 1_000e6, 0);
    }

    function testTrackerRejectsExecutionAtEvaluationEnd() public {
        vm.warp(round.end());
        vm.expectRevert(PerformanceTracker.InvalidObservation.selector);
        module.record(tracker, 1, 1_000e18, 1_000e6, 0);
    }

    function testTrackerComputesReturnFromFixedHoldings() public {
        // $1,000 starting value -> $500 cash + 0.245 ETH after $10 execution costs.
        module.record(tracker, 1, 1_000e18, 500e6, 0.245e18);
        round.setExecuted(true);
        vm.warp(round.end());
        stable.set(1e8, block.timestamp);
        asset.set(2_200e8, block.timestamp);
        uint256 ratio = tracker.settle(1);
        assertEq(ratio, 1.039e18);
        assertEq(round.result(), 1.039e18);
        vm.expectRevert(abi.encodeWithSelector(PerformanceTracker.AlreadyObserved.selector, 1));
        tracker.settle(1);
    }

    function testStableDepegIsPriced() public {
        module.record(tracker, 1, 1_000e18, 1_000e6, 0);
        round.setExecuted(true);
        vm.warp(round.end());
        stable.set(0.9e8, block.timestamp);
        asset.set(2_000e8, block.timestamp);
        assertEq(tracker.settle(1), 0.9e18);
    }

    function testFixedRecordedPortfolioUsesExecutionQuantities() public {
        module.record(tracker, 1, 1_000e18, 500e6, 0.25e18);
        round.setExecuted(true);
        vm.warp(round.end());
        stable.set(1e8, block.timestamp);
        asset.set(2_400e8, block.timestamp);
        assertEq(tracker.settle(1), 1.1e18);
        (uint256 starting, uint256 stableQty, uint256 assetQty,,,,,) = tracker.portfolios(1);
        assertEq(starting, 1_000e18);
        assertEq(stableQty, 500e6);
        assertEq(assetQty, 0.25e18);
    }

    function testSettlementWindowIncludesExactUpperBoundary() public {
        module.record(tracker, 1, 1_000e18, 1_000e6, 0);
        round.setExecuted(true);
        vm.warp(round.end() + 600);
        stable.set(1e8, block.timestamp);
        asset.set(2_000e8, block.timestamp);
        assertEq(tracker.settle(1), 1e18);
    }

    function testTrackerRejectsObservationBeforeEnd() public {
        module.record(tracker, 1, 1_000e18, 1_000e6, 0);
        round.setExecuted(true);
        vm.expectRevert(abi.encodeWithSelector(PerformanceTracker.ObservationTooEarly.selector, round.end()));
        tracker.settle(1);
    }

    function testTrackerRejectsFreshButPreDeadlinePrice() public {
        module.record(tracker, 1, 1_000e18, 1_000e6, 0);
        round.setExecuted(true);
        vm.warp(round.end());
        stable.set(1e8, block.timestamp - 1);
        asset.set(2_000e8, block.timestamp - 1);
        vm.expectRevert(PerformanceTracker.InvalidObservation.selector);
        tracker.settle(1);
    }

    function testTrackerRejectsExpiredWindow() public {
        module.record(tracker, 1, 1_000e18, 1_000e6, 0);
        round.setExecuted(true);
        vm.warp(round.end() + 601);
        vm.expectRevert(abi.encodeWithSelector(PerformanceTracker.ObservationExpired.selector, round.end() + 600));
        tracker.settle(1);
    }

    function testTrackerRejectsUnexecutedRound() public {
        module.record(tracker, 1, 1_000e18, 1_000e6, 0);
        vm.expectRevert(abi.encodeWithSelector(PerformanceTracker.NotExecuted.selector, 1));
        tracker.settle(1);
    }

    function test_FailedEngineSettlementCanRetryWithoutLosingObservation() public {
        module.record(tracker, 1, 1_000e18, 1_000e6, 0);
        round.setExecuted(true);
        vm.warp(round.end());
        stable.set(1e8, block.timestamp);
        asset.set(2_000e8, block.timestamp);
        round.setShouldFail(true);
        vm.expectRevert(abi.encodeWithSignature("Error(string)", "settlement failure"));
        tracker.settle(1);
        round.setShouldFail(false);
        assertEq(tracker.settle(1), 1e18);
    }

    function testFuzzValueOfUsesCorrectUnits(uint96 stableQty, uint96 assetQty, uint64 stablePrice, uint64 assetPrice)
        public
        view
    {
        uint256 expected = uint256(stableQty) * stablePrice / 1e6 + uint256(assetQty) * assetPrice / 1e18;
        assertEq(tracker.valueOf(stableQty, assetQty, stablePrice, assetPrice), expected);
    }

    function testDiaAdapterRejectsStaleDocumentedStyleFeed() public {
        DiaFixture dia = new DiaFixture();
        DiaPortfolioOracle adapter = new DiaPortfolioOracle(dia, "USDC/USD", "ETH/USD", 60, 15);
        dia.set("USDC/USD", 1e8, uint128(block.timestamp));
        dia.set("ETH/USD", 2_000e8, uint128(block.timestamp));
        (uint256 s, uint256 a,) = adapter.read();
        assertEq(s, 1e18);
        assertEq(a, 2_000e18);
        dia.set("ETH/USD", 2_000e8, uint128(block.timestamp - 61));
        vm.expectRevert(abi.encodeWithSelector(DiaPortfolioOracle.StalePrice.selector, block.timestamp - 61));
        adapter.read();
    }

    function testDiaRejectsFutureAndZeroPrices() public {
        DiaFixture dia = new DiaFixture();
        DiaPortfolioOracle adapter = new DiaPortfolioOracle(dia, "USDC/USD", "ETH/USD", 60, 15);
        dia.set("USDC/USD", 1e8, uint128(block.timestamp));
        dia.set("ETH/USD", 2_000e8, uint128(block.timestamp + 1));
        vm.expectRevert(abi.encodeWithSelector(DiaPortfolioOracle.InvalidTimestamp.selector, block.timestamp + 1));
        adapter.read();
        dia.set("ETH/USD", 0, uint128(block.timestamp));
        vm.expectRevert(DiaPortfolioOracle.InvalidPrice.selector);
        adapter.read();
    }
}
