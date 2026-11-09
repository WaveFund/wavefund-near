// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";

/// @dev Build-only root: guarantees the external v4 implementation artifact on a clean sparse build.
///      Never part of the deployed money-contract stack.
contract ForecastBuild {
    function creationCode() external pure returns (bytes memory) {
        return type(PoolManager).creationCode;
    }
}
