// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {Script} from "forge-std/Script.sol";
import {AgentReputation, IReputationRound, IReputationTracker} from "../src/AgentReputation.sol";

/// @notice Additive testnet deployment; never replaces trading contracts or transfers tokens.
contract DeployAgentReputation is Script {
    function run() external returns (AgentReputation reputation) {
        require(block.chainid == 1313161555 || block.chainid == 31337, "testnet/local only");
        address engine = vm.envAddress("REPUTATION_ENGINE");
        address tracker = vm.envAddress("REPUTATION_TRACKER");
        vm.startBroadcast();
        reputation = new AgentReputation(IReputationRound(engine), IReputationTracker(tracker));
        vm.stopBroadcast();
    }
}
