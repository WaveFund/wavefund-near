// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPortfolioOracle} from "../interfaces/ISafeIntegration.sol";

interface IAggregatorFeed {
    function decimals() external view returns (uint8);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/// @notice Immutable validated consumer of two AggregatorV3-compatible feeds.
/// @dev This adapter establishes no claim that Chainlink or another provider operates on Aurora.
///      Deployment requires independently verified feed identities, owners, heartbeats and decimals.
contract FeedPortfolioOracle is IPortfolioOracle {
    IAggregatorFeed public immutable stableFeed;
    IAggregatorFeed public immutable assetFeed;
    uint256 public immutable stableScale;
    uint256 public immutable assetScale;
    uint256 public immutable maxAge;
    uint256 public immutable maxSkew;

    error InvalidConfiguration();
    error InvalidPrice(address feed);
    error InvalidTimestamp(address feed, uint256 publishedAt);
    error StalePrice(address feed, uint256 publishedAt);
    error IncompleteRound(address feed);
    error TimestampSkew(uint256 stableTimestamp, uint256 assetTimestamp);

    constructor(IAggregatorFeed stableFeed_, IAggregatorFeed assetFeed_, uint256 maxAge_, uint256 maxSkew_) {
        if (
            address(stableFeed_).code.length == 0 || address(assetFeed_).code.length == 0 || maxAge_ == 0
                || maxAge_ > 1 days || maxSkew_ > maxAge_
        ) revert InvalidConfiguration();
        uint8 stableDecimals = stableFeed_.decimals();
        uint8 assetDecimals = assetFeed_.decimals();
        if (stableDecimals > 18 || assetDecimals > 18) revert InvalidConfiguration();
        stableFeed = stableFeed_;
        assetFeed = assetFeed_;
        stableScale = 10 ** (18 - stableDecimals);
        assetScale = 10 ** (18 - assetDecimals);
        maxAge = maxAge_;
        maxSkew = maxSkew_;
    }

    function read() external view returns (uint256 stableUsdX18, uint256 assetUsdX18, uint256 publishedAt) {
        uint256 stableTime;
        uint256 assetTime;
        (stableUsdX18, stableTime) = _read(stableFeed, stableScale);
        (assetUsdX18, assetTime) = _read(assetFeed, assetScale);
        uint256 skew = stableTime > assetTime ? stableTime - assetTime : assetTime - stableTime;
        if (skew > maxSkew) revert TimestampSkew(stableTime, assetTime);
        publishedAt = stableTime < assetTime ? stableTime : assetTime;
    }

    function _read(IAggregatorFeed feed, uint256 scale) private view returns (uint256 price, uint256 publishedAt) {
        (uint80 roundId, int256 answer,, uint256 updatedAt, uint80 answeredInRound) = feed.latestRoundData();
        if (roundId == 0 || answeredInRound < roundId) revert IncompleteRound(address(feed));
        if (answer <= 0) revert InvalidPrice(address(feed));
        if (updatedAt == 0 || updatedAt > block.timestamp) revert InvalidTimestamp(address(feed), updatedAt);
        if (block.timestamp - updatedAt > maxAge) revert StalePrice(address(feed), updatedAt);
        // Solidity checked multiplication rejects values that cannot fit normalized precision.
        price = uint256(answer) * scale;
        publishedAt = updatedAt;
    }
}
