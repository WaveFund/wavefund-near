import test from 'node:test';
import assert from 'node:assert/strict';
import { keccak256 } from 'viem';
import { createReputationReader } from '../agents/reputation-readonly.mjs';
const addr = n => '0x' + String(n).padStart(40, '0');
function fixture() {
  const calls = []; const values = { engine: addr(2), tracker: addr(3), statistics: [1n, 0n, 1n, 0n], score: -1n };
  const manifest = { schemaVersion: 1, chainId: 1313161555, contracts: { reputation: addr(1), engine: addr(2), tracker: addr(3) }, runtimeHash: keccak256('0x6000') };
  const client = { getChainId: async () => 1313161555, getBlock: async () => ({ number: 77n, timestamp: 990n }),
    getCode: async x => { assert.equal(x.blockNumber, 77n); return '0x6000'; },
    readContract: async x => { calls.push(x); assert.equal(x.blockNumber, 77n); assert.equal(x.address, addr(1)); return values[x.functionName]; } };
  const options = { client, manifest, clock: () => 1000 };
  return { calls, values, options, read: () => createReputationReader(options).read(addr(4)) };
}
test('reputation reader pins every read and returns loss totals as integer strings', async () => {
  const f = fixture(); const result = await f.read();
  assert.equal(result.score, '-1'); assert.equal(result.samples, '1'); assert.equal(result.negative, '1');
  assert.equal(result.hasEvaluatedStrategies, true); assert.equal(result.blockNumber, '77');
  assert.equal(f.calls.length, 4); assert.equal(result.metric, 'absolute-marked-return-points-v1');
});
test('an actual zero-sample history is distinguishable from unavailable data', async () => {
  const f = fixture(); f.values.statistics = [0n, 0n, 0n, 0n]; f.values.score = 0n;
  const result = await f.read(); assert.equal(result.hasEvaluatedStrategies, false); assert.equal(result.samples, '0');
});
test('wrong network is rejected before contract reads', async () => {
  const f = fixture(); f.options.client.getChainId = async () => 42161;
  await assert.rejects(f.read(), { code: 'REPUTATION_WRONG_NETWORK' }); assert.equal(f.calls.length, 0);
});
test('code and engine bindings must match the trusted manifest', async () => {
  const f = fixture(); f.options.client.getCode = async () => '0x6001';
  await assert.rejects(f.read(), { code: 'REPUTATION_CODE_MISMATCH' });
  const g = fixture(); g.values.engine = addr(9); await assert.rejects(g.read(), { code: 'REPUTATION_BINDING_MISMATCH' });
});
test('inconsistent sample totals and score are rejected', async () => {
  const f = fixture(); f.values.statistics = [2n, 0n, 1n, 0n];
  await assert.rejects(f.read(), { code: 'REPUTATION_INVALID_DATA' });
  const g = fixture(); g.values.score = 1n; await assert.rejects(g.read(), { code: 'REPUTATION_INVALID_DATA' });
});
test('stale blocks and RPC errors return unavailable errors rather than fabricated zero scores', async () => {
  const f = fixture(); f.options.clock = () => 2000; await assert.rejects(f.read(), { code: 'REPUTATION_STALE' });
  const g = fixture(); g.options.client.getBlock = async () => { throw Error('secret RPC URL'); };
  await assert.rejects(g.read(), { code: 'REPUTATION_UNAVAILABLE', message: 'REPUTATION_UNAVAILABLE' });
});
