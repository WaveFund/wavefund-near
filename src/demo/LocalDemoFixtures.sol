// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IPortfolioOracle} from "../interfaces/ISafeIntegration.sol";

/// @dev Simulation fixtures are intentionally restricted to disposable local chain 31337.
abstract contract LocalChainOnly {
    error LocalNetworkOnly(uint256 chainId);

    constructor() {
        _requireLocal();
    }
    modifier localOnly() {
        _requireLocal();
        _;
    }

    function _requireLocal() internal view {
        if (block.chainid != 31337) revert LocalNetworkOnly(block.chainid);
    }
}

contract LocalDemoToken is ERC20, LocalChainOnly {
    address public immutable operator;
    uint8 private immutable precision;
    error OnlyOperator();
    error InvalidConfiguration();

    constructor(string memory name_, string memory symbol_, uint8 precision_, address operator_) ERC20(name_, symbol_) {
        if (operator_ == address(0) || (precision_ != 6 && precision_ != 18)) revert InvalidConfiguration();
        precision = precision_;
        operator = operator_;
    }

    function decimals() public view override returns (uint8) {
        return precision;
    }

    function mint(address to, uint256 amount) external localOnly {
        if (msg.sender != operator) revert OnlyOperator();
        _mint(to, amount);
    }

    function approve(address spender, uint256 amount) public override localOnly returns (bool) {
        return super.approve(spender, amount);
    }

    function _update(address from, address to, uint256 amount) internal override {
        _requireLocal();
        super._update(from, to, amount);
    }
}

/// @notice EXPLICITLY SIMULATED prices, not RedStone or another live feed.
contract LocalDemoOracle is IPortfolioOracle, LocalChainOnly {
    address public immutable operator;
    uint256 public constant MAX_AGE = 5 minutes;
    uint256 public stableUsdX18;
    uint256 public assetUsdX18;
    uint256 public updatedAt;
    error OnlyOperator();
    error InvalidPrice();
    error StalePrice(uint256 updatedAt);
    event SimulatedPricesUpdated(uint256 stableUsdX18, uint256 assetUsdX18, uint256 updatedAt);

    constructor(address operator_) {
        if (operator_ == address(0)) revert OnlyOperator();
        operator = operator_;
        _set(1e18, 2_000e18);
    }

    function setPrices(uint256 stablePrice, uint256 assetPrice) external localOnly {
        if (msg.sender != operator) revert OnlyOperator();
        _set(stablePrice, assetPrice);
    }

    function read() external view returns (uint256, uint256, uint256) {
        if (block.timestamp < updatedAt || block.timestamp - updatedAt > MAX_AGE) revert StalePrice(updatedAt);
        return (stableUsdX18, assetUsdX18, updatedAt);
    }

    function _set(uint256 stablePrice, uint256 assetPrice) private {
        if (stablePrice == 0 || assetPrice == 0) revert InvalidPrice();
        stableUsdX18 = stablePrice;
        assetUsdX18 = assetPrice;
        updatedAt = block.timestamp;
        emit SimulatedPricesUpdated(stablePrice, assetPrice, block.timestamp);
    }
}

/// @notice Fixed-reference-price simulation venue, with actual prefunded token reserves and 30bps fee.
/// @dev Not a Trisolaris liquidity/price-impact implementation. Swaps do not mint output assets.
contract LocalDemoRouter is LocalChainOnly {
    using SafeERC20 for IERC20;
    IERC20 public immutable stable;
    IERC20 public immutable asset;
    IPortfolioOracle public immutable oracle;
    uint256 public constant FEE_BPS = 30;
    error InvalidRoute();
    error InvalidAmount();
    error Expired(uint256 deadline);
    error InsufficientOutput(uint256 actual, uint256 minimum);
    error InsufficientReserve(address token, uint256 requested, uint256 available);
    event SimulatedSwap(
        address indexed caller, address indexed recipient, address tokenIn, uint256 amountIn, uint256 amountOut
    );

    constructor(IERC20 stable_, IERC20 asset_, IPortfolioOracle oracle_) {
        if (
            address(stable_) == address(0) || address(asset_) == address(0) || address(stable_) == address(asset_)
                || address(oracle_) == address(0)
        ) revert InvalidRoute();
        stable = stable_;
        asset = asset_;
        oracle = oracle_;
    }

    function getAmountsOut(uint256 amountIn, address[] calldata route) public view returns (uint256[] memory amounts) {
        bool buy = _route(route);
        if (amountIn == 0) revert InvalidAmount();
        (uint256 stablePrice, uint256 assetPrice,) = oracle.read();
        uint256 raw = buy
            ? Math.mulDiv(Math.mulDiv(amountIn, stablePrice, 1e6), 1e18, assetPrice)
            : Math.mulDiv(Math.mulDiv(amountIn, assetPrice, 1e18), 1e6, stablePrice);
        amounts = new uint256[](2);
        amounts[0] = amountIn;
        amounts[1] = Math.mulDiv(raw, 10_000 - FEE_BPS, 10_000);
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 minimumOut,
        address[] calldata route,
        address recipient,
        uint256 deadline
    ) external localOnly returns (uint256[] memory amounts) {
        if (block.timestamp > deadline) revert Expired(deadline);
        if (recipient == address(0)) revert InvalidRoute();
        amounts = getAmountsOut(amountIn, route);
        if (amounts[1] < minimumOut) revert InsufficientOutput(amounts[1], minimumOut);
        IERC20 output = IERC20(route[1]);
        uint256 reserve = output.balanceOf(address(this));
        if (reserve < amounts[1]) revert InsufficientReserve(address(output), amounts[1], reserve);
        IERC20(route[0]).safeTransferFrom(msg.sender, address(this), amountIn);
        output.safeTransfer(recipient, amounts[1]);
        emit SimulatedSwap(msg.sender, recipient, route[0], amountIn, amounts[1]);
    }

    function _route(address[] calldata route) private view returns (bool buy) {
        if (route.length != 2) revert InvalidRoute();
        buy = route[0] == address(stable) && route[1] == address(asset);
        if (!buy && !(route[0] == address(asset) && route[1] == address(stable))) revert InvalidRoute();
    }
}
