// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IQuantumRoundControl, RoundStatus} from "../interfaces/IQuantumRoundControl.sol";
import {
    IPortfolioOracle,
    IPerformanceTracker,
    ISafeModuleExecutor,
    IExactInputRouter
} from "../interfaces/ISafeIntegration.sol";

interface ITrackerBindings {
    function engine() external view returns (address);
    function oracle() external view returns (address);
}

interface ICurrentRoundIdentity {
    function currentRoundId() external view returns (uint256);
}

/// @notice Fixed two-asset CALL-only execution for one manager-owned Safe.
/// @dev Safe owners retain custody and may disable this module. They cannot change an active round's policy.
///      Owner/other-module balance changes before execution invalidate the snapshot. After execution the
///      performance tracker measures the recorded portfolio rather than arbitrary Safe balance changes.
contract TradingSafeModule is ReentrancyGuard {
    uint256 private constant BPS = 10_000;
    uint16 public constant MAX_SLIPPAGE_BPS = 1_000;

    address public immutable safe;
    IQuantumRoundControl public immutable engine;
    IERC20 public immutable stable;
    IERC20 public immutable asset;
    address public immutable router;
    IPortfolioOracle public immutable oracle;
    IPerformanceTracker public immutable tracker;

    uint16 public maxSlippageBps = 100;
    uint256 public activeRoundId;

    struct Authorization {
        uint256 roundId;
        uint256 tradingEnd;
        uint256 evaluationEnd;
        uint256 executionDeadline;
        uint256 rMin;
        uint256 rMax;
        uint256 twapWindow;
    }

    struct Snapshot {
        uint256 tradingEnd;
        uint256 evaluationEnd;
        uint256 executionDeadline;
        uint256 stableBalance;
        uint256 assetBalance;
        bytes32 policyHash;
        bool executed;
        bool cancelled;
    }
    Authorization public authorization;
    mapping(uint256 roundId => Snapshot) public snapshots;

    error ZeroAddress();
    error InvalidDecimals();
    error InvalidDeployment();
    error TrackerBindingMismatch();
    error OnlySafe();
    error OnlyEngine();
    error ActiveRound(uint256 roundId);
    error AuthorizationPending();
    error InvalidSchedule();
    error UnauthorizedRound(uint256 roundId);
    error InvalidSlippage(uint256 bps);
    error EmptyPortfolio();
    error NotExecutable(uint256 roundId);
    error ExecutionExpired(uint256 deadline);
    error DeadlineNotExpired(uint256 deadline);
    error SnapshotChanged();
    error InvalidAllocation(uint256 bps);
    error SafeCallFailed(address target);
    error TokenOperationFailed(address token);
    error UnexpectedBalanceChange();
    error InvalidOraclePrice();

    event PolicyConfigured(uint16 maxSlippageBps);
    event RoundAuthorized(
        uint256 indexed roundId, uint256 tradingEnd, uint256 evaluationEnd, uint256 executionDeadline
    );
    event AuthorizationRevoked(uint256 indexed roundId);
    event RoundPrepared(
        uint256 indexed roundId, bytes32 indexed policyHash, uint256 stableBalance, uint256 assetBalance
    );
    event AllocationExecuted(
        uint256 indexed roundId,
        uint256 indexed winnerId,
        uint16 targetBps,
        uint256 startingValueX18,
        uint256 stableQuantity,
        uint256 assetQuantity
    );
    event ExpiredRoundCancelled(uint256 indexed roundId);

    constructor(
        address safe_,
        IQuantumRoundControl engine_,
        IERC20 stable_,
        IERC20 asset_,
        address router_,
        IPortfolioOracle oracle_,
        IPerformanceTracker tracker_
    ) {
        if (
            safe_ == address(0) || address(engine_) == address(0) || address(stable_) == address(0)
                || address(asset_) == address(0) || router_ == address(0) || address(oracle_) == address(0)
                || address(tracker_) == address(0)
        ) revert ZeroAddress();
        if (
            safe_.code.length == 0 || address(engine_).code.length == 0 || router_.code.length == 0
                || address(oracle_).code.length == 0 || address(tracker_).code.length == 0
        ) revert InvalidDeployment();
        if (
            address(stable_) == address(asset_) || IERC20Metadata(address(stable_)).decimals() != 6
                || IERC20Metadata(address(asset_)).decimals() != 18
        ) revert InvalidDecimals();
        if (
            ITrackerBindings(address(tracker_)).engine() != address(engine_)
                || ITrackerBindings(address(tracker_)).oracle() != address(oracle_)
        ) revert TrackerBindingMismatch();
        safe = safe_;
        engine = engine_;
        stable = stable_;
        asset = asset_;
        router = router_;
        oracle = oracle_;
        tracker = tracker_;
    }

    modifier onlySafe() {
        if (msg.sender != safe) revert OnlySafe();
        _;
    }

    function configurePolicy(uint16 slippageBps) external onlySafe nonReentrant {
        _requireNoActiveRound();
        if (authorization.roundId != 0) revert AuthorizationPending();
        if (slippageBps > MAX_SLIPPAGE_BPS) revert InvalidSlippage(slippageBps);
        maxSlippageBps = slippageBps;
        emit PolicyConfigured(slippageBps);
    }

    /// @notice Safe owners approve exact timing before the keeper opens the next market.
    function authorizeRound(
        uint256 roundId,
        uint256 tradingEnd,
        uint256 evaluationEnd,
        uint256 executionDeadline,
        uint256 rMin,
        uint256 rMax,
        uint256 twapWindow
    ) external onlySafe nonReentrant {
        _requireNoActiveRound();
        if (roundId != ICurrentRoundIdentity(address(engine)).currentRoundId() + 1) revert UnauthorizedRound(roundId);
        if (
            tradingEnd <= block.timestamp || executionDeadline <= tradingEnd || executionDeadline >= evaluationEnd
                || rMin >= rMax || twapWindow == 0 || twapWindow > tradingEnd - block.timestamp
        ) revert InvalidSchedule();
        authorization = Authorization(roundId, tradingEnd, evaluationEnd, executionDeadline, rMin, rMax, twapWindow);
        emit RoundAuthorized(roundId, tradingEnd, evaluationEnd, executionDeadline);
    }

    function revokeAuthorization() external onlySafe nonReentrant {
        uint256 id = authorization.roundId;
        delete authorization;
        emit AuthorizationRevoked(id);
    }

    /// @notice Called atomically by the engine while opening a round; failed opening rolls this back.
    function prepareRound(
        uint256 roundId,
        uint256 tradingEnd,
        uint256 evaluationEnd,
        uint256 rMin,
        uint256 rMax,
        uint256 twapWindow
    ) external nonReentrant returns (bytes32 policyHash, uint256 executionDeadline) {
        if (msg.sender != address(engine)) revert OnlyEngine();
        if (!ISafeModuleExecutor(safe).isModuleEnabled(address(this))) revert NotExecutable(roundId);
        _requireNoActiveRound();
        Authorization memory a = authorization;
        if (
            a.roundId != roundId || a.tradingEnd != tradingEnd || a.evaluationEnd != evaluationEnd || a.rMin != rMin
                || a.rMax != rMax || a.twapWindow != twapWindow
        ) revert UnauthorizedRound(roundId);
        uint256 stableBalance = stable.balanceOf(safe);
        uint256 assetBalance = asset.balanceOf(safe);
        if (stableBalance == 0 && assetBalance == 0) revert EmptyPortfolio();
        // Require the oracle to be usable before anyone can fund this market.
        _prices();
        executionDeadline = a.executionDeadline;
        policyHash = keccak256(
            abi.encode(
                block.chainid,
                address(this),
                safe,
                address(engine),
                address(stable),
                address(asset),
                router,
                address(oracle),
                address(tracker),
                maxSlippageBps,
                a
            )
        );
        snapshots[roundId] = Snapshot(
            tradingEnd, evaluationEnd, executionDeadline, stableBalance, assetBalance, policyHash, false, false
        );
        activeRoundId = roundId;
        delete authorization;
        emit RoundPrepared(roundId, policyHash, stableBalance, assetBalance);
    }

    /// @notice Legacy allocation-source selector retained so the forecasting core need not be rewritten.
    function currentTEthBps() external view returns (uint256) {
        (uint256 stablePrice, uint256 assetPrice) = _prices();
        uint256 stableValue = Math.mulDiv(stable.balanceOf(safe), stablePrice, 1e6);
        uint256 assetValue = Math.mulDiv(asset.balanceOf(safe), assetPrice, 1e18);
        uint256 value = stableValue + assetValue;
        if (value == 0) revert EmptyPortfolio();
        return Math.mulDiv(assetValue, BPS, value);
    }

    /// @notice Anyone may trigger the exact winning action. No caller chooses a recipient or calldata.
    function execute(uint256 roundId, uint256 minOut, uint256 deadline) external nonReentrant {
        Snapshot storage s = snapshots[roundId];
        if (
            !ISafeModuleExecutor(safe).isModuleEnabled(address(this)) || activeRoundId != roundId
                || s.policyHash == bytes32(0) || s.executed || s.cancelled
                || engine.roundStatus(roundId) != RoundStatus.Collapsed || block.timestamp < s.tradingEnd
        ) revert NotExecutable(roundId);
        if (block.timestamp > s.executionDeadline || deadline < block.timestamp || deadline > s.executionDeadline) {
            revert ExecutionExpired(s.executionDeadline);
        }
        if (stable.balanceOf(safe) != s.stableBalance || asset.balanceOf(safe) != s.assetBalance) {
            revert SnapshotChanged();
        }
        (uint256 winner, uint16 targetBps) = engine.winningAllocation(roundId);
        if (targetBps > BPS) revert InvalidAllocation(targetBps);
        (uint256 stablePrice, uint256 assetPrice) = _prices();
        uint256 assetValue = Math.mulDiv(s.assetBalance, assetPrice, 1e18);
        uint256 startingValue = Math.mulDiv(s.stableBalance, stablePrice, 1e6) + assetValue;
        if (startingValue == 0) revert EmptyPortfolio();
        uint256 targetValue = Math.mulDiv(startingValue, targetBps, BPS);
        s.executed = true;
        if (winner != 0 && targetValue > assetValue) {
            uint256 amountIn = Math.min(s.stableBalance, Math.mulDiv(targetValue - assetValue, 1e6, stablePrice));
            uint256 expected = Math.mulDiv(Math.mulDiv(amountIn, stablePrice, 1e6), 1e18, assetPrice);
            if (amountIn != 0) {
                _swap(
                    true,
                    amountIn,
                    Math.max(1, Math.max(minOut, Math.mulDiv(expected, BPS - maxSlippageBps, BPS))),
                    deadline
                );
            }
        } else if (winner != 0 && assetValue > targetValue) {
            uint256 amountIn = Math.min(s.assetBalance, Math.mulDiv(assetValue - targetValue, 1e18, assetPrice));
            uint256 expected = Math.mulDiv(Math.mulDiv(amountIn, assetPrice, 1e18), 1e6, stablePrice);
            if (amountIn != 0) {
                _swap(
                    false,
                    amountIn,
                    Math.max(1, Math.max(minOut, Math.mulDiv(expected, BPS - maxSlippageBps, BPS))),
                    deadline
                );
            }
        }
        uint256 stableAfter = stable.balanceOf(safe);
        uint256 assetAfter = asset.balanceOf(safe);
        tracker.recordExecution(roundId, startingValue, stableAfter, assetAfter);
        engine.markExecuted(roundId);
        emit AllocationExecuted(roundId, winner, targetBps, startingValue, stableAfter, assetAfter);
    }

    /// @notice Cancellation is only available when no investment was executed and its window is over.
    function abortExpired(uint256 roundId) external nonReentrant {
        Snapshot storage s = snapshots[roundId];
        if (
            activeRoundId != roundId || s.policyHash == bytes32(0) || s.executed || s.cancelled
                || engine.roundStatus(roundId) != RoundStatus.Collapsed
        ) revert NotExecutable(roundId);
        if (block.timestamp <= s.executionDeadline) revert DeadlineNotExpired(s.executionDeadline);
        s.cancelled = true;
        engine.cancelRound(roundId);
        emit ExpiredRoundCancelled(roundId);
    }

    function _swap(bool buyAsset, uint256 amountIn, uint256 minOut, uint256 deadline) private {
        IERC20 input = buyAsset ? stable : asset;
        IERC20 output = buyAsset ? asset : stable;
        uint256 beforeInput = input.balanceOf(safe);
        uint256 beforeOutput = output.balanceOf(safe);
        _approve(input, 0);
        _approve(input, amountIn);
        address[] memory route = new address[](2);
        route[0] = address(input);
        route[1] = address(output);
        _safeCall(
            router,
            abi.encodeCall(IExactInputRouter.swapExactTokensForTokens, (amountIn, minOut, route, safe, deadline)),
            false
        );
        _approve(input, 0);
        uint256 afterInput = input.balanceOf(safe);
        uint256 afterOutput = output.balanceOf(safe);
        if (
            beforeInput < afterInput || beforeInput - afterInput != amountIn || afterOutput < beforeOutput
                || afterOutput - beforeOutput < minOut || input.allowance(safe, router) != 0
        ) revert UnexpectedBalanceChange();
    }

    function _approve(IERC20 token, uint256 amount) private {
        _safeCall(address(token), abi.encodeCall(IERC20.approve, (router, amount)), true);
    }

    function _safeCall(address target, bytes memory data, bool tokenCall) private {
        (bool success, bytes memory returnData) =
            ISafeModuleExecutor(safe).execTransactionFromModuleReturnData(target, 0, data, 0);
        if (!success) revert SafeCallFailed(target);
        if (tokenCall && returnData.length != 0 && (returnData.length != 32 || !abi.decode(returnData, (bool)))) {
            revert TokenOperationFailed(target);
        }
    }

    function _prices() private view returns (uint256 stablePrice, uint256 assetPrice) {
        (stablePrice, assetPrice,) = oracle.read();
        if (stablePrice == 0 || assetPrice == 0) revert InvalidOraclePrice();
    }

    function _requireNoActiveRound() private view {
        uint256 id = activeRoundId;
        if (id != 0) {
            RoundStatus status = engine.roundStatus(id);
            if (status != RoundStatus.Settled && status != RoundStatus.Cancelled) revert ActiveRound(id);
        }
    }
}
