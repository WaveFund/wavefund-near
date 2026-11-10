// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Operator-minted test assets. No redemption value or connection to real USDC/ETH.
contract AuroraTestToken is ERC20 {
    address public immutable operator;
    uint8 private immutable precision;
    error TestnetOnly();
    error InvalidConfiguration();
    error OnlyOperator();

    constructor(string memory name_, string memory symbol_, uint8 decimals_, address operator_) ERC20(name_, symbol_) {
        if (block.chainid != 1313161555 && block.chainid != 31337) revert TestnetOnly();
        if (operator_ == address(0) || (decimals_ != 6 && decimals_ != 18)) revert InvalidConfiguration();
        operator = operator_;
        precision = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return precision;
    }

    function mint(address to, uint256 amount) external {
        if (block.chainid != 1313161555 && block.chainid != 31337) revert TestnetOnly();
        if (msg.sender != operator) revert OnlyOperator();
        _mint(to, amount);
    }
}
