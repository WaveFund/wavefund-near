import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { normalizeResearch, decimal18, collectResearch, researchStatus, RESEARCH_URLS } from '../operator/research.mjs';
import { readonlyRPC, probeAurora } from '../operator/readonly-rpc.mjs';
import { auditReceipts } from '../operator/recovery.mjs';

const sample = () => ({ candles: [8700, 9000, 9300, 9600].map((t) => [t, 90, 110, 100, 100, 1]), ticker: { time: new Date(10000 * 1000).toISOString(), price: '102.12' }, stable: { data: { base: 'USDC', currency: 'USD', amount: '0.99' } } });
test('research normalization preserves decimal precision and USDC deviations', () => {
  assert.equal(decimal18('1.000000000000000001'), '1000000000000000001');
  const market = normalizeResearch(sample(), { now: 10000 }); assert.equal(market.source, 'external-unverified'); assert.equal(market.stableUsdX18, '990000000000000000'); assert.equal(market.provenance.settlementEligible, false); assert.equal(market.provenance.stableObservationAt, null);
  assert.equal(market.history.at(-1).timestamp, 10000);
});
test('research rejects stale prices, wrong pairs, duplicate and malformed candles', () => {
  assert.throws(() => normalizeResearch(sample(), { now: 10121 }), /stale/);
  assert.throws(() => normalizeResearch(sample(), { now: 9999 }), /future/);
  const wrong = sample(); wrong.stable.data.base = 'ETH'; assert.throws(() => normalizeResearch(wrong, { now: 10000 }), /pair/);
  const duplicate = sample(); duplicate.candles.push(duplicate.candles[0]); assert.throws(() => normalizeResearch(duplicate, { now: 10000 }), /Duplicate/);
  const malformed = sample(); malformed.candles[0][4] = 200; assert.throws(() => normalizeResearch(malformed, { now: 10000 }), /Inconsistent/);
  for (const price of ['1e3', '-1', '0', NaN, '0.0000000000000000001']) assert.throws(() => decimal18(price), /price/);
});
test('unfinished candle data cannot leak a future close into research', () => {
  const value = sample(); value.candles.push([9900, 9000, 9001, 9000, 9000, 1]);
  const market = normalizeResearch(value, { now: 10000 }); assert.ok(market.history.every((p) => p.assetUsdX18 !== '9000000000000000000000'));
});
test('collector requests only the three fixed public sources without authorization', async () => {
  const seen = []; const value = sample();
  const market = await collectResearch({ now: 10000, fetchImpl: async (url, options) => { seen.push(url); assert.equal(options.redirect, 'error'); assert.ok(!options.headers.Authorization); const key = Object.keys(RESEARCH_URLS).find((key) => RESEARCH_URLS[key] === url); return new Response(JSON.stringify(value[{ candles: 'candles', ticker: 'ticker', stable: 'stable' }[key]])); } });
  assert.equal(seen.length, 3); assert.equal(market.provenance.settlementEligible, false);
});
test('research snapshots report missing and stale data instead of inventing live values', async () => {
  const dir = await mkdtemp(`${tmpdir()}/wavefund-research-`); const file = `${dir}/market.json`;
  try { assert.equal((await researchStatus(file)).status, 'not-configured'); await writeFile(file, JSON.stringify(normalizeResearch(sample(), { now: 10000 }))); assert.equal((await researchStatus(file, 10000)).status, 'available'); assert.equal((await researchStatus(file, 10301)).status, 'unavailable'); } finally { await rm(dir, { recursive: true, force: true }); }
});
test('read-only RPC rejects signing, broadcasting and arbitrary endpoints', async () => {
  const rpc = readonlyRPC('https://testnet.aurora.dev', { fetchImpl: () => { throw new Error('Must not call'); } });
  for (const method of ['eth_sendRawTransaction', 'eth_sendTransaction', 'personal_sign', 'eth_estimateGas', 'anvil_reset']) await assert.rejects(rpc.request({ method }), /read-only/);
  for (const url of ['https://mainnet.aurora.dev', 'https://evil.example', 'http://localhost/?key=secret']) assert.throws(() => readonlyRPC(url), /Read-only/);
});
function probeFetch({ invalidSucceeds = false, wrongChain = false, wrongId = false } = {}) {
  return async (url, options) => { const input = JSON.parse(options.body); let result;
    if (input.method === 'eth_chainId') result = wrongChain ? '0x1' : '0x4e454153';
    if (input.method === 'eth_getBlockByNumber') result = { number: '0x2', timestamp: '0x64' };
    if (input.method === 'eth_call') { const code = Object.values(input.params[2])[0].code; if (code === '0xfe' && !invalidSucceeds) return new Response(JSON.stringify({ jsonrpc: '2.0', id: input.id, error: { code: 3 } })); result = '0x' + '2a'.padStart(64, '0'); }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: input.id + (wrongId ? 1 : 0), result })); };
}
test('Aurora probe requires both positive opcodes and a rejecting negative control', async () => {
  const result = await probeAurora(readonlyRPC(undefined, { fetchImpl: probeFetch() })); assert.equal(result.transactionsSent, 0); assert.equal(result.transientStorage, true);
  await assert.rejects(probeAurora(readonlyRPC(undefined, { fetchImpl: probeFetch({ invalidSucceeds: true }) })), /negative control/);
  await assert.rejects(probeAurora(readonlyRPC(undefined, { fetchImpl: probeFetch({ wrongChain: true }) })), /Aurora testnet/);
  await assert.rejects(probeAurora(readonlyRPC(undefined, { fetchImpl: probeFetch({ wrongId: true }) })), /identity/);
});
const hash = '0x' + '11'.repeat(32); const blockHash = '0x' + '22'.repeat(32); const from = '0x' + '33'.repeat(20); const to = '0x' + '44'.repeat(20);
const journal = { schemaVersion: 1, stage: 'interrupted', actions: [{ id: 1, label: 'Test action', from, to, nonce: 1, hash, blockHash, functionName: 'approve', status: 'unknown' }] };
function recoveryClient(patch = {}) { return { getChainId: async () => 31337, getBlockNumber: async () => 5n, getTransactionReceipt: async () => ({ status: 'success', blockNumber: 4n, blockHash, logs: [] }), getTransaction: async () => ({ from, to, nonce: 1 }), ...patch }; }
test('receipt audit resolves a known hash by chain evidence without rewriting or retrying', async () => {
  const report = await auditReceipts({ publicClient: recoveryClient(), journal, contracts: { safe: to } }); assert.equal(report.allConfirmed, true); assert.equal(report.actions[0].confirmations, '2'); assert.equal(report.automaticRetry, false); assert.equal(journal.actions[0].status, 'unknown');
});
test('missing receipts, nonce mismatch and block mismatch require manual review', async () => {
  for (const patch of [{ getTransactionReceipt: async () => { throw new Error('Missing'); } }, { getTransaction: async () => ({ from, to, nonce: 2 }) }, { getTransactionReceipt: async () => ({ status: 'success', blockNumber: 4n, blockHash: hash, logs: [] }) }]) { const report = await auditReceipts({ publicClient: recoveryClient(patch), journal, contracts: { safe: to } }); assert.equal(report.needsManualReview, true); assert.equal(report.allConfirmed, false); }
});
test('generic transaction success never substitutes for Safe internal success', async () => {
  const safeJournal = { ...journal, actions: [{ ...journal.actions[0], functionName: 'execTransaction' }] };
  const report = await auditReceipts({ publicClient: recoveryClient(), journal: safeJournal, contracts: { safe: to } }); assert.equal(report.actions[0].status, 'safe-inner-failure');
});

test('receipt audit bypasses cached block height', async () => {
  let uncached = false;
  const report = await auditReceipts({ publicClient: recoveryClient({ getBlockNumber: async (options) => { uncached = options?.cacheTime === 0; return uncached ? 5n : 1n; } }), journal, contracts: { safe: to } });
  assert.equal(uncached, true); assert.equal(report.allConfirmed, true);
});

import { createManagerService } from '../operator/manager.mjs';
import { CONTRACT_NAMES } from '../config.mjs';
import { decodeFunctionData, parseAbi } from 'viem';
const contracts = Object.fromEntries(CONTRACT_NAMES.map((name, index) => [name, '0x' + (index + 100).toString(16).padStart(40, '0')]));
const owner = '0x' + 'ab'.repeat(20);
const managerAbis = { module: parseAbi(['function authorization() view returns(uint256 roundId,uint256 tradingEnd,uint256 evaluationEnd,uint256 executionDeadline,uint256 rMin,uint256 rMax,uint256 twapWindow)', 'function configurePolicy(uint16)', 'function authorizeRound(uint256,uint256,uint256,uint256,uint256,uint256,uint256)', 'function revokeAuthorization()']), engine: parseAbi(['function addProtocolLiquiditySeed(uint256)', 'function rescueProtocolSeed(uint256)']) };
function mockManager(overrides = {}) {
  const lookup = {
    'safe:VERSION': '1.4.1', 'safe:getOwners': [owner], 'safe:getThreshold': 1n, 'safe:isModuleEnabled': true,
    ...Object.fromEntries(['safe', 'engine', 'stable', 'asset', 'router', 'oracle', 'tracker'].map((name) => [`module:${name}`, contracts[name]])),
    'engine:allocationSource': contracts.module, 'engine:executionModule': contracts.module, 'engine:performanceTracker': contracts.tracker,
    ...Object.fromEntries([['engine', 'market', 'market'], ['engine', 'tokens', 'tokens'], ['engine', 'registry', 'registry'], ['engine', 'usdc', 'stable'], ['market', 'quantumRound', 'engine'], ['market', 'proposalTokens', 'tokens'], ['market', 'poolManager', 'poolManager'], ['market', 'waveHook', 'hook'], ['market', 'owner', 'engine'], ['hook', 'adapter', 'market'], ['hook', 'poolManager', 'poolManager'], ['registry', 'usdc', 'stable']].map(([name, method, target]) => [`${name}:${method}`, contracts[target]])),
    'tracker:module': contracts.module, 'tracker:engine': contracts.engine, 'tracker:oracle': contracts.oracle,
    'stable:decimals': 6, 'asset:decimals': 18, 'module:maxSlippageBps': 100, 'module:activeRoundId': 0n, 'module:authorization': [0n, 0n, 0n, 0n, 0n, 0n, 0n], 'engine:hasRole': true, 'engine:currentRoundId': 0n, 'engine:protocolLiquiditySeed': 100000000n,
    'stable:balanceOf': 2000000000n, 'asset:balanceOf': 0n, 'oracle:read': [10n ** 18n, 2000n * 10n ** 18n, 10000n], 'engine:roundStatus': 1,
    ...overrides,
  };
  return createManagerService({ contracts, abis: managerAbis, publicClient: { getChainId: async () => 31337, getBlock: async () => ({ number: 1n, timestamp: 10000n }), getCode: async () => '0x01', readContract: async ({ address, functionName }) => { const key = `${Object.keys(contracts).find((name) => contracts[name] === address)}:${functionName}`; if (!(key in lookup)) throw new Error(`Unexpected read ${key}`); if (lookup[key] instanceof Error) throw lookup[key]; return lookup[key]; } } });
}
test('manager validates bindings and does not expose arbitrary call parameters', async () => {
  assert.equal((await mockManager().inspect()).moduleEnabled, true);
  await assert.rejects(mockManager({ 'module:engine': owner }).inspect(), /Unsafe manager/);
  await assert.rejects(mockManager({ 'market:quantumRound': owner }).inspect(), /hook binding/);
  await assert.rejects(mockManager().prepare({ action: 'policy', slippageBps: 50, recipient: owner }), /Unexpected/);
  await assert.rejects(mockManager().prepare({ action: 'delegatecall' }), /Unknown/);
});
test('manager sponsor amounts cannot exceed Safe capital or unallocated seed', async () => {
  await assert.rejects(mockManager().prepare({ action: 'seed', amountMicro: '2000000001' }), /Insufficient/);
  await assert.rejects(mockManager().prepare({ action: 'withdraw-seed', amountMicro: '100000001' }), /exceeds/);
  for (const amountMicro of ['0', '-1', '1e6', 1000000]) await assert.rejects(mockManager().prepare({ action: 'seed', amountMicro }), /amount/);
  const prepared = await mockManager().prepare({ action: 'seed', amountMicro: '25000000' }); assert.equal(prepared.unsignedOnly, true); assert.equal(prepared.safeTransactionBuilder.transactions.length, 4);
  assert.ok(prepared.safeTransactionBuilder.transactions.every((tx) => tx.value === '0' && [contracts.stable, contracts.engine].includes(tx.to)));
  const approve = parseAbi(['function approve(address,uint256) returns(bool)']);
  const args = decodeFunctionData({ abi: approve, data: prepared.safeTransactionBuilder.transactions[1].data }).args; assert.equal(args[0].toLowerCase(), contracts.engine); assert.equal(args[1], 25000000n);
});
test('pending or active rounds block sponsor changes and policy changes', async () => {
  for (const service of [mockManager({ 'module:authorization': [1n, 0n, 0n, 0n, 0n, 0n, 0n] }), mockManager({ 'module:activeRoundId': 1n })]) {
    await assert.rejects(service.prepare({ action: 'seed', amountMicro: '1' }), /blocks/);
    await assert.rejects(service.prepare({ action: 'policy', slippageBps: 100 }), /blocks/);
  }
  await assert.rejects(mockManager().prepare({ action: 'policy', slippageBps: 1001 }), /bounds/);
});
test('manager refuses stale oracle round authorization', async () => {
  const input = { action: 'authorize', tradingSeconds: 120, evaluationSeconds: 180, executionGraceSeconds: 60, twapWindowSeconds: 30 };
  await assert.rejects(mockManager({ 'oracle:read': new Error('Stale') }).prepare(input), /refresh/);
  await assert.rejects(mockManager().prepare({ ...input, executionGraceSeconds: 180 }), /precede/);
});

import { validateAuroraManifest } from '../operator/aurora.mjs';
test('Aurora manifests reject mainnet, missing and duplicate contracts and discard extra fields', () => {
  const valid = { schemaVersion: 1, chainId: 1313161555, contracts, apiKey: 'must-not-be-reflected' };
  assert.ok(!JSON.stringify(validateAuroraManifest(valid)).includes('must-not-be-reflected'));
  assert.throws(() => validateAuroraManifest({ ...valid, chainId: 1313161554 }), /testnet/);
  assert.throws(() => validateAuroraManifest({ ...valid, contracts: { ...contracts, oracle: contracts.module } }), /distinct/);
  assert.throws(() => validateAuroraManifest({ ...valid, contracts: { ...contracts, oracle: '' } }), /Missing/);
});
