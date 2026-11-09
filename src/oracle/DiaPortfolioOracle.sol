// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPortfolioOracle} from "../interfaces/ISafeIntegration.sol";

interface IDiaFeed {
    function getValue(string memory key) external view returns (uint128 price8, uint128 publishedAt);
}

/// @notice Immutable DIA-format adapter, NOT endorsement of a live deployment or its feed freshness.
/// @dev Documented Aurora testnet DIA feed was stale during verification; deployment must fail preflight.
contract DiaPortfolioOracle is IPortfolioOracle {
    IDiaFeed public immutable feed;
    string public stableKey;
    string public assetKey;
    uint256 public immutable maxAge;
    uint256 public immutable maxSkew;

    error InvalidConfiguration();
    error InvalidPrice();
    error InvalidTimestamp(uint256 publishedAt);
    error StalePrice(uint256 publishedAt);
    error TimestampSkew(uint256 stableTimestamp, uint256 assetTimestamp);

    constructor(IDiaFeed feed_, string memory stableKey_, string memory assetKey_, uint256 maxAge_, uint256 maxSkew_) {
        if (
            address(feed_).code.length == 0 || bytes(stableKey_).length == 0 || bytes(assetKey_).length == 0
                || keccak256(bytes(stableKey_)) == keccak256(bytes(assetKey_)) || maxAge_ == 0 || maxAge_ > 1 days
                || maxSkew_ > maxAge_
        ) revert InvalidConfiguration();
        feed = feed_;
        stableKey = stableKey_;
        assetKey = assetKey_;
        maxAge = maxAge_;
        maxSkew = maxSkew_;
    }

    function read() external view returns (uint256 stableUsdX18, uint256 assetUsdX18, uint256 publishedAt) {
        uint256 stableTime;
        uint256 assetTime;
        (stableUsdX18, stableTime) = _read(stableKey);
        (assetUsdX18, assetTime) = _read(assetKey);
        uint256 skew = stableTime > assetTime ? stableTime - assetTime : assetTime - stableTime;
        if (skew > maxSkew) revert TimestampSkew(stableTime, assetTime);
        publishedAt = stableTime < assetTime ? stableTime : assetTime;
    }

    function _read(string memory key) private view returns (uint256 price, uint256 publishedAt) {
        (uint128 value, uint128 timestamp) = feed.getValue(key);
        if (value == 0) revert InvalidPrice();
        if (timestamp == 0 || timestamp > block.timestamp) revert InvalidTimestamp(timestamp);
        if (block.timestamp - timestamp > maxAge) revert StalePrice(timestamp);
        return (uint256(value) * 1e10, timestamp);
    }
}
