import test from 'node:test';
import assert from 'node:assert/strict';
import { makeStrategyPlan, validateStrategyPlan, anonymousStrategies, deliberateProvider, STRATEGIES } from '../agents/strategy-team.mjs';
import { boundedLiveProvider, LIVE_MODEL } from '../agents/aurora-plan.mjs';
import { validateMarket } from '../agents/market.mjs';
const now = 200000;
const contracts = { safe: '0x1111111111111111111111111111111111111111', engine: '0x2222222222222222222222222222222222222222' };
const portfolio = { stableBalance: '0', assetBalance: '1000000000000000000', currentAllocationBps: 10000 };
const snapshot = { chainId: 1313161555, roundId: '3', ...contracts, portfolio, blockNumber: '123' };
const market = validateMarket({ source: 'external-unverified', asOf: now, stableUsdX18: '1000000000000000000', history: [
  { timestamp: now - 600, assetUsdX18: '2000000000000000000000' }, { timestamp: now - 300, assetUsdX18: '1999000000000000000000' }, { timestamp: now, assetUsdX18: '1998000000000000000000' },
] }, { now });
const options = { contracts, roundId: 3n, portfolio, now, fixture: true };
const fixture = () => makeStrategyPlan({ snapshot, market, fixture: true, now });

test('deliberate profile has four distinct mandates, four forecasters and explicit fixture provenance', async () => {
  const plan = await fixture();
  assert.equal(plan.records.length, 8); assert.equal(plan.proposals.length, 5); assert.equal(plan.forecasts.length, 4);
  assert.deepEqual(plan.proposals.slice(1).map(p => p.allocationBps), [1000, 4500, 7500, 9500]);
  assert.equal(validateStrategyPlan(plan, options), plan);
  assert.ok(plan.records.every(r => r.provider === 'test-fixture'));
  assert.throws(() => validateStrategyPlan(plan, { ...options, fixture: false }), /provenance mismatch/);
});
test('forecasters receive anonymous allocations and correct zero Hold fee', async () => {
  const plan = await fixture(); const values = anonymousStrategies(plan.proposals, 10000);
  assert.equal(values[0].turnoverBps, 0); assert.equal(values[0].swapFeeEstimatePortfolioBps, 0);
  assert.equal(values[2].turnoverBps, 5500); assert.equal(values[2].swapFeeEstimatePortfolioBps, 16.5);
  assert.ok(!JSON.stringify(values).includes('Momentum'));
  assert.ok(!JSON.stringify(values).includes('Conservative'));
});
test('live profile preserves decisions and separate forecaster inputs without fixture substitution', async () => {
  const base = deliberateProvider(); const contexts = [];
  const provider = { info: { mode: 'near-ai', model: LIVE_MODEL, attestationVerified: false }, async complete(task) { contexts.push(task.context); return base.complete(task); } };
  const plan = await makeStrategyPlan({ snapshot, market, provider, now });
  assert.equal(plan.kind, 'live-model'); assert.equal(validateStrategyPlan(plan, { ...options, fixture: false }), plan);
  assert.equal(contexts.length, 8);
  assert.ok(contexts.slice(4).every(c => c.strategies.length === 5 && !JSON.stringify(c.strategies).includes('Momentum') && !('forecasts' in c)));
});
test('wrong mandate output halts before forecasters and never rewrites or regenerates it', async () => {
  let calls = 0; const base = deliberateProvider();
  const provider = { ...base, async complete(task) { calls++; const result = await base.complete(task); if (calls === 2) result.value.allocationBps = 1000; return result; } };
  await assert.rejects(makeStrategyPlan({ snapshot, market, fixture: true, provider, now }), /allocation/);
  assert.equal(calls, 2);
});
test('duplicate, altered and secret-bearing plans are rejected', async () => {
  let plan = await fixture(); plan.proposals[2].allocationBps = plan.proposals[1].allocationBps;
  assert.throws(() => validateStrategyPlan(plan, options), /Duplicate/);
  plan = await fixture(); plan.records[0].outputHash = 'a'.repeat(64);
  assert.throws(() => validateStrategyPlan(plan, options), /Changed strategy decision/);
  await assert.rejects(makeStrategyPlan({ snapshot: { ...snapshot, privateKey: 'fixture-nonsecret' }, market, fixture: true, now }), /snapshot fields/);
});
test('mark-price weight drift does not masquerade as a custody change', async () => {
  const mixed = { ...snapshot, portfolio: { stableBalance: '2000000000', assetBalance: '1000000000000000000', currentAllocationBps: 5000 } };
  const plan = await makeStrategyPlan({ snapshot: mixed, market, fixture: true, now });
  assert.equal(validateStrategyPlan(plan, { ...options, portfolio: { ...mixed.portfolio, currentAllocationBps: 5073 } }), plan);
  assert.throws(() => validateStrategyPlan(plan, { ...options, portfolio: { ...mixed.portfolio, stableBalance: '2000000001' } }), /treasury changed/);
});
test('explicit expanded budget admits eight requests and rejects the ninth', async () => {
  let calls = 0;
  const provider = boundedLiveProvider({ mode: 'near-ai', model: LIVE_MODEL, apiKey: 'synthetic-test-key' }, { maxCalls: 8, budgetNanoUsd: 100000000,
    fetchImpl: async () => { calls++; return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{}' } }] })); } });
  for (let i = 0; i < 8; i++) await provider.complete({ system: 'JSON only', context: {} });
  await assert.rejects(provider.complete({ system: 'JSON only', context: {} }), /budget/);
  assert.equal(calls, 8);
  assert.throws(() => boundedLiveProvider({ mode: 'near-ai', model: LIVE_MODEL, apiKey: 'test' }, { maxCalls: 9 }), /explicit live budget/);
});
