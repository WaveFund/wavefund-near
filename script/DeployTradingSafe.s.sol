// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import {ProposalTokens} from "../src/ProposalTokens.sol";
import {ProposerRegistry} from "../src/ProposerRegistry.sol";
import {QuantumRound} from "../src/QuantumRound.sol";
import {WaveHook} from "../src/WaveHook.sol";
import {WaveV4ProposalMarket} from "../src/WaveV4ProposalMarket.sol";
import {TradingSafeModule} from "../src/safe/TradingSafeModule.sol";
import {PerformanceTracker, IPerformanceRound} from "../src/PerformanceTracker.sol";
import {IPortfolioOracle, IPerformanceTracker} from "../src/interfaces/ISafeIntegration.sol";

/// @notice Small actual CREATE2 deployer; no assumed chain-global deployment proxy.
contract HookDeployer {
    error DeploymentFailed();

    function deploy(bytes32 salt, bytes memory creationCode) external returns (address deployed) {
        assembly ("memory-safe") { deployed := create2(0, add(creationCode, 32), mload(creationCode), salt) }
        if (deployed == address(0)) revert DeploymentFailed();
    }
}

/// @notice Aurora TESTNET/local deployment recipe. Never enables a module or moves investment/forecast money.
/// @dev run() is only broadcast when an operator explicitly invokes forge script --broadcast.
///      Existing Safe owners must later enable the module and authorize a round themselves.
contract DeployTradingSafe is Script {
    struct Config {
        address safe;
        address stable;
        address asset;
        address router;
        address oracle;
        address keeper;
        address poolManager;
        bool deployPoolManager;
        uint256 observationWindow;
    }

    struct Stack {
        IPoolManager poolManager;
        ProposalTokens tokens;
        ProposerRegistry registry;
        WaveV4ProposalMarket market;
        QuantumRound engine;
        WaveHook hook;
        PerformanceTracker tracker;
        TradingSafeModule module;
        HookDeployer hookDeployer;
    }
    error UnsupportedChain(uint256 chainId);
    error InvalidDeploymentConfig();
    error UnexpectedHookAddress(address actual, address expected);

    event StackDeployed(
        address indexed safe,
        address engine,
        address module,
        address tracker,
        address tokens,
        address registry,
        address market,
        address hook,
        address poolManager,
        address hookDeployer
    );

    function run() external virtual returns (Stack memory stack) {
        _requireNetwork();
        Config memory c = Config({
            safe: vm.envAddress("TRADING_SAFE"),
            stable: vm.envAddress("STABLE_TOKEN"),
            asset: vm.envAddress("INVESTMENT_TOKEN"),
            router: vm.envAddress("INVESTMENT_ROUTER"),
            oracle: vm.envAddress("PORTFOLIO_ORACLE"),
            keeper: vm.envAddress("KEEPER_ADDRESS"),
            poolManager: vm.envOr("FORECAST_POOL_MANAGER", address(0)),
            deployPoolManager: vm.envOr("DEPLOY_FORECAST_POOL_MANAGER", false),
            observationWindow: vm.envOr("OBSERVATION_WINDOW", uint256(15 minutes))
        });
        _validate(c);
        uint256 privateKey = vm.envUint("DEPLOYER_PK");
        address deployer = vm.addr(privateKey);
        vm.startBroadcast(privateKey);
        stack = _deploy(c, deployer);
        vm.stopBroadcast();
    }

    /// @notice Local-test entrypoint uses this script/test contract as the temporary setup administrator.
    /// @dev Deliberately disabled on public networks; scripts are orchestration, not an onchain factory.
    function deployLocal(Config memory c) public returns (Stack memory stack) {
        if (block.chainid != 31337) revert UnsupportedChain(block.chainid);
        _validate(c);
        return _deploy(c, address(this));
    }

    function _deploy(Config memory c, address setupAdmin) internal returns (Stack memory s) {
        s.poolManager = c.deployPoolManager
            ? IPoolManager(_create("PoolManager.sol:PoolManager", abi.encode(c.safe)))
            : IPoolManager(c.poolManager);
        s.tokens = ProposalTokens(_create("ProposalTokens.sol:ProposalTokens", abi.encode(setupAdmin)));
        s.tokens.setCreditDecimals(6);
        s.registry =
            ProposerRegistry(_create("ProposerRegistry.sol:ProposerRegistry", abi.encode(setupAdmin, c.stable)));
        s.market = WaveV4ProposalMarket(
            _create("WaveV4ProposalMarket.sol:WaveV4ProposalMarket", abi.encode(s.poolManager, s.tokens, setupAdmin))
        );
        s.engine = QuantumRound(
            _create("QuantumRound.sol:QuantumRound", abi.encode(setupAdmin, c.stable, s.tokens, s.registry, s.market))
        );
        s.hookDeployer = new HookDeployer();
        bytes memory arguments = abi.encode(s.poolManager, address(s.market));
        uint160 flags = Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG | Hooks.BEFORE_SWAP_FLAG
            | Hooks.AFTER_SWAP_FLAG;
        (address expectedHook, bytes32 salt) =
            HookMiner.find(address(s.hookDeployer), flags, type(WaveHook).creationCode, arguments);
        address deployedHook = s.hookDeployer.deploy(salt, abi.encodePacked(type(WaveHook).creationCode, arguments));
        if (deployedHook != expectedHook) revert UnexpectedHookAddress(deployedHook, expectedHook);
        s.hook = WaveHook(deployedHook);
        s.market.setQuantumRound(address(s.engine));
        s.market.setWaveHook(address(s.hook));
        s.tokens.grantRole(s.tokens.QUANTUM_ROUND_ROLE(), address(s.engine));
        s.registry.grantRole(s.registry.QUANTUM_ROUND_ROLE(), address(s.engine));
        s.tracker = PerformanceTracker(
            _create(
                "PerformanceTracker.sol:PerformanceTracker",
                abi.encode(s.engine, c.oracle, setupAdmin, c.observationWindow)
            )
        );
        s.module = TradingSafeModule(
            _create(
                "TradingSafeModule.sol:TradingSafeModule",
                abi.encode(c.safe, s.engine, c.stable, c.asset, c.router, c.oracle, s.tracker)
            )
        );
        s.tracker.bindModule(address(s.module));
        s.engine.bindExecution(address(s.module), address(s.tracker));
        s.engine.grantRole(s.engine.KEEPER_ROLE(), c.keeper);
        // No VAULT_ROLE/RESOLVER_ROLE shortcut is granted. Bindings enforce exact contract identities.
        bytes32 adminRole = s.engine.DEFAULT_ADMIN_ROLE();
        s.engine.grantRole(adminRole, c.safe);
        // Token-controller and bond-controller role administration is permanently sealed.
        // A customer must never be able to mint forecasting claims or confiscate proposer bonds.
        s.tokens.renounceRole(adminRole, setupAdmin);
        s.registry.renounceRole(adminRole, setupAdmin);
        if (setupAdmin != c.safe) s.engine.renounceRole(adminRole, setupAdmin);
        emit StackDeployed(
            c.safe,
            address(s.engine),
            address(s.module),
            address(s.tracker),
            address(s.tokens),
            address(s.registry),
            address(s.market),
            address(s.hook),
            address(s.poolManager),
            address(s.hookDeployer)
        );
    }

    /// @dev Load compiled initcode rather than embedding every contract into the script/test bytecode.
    function _create(string memory artifact, bytes memory arguments) internal returns (address deployed) {
        bytes memory initcode = abi.encodePacked(vm.getCode(artifact), arguments);
        assembly ("memory-safe") { deployed := create(0, add(initcode, 32), mload(initcode)) }
        if (deployed == address(0)) revert InvalidDeploymentConfig();
    }

    function _requireNetwork() internal view {
        if (block.chainid != 1313161555 && block.chainid != 31337) revert UnsupportedChain(block.chainid);
    }

    function _validate(Config memory c) internal view {
        if (
            c.safe.code.length == 0 || c.stable.code.length == 0 || c.asset.code.length == 0
                || c.router.code.length == 0 || c.oracle.code.length == 0 || c.keeper == address(0)
                || (c.deployPoolManager && c.poolManager != address(0))
                || (!c.deployPoolManager && c.poolManager.code.length == 0) || c.observationWindow == 0
                || c.observationWindow > 1 days
        ) revert InvalidDeploymentConfig();
        // Fail preflight on stale/invalid live oracle data. No mock-oracle or keeper-price fallback.
        (uint256 stablePrice, uint256 assetPrice, uint256 timestamp) = IPortfolioOracle(c.oracle).read();
        if (stablePrice == 0 || assetPrice == 0 || timestamp == 0 || timestamp > block.timestamp) {
            revert InvalidDeploymentConfig();
        }
        (bool ok, bytes memory value) = c.safe.staticcall(abi.encodeWithSignature("VERSION()"));
        if (!ok || value.length < 64 || keccak256(bytes(abi.decode(value, (string)))) != keccak256(bytes("1.4.1"))) {
            revert InvalidDeploymentConfig();
        }
        (ok, value) = c.safe.staticcall(abi.encodeWithSignature("getThreshold()"));
        if (!ok || value.length != 32 || abi.decode(value, (uint256)) == 0) revert InvalidDeploymentConfig();
    }
}
