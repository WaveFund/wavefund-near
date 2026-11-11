import { keccak256, parseAbi } from 'viem';
import { address, approvedRoute, clone, exact, requireFunding as check, timestamp, txHash } from './schema.mjs';

const names = ['safe', 'stable', 'asset', 'module', 'engine', 'tracker', 'oracle', 'router', 'market', 'tokens', 'registry', 'poolManager', 'hook'];
const views = parseAbi([
  'function VERSION() view returns(string)', 'function getOwners() view returns(address[])',
  'function getThreshold() view returns(uint256)', 'function isModuleEnabled(address) view returns(bool)',
  'function masterCopy() view returns(address)',
  'function decimals() view returns(uint8)', 'function balanceOf(address) view returns(uint256)',
  'function safe() view returns(address)', 'function engine() view returns(address)',
  'function stable() view returns(address)', 'function asset() view returns(address)',
  'function router() view returns(address)', 'function oracle() view returns(address)',
  'function tracker() view returns(address)', 'function allocationSource() view returns(address)',
  'function executionModule() view returns(address)', 'function performanceTracker() view returns(address)',
  'function module() view returns(address)', 'function market() view returns(address)',
  'function tokens() view returns(address)', 'function registry() view returns(address)',
  'function usdc() view returns(address)', 'function quantumRound() view returns(address)',
  'function proposalTokens() view returns(address)', 'function poolManager() view returns(address)',
  'function waveHook() view returns(address)', 'function owner() view returns(address)',
  'function adapter() view returns(address)', 'function hasRole(bytes32,address) view returns(bool)',
  'function currentRoundId() view returns(uint256)', 'function activeRoundId() view returns(uint256)',
  'function roundStatus(uint256) view returns(uint8)', 'function maxSlippageBps() view returns(uint16)',
  'function authorization() view returns(uint256 roundId,uint256 tradingEnd,uint256 evaluationEnd,uint256 executionDeadline,uint256 rMin,uint256 rMax,uint256 twapWindow)',
  'function read() view returns(uint256 stableUsdX18,uint256 assetUsdX18,uint256 publishedAt)',
]);
const bindings = [
  ...['safe', 'engine', 'stable', 'asset', 'router', 'oracle', 'tracker'].map(key => ['module', key, key]),
  ['engine', 'allocationSource', 'module'], ['engine', 'executionModule', 'module'], ['engine', 'performanceTracker', 'tracker'],
  ...['module', 'engine', 'oracle'].map(key => ['tracker', key, key]),
  ...['market', 'tokens', 'registry'].map(key => ['engine', key, key]), ['engine', 'usdc', 'stable'],
  ['market', 'quantumRound', 'engine'], ['market', 'proposalTokens', 'tokens'], ['market', 'poolManager', 'poolManager'],
  ['market', 'waveHook', 'hook'], ['market', 'owner', 'engine'], ['hook', 'adapter', 'market'],
  ['hook', 'poolManager', 'poolManager'], ['registry', 'usdc', 'stable'],
];

// Separate MAINNET-only read adapter: does not widen the existing testnet manager
// service, construct a wallet, create an RPC transport or deploy anything. The
// caller supplies a trusted read client and reviewed runtime bytecode pins.
export function createAuroraFundingSnapshotReader({ publicClient, manifest: input, clock = () => Math.floor(Date.now() / 1000) }) {
  const manifest = clone(input);
  exact(manifest, ['schemaVersion', 'chainId', 'contracts', 'codeHashes', 'safeSingleton', 'safeSingletonCodeHash']);
  check(manifest.schemaVersion === 1 && manifest.chainId === 1313161554, 'FUNDING_MANIFEST_NETWORK');
  exact(manifest.contracts, names); exact(manifest.codeHashes, names);
  for (const key of names) { manifest.contracts[key] = address(manifest.contracts[key]); manifest.codeHashes[key] = txHash(manifest.codeHashes[key]); }
  manifest.safeSingleton = address(manifest.safeSingleton); manifest.safeSingletonCodeHash = txHash(manifest.safeSingletonCodeHash);
  check(new Set(Object.values(manifest.contracts)).size === names.length, 'FUNDING_MANIFEST_DUPLICATE');
  check(publicClient?.getChainId && publicClient.getBlock && publicClient.getCode && publicClient.readContract, 'READ_CLIENT_REQUIRED');
  const contracts = manifest.contracts;
  return async function readSnapshot(inputRoute) {
    const route = approvedRoute(inputRoute);
    check(route.destination.chainId === manifest.chainId && route.safe === contracts.safe
      && route.destination.token === contracts.stable, 'FUNDING_MANIFEST_ROUTE_MISMATCH');
    check(await publicClient.getChainId() === manifest.chainId, 'FUNDING_RPC_NETWORK');
    const block = await publicClient.getBlock({ blockTag: 'latest' });
    check(typeof block.number === 'bigint' && block.number >= 0n && typeof block.timestamp === 'bigint'
      && block.timestamp > 0n && block.timestamp <= BigInt(Number.MAX_SAFE_INTEGER), 'FUNDING_BLOCK_INVALID');
    txHash(block.hash);
    const time = timestamp(clock()); const observedAt = Number(block.timestamp);
    check(observedAt <= time && time - observedAt <= route.maxObservationAgeSeconds, 'FUNDING_BLOCK_STALE');
    const read = (key, functionName, args = []) => publicClient.readContract({ address: contracts[key], abi: views, functionName, args, blockNumber: block.number });
    for (const key of names) {
      const code = await publicClient.getCode({ address: contracts[key], blockNumber: block.number });
      check(typeof code === 'string' && /^0x(?:[0-9a-fA-F]{2})+$/.test(code), 'FUNDING_CODE_MISSING');
      check(keccak256(code) === manifest.codeHashes[key], 'FUNDING_CODE_MISMATCH');
    }
    const singleton = await read('safe', 'masterCopy');
    check(address(singleton) === manifest.safeSingleton, 'FUNDING_SAFE_SINGLETON');
    const singletonCode = await publicClient.getCode({ address: manifest.safeSingleton, blockNumber: block.number });
    check(typeof singletonCode === 'string' && /^0x(?:[0-9a-fA-F]{2})+$/.test(singletonCode)
      && keccak256(singletonCode) === manifest.safeSingletonCodeHash, 'FUNDING_SAFE_SINGLETON_CODE');
    const [version, owners, threshold, enabled, stableDecimals, assetDecimals, admin, maxSlippage] = await Promise.all([
      read('safe', 'VERSION'), read('safe', 'getOwners'), read('safe', 'getThreshold'), read('safe', 'isModuleEnabled', [contracts.module]),
      read('stable', 'decimals'), read('asset', 'decimals'), read('engine', 'hasRole', [`0x${'00'.repeat(32)}`, contracts.safe]), read('module', 'maxSlippageBps'),
    ]);
    check(version === '1.4.1' && Array.isArray(owners) && owners.length === 1 && address(owners[0]) === route.manager && threshold === 1n, 'FUNDING_SAFE_OWNERSHIP');
    check(enabled === true && admin === true, 'FUNDING_MODULE_AUTHORITY');
    check(stableDecimals === 6 && assetDecimals === 18 && route.destination.decimals === stableDecimals, 'FUNDING_TOKEN_DECIMALS');
    check(typeof maxSlippage === 'number' && Number.isInteger(maxSlippage) && maxSlippage >= 0 && maxSlippage <= 1000, 'FUNDING_SLIPPAGE_POLICY');
    const links = await Promise.all(bindings.map(([key, method]) => read(key, method)));
    check(links.every((value, index) => address(value) === contracts[bindings[index][2]]), 'FUNDING_CONTRACT_BINDING');
    const [current, active, authorization, stableBalance, assetBalance, prices] = await Promise.all([
      read('engine', 'currentRoundId'), read('module', 'activeRoundId'), read('module', 'authorization'),
      read('stable', 'balanceOf', [contracts.safe]), read('asset', 'balanceOf', [contracts.safe]), read('oracle', 'read'),
    ]);
    check([current, active, stableBalance, assetBalance].every(v => typeof v === 'bigint' && v >= 0n && v < 2n ** 256n), 'FUNDING_VIEW_INVALID');
    check(Array.isArray(authorization) && authorization.length === 7 && authorization.every(v => typeof v === 'bigint' && v >= 0n), 'FUNDING_AUTHORIZATION_INVALID');
    check(Array.isArray(prices) && prices.length === 3 && prices.every(v => typeof v === 'bigint' && v > 0n)
      && prices[2] <= block.timestamp && block.timestamp - prices[2] <= BigInt(route.maxObservationAgeSeconds), 'FUNDING_ORACLE_UNUSABLE');
    // The engine may have a round even when the module's activeRoundId is zero.
    // Unknown/new status values are rejected rather than classified as idle.
    let activeRound = false;
    for (const id of [...new Set([current, active].filter(v => v !== 0n))]) {
      const status = await read('engine', 'roundStatus', [id]);
      check(Number.isInteger(status) && status >= 1 && status <= 4, 'FUNDING_ROUND_STATUS');
      if (status === 1 || status === 2) activeRound = true;
    }
    const canonical = await publicClient.getBlock({ blockNumber: block.number });
    check(canonical.hash === block.hash && await publicClient.getChainId() === manifest.chainId, 'FUNDING_SNAPSHOT_CHANGED');
    const finishedAt = timestamp(clock());
    check(finishedAt >= observedAt && finishedAt - observedAt <= route.maxObservationAgeSeconds, 'FUNDING_BLOCK_STALE');
    return { chainId: manifest.chainId, safe: contracts.safe, stableToken: contracts.stable, assetToken: contracts.asset,
      stableBalance: String(stableBalance), assetBalance: String(assetBalance), activeRound, pendingAuthorization: authorization[0] !== 0n,
      observedAt, blockNumber: String(block.number), blockHash: block.hash, compatible: true };
  };
}
