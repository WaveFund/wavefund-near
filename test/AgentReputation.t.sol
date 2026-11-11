// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {Test} from "forge-std/Test.sol";
import {AgentReputation, IReputationRound, IReputationTracker} from "../src/AgentReputation.sol";

contract ReputationSource {
    address public engine;
    address public performanceTracker;
    uint8 public status = 3;
    bool public executed = true;
    uint256 public winner = 1;
    uint256 public factor = 1e18;
    uint256 public observed = 200;
    address public agent = address(123);
    bytes32 public observation = bytes32(uint256(1));

    function setObservation(bytes32 value) external {
        observation = value;
    }

    function configure(address engine_, address tracker_) external {
        engine = engine_;
        performanceTracker = tracker_;
    }

    function set(uint8 s, bool e, uint256 w, uint256 f, uint256 o) external {
        status = s;
        executed = e;
        winner = w;
        factor = f;
        observed = o;
    }

    function roundStatus(uint256) external view returns (uint8) {
        return status;
    }

    function roundExecuted(uint256) external view returns (bool) {
        return executed;
    }

    function winningAllocation(uint256) external view returns (uint256, uint16) {
        return (winner, 7500);
    }

    function proposals(uint256, uint256)
        external
        view
        returns (address, uint16, bool, uint256, uint256, uint256, string memory)
    {
        return (agent, 7500, false, 0, 0, 0, "");
    }

    function portfolios(uint256)
        external
        view
        returns (uint256, uint256, uint256, uint256, uint256, uint256, uint256, bytes32)
    {
        return (100e18, 0, 1e18, 100, observed, observed, factor, observation);
    }
}

contract AgentReputationTest is Test {
    ReputationSource source;
    AgentReputation rep;

    function setUp() public {
        source = new ReputationSource();
        source.configure(address(source), address(source));
        rep = new AgentReputation(IReputationRound(address(source)), IReputationTracker(address(source)));
    }

    function testPositiveNegativeAndFlatAreSeparateAndReplayRejected() public {
        source.set(3, true, 1, 1.01e18, 200);
        rep.record(1);
        assertEq(rep.score(address(123)), 1);
        source.set(3, true, 1, 0.99e18, 200);
        rep.record(2);
        source.set(3, true, 1, 1e18, 200);
        rep.record(3);
        (uint256 n, uint256 p, uint256 m, uint256 f) = rep.statistics(address(123));
        assertEq(n, 3);
        assertEq(p, 1);
        assertEq(m, 1);
        assertEq(f, 1);
        assertEq(rep.score(address(123)), 0);
        vm.expectRevert(abi.encodeWithSelector(AgentReputation.AlreadyRecorded.selector, 1));
        rep.record(1);
    }

    function testSelectedCancelledAndUnexecutedNeverScore() public {
        source.set(2, true, 1, 1.1e18, 200);
        vm.expectRevert(abi.encodeWithSelector(AgentReputation.NotSettled.selector, 1));
        rep.record(1);
        source.set(4, true, 1, 1.1e18, 200);
        vm.expectRevert(abi.encodeWithSelector(AgentReputation.NotSettled.selector, 1));
        rep.record(1);
        source.set(3, false, 1, 1.1e18, 200);
        vm.expectRevert(abi.encodeWithSelector(AgentReputation.NotSettled.selector, 1));
        rep.record(1);
    }

    function testHoldAndMissingObservationNeverScore() public {
        source.set(3, true, 0, 1.1e18, 200);
        vm.expectRevert(abi.encodeWithSelector(AgentReputation.NoAgentWinner.selector, 1));
        rep.record(1);
        source.set(3, true, 1, 1.1e18, 0);
        vm.expectRevert(abi.encodeWithSelector(AgentReputation.MissingObservation.selector, 1));
        rep.record(1);
        source.set(3, true, 1, 1.1e18, 200);
        source.setObservation(bytes32(0));
        vm.expectRevert(abi.encodeWithSelector(AgentReputation.MissingObservation.selector, 1));
        rep.record(1);
        assertFalse(rep.recorded(1));
    }

    function testBindingMismatchRejected() public {
        source.configure(address(999), address(source));
        vm.expectRevert(AgentReputation.InvalidConfiguration.selector);
        new AgentReputation(IReputationRound(address(source)), IReputationTracker(address(source)));
    }
}
