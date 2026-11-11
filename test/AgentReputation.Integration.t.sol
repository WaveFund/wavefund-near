// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {ProductScenariosTest} from "./ProductScenarios.t.sol";
import {AgentReputation, IReputationRound, IReputationTracker} from "../src/AgentReputation.sol";

contract AgentReputationIntegrationTest is ProductScenariosTest {
    function testReputationActualSettlementGain() public {
        AgentReputation rep =
            new AgentReputation(IReputationRound(address(engine)), IReputationTracker(address(tracker)));
        _exercise6000(2050e18, 1.015e18, 0.65e18);
        rep.record(1);
        assertEq(rep.score(_proposer(2)), 1);
        (uint256 n, uint256 p, uint256 m, uint256 f) = rep.statistics(_proposer(2));
        assertEq(n, 1);
        assertEq(p, 1);
        assertEq(m, 0);
        assertEq(f, 0);
        assertEq(rep.score(_proposer(0)), 0);
    }

    function testReputationActualSettlementLoss() public {
        AgentReputation rep =
            new AgentReputation(IReputationRound(address(engine)), IReputationTracker(address(tracker)));
        _exercise6000(1950e18, 0.985e18, 0.35e18);
        rep.record(1);
        assertEq(rep.score(_proposer(2)), -1);
        (uint256 n, uint256 p, uint256 m, uint256 f) = rep.statistics(_proposer(2));
        assertEq(n, 1);
        assertEq(p, 0);
        assertEq(m, 1);
        assertEq(f, 0);
    }
}
