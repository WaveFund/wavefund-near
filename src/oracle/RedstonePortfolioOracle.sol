// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    PrimaryProdDataServiceConsumerBase
} from "@redstone-finance/evm-connector/contracts/data-services/PrimaryProdDataServiceConsumerBase.sol";
import {IPortfolioOracle} from "../interfaces/ISafeIntegration.sol";

/// @notice Permissionless, signature-verified USDC/ETH cache for the existing read-only portfolio interface.
/// @dev Uses the pinned RedStone primary-prod 3-of-5 signer policy. No owner can replace signers or prices.
///      Relayers append an upstream-format signed payload to update(). HTTP response metadata is not trusted.
contract RedstonePortfolioOracle is PrimaryProdDataServiceConsumerBase, IPortfolioOracle {
    uint256 public immutable maxAge;
    uint256 public lastTimestampMilliseconds;
    uint256 private stablePriceX18;
    uint256 private assetPriceX18;

    error InvalidMaxAge();
    error InvalidPublicationTime(uint256 milliseconds);
    error StalePublication(uint256 milliseconds);
    error NonIncreasingPublication(uint256 milliseconds);
    error InvalidPrice();
    error NoVerifiedPrices();

    event PricesVerified(
        uint256 stableUsdX18, uint256 assetUsdX18, uint256 timestampMilliseconds, bytes32 calldataHash
    );

    constructor(uint256 maxAgeSeconds) {
        if (maxAgeSeconds == 0 || maxAgeSeconds > 5 minutes) revert InvalidMaxAge();
        maxAge = maxAgeSeconds;
    }

    /// @notice Anyone may deliver authentic new signed data. No caller-supplied numerical price is accepted.
    function update() external {
        bytes32[] memory feeds = new bytes32[](2);
        feeds[0] = bytes32("USDC");
        feeds[1] = bytes32("ETH");
        // This upstream method verifies signatures/quorum/equal package timestamps, but NOT freshness.
        (uint256[] memory values, uint256 timestampMs) = getOracleNumericValuesAndTimestampFromTxMsg(feeds);
        validateTimestamp(timestampMs);
        if (timestampMs <= lastTimestampMilliseconds) revert NonIncreasingPublication(timestampMs);
        if (values[0] == 0 || values[1] == 0) revert InvalidPrice();
        // Standard RedStone numeric USD feeds have eight decimals. Checked multiplication rejects overflow.
        uint256 stable = values[0] * 1e10;
        uint256 asset = values[1] * 1e10;
        stablePriceX18 = stable;
        assetPriceX18 = asset;
        lastTimestampMilliseconds = timestampMs;
        emit PricesVerified(stable, asset, timestampMs, keccak256(msg.data));
    }

    function validateTimestamp(uint256 timestampMs) public view override {
        uint256 seconds_ = timestampMs / 1000;
        if (seconds_ == 0 || seconds_ > block.timestamp) revert InvalidPublicationTime(timestampMs);
        if (block.timestamp - seconds_ > maxAge) revert StalePublication(timestampMs);
    }

    function read() external view returns (uint256 stableUsdX18, uint256 assetUsdX18, uint256 publishedAt) {
        uint256 timestamp = lastTimestampMilliseconds;
        if (timestamp == 0) revert NoVerifiedPrices();
        validateTimestamp(timestamp);
        return (stablePriceX18, assetPriceX18, timestamp / 1000);
    }
}
