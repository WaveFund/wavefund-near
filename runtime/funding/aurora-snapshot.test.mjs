import test from 'node:test';
import assert from 'node:assert/strict';
import { keccak256 } from 'viem';
import { createAuroraFundingSnapshotReader } from './aurora-snapshot.mjs';
const addr = n => `0x${String(n).padStart(40, '0')}`;
const hash = n => `0x${String(n).padStart(64, '0')}`;
function fixture() {
  const names = ['safe', 'stable', 'asset', 'module', 'engine', 'tracker', 'oracle', 'router', 'market', 'tokens', 'registry', 'poolManager', 'hook'];
  const contracts = Object.fromEntries(names.map((n, i) => [n, addr(i + 10)]));
  const code = '0x60006000';
  const manifest = { schemaVersion: 1, chainId: 1313161554, contracts,
    codeHashes: Object.fromEntries(names.map(n => [n, keccak256(code)])), safeSingleton: addr(30), safeSingletonCodeHash: keccak256(code) };
  const route = { routeId: 'synthetic-only', enabled: true, liveVerified: true, manager: addr(1), safe: contracts.safe,
    source: { chainId: 1, assetId: 'nep141:fixture-source.near', token: addr(2), decimals: 6 },
    destination: { chainId: 1313161554, assetId: 'nep141:fixture-destination.near', token: contracts.stable, decimals: 6 },
    refundRecipient: addr(1), minAmountIn: '1', maxAmountIn: '1000', minAmountOut: '1', maxQuoteLifetimeSeconds: 60,
    maxObservationAgeSeconds: 30, minimumConfirmations: 3 };
  const values = {
    'safe.masterCopy': manifest.safeSingleton, 'safe.VERSION': '1.4.1', 'safe.getOwners': [addr(1)], 'safe.getThreshold': 1n, 'safe.isModuleEnabled': true,
    'stable.decimals': 6, 'asset.decimals': 18, 'engine.hasRole': true, 'module.maxSlippageBps': 100,
    'engine.allocationSource': contracts.module, 'engine.executionModule': contracts.module, 'engine.performanceTracker': contracts.tracker,
    'engine.usdc': contracts.stable, 'market.quantumRound': contracts.engine, 'market.proposalTokens': contracts.tokens,
    'market.waveHook': contracts.hook, 'market.owner': contracts.engine, 'hook.adapter': contracts.market, 'registry.usdc': contracts.stable,
    'engine.currentRoundId': 3n, 'module.activeRoundId': 0n, 'module.authorization': [0n, 0n, 0n, 0n, 0n, 0n, 0n],
    'stable.balanceOf': 2000000000n, 'asset.balanceOf': 1000000000000000000n, 'oracle.read': [1000000000000000000n, 2000000000000000000000n, 990n],
    'engine.roundStatus': 3,
  };
  const calls = []; let chainId = 1313161554; let finalHash = hash(1); let now = 1000;
  const block = { number: 50n, timestamp: 1000n, hash: hash(1) };
  const publicClient = {
    getChainId: async () => { calls.push(['chain']); return chainId; },
    getBlock: async args => { calls.push(['block', args]); return { ...block, hash: args.blockNumber !== undefined ? finalHash : block.hash }; },
    getCode: async args => { calls.push(['code', args]); return code; },
    readContract: async args => {
      calls.push(['read', args]); const name = names.find(n => contracts[n] === args.address); const key = `${name}.${args.functionName}`;
      if (Object.hasOwn(values, key)) return values[key];
      if (contracts[args.functionName]) return contracts[args.functionName];
      throw new Error(`Unexpected fixture view ${key}`);
    },
  };
  const build = () => createAuroraFundingSnapshotReader({ publicClient, manifest, clock: () => now });
  return { manifest, route, values, calls, publicClient, block, build, setChain: v => { chainId = v; }, setFinalHash: v => { finalHash = v; }, setTime: v => { now = v; } };
}
const rejected = (run, code) => assert.rejects(run, { name: 'FundingError', code });

test('snapshot checks reviewed bytecode, Safe singleton and bindings at one pinned block', async () => {
  const f = fixture(); const result = await f.build()(f.route);
  assert.equal(result.compatible, true); assert.equal(result.activeRound, false); assert.equal(result.pendingAuthorization, false);
  assert.equal(result.stableBalance, '2000000000'); assert.equal(result.assetBalance, '1000000000000000000');
  assert.equal(f.calls.filter(c => c[0] === 'code').length, 14);
  assert.ok(f.calls.filter(c => ['code', 'read'].includes(c[0])).every(c => c[1].blockNumber === 50n));
  assert.ok(f.calls.every(c => ['chain', 'block', 'code', 'read'].includes(c[0])));
});
test('reader refuses testnet manifest and incomplete bytecode configuration', () => {
  const f = fixture(); f.manifest.chainId = 1313161555;
  assert.throws(f.build, { code: 'FUNDING_MANIFEST_NETWORK' });
  const g = fixture(); delete g.manifest.codeHashes.router; assert.throws(g.build, { code: 'INVALID_FIELDS' });
});
test('wrong RPC network or destination Safe is rejected before contract reads', async () => {
  const f = fixture(); f.setChain(1313161555); await rejected(() => f.build()(f.route), 'FUNDING_RPC_NETWORK');
  assert.ok(!f.calls.some(c => c[0] === 'read'));
  const g = fixture(); g.route.safe = addr(99); await rejected(() => g.build()(g.route), 'FUNDING_MANIFEST_ROUTE_MISMATCH');
});
test('missing or mismatched deployed code and wrong Safe singleton fail closed', async () => {
  const f = fixture(); f.publicClient.getCode = async () => '0x'; await rejected(() => f.build()(f.route), 'FUNDING_CODE_MISSING');
  const g = fixture(); g.manifest.codeHashes.router = hash(5); await rejected(() => g.build()(g.route), 'FUNDING_CODE_MISMATCH');
  const h = fixture(); h.values['safe.masterCopy'] = addr(99); await rejected(() => h.build()(h.route), 'FUNDING_SAFE_SINGLETON');
  const j = fixture(); j.manifest.safeSingletonCodeHash = hash(7); await rejected(() => j.build()(j.route), 'FUNDING_SAFE_SINGLETON_CODE');
});
test('unexpected manager, threshold, module authority or decimals is rejected', async () => {
  for (const [key, value, code] of [['safe.getOwners', [addr(99)], 'FUNDING_SAFE_OWNERSHIP'], ['safe.getThreshold', 2n, 'FUNDING_SAFE_OWNERSHIP'],
    ['safe.isModuleEnabled', false, 'FUNDING_MODULE_AUTHORITY'], ['engine.hasRole', false, 'FUNDING_MODULE_AUTHORITY'],
    ['stable.decimals', 18, 'FUNDING_TOKEN_DECIMALS'], ['module.maxSlippageBps', 1001, 'FUNDING_SLIPPAGE_POLICY']]) {
    const f = fixture(); f.values[key] = value; await rejected(() => f.build()(f.route), code);
  }
});
test('a wrong tracker or forecasting hook binding is rejected', async () => {
  for (const key of ['tracker.module', 'hook.adapter', 'market.quantumRound']) {
    const f = fixture(); f.values[key] = addr(99); await rejected(() => f.build()(f.route), 'FUNDING_CONTRACT_BINDING');
  }
});
test('engine rounds remain active even if module activeRoundId is zero', async () => {
  for (const status of [1, 2]) {
    const f = fixture(); f.values['engine.roundStatus'] = status; assert.equal((await f.build()(f.route)).activeRound, true);
  }
  const f = fixture(); f.values['module.authorization'][0] = 4n; assert.equal((await f.build()(f.route)).pendingAuthorization, true);
  const g = fixture(); g.values['engine.roundStatus'] = 5; await rejected(() => g.build()(g.route), 'FUNDING_ROUND_STATUS');
});
test('stale blocks, stale/future oracle and reorg during reads reject snapshot', async () => {
  const f = fixture(); f.setTime(1031); await rejected(() => f.build()(f.route), 'FUNDING_BLOCK_STALE');
  for (const time of [900n, 1001n]) {
    const g = fixture(); g.values['oracle.read'][2] = time; await rejected(() => g.build()(g.route), 'FUNDING_ORACLE_UNUSABLE');
  }
  const h = fixture(); h.setFinalHash(hash(2)); await rejected(() => h.build()(h.route), 'FUNDING_SNAPSHOT_CHANGED');
});
test('a changed network or clock expiry after slow reads cannot return compatible', async () => {
  const f = fixture(); let reads = 0;
  f.publicClient.getChainId = async () => ++reads === 1 ? 1313161554 : 1;
  await rejected(() => f.build()(f.route), 'FUNDING_SNAPSHOT_CHANGED');
  const g = fixture(); const read = g.publicClient.readContract;
  g.publicClient.readContract = async args => { const result = await read(args); g.setTime(1031); return result; };
  await rejected(() => g.build()(g.route), 'FUNDING_BLOCK_STALE');
});
