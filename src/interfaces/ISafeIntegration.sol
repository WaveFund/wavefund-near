// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IPortfolioOracle {
    function read() external view returns (uint256 stableUsdX18, uint256 assetUsdX18, uint256 publishedAt);
}

interface IRoundPreparation {
    function prepareRound(
        uint256 roundId,
        uint256 tradingEnd,
        uint256 evaluationEnd,
        uint256 rMin,
        uint256 rMax,
        uint256 twapWindow
    ) external returns (bytes32 policyHash, uint256 executionDeadline);
}

interface IPerformanceTracker {
    function recordExecution(uint256 roundId, uint256 startingValueX18, uint256 stableQty6, uint256 assetQty18) external;
}

interface ISafeModuleExecutor {
    function execTransactionFromModuleReturnData(address to, uint256 value, bytes memory data, uint8 operation)
        external
        returns (bool success, bytes memory returnData);
    function isModuleEnabled(address module) external view returns (bool);
}

interface IExactInputRouter {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
}
