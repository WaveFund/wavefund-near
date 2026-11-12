// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

interface IReputationRound {
    function roundStatus(uint256 roundId) external view returns (uint8);
    function roundExecuted(uint256 roundId) external view returns (bool);
    function winningAllocation(uint256 roundId) external view returns (uint256, uint16);
    function performanceTracker() external view returns (address);
    function proposals(uint256 roundId, uint256 proposalId)
        external
        view
        returns (address, uint16, bool, uint256, uint256, uint256, string memory);
}

interface IReputationTracker {
    function engine() external view returns (address);
    function portfolios(uint256 roundId)
        external
        view
        returns (uint256, uint256, uint256, uint256, uint256, uint256, uint256, bytes32);
}

/// @notice Permissionless, once-per-round outcome statistics for one immutable engine/tracker pair.
/// @dev Absolute marked portfolio return, not excess return, audited alpha or lending creditworthiness.
/// No effect on selection, custody, payouts or existing registry selection counters.
contract AgentReputation {
    IReputationRound public immutable engine;
    IReputationTracker public immutable tracker;

    struct Statistics {
        uint256 samples;
        uint256 positive;
        uint256 negative;
        uint256 flat;
    }
    mapping(address => Statistics) public statistics;
    mapping(uint256 => bool) public recorded;
    error InvalidConfiguration();
    error NotSettled(uint256 roundId);
    error AlreadyRecorded(uint256 roundId);
    error NoAgentWinner(uint256 roundId);
    error MissingObservation(uint256 roundId);
    event OutcomeRecorded(uint256 indexed roundId, address indexed agent, uint256 returnFactorX18, int8 point);

    constructor(IReputationRound engine_, IReputationTracker tracker_) {
        if (
            address(engine_).code.length == 0 || address(tracker_).code.length == 0
                || tracker_.engine() != address(engine_) || engine_.performanceTracker() != address(tracker_)
        ) {
            revert InvalidConfiguration();
        }
        engine = engine_;
        tracker = tracker_;
    }

    function score(address agent) external view returns (int256) {
        Statistics storage s = statistics[agent];
        return s.positive >= s.negative
            ? SafeCast.toInt256(s.positive - s.negative)
            : -SafeCast.toInt256(s.negative - s.positive);
    }

    function record(uint256 roundId) external {
        if (recorded[roundId]) revert AlreadyRecorded(roundId);
        // QuantumRound.RoundStatus.Settled == 3. Cancelled or merely selected rounds never score.
        if (engine.roundStatus(roundId) != 3 || !engine.roundExecuted(roundId)) revert NotSettled(roundId);
        (uint256 winner,) = engine.winningAllocation(roundId);
        if (winner == 0) revert NoAgentWinner(roundId);
        (address agent,, bool statusQuo,,,,) = engine.proposals(roundId, winner);
        if (agent == address(0) || statusQuo) revert NoAgentWinner(roundId);
        (uint256 start,,, uint256 executedAt, uint256 observedAt,, uint256 factor, bytes32 observation) =
            tracker.portfolios(roundId);
        if (start == 0 || executedAt == 0 || observedAt < executedAt || observedAt == 0 || observation == bytes32(0)) {
            revert MissingObservation(roundId);
        }
        recorded[roundId] = true;
        Statistics storage s = statistics[agent];
        s.samples++;
        int8 point;
        if (factor > 1e18) {
            s.positive++;
            point = 1;
        } else if (factor < 1e18) {
            s.negative++;
            point = -1;
        } else {
            s.flat++;
        }
        emit OutcomeRecorded(roundId, agent, factor, point);
    }
}
