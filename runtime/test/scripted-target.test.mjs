// Pre-registered scripted targets: each target 0..4 must actually be selected by the engine's TWAP rule.
// The market here is a constant-product MODEL of the full-range v4 LONG/SHORT pool (0.3% fee, fees outside reserves),
// calibrated below against the four quotes recorded on Aurora testnet in Tidepool round 1. It is not the contract.
import test from 'node:test';
import assert from 'node:assert/strict';
import { localResearchFixture, validateMarket } from '../agents/market.mjs';
import { researchContext } from '../agents/research-context.mjs';
import { makeStrategyPlan, validateStrategyPlan, deliberateProvider, scriptedViews, STRATEGIES } from '../agents/strategy-team.mjs';
import { LIVE_MODEL } from '../agents/aurora-plan.mjs';
import { chooseTrade } from '../agents/policy.mjs';
import { digest } from '../agents/policy.mjs';

const now = 20000;
const market = validateMarket({ ...localResearchFixture({ now }), source: 'external-unverified' }, { now });
const fulfilled = value => ({ status: 'fulfilled', value });
const data = () => ({
  stats24h: fulfilled({ open: '1900', high: '2100', low: '1850', last: '2000', volume: '12345.67' }),
  spread: fulfilled({ bids: [['1999', '1', 1]], asks: [['2001', '1', 1]], time: new Date(now * 1000).toISOString() }),
  crossExchange: fulfilled({ error: [], result: { XETHZUSD: { c: ['2002', '1'], v: ['123', '456'] } } }),
});
const contracts = { safe: '0x' + '11'.repeat(20), engine: '0x' + '22'.repeat(20) };
const portfolio = { stableBalance: '199480000', assetBalance: '0', currentAllocationBps: 0 };
const options = { contracts, roundId: 7n, portfolio, now, scriptedForecasts: true };
const ONE = 10n ** 18n; const SCALE = 10n ** 12n; const EPSILON = 5n * 10n ** 15n; const SEED = 5000000n;

async function hybridPlan(extra = {}) {
  const fixture = deliberateProvider(); let calls = 0;
  const provider = { info: { mode: 'near-ai', model: LIVE_MODEL }, async complete(task) { calls++; return fixture.complete(task); } };
  const plan = await makeStrategyPlan({ snapshot: { chainId: 1313161555, roundId: '7', ...contracts, portfolio, blockNumber: '100' }, market,
    researchContext: researchContext(data(), { market, now }), scriptedForecasts: true, provider, now, ...extra });
  return { plan, calls };
}

function pool() { return { long: SEED * SCALE, short: SEED * SCALE }; }
function fill(p, credits, isLong, mutate = false, feePips = 3000n) {
  const raw = credits * SCALE; const input = raw * (1000000n - feePips) / 1000000n;
  const [inside, outside] = isLong ? ['short', 'long'] : ['long', 'short'];
  const out = p[outside] * input / (p[inside] + input);
  if (mutate) { p[outside] -= out; p[inside] += input; }
  return raw + out;
}
const probability = p => p.short * ONE / (p.long + p.short);
function simulate(plan) {
  const pools = plan.proposals.map(() => pool()); const trades = [];
  for (const [index, forecaster] of plan.forecasts.entries()) {
    const creditAmount = index === 0 ? 400000n : 100000n;
    const quotes = plan.proposals.flatMap(p => ['long', 'short'].map(side => ({ proposalId: p.id, side, outcomeAmount: fill(pools[p.id], creditAmount, side === 'long') })));
    const trade = chooseTrade({ forecasts: forecaster.forecasts, quotes, creditAmount });
    trades.push(trade && { name: forecaster.name, proposalId: trade.proposalId, side: trade.side, out: fill(pools[trade.proposalId], creditAmount, trade.side === 'long', true) });
  }
  const twaps = pools.map(probability); let best = 0;
  for (let p = 1; p < twaps.length; p++) if (best === 0 || twaps[p] > twaps[best]) best = p;
  return { trades, twaps, winner: best !== 0 && twaps[best] > twaps[0] + EPSILON ? best : 0 };
}

test('pool model reproduces the four quotes recorded on chain in Tidepool round 1 (within 0.05%)', () => {
  const pools = [0, 1, 2, 3, 4].map(() => pool()); const close = (a, b) => (a > b ? a - b : b - a) * 10000n <= b * 5n;
  assert.ok(close(fill(pools[3], 400000n, true, true), 769341335111506260n), 'Quant LONG 3');
  assert.ok(close(fill(pools[3], 100000n, false, true), 213788487962928732n), 'Guardian SHORT 3');
  assert.ok(close(fill(pools[1], 100000n, false, true), 197750848089103280n), 'FeeAnalyst SHORT 1');
  assert.ok(close(fill(pools[3], 100000n, true, true), 187584405930591284n), 'StressAnalyst LONG 3');
  // Discriminates: the same pool without the 0.3% fee misses the recorded quote by more than the tolerance.
  assert.ok(!close(fill(pool(), 400000n, true, false, 0n), 769341335111506260n));
});

for (const target of [0, 1, 2, 3, 4]) {
  test(`scripted target ${target} is recorded, validated, and selected by the TWAP rule`, async () => {
    const { plan, calls } = await hybridPlan({ scriptedTarget: target });
    assert.equal(calls, 4, 'still exactly four paid proposer calls');
    assert.equal(plan.scriptedTarget, target);
    assert.equal(validateStrategyPlan(plan, options), plan);
    const views = scriptedViews(target);
    for (const forecast of plan.forecasts) {
      const directional = forecast.forecasts.filter(f => f.expectedReturnBps !== 0);
      assert.deepEqual(directional.map(f => [f.proposalId, f.expectedReturnBps]), [views[forecast.name]]);
    }
    assert.deepEqual([views.Quant[0], views.Guardian[0], views.StressAnalyst[0]], [target, target, target]);
    assert.notEqual(views.FeeAnalyst[0], target); assert.notEqual(views.FeeAnalyst[0], 0, 'FeeAnalyst never shorts Hold');
    const { trades, twaps, winner } = simulate(plan);
    assert.ok(trades.every(Boolean), 'every scripted forecaster finds an edge and trades');
    assert.deepEqual(trades.map(t => [t.name, t.proposalId, t.side]), plan.forecasts.map(f => [f.name, views[f.name][0], views[f.name][1] > 0 ? 'long' : 'short']));
    assert.equal(winner, target, `twaps ${twaps.join(',')}`);
    if (target === 0) assert.ok(twaps.slice(1).every(t => t <= twaps[0] + EPSILON), 'no challenger lifted above Hold');
    else assert.ok(twaps[target] > twaps[0] + EPSILON);
  });
}

test('target 3 reproduces the original round-1 fixture views exactly (backward compatible default)', async () => {
  assert.deepEqual(scriptedViews(3), { Quant: [3, 500], Guardian: [3, -500], FeeAnalyst: [1, -500], StressAnalyst: [3, 500] });
  const { plan } = await hybridPlan();
  assert.equal(plan.scriptedTarget, 3); assert.equal(plan.evaluationSeconds, 180);
  assert.ok(plan.records.every(r => r.input.context.policy.horizonSeconds === 180 && r.input.system.includes('Forecast the180second evaluation horizon')));
});

test('FeeAnalyst never shorts the target: SHORT 1 except for target 1, where it shorts HighBeta instead', async () => {
  for (const target of [0, 2, 3, 4]) assert.equal(scriptedViews(target).FeeAnalyst[0], 1);
  assert.equal(scriptedViews(1).FeeAnalyst[0], 4);
});

test('scripted target validation: out of range, tampered, mismatched forecasts and non-hybrid targets are rejected', async () => {
  for (const bad of [-1, 5, 1.5, '3', null]) await assert.rejects(hybridPlan({ scriptedTarget: bad }), /Scripted target/, String(bad));
  assert.throws(() => scriptedViews(5), /Scripted target/);
  let { plan } = await hybridPlan({ scriptedTarget: 2 });
  plan.scriptedTarget = 4;
  assert.throws(() => validateStrategyPlan(plan, options), /pre-registered target/);
  ({ plan } = await hybridPlan({ scriptedTarget: 2 }));
  delete plan.scriptedTarget;
  assert.throws(() => validateStrategyPlan(plan, options), /Scripted target/);
  ({ plan } = await hybridPlan({ scriptedTarget: 2 }));
  plan.scriptedTarget = 7;
  assert.throws(() => validateStrategyPlan(plan, options), /Scripted target/);
  // A forecast redirected to another proposal with a consistent record hash still fails the target rule.
  ({ plan } = await hybridPlan({ scriptedTarget: 2 }));
  const quant = plan.forecasts[0].forecasts; quant.find(f => f.proposalId === 2).expectedReturnBps = 0; quant.find(f => f.proposalId === 4).expectedReturnBps = 500;
  plan.records[4].outputHash = digest({ forecasts: quant });
  assert.throws(() => validateStrategyPlan(plan, options), /pre-registered target/);
  const fixturePlan = await makeStrategyPlan({ snapshot: { chainId: 1313161555, roundId: '7', ...contracts, portfolio, blockNumber: '100' }, market, fixture: true, now });
  assert.equal('scriptedTarget' in fixturePlan, false);
  assert.equal(validateStrategyPlan(fixturePlan, { ...options, scriptedForecasts: false, fixture: true }), fixturePlan);
  assert.throws(() => validateStrategyPlan({ ...fixturePlan, scriptedTarget: 3 }, { ...options, scriptedForecasts: false, fixture: true }), /scripted target/);
});

test('evaluation window is pre-registered in the plan, bounded 180..3600 and visible to every agent prompt', async () => {
  const { plan } = await hybridPlan({ scriptedTarget: 1, evaluationSeconds: 3600 });
  assert.equal(plan.evaluationSeconds, 3600);
  assert.ok(plan.records.every(r => r.input.context.policy.horizonSeconds === 3600 && r.input.system.includes('Forecast the3600second')));
  assert.equal(validateStrategyPlan(plan, options), plan);
  for (const bad of [179, 3601, 600.5, '600']) await assert.rejects(hybridPlan({ evaluationSeconds: bad }), /Evaluation window/, String(bad));
  plan.evaluationSeconds = 600;
  assert.throws(() => validateStrategyPlan(plan, options), /pre-registered evaluation window/);
  plan.evaluationSeconds = 4000;
  assert.throws(() => validateStrategyPlan(plan, options), /Evaluation window/);
  assert.equal(STRATEGIES.length, 4);
});
