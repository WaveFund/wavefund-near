// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {DeployTradingSafe} from "./DeployTradingSafe.s.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Enum} from "../lib/safe-contracts/contracts/common/Enum.sol";
import {SafeProxy} from "../lib/safe-contracts/contracts/proxies/SafeProxy.sol";
import {LocalDemoToken, LocalDemoOracle, LocalDemoRouter, LocalChainOnly} from "../src/demo/LocalDemoFixtures.sol";

interface ILocalDemoSafe {
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
        bytes calldata signatures
    ) external payable returns (bool success);
    function isModuleEnabled(address module) external view returns (bool);
}

/// @notice Bootstrap for DISPOSABLE LOCAL ANVIL ONLY. No external wallet or production oracle is used.
/// @dev Uses public Anvil mnemonic keys only after checking chain31337. This is not an Aurora deployment recipe.
contract LocalDemo is DeployTradingSafe {
    string internal constant LOCAL_MNEMONIC = "test test test test test test test test test test test junk";
    uint256 internal constant LOCAL_CHAIN_ID = 31337;

    struct Demo {
        Stack stack;
        address owner;
        address keeper;
        address safe;
        LocalDemoToken stable;
        LocalDemoToken asset;
        LocalDemoOracle oracle;
        LocalDemoRouter router;
        address[] proposers;
        address[] forecasters;
    }

    error LocalNetworkOnly(uint256 chainId);
    error SafeOwnerCallFailed(address target);

    function run() external override returns (Stack memory stack) {
        _local();
        uint256 key = vm.deriveKey(LOCAL_MNEMONIC, 0);
        address owner = vm.addr(key);
        address[] memory proposers = new address[](2);
        proposers[0] = vm.addr(vm.deriveKey(LOCAL_MNEMONIC, 1));
        proposers[1] = vm.addr(vm.deriveKey(LOCAL_MNEMONIC, 4));
        address[] memory forecasters = new address[](2);
        forecasters[0] = vm.addr(vm.deriveKey(LOCAL_MNEMONIC, 2));
        forecasters[1] = vm.addr(vm.deriveKey(LOCAL_MNEMONIC, 3));
        vm.startBroadcast(key);
        Demo memory demo = _bootstrap(owner, owner, owner, proposers, forecasters);
        vm.stopBroadcast();
        _manifest(demo, "deployments/local.json");
        return demo.stack;
    }

    /// @dev Tests call the exact bootstrap under their own contract ownership; normal run broadcasts as owner.
    function _bootstrap(
        address owner,
        address keeper,
        address setupAdmin,
        address[] memory proposers,
        address[] memory forecasters
    ) internal returns (Demo memory d) {
        _local();
        d.owner = owner;
        d.keeper = keeper;
        d.proposers = proposers;
        d.forecasters = forecasters;
        d.stable = new LocalDemoToken("SIMULATED USDC", "dUSDC", 6, owner);
        d.asset = new LocalDemoToken("SIMULATED ETH", "dETH", 18, owner);
        d.oracle = new LocalDemoOracle(owner);
        d.router = new LocalDemoRouter(d.stable, d.asset, d.oracle);
        address singleton = _create("Safe.sol:Safe", "");
        d.safe = address(new SafeProxy(singleton));
        address[] memory owners = new address[](1);
        owners[0] = owner;
        ILocalDemoSafe(d.safe).setup(owners, 1, address(0), "", address(0), address(0), 0, payable(address(0)));
        Config memory config = Config(
            d.safe,
            address(d.stable),
            address(d.asset),
            address(d.router),
            address(d.oracle),
            keeper,
            address(0),
            true,
            15 minutes
        );
        _validate(config);
        d.stack = _deploy(config, setupAdmin);

        // Synthetic funding allocations are separate: $2k manager capital and $100 sponsor reserve.
        d.stable.mint(d.safe, 2_100e6);
        d.stable.mint(address(d.router), 200_000e6);
        d.asset.mint(address(d.router), 100e18);
        for (uint256 i; i < proposers.length; ++i) {
            d.stable.mint(proposers[i], 100e6);
        }
        for (uint256 i; i < forecasters.length; ++i) {
            d.stable.mint(forecasters[i], 100e6);
        }
        _ownerCall(d.safe, owner, d.safe, abi.encodeWithSignature("enableModule(address)", address(d.stack.module)));
        _ownerCall(d.safe, owner, address(d.stable), abi.encodeCall(IERC20.approve, (address(d.stack.engine), 100e6)));
        _ownerCall(
            d.safe, owner, address(d.stack.engine), abi.encodeCall(d.stack.engine.addProtocolLiquiditySeed, (100e6))
        );
    }

    function _ownerCall(address safe, address owner, address target, bytes memory data) internal {
        // A prevalidated signature is valid only when the actual Safe owner is the caller.
        bytes memory signature = abi.encodePacked(bytes32(uint256(uint160(owner))), bytes32(0), uint8(1));
        bool success = ILocalDemoSafe(safe)
            .execTransaction(target, 0, data, Enum.Operation.Call, 0, 0, 0, address(0), payable(address(0)), signature);
        if (!success) revert SafeOwnerCallFailed(target);
    }

    function _manifest(Demo memory d, string memory path) internal {
        _local();
        string memory contractsJson = vm.serializeAddress("contracts", "safe", d.safe);
        contractsJson = vm.serializeAddress("contracts", "stable", address(d.stable));
        contractsJson = vm.serializeAddress("contracts", "asset", address(d.asset));
        contractsJson = vm.serializeAddress("contracts", "oracle", address(d.oracle));
        contractsJson = vm.serializeAddress("contracts", "router", address(d.router));
        contractsJson = vm.serializeAddress("contracts", "poolManager", address(d.stack.poolManager));
        contractsJson = vm.serializeAddress("contracts", "engine", address(d.stack.engine));
        contractsJson = vm.serializeAddress("contracts", "module", address(d.stack.module));
        contractsJson = vm.serializeAddress("contracts", "tracker", address(d.stack.tracker));
        contractsJson = vm.serializeAddress("contracts", "tokens", address(d.stack.tokens));
        contractsJson = vm.serializeAddress("contracts", "registry", address(d.stack.registry));
        contractsJson = vm.serializeAddress("contracts", "hook", address(d.stack.hook));
        contractsJson = vm.serializeAddress("contracts", "market", address(d.stack.market));
        string memory actorsJson = vm.serializeAddress("actors", "owner", d.owner);
        actorsJson = vm.serializeAddress("actors", "keeper", d.keeper);
        actorsJson = vm.serializeAddress("actors", "proposers", d.proposers);
        actorsJson = vm.serializeAddress("actors", "forecasters", d.forecasters);
        string memory timingJson = vm.serializeUint("timing", "tradingSeconds", 120);
        timingJson = vm.serializeUint("timing", "twapWindowSeconds", 30);
        timingJson = vm.serializeUint("timing", "executionGraceSeconds", 60);
        timingJson = vm.serializeUint("timing", "evaluationSeconds", 180);
        // This is the script's simulation block. Local launcher replaces it with the first actual receipt block.
        string memory root = string.concat(
            '{"schemaVersion":1,"chainId":31337,"rpcUrl":"http://127.0.0.1:8545","mode":"local-simulation","deployedAtBlock":',
            vm.toString(block.number),
            ',"contracts":',
            contractsJson,
            ',"actors":',
            actorsJson,
            ',"timing":',
            timingJson,
            "}"
        );
        vm.writeJson(root, path);
    }

    function _local() internal view {
        if (block.chainid != LOCAL_CHAIN_ID) revert LocalNetworkOnly(block.chainid);
    }
}
