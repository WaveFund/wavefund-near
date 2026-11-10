import test from 'node:test';
import assert from 'node:assert/strict';
import { makeAuroraPlan, validateAuroraPlan, boundedLiveProvider, LIVE_MODEL } from '../agents/aurora-plan.mjs';
import { validateMarket } from '../agents/market.mjs';
import { chooseTrade } from '../agents/policy.mjs';
import { normalizeAuthenticatedPrices } from '../agents/supra-observation.mjs';

const now = 200000;
const contracts = { safe: '0x1111111111111111111111111111111111111111', engine: '0x2222222222222222222222222222222222222222' };
const portfolio = { stableBalance: '0', assetBalance: '1000000000000000000', currentAllocationBps: 10000 };
const snapshot = { chainId: 1313161555, roundId: '2', ...contracts, portfolio, blockNumber: '100' };
const market = validateMarket({ source: 'external-unverified', asOf: now, stableUsdX18: '1000000000000000000', history: [
  { timestamp: now - 600, assetUsdX18: '2000000000000000000000' },
  { timestamp: now - 300, assetUsdX18: '2001000000000000000000' },
  { timestamp: now, assetUsdX18: '2002000000000000000000' },
] }, { now });
function fixtureProvider() {
  const contexts = [];
  return { contexts, info: { mode: 'near-ai', model: LIVE_MODEL, attestationVerified: false }, async complete({ context }) {
    contexts.push(context);
    const explanation = { confidenceBps: 7000, rationale: 'Fixture answer, not live inference', risks: ['Uncertain short horizon'], evidenceIds: [context.market.evidenceId] };
    const value = context.role === 'proposer' ? { allocationBps: context.agent === 'Momentum' ? 10000 : 5000, ...explanation }
      : { forecasts: context.proposals.map(p => ({ proposalId: p.id, expectedReturnBps: p.id === 2 ? -30 : 0, ...explanation })) };
    return { value, usage: { inputTokens: 10, outputTokens: 10 } };
  } };
}
const options = { contracts, roundId: 2n, portfolio, now };
async function fixturePlan() { return makeAuroraPlan({ snapshot, market, provider: fixtureProvider(), now }); }

test('four validated decisions bind to this treasury, round and real-research shape', async () => {
  const provider = fixtureProvider();
  const plan = await makeAuroraPlan({ snapshot, market, provider, now });
  assert.equal(validateAuroraPlan(plan, options), plan);
  assert.equal(plan.records.length, 4); assert.equal(provider.contexts.length, 4);
  assert.ok(provider.contexts.every(c => !JSON.stringify(c).includes(contracts.safe)));
  assert.ok(!JSON.stringify(provider.contexts[3]).includes('forecasts'));
  assert.equal(plan.attestationVerified, false);
});
test('different chain, round, treasury, changed holdings and expired research are rejected', async () => {
  const plan = await fixturePlan();
  for (const changed of [{ ...plan, chainId: 1 }, { ...plan, roundId: '3' }]) assert.throws(() => validateAuroraPlan(changed, options), /another chain or round/);
  assert.throws(() => validateAuroraPlan({ ...plan, safe: contracts.engine }, options), /another treasury/);
  assert.throws(() => validateAuroraPlan(plan, { ...options, portfolio: { ...portfolio, assetBalance: '1' } }), /Treasury changed/);
  assert.throws(() => validateAuroraPlan(plan, { ...options, now: now + 301 }), /stale/);
});
test('altered allocations, proposer identity, forecast coverage and model records fail closed', async () => {
  for (const [mutate, expected] of [
    [p => { p.proposals[1].allocationBps = 9000; }, /Proposal differs/],
    [p => { p.proposals[1].name = 'Guardian'; }, /proposer mapping/],
    [p => { p.forecasts[0].forecasts.pop(); }, /coverage/],
    [p => { p.records[0].outputHash = 'a'.repeat(64); }, /Proposal differs/],
    [p => { p.provider.mode = 'fixture'; }, /provider provenance/],
  ]) {
    const plan = await fixturePlan(); mutate(plan);
    assert.throws(() => validateAuroraPlan(plan, options), expected);
  }
});
test('synthetic research and secret-bearing snapshots cannot start live inference', async () => {
  const provider = fixtureProvider();
  await assert.rejects(makeAuroraPlan({ snapshot, market: { ...market, source: 'fixture' }, provider, now }), /not fixtures/);
  await assert.rejects(makeAuroraPlan({ snapshot: { ...snapshot, privateKey: 'not-a-real-secret' }, market, provider, now }), /snapshot fields/);
  assert.equal(provider.contexts.length, 0);
});
test('bounded provider uses documented Qwen JSON controls and at most four calls', async () => {
  const calls = []; const reservations = [];
  const provider = boundedLiveProvider({ mode: 'near-ai', model: LIVE_MODEL, apiKey: 'synthetic-test-key' }, {
    onRequest: r => reservations.push(r),
    fetchImpl: async (url, options) => { calls.push(JSON.parse(options.body)); return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{}' } }], usage: { prompt_tokens: 10, completion_tokens: 10 } })); },
  });
  for (let i = 0; i < 4; i++) await provider.complete({ system: 'Return JSON', context: {} });
  await assert.rejects(provider.complete({ system: 'Return JSON', context: {} }), /budget/);
  assert.equal(calls.length, 4); assert.equal(reservations.length, 4);
  assert.ok(reservations.at(-1).reservedNanoUsd <= 50000000);
  assert.deepEqual(calls[0].chat_template_kwargs, { enable_thinking: false });
  assert.deepEqual(calls[0].response_format, { type: 'json_object' });
  assert.equal(calls[0].max_tokens, 1800);
});
test('oversized requests and the wrong model consume zero requests', async () => {
  let calls = 0;
  assert.throws(() => boundedLiveProvider({ mode: 'near-ai', model: 'other/model', apiKey: 'test' }), /priced live model/);
  const provider = boundedLiveProvider({ mode: 'near-ai', model: LIVE_MODEL, apiKey: 'test' }, { fetchImpl: async () => { calls++; } });
  await assert.rejects(provider.complete({ system: 'x'.repeat(17000), context: {} }), /input limit/);
  assert.equal(calls, 0);
});
test('small live trade can clear execution costs where larger entry would rationally abstain', () => {
  const forecasts = [{ proposalId: 1, confidenceBps: 7000, expectedReturnBps: -30 }];
  assert.equal(chooseTrade({ forecasts, creditAmount: 2000000n, quotes: [{ proposalId: 1, side: 'short', outcomeAmount: 3400000000000000000n }] }), null);
  const small = chooseTrade({ forecasts, creditAmount: 100000n, quotes: [{ proposalId: 1, side: 'short', outcomeAmount: 198000000000000000n }] });
  assert.equal(small.side, 'short'); assert.ok(small.expectedProfit > 1000n);
});

test('authenticated snapshot metadata enforces units, exact pairs, positive prices and freshness', () => {
  const p = { pairs: [19n, 89n], prices: [200000000000n, 99990000n], timestamp: [199990000n, 199995000n], decimal: [8n, 8n], round: [1n, 1n] };
  assert.deepEqual(normalizeAuthenticatedPrices(p, 200000000n), { stable: 999900000000000000n, asset: 2000000000000000000000n });
  assert.throws(() => normalizeAuthenticatedPrices({ ...p, timestamp: [200000n, 200000n] }, 200000000n), /stale/);
  assert.throws(() => normalizeAuthenticatedPrices({ ...p, timestamp: [200000001n, 199995000n] }, 200000000n), /future/);
  assert.throws(() => normalizeAuthenticatedPrices({ ...p, pairs: [19n, 19n] }, 200000000n), /feeds/);
  assert.throws(() => normalizeAuthenticatedPrices({ ...p, timestamp: [199950000n, 199995000n] }, 200000000n), /skew/);
  assert.throws(() => normalizeAuthenticatedPrices({ ...p, prices: [0n, 99990000n] }, 200000000n), /Invalid authenticated price/);
});
