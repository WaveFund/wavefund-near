// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPortfolioOracle} from "../interfaces/ISafeIntegration.sol";

interface ISupraPullV2 {
    struct PriceInfo {
        uint256[] pairs;
        uint256[] prices;
        uint256[] timestamp;
        uint256[] decimal;
        uint256[] round;
    }
    function verifyOracleProofV2(bytes calldata proof) external returns (PriceInfo memory);
}

/// @notice Permissionless cache accepting only verifier-authenticated ETH/USD and USDC/USD.
/// @dev The immutable verifier address may itself be upgradeable: its governance is a trust assumption.
/// Millisecond source timestamps are retained; read() returns the older feed time in seconds.
contract SupraPortfolioOracle is IPortfolioOracle, ReentrancyGuard {
    uint256 public constant ETH_USD = 19;
    uint256 public constant USDC_USD = 89;
    ISupraPullV2 public immutable verifier;
    uint256 public immutable maxAge;
    uint256 public immutable maxSkew;
    uint256 public stableTimestampMs;
    uint256 public assetTimestampMs;
    uint256 public stableRound;
    uint256 public assetRound;
    uint256 private stablePrice;
    uint256 private assetPrice;

    error InvalidConfiguration();
    error InvalidProofShape();
    error UnexpectedFeed(uint256 feed);
    error InvalidPrice();
    error InvalidTimestamp(uint256 timestampMs);
    error StalePrice(uint256 timestampMs);
    error TimestampSkew();
    error NonIncreasingObservation();
    error NoVerifiedPrices();
    event PricesVerified(
        uint256 stableUsdX18, uint256 assetUsdX18, uint256 stableTimeMs, uint256 assetTimeMs, bytes32 proofHash
    );

    constructor(ISupraPullV2 verifier_, uint256 maxAge_, uint256 maxSkew_) {
        if (address(verifier_).code.length == 0 || maxAge_ == 0 || maxAge_ > 5 minutes || maxSkew_ > maxAge_) {
            revert InvalidConfiguration();
        }
        verifier = verifier_;
        maxAge = maxAge_;
        maxSkew = maxSkew_;
    }

    function update(bytes calldata proof) external nonReentrant {
        ISupraPullV2.PriceInfo memory p = verifier.verifyOracleProofV2(proof);
        if (
            p.pairs.length != 2 || p.prices.length != 2 || p.timestamp.length != 2 || p.decimal.length != 2
                || p.round.length != 2
        ) revert InvalidProofShape();
        uint256 si;
        uint256 ai;
        if (p.pairs[0] == USDC_USD && p.pairs[1] == ETH_USD) {
            si = 0;
            ai = 1;
        } else if (p.pairs[0] == ETH_USD && p.pairs[1] == USDC_USD) {
            si = 1;
            ai = 0;
        } else {
            revert UnexpectedFeed(p.pairs[0] != ETH_USD && p.pairs[0] != USDC_USD ? p.pairs[0] : p.pairs[1]);
        }
        uint256 st = p.timestamp[si];
        uint256 at = p.timestamp[ai];
        _validateTime(st);
        _validateTime(at);
        if ((st > at ? st - at : at - st) > maxSkew * 1000) revert TimestampSkew();
        // One feed may remain unchanged while the other advances; neither may roll back.
        if (
            st < stableTimestampMs || at < assetTimestampMs || p.round[si] < stableRound || p.round[ai] < assetRound
                || (st == stableTimestampMs && at == assetTimestampMs)
        ) {
            revert NonIncreasingObservation();
        }
        if (p.round[si] == 0 || p.round[ai] == 0) revert InvalidProofShape();
        uint256 s = _normalize(p.prices[si], p.decimal[si]);
        uint256 a = _normalize(p.prices[ai], p.decimal[ai]);
        stablePrice = s;
        assetPrice = a;
        stableTimestampMs = st;
        assetTimestampMs = at;
        stableRound = p.round[si];
        assetRound = p.round[ai];
        emit PricesVerified(s, a, st, at, keccak256(proof));
    }

    function read() external view returns (uint256, uint256, uint256) {
        if (stableTimestampMs == 0 || assetTimestampMs == 0) revert NoVerifiedPrices();
        _validateTime(stableTimestampMs);
        _validateTime(assetTimestampMs);
        return (stablePrice, assetPrice, Math.min(stableTimestampMs, assetTimestampMs) / 1000);
    }

    function _validateTime(uint256 ms) private view {
        if (ms == 0 || ms > block.timestamp * 1000) revert InvalidTimestamp(ms);
        if (block.timestamp * 1000 - ms > maxAge * 1000) revert StalePrice(ms);
    }

    function _normalize(uint256 price, uint256 decimals_) private pure returns (uint256 value) {
        if (price == 0 || decimals_ > 36) revert InvalidPrice();
        value = Math.mulDiv(price, 1e18, 10 ** decimals_);
        if (value == 0) revert InvalidPrice();
    }
}
