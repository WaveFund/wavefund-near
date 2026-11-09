// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    PrimaryProdDataServiceConsumerBase
} from "@redstone-finance/evm-connector/contracts/data-services/PrimaryProdDataServiceConsumerBase.sol";

/// @dev DIAGNOSTIC ONLY. No freshness validation, storage or IPortfolioOracle interface.
///      Allows unsigned eth_call runtime probes of authentic historical signatures. Never use for settlement.
contract RedstoneSignatureProbe is PrimaryProdDataServiceConsumerBase {
    function inspect() external view returns (uint256 stable8, uint256 asset8, uint256 timestampMs) {
        bytes32[] memory feeds = new bytes32[](2);
        feeds[0] = bytes32("USDC");
        feeds[1] = bytes32("ETH");
        (uint256[] memory values, uint256 timestamp) = getOracleNumericValuesAndTimestampFromTxMsg(feeds);
        return (values[0], values[1], timestamp);
    }
}
