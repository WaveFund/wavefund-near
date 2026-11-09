// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPortfolioOracle} from "./interfaces/ISafeIntegration.sol";

interface IPerformanceRound {
    function evaluationEnd(uint256 roundId) external view returns (uint256);
    function roundExecuted(uint256 roundId) external view returns (bool);
    function settle(uint256 roundId, uint256 realisedReturn) external;
}

interface IBoundTradingModule {
    function engine() external view returns (address);
    function oracle() external view returns (address);
    function tracker() external view returns (address);
}

/// @notice Prices the immutable executed strategy portfolio, independent of later Safe transfers.
/// @dev Permissionless bounded observation, not an exact historical-price oracle. The first valid
///      transaction selects a fresh post-deadline observation. Oracle availability/ordering remain assumptions.
contract PerformanceTracker is ReentrancyGuard {
    uint256 private constant ONE = 1e18;
    IPerformanceRound public immutable engine;
    IPortfolioOracle public immutable oracle;
    address public immutable admin;
    uint256 public immutable observationWindow;
    address public module;

    struct Portfolio {
        uint256 startingValueX18;
        uint256 stableQty6;
        uint256 assetQty18;
        uint256 executedAt;
        uint256 observedAt;
        uint256 oraclePublishedAt;
        uint256 realisedReturn;
        bytes32 observationHash;
    }
    mapping(uint256 => Portfolio) public portfolios;

    error InvalidConfiguration();
    error Unauthorized();
    error AlreadyBound();
    error AlreadyRecorded(uint256 roundId);
    error NotRecorded(uint256 roundId);
    error NotExecuted(uint256 roundId);
    error AlreadyObserved(uint256 roundId);
    error ObservationTooEarly(uint256 evaluationEnd);
    error ObservationExpired(uint256 deadline);
    error InvalidObservation();

    event ModuleBound(address indexed module);
    event ExecutionRecorded(uint256 indexed roundId, uint256 startingValueX18, uint256 stableQty6, uint256 assetQty18);
    event PerformanceObserved(
        uint256 indexed roundId, uint256 realisedReturn, uint256 publishedAt, bytes32 observationHash
    );

    constructor(IPerformanceRound engine_, IPortfolioOracle oracle_, address admin_, uint256 observationWindow_) {
        if (
            address(engine_).code.length == 0 || address(oracle_).code.length == 0 || admin_ == address(0)
                || observationWindow_ == 0 || observationWindow_ > 1 days
        ) revert InvalidConfiguration();
        engine = engine_;
        oracle = oracle_;
        admin = admin_;
        observationWindow = observationWindow_;
    }

    function bindModule(address module_) external {
        if (msg.sender != admin) revert Unauthorized();
        if (module != address(0)) revert AlreadyBound();
        if (module_.code.length == 0) revert InvalidConfiguration();
        IBoundTradingModule candidate = IBoundTradingModule(module_);
        if (
            candidate.engine() != address(engine) || candidate.oracle() != address(oracle)
                || candidate.tracker() != address(this)
        ) revert InvalidConfiguration();
        module = module_;
        emit ModuleBound(module_);
    }

    function recordExecution(uint256 roundId, uint256 startingValueX18, uint256 stableQty6, uint256 assetQty18)
        external
    {
        if (msg.sender != module) revert Unauthorized();
        if (portfolios[roundId].startingValueX18 != 0) revert AlreadyRecorded(roundId);
        if (
            startingValueX18 == 0 || (stableQty6 == 0 && assetQty18 == 0)
                || block.timestamp >= engine.evaluationEnd(roundId)
        ) revert InvalidObservation();
        portfolios[roundId] = Portfolio(startingValueX18, stableQty6, assetQty18, block.timestamp, 0, 0, 0, bytes32(0));
        emit ExecutionRecorded(roundId, startingValueX18, stableQty6, assetQty18);
    }

    function settle(uint256 roundId) external nonReentrant returns (uint256 realisedReturn) {
        Portfolio storage p = portfolios[roundId];
        if (p.startingValueX18 == 0) revert NotRecorded(roundId);
        if (p.observedAt != 0) revert AlreadyObserved(roundId);
        if (!engine.roundExecuted(roundId)) revert NotExecuted(roundId);
        uint256 end = engine.evaluationEnd(roundId);
        if (block.timestamp < end) revert ObservationTooEarly(end);
        uint256 deadline = end + observationWindow;
        if (block.timestamp > deadline) revert ObservationExpired(deadline);
        (uint256 stablePrice, uint256 assetPrice, uint256 publishedAt) = oracle.read();
        if (stablePrice == 0 || assetPrice == 0 || publishedAt < end || publishedAt > block.timestamp) {
            revert InvalidObservation();
        }
        uint256 endingValue = valueOf(p.stableQty6, p.assetQty18, stablePrice, assetPrice);
        realisedReturn = Math.mulDiv(endingValue, ONE, p.startingValueX18);
        bytes32 hash =
            keccak256(abi.encode(block.chainid, address(this), roundId, stablePrice, assetPrice, publishedAt));
        p.observedAt = block.timestamp;
        p.oraclePublishedAt = publishedAt;
        p.realisedReturn = realisedReturn;
        p.observationHash = hash;
        engine.settle(roundId, realisedReturn);
        emit PerformanceObserved(roundId, realisedReturn, publishedAt, hash);
    }

    function valueOf(uint256 stableQty6, uint256 assetQty18, uint256 stablePriceX18, uint256 assetPriceX18)
        public
        pure
        returns (uint256)
    {
        return Math.mulDiv(stableQty6, stablePriceX18, 1e6) + Math.mulDiv(assetQty18, assetPriceX18, ONE);
    }
}
