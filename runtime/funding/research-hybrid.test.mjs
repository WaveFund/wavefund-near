import test from 'node:test';
import assert from 'node:assert/strict';
import { localResearchFixture, validateMarket } from '../agents/market.mjs';
import { researchContext, validateResearchContext } from '../agents/research-context.mjs';
import { makeStrategyPlan, validateStrategyPlan, deliberateProvider } from '../agents/strategy-team.mjs';
import { LIVE_MODEL } from '../agents/aurora-plan.mjs';
import { makeAuroraPlan, validateAuroraPlan } from '../agents/aurora-plan.mjs';
const now = 20000;
const market = validateMarket({ ...localResearchFixture({ now }), source: 'external-unverified' }, { now });
const fulfilled = value => ({ status: 'fulfilled', value });
function data() { return {
  stats24h: fulfilled({ open: '1900', high: '2100', low: '1850', last: '2000', volume: '12345.67' }),
  spread: fulfilled({ bids: [['1999', '1', 1]], asks: [['2001', '1', 1]], time: new Date(now * 1000).toISOString() }),
  crossExchange: fulfilled({ error: [], result: { XETHZUSD: { c: ['2002', '1'], v: ['123', '456'] } } }),
}; }
test('research normalizes 24h return/volume, spread and independent exchange comparison with honest timestamps', () => {
  const c = researchContext(data(), { market, now });
  assert.equal(c.observations.stats24h.volume24hETH, '12345.67');
  assert.equal(c.observations.stats24h.return24hBpsApprox, 526.3157);
  assert.equal(c.observations.spread.publisherTimestamp, now);
  assert.equal(c.observations.crossExchange.differenceFromCoinbaseBpsApprox, 10);
  assert.equal(c.observations.crossExchange.publisherTimestamp, null);
  assert.equal(c.settlementEligible, false); assert.equal(validateResearchContext(c, { market, now }), c);
});
test('unavailable, crossed and wrong-pair sources are missing rather than invented zero', () => {
  const raw = data(); raw.stats24h = { status: 'rejected' }; raw.spread.value.asks[0][0] = '1900'; raw.crossExchange.value.result = { BTCUSD: {} };
  const c = researchContext(raw, { market, now });
  assert.ok(Object.values(c.observations).every(x => x.status === 'unavailable'));
  assert.ok(!('return24hBpsApprox' in c.observations.stats24h));
});
test('research tampering or old evidence fails validation', () => {
  const c = researchContext(data(), { market, now });
  assert.throws(() => validateResearchContext(c, { market, now: now + 301 }), /stale/);
  c.observations.crossExchange.lastUsdX18 = '1';
  assert.throws(() => validateResearchContext(c, { market, now }), /changed/);
});
test('ordinary genuine forecasters also receive the enriched source context without forcing a trade', async () => {
  const portfolio = { stableBalance: '1000000000', assetBalance: '500000000000000000', currentAllocationBps: 5000 };
  const contracts = { safe: '0x' + '11'.repeat(20), engine: '0x' + '22'.repeat(20) };
  const explanation = { confidenceBps: 500, rationale: 'Uncertain point forecast.', risks: ['Research is unverified.'], evidenceIds: [market.evidenceId] };
  const provider = { info: { mode: 'near-ai', model: LIVE_MODEL }, async complete({ context }) {
    return { value: context.role === 'proposer' ? { allocationBps: 5000, ...explanation }
      : { forecasts: context.proposals.map(p => ({ proposalId: p.id, expectedReturnBps: 0, ...explanation })) } };
  } };
  const plan = await makeAuroraPlan({ snapshot: { chainId: 1313161555, roundId: '7', ...contracts, portfolio, blockNumber: '100' }, market,
    researchContext: researchContext(data(), { market, now }), provider, now });
  assert.equal(validateAuroraPlan(plan, { contracts, roundId: 7n, portfolio, now }), plan);
  assert.ok(plan.records.every(r => r.input.context.researchContext.evidenceId === plan.researchContext.evidenceId));
  assert.ok(plan.forecasts.every(f => f.forecasts.every(p => p.confidenceBps === 500)));
});
test('hybrid calls only four live proposers, labels scripted forecasts, and records literal public prompts/inputs', async () => {
  let calls = 0; const fixture = deliberateProvider();
  const provider = { info: { mode: 'near-ai', model: LIVE_MODEL }, async complete(task) { calls++; return fixture.complete(task); } };
  const portfolio = { stableBalance: '1000000000', assetBalance: '500000000000000000', currentAllocationBps: 5000 };
  const contracts = { safe: '0x' + '11'.repeat(20), engine: '0x' + '22'.repeat(20) };
  const plan = await makeStrategyPlan({ snapshot: { chainId: 1313161555, roundId: '7', ...contracts, portfolio, blockNumber: '100' }, market,
    researchContext: researchContext(data(), { market, now }), scriptedForecasts: true, provider, now });
  assert.equal(calls, 4); assert.equal(plan.kind, 'ai-proposals-scripted-forecasters');
  assert.ok(plan.records.slice(0, 4).every(x => x.provider === 'near-ai'));
  assert.ok(plan.records.slice(4).every(x => x.provider === 'test-fixture'));
  assert.ok(plan.records.every(x => x.input.context.researchContext.evidenceId === plan.researchContext.evidenceId));
  assert.equal(plan.forecasts[0].forecasts.find(f => f.expectedReturnBps === 500).proposalId, 3);
  const options = { contracts, roundId: 7n, portfolio, now, scriptedForecasts: true };
  assert.equal(validateStrategyPlan(plan, options), plan);
  assert.throws(() => validateStrategyPlan(plan, { ...options, scriptedForecasts: false }), /identity/);
  plan.records[4].provider = 'near-ai';
  assert.throws(() => validateStrategyPlan(plan, options), /provenance/);
});
