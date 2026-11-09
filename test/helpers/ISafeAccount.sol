// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {Enum} from "../../lib/safe-contracts/contracts/common/Enum.sol";

interface ISafeAccount {
    function setup(
        address[] calldata owners,
        uint256 threshold,
        address to,
        bytes calldata data,
        address fallbackHandler,
        address paymentToken,
        uint256 payment,
        address payable paymentReceiver
    ) external;
    function execTransaction(
        address to,
        uint256 value,
        bytes calldata data,
        Enum.Operation operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address payable refundReceiver,
        bytes memory signatures
    ) external payable returns (bool);
    function isModuleEnabled(address module) external view returns (bool);
    function VERSION() external view returns (string memory);
    function getThreshold() external view returns (uint256);
}
