// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
// Separate legacy-codegen root ensures actual upstream Safe artifact is built.
import {Safe} from "../../lib/safe-contracts/contracts/Safe.sol";

contract SafeBuild {
    function creationCode() external pure returns (bytes memory) {
        return type(Safe).creationCode;
    }
}
