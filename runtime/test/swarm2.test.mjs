import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SWARM2_MODELS, SWARM2_PROPOSERS, SWARM2_FORECASTERS, SWARM2_CALLS, SWARM2_ACTORS, SWARM2_BUDGET_NANO_USD, SWARM2_MIN_EDGE_BPS, SWARM2_TRADE_RULE, validateSwarmConfig, requestBodyFor, callAllowanceNanoUsd } from '../agents/swarm-config.mjs';
import { chooseValueTrade, chooseTrade, expectedLongPayout, validateReturnForecast, VALUE_TRADE_RULE } from '../agents/policy.mjs';
import { PROFILE_CALLS, roundCallCap } from '../agents/provider.mjs';
import { SWARM2_FORECAST_IDS } from '../agents/swarm-config.mjs';
import { makeSwarm2Plan, validateSwarm2Plan, swarm2LiveProvider, swarm2FixtureProvider, makeStrategyPlan, validateStrategyPlan } from '../agents/strategy-team.mjs';

// Real-shaped inputs from the published round 7 plan (public evidence, not secrets).
const round7 = JSON.parse(readFileSync(new URL('../../docs/test-evidence/tidepool-rounds/round7/plan.json', import.meta.url)));
const now = round7.createdAt;
const { snapshot, market, researchContext } = round7;
const contracts = { safe: snapshot.safe, engine: snapshot.engine };
const options = { contracts, roundId: BigInt(snapshot.roundId), portfolio: snapshot.portfolio, now };

// ---------------------------------------------------------------- config

test('swarm2 config: 4 proposers + 8 forecasters, 12 distinct allowlisted models, attested proposers, no abliterated weights', () => {
  assert.equal(SWARM2_PROPOSERS.length, 4); assert.equal(SWARM2_FORECASTERS.length, 8); assert.equal(SWARM2_CALLS, 12);
  assert.deepEqual(SWARM2_PROPOSERS.map(p => p.name), ['Conservative', 'Balanced', 'Momentum', 'HighBeta']);
  assert.ok(Object.keys(SWARM2_MODELS).every(m => !/abliterated/i.test(m)));
  const models = [...SWARM2_PROPOSERS, ...SWARM2_FORECASTERS].map(a => a.model);
  assert.equal(new Set(models).size, 12);
  assert.ok(models.every(m => Object.hasOwn(SWARM2_MODELS, m)));
  assert.ok(SWARM2_PROPOSERS.every(p => SWARM2_MODELS[p.model].hosting === 'near-attested'));
  assert.ok(SWARM2_FORECASTERS.every(f => SWARM2_MODELS[f.model].hosting === 'proxied'));
  // 6 families: Moonshot (kimi-k2.6, empty JSON) and proxied Qwen3.7-max (HTTP 500) failed a live smoke test on 2026-11-13.
  assert.ok(new Set(SWARM2_FORECASTERS.map(f => SWARM2_MODELS[f.model].family)).size >= 6);
  assert.equal(SWARM2_ACTORS.length, 12);
  assert.equal(PROFILE_CALLS.swarm2, 12); assert.equal(PROFILE_CALLS.swarm2, SWARM2_CALLS); assert.equal(PROFILE_CALLS.swarm, 8); assert.equal(PROFILE_CALLS.hybrid, 4); assert.equal(PROFILE_CALLS.classic, 4);
});

test('swarm2 config rejects a shared model, an unknown model, a proxied proposer and overlapping mandates', () => {
  const p = SWARM2_PROPOSERS.map(x => ({ ...x })); const f = SWARM2_FORECASTERS.map(x => ({ ...x }));
  assert.throws(() => validateSwarmConfig({ proposers: p, forecasters: f.map((x, i) => i === 1 ? { ...x, model: f[0].model } : x) }), /different model/);
  assert.throws(() => validateSwarmConfig({ proposers: p, forecasters: f.map((x, i) => i === 0 ? { ...x, model: 'openai/gpt-5-mini' } : x) }), /Unknown model/);
  assert.throws(() => validateSwarmConfig({ proposers: p.map((x, i) => i === 0 ? { ...x, model: 'openai/gpt-4.1-mini' } : x), forecasters: f.map((x, i) => i === 0 ? { ...x, model: p[0].model } : x) }), /NEAR-attested/);
  assert.throws(() => validateSwarmConfig({ proposers: p.map((x, i) => i === 3 ? { ...x, min: 7900 } : x), forecasters: f }), /overlap/);
  assert.throws(() => validateSwarmConfig({ proposers: p.slice(0, 3), forecasters: f }), /four proposers/);
  assert.throws(() => validateSwarmConfig({ proposers: p.map((x, i) => i === 0 ? { ...x, model: 'Qwen/Qwen3.8-27B-abliterated' } : x), forecasters: f }), /Unknown model/);
  assert.deepEqual(validateSwarmConfig().proposers, SWARM2_PROPOSERS);
});

test('request bodies follow each model catalog features', () => {
  const body = model => ({ model, messages: [], max_tokens: 1800, temperature: 0.2, stream: false });
  const claude = requestBodyFor('anthropic/claude-haiku-5-5', 'forecaster', body('anthropic/claude-haiku-5-5'));
  assert.equal('temperature' in claude, false); assert.equal(claude.response_format.type, 'json_schema'); assert.equal(claude.response_format.json_schema.name, 'forecasts'); assert.equal(claude.max_tokens, 4000);
  const gpt = requestBodyFor('openai/gpt-4.1-mini', 'forecaster', body('openai/gpt-4.1-mini'));
  assert.deepEqual(gpt.response_format, { type: 'json_object' }); assert.equal(gpt.temperature, 0.2); assert.equal(gpt.max_tokens, 1800); assert.equal('chat_template_kwargs' in gpt, false);
  const glm = requestBodyFor('z-ai/glm-5.3', 'forecaster', body('z-ai/glm-5.3'));
  assert.equal('response_format' in glm, false);
  const qwen = requestBodyFor('Qwen/Qwen3.8-27B', 'proposer', body('Qwen/Qwen3.8-27B'));
  assert.equal(qwen.response_format.json_schema.name, 'proposal'); assert.deepEqual(qwen.chat_template_kwargs, { enable_thinking: false });
  assert.throws(() => requestBodyFor('openai/gpt-4.1-mini', 'forecaster', body('x-ai/grok-4.6')), /differs from the allowlisted/);
  assert.throws(() => requestBodyFor('openai/gpt-5-mini', 'forecaster', body('openai/gpt-5-mini')), /differs from the allowlisted/);
});

test('round budget equals the sum of worst-case reservations and fits no extra call', () => {
  const worst = [...SWARM2_PROPOSERS, ...SWARM2_FORECASTERS].map(a => callAllowanceNanoUsd(a.model, 20480));
  assert.equal(SWARM2_BUDGET_NANO_USD, worst.reduce((a, b) => a + b, 0));
  assert.ok(SWARM2_BUDGET_NANO_USD < 400000000); // under $0.40 even at the byte-as-token bound
  assert.throws(() => callAllowanceNanoUsd('openai/gpt-4.1-mini', 20481), /input limit/);
  const cap = roundCallCap('swarm2');
  for (let i = 1; i <= 12; i++) assert.equal(cap.take(), i);
  assert.throws(() => cap.take(), /Round model-call cap exhausted/);
  assert.throws(() => roundCallCap('swarm3'), /Unknown agent profile/);
});

// ---------------------------------------------------------------- expected-payout value trade rule

const CREDIT = 100000n; // 0.1 test USDC, the run-phase swarm credit amount
const R_MIN = 950000000000000000n; const R_MAX = 1050000000000000000n; // the round's on-chain bounds (+/-5%)
const EDGE = SWARM2_MIN_EDGE_BPS;
// outcomes (18 decimals) bought for CREDIT at a given entry price in bps: CREDIT * 1e12 * 10000 / priceBps.
const outcomesAt = priceBps => CREDIT * 10n ** 12n * 10000n / BigInt(priceBps);
const quotes = (rows) => rows.flatMap(([proposalId, longBps, shortBps]) => [{ proposalId, side: 'long', outcomeAmount: outcomesAt(longBps) }, { proposalId, side: 'short', outcomeAmount: outcomesAt(shortBps) }]);
const f = (proposalId, expectedReturnBps) => ({ proposalId, expectedReturnBps });
const trade = (forecasts, q, extra = {}) => chooseValueTrade({ forecasts, quotes: q, creditAmount: CREDIT, rMin: R_MIN, rMax: R_MAX, minEdgeBps: EDGE, ...extra });
const even = quotes([[0, 5000, 5000], [1, 5000, 5000], [2, 5000, 5000], [3, 5000, 5000], [4, 5000, 5000]]); // entry price exactly 0.5

test('minimum edge is 3 points and the rule name is recorded', () => {
  assert.equal(SWARM2_MIN_EDGE_BPS, 300); assert.equal(SWARM2_TRADE_RULE, 'expected-payout-value-v1'); assert.equal(VALUE_TRADE_RULE, SWARM2_TRADE_RULE);
});

test('real round-7 numbers: Conservative -255 bps at price 0.5 => SHORT; +24 bps => abstain', () => {
  // v = (1 - 0.0255 - 0.95) / 0.10 = 0.245; SHORT is worth 0.755 against a 0.5 entry price: edge 25.5 points.
  const short = trade([f(1, -255)], even);
  assert.equal(short.side, 'short'); assert.equal(short.proposalId, 1); assert.equal(short.rule, 'expected-payout-value-v1');
  assert.equal(short.expectedPayoutX18, 755000000000000000n); assert.equal(short.entryPriceX18, 500000000000000000n); assert.equal(short.edgeMicroBps, 2550000000n);
  assert.equal(short.minimumOutcomes, 199000000000000000n); // 0.5% slippage floor on 2e17 outcomes
  // v = (1.0024 - 0.95) / 0.10 = 0.524: LONG edge 2.4 points < 3, SHORT edge negative.
  assert.equal(trade([f(4, 24)], even), null);
  // The genuine round-7 Quant forecasts (confidence ignored): Conservative's -255 is the largest edge.
  const quant = round7.forecasts[0].forecasts.map(x => f(x.proposalId, x.expectedReturnBps));
  assert.deepEqual(quant.map(x => x.expectedReturnBps), [24, -255, -159, -60, 24]);
  const picked = trade(quant, even); assert.equal(picked.proposalId, 1); assert.equal(picked.side, 'short');
});

test('exact edge boundary on both sides: 3.0 points trades, 2.9 abstains', () => {
  // +30 bps => v = 0.53 exactly: LONG edge exactly 300 bps against 0.5.
  const long = trade([f(2, 30)], even); assert.equal(long.side, 'long'); assert.equal(long.edgeMicroBps, 300000000n);
  assert.equal(trade([f(2, 29)], even), null);
  // -30 bps => v = 0.47: SHORT worth 0.53, edge exactly 300 bps.
  const short = trade([f(2, -30)], even); assert.equal(short.side, 'short'); assert.equal(short.edgeMicroBps, 300000000n);
  assert.equal(trade([f(2, -29)], even), null);
  // The threshold is the passed minimum edge, not a constant.
  assert.equal(trade([f(2, 30)], even, { minEdgeBps: 301 }), null);
});

test('LONG and SHORT are priced against their own actual quotes', () => {
  // Same +30 forecast (v = 0.53); LONG costs 0.5, SHORT costs 0.4: SHORT worth 0.47 has edge 7 points, LONG only 3.
  const q = quotes([[3, 5000, 4000]]);
  const t = trade([f(3, 30)], q); assert.equal(t.side, 'short'); assert.equal(t.edgeMicroBps, 700000000n);
  // An inexact quote rounds against the trader: floor(outcomes) puts the LONG price just above 0.48.
  const inexact = quotes([[1, 4800, 9000]]);
  assert.equal(trade([f(1, 10)], inexact), null); // v = 0.51, edge just below 3 points
  assert.equal(trade([f(1, 11)], inexact).side, 'long');
});

test('payout is clipped at the bounds and uses the round actual rMin/rMax', () => {
  assert.equal(expectedLongPayout(500, R_MIN, R_MAX), 10n ** 18n); assert.equal(expectedLongPayout(900, R_MIN, R_MAX), 10n ** 18n);
  assert.equal(expectedLongPayout(-500, R_MIN, R_MAX), 0n); assert.equal(expectedLongPayout(-2000, R_MIN, R_MAX), 0n);
  // +900 and +500 both clip to a payout of 1: equal edges against the same 0.8 price, so the lower proposal id wins.
  const q = quotes([[1, 8000, 2500], [2, 8000, 2500]]);
  const tie = trade([f(2, 900), f(1, 500)], q); assert.equal(tie.proposalId, 1); assert.equal(tie.side, 'long'); assert.equal(tie.edgeMicroBps, 2000000000n);
  // Largest edge beats the lower id.
  assert.equal(trade([f(1, 230), f(2, 500)], q).proposalId, 2); // v(1) = 0.73: LONG negative, SHORT 2 points; v(2) = 1: LONG 20 points
  // +20 bps abstains under +/-5% (v = 0.52) but is a clear LONG under +/-1% bounds (v = 0.6).
  assert.equal(trade([f(1, 20)], even), null);
  assert.equal(trade([f(1, 20)], even, { rMin: 990000000000000000n, rMax: 1010000000000000000n }).side, 'long');
});

test('ranks by edge per outcome (price-relative), not by total surplus', () => {
  // id 1: v = 0.31 at a 0.25 LONG price -> edge 6 points on 4e17 outcomes; id 2: v = 0.6 at 0.5 -> edge 10 points on 2e17.
  const q = quotes([[1, 2500, 8000], [2, 5000, 5000]]);
  const t = trade([f(1, -190), f(2, 100)], q);
  assert.equal(t.proposalId, 2); assert.equal(t.side, 'long'); assert.equal(t.edgeMicroBps, 1000000000n);
  assert.equal(trade([f(1, -190)], q).edgeMicroBps, 600000000n);
});

test('abstain band includes the spread: no trade anywhere between the two thresholds', () => {
  const q = quotes([[1, 5120, 5120]]); // LONG needs v >= 0.542 (R >= +42), SHORT needs v <= 0.458 (R <= -42)
  for (const r of [-41, -20, 0, 12, 24, 41]) assert.equal(trade([f(1, r)], q), null, `r=${r}`);
  assert.equal(trade([f(1, 42)], q).side, 'long');
  assert.equal(trade([f(1, -42)], q).side, 'short');
});

test('value rule validates inputs and never uses missing quotes', () => {
  assert.throws(() => trade([f(1, 10001)], []), /Invalid expected return/);
  assert.throws(() => trade([{ proposalId: 1, probabilityBeatsHoldBps: 9000 }], []), /Invalid expected return/);
  assert.throws(() => chooseValueTrade({ forecasts: [f(1, 100)], quotes: [], creditAmount: 6000000n, rMin: R_MIN, rMax: R_MAX, minEdgeBps: EDGE }), /local agent budget/);
  assert.throws(() => trade([f(1, 100)], [], { minEdgeBps: 0 }), /minimum edge/);
  assert.throws(() => trade([f(1, 100)], [], { rMin: undefined }), /Round return bounds are required/);
  assert.throws(() => trade([f(1, 100)], [], { rMin: R_MAX, rMax: R_MIN }), /Invalid payout bounds/);
  assert.equal(trade([f(1, 900)], [{ proposalId: 1, side: 'long', outcomeAmount: 0n }]), null);
  assert.equal(trade([f(1, 900)], quotes([[2, 5000, 5000]])), null);
});

test('old confidence rule is unchanged: real round-7 low confidence still abstains', () => {
  const forecasts = round7.forecasts[0].forecasts;
  assert.ok(forecasts.every(x => x.confidenceBps < 5000));
  assert.equal(chooseTrade({ forecasts, quotes: even, creditAmount: CREDIT }), null);
});

test('return forecasts cover every proposal (Hold included) once, with no confidence field', () => {
  const ids = [0, 1, 2, 3, 4, 5]; const e = { rationale: 'r', risks: ['x'], evidenceIds: ['m'] };
  const ok = { forecasts: ids.map(id => ({ proposalId: id, expectedReturnBps: -12, ...e })) };
  assert.equal(validateReturnForecast(ok, { evidenceIds: ['m'], proposalIds: ids }).forecasts.length, 6);
  const withNote = { forecasts: ok.forecasts.map(x => ({ ...x, uncertainty: 'Thin history.' })) };
  assert.equal(validateReturnForecast(withNote, { evidenceIds: ['m'], proposalIds: ids }).forecasts[0].uncertainty, 'Thin history.');
  assert.throws(() => validateReturnForecast({ forecasts: [{ ...ok.forecasts[1] }, ...ok.forecasts.slice(1)] }, { evidenceIds: ['m'], proposalIds: ids }), /Unknown or duplicate/);
  assert.throws(() => validateReturnForecast({ forecasts: ok.forecasts.slice(1) }, { evidenceIds: ['m'], proposalIds: ids }), /coverage/);
  assert.throws(() => validateReturnForecast({ forecasts: ok.forecasts.map(x => ({ ...x, confidenceBps: 1000 })) }, { evidenceIds: ['m'], proposalIds: ids }), /Invalid return forecast fields/);
  assert.throws(() => validateReturnForecast({ forecasts: ok.forecasts.map(({ expectedReturnBps, ...x }) => ({ ...x, probabilityBeatsHoldBps: 5000 })) }, { evidenceIds: ['m'], proposalIds: ids }), /Invalid return forecast fields/);
  assert.throws(() => validateReturnForecast({ forecasts: ok.forecasts.map((x, i) => i ? x : { ...x, expectedReturnBps: 10001 }) }, { evidenceIds: ['m'], proposalIds: ids }), /Invalid expected return/);
  assert.throws(() => validateReturnForecast({ forecasts: ok.forecasts.map((x, i) => i ? x : { ...x, uncertainty: '' }) }, { evidenceIds: ['m'], proposalIds: ids }), /Invalid uncertainty/);
});

// ---------------------------------------------------------------- plan

// One fake NEAR AI provider per agent, reporting the agent's own model. Values come from the fixture shape.
function fakeLive(log = []) {
  const base = swarm2FixtureProvider();
  return (agent, role) => ({ info: { mode: 'near-ai', model: agent.model, attestationVerified: false }, async complete(task) {
    log.push({ agent: agent.name, role, bytes: Buffer.byteLength(JSON.stringify({ system: task.system, context: task.context })) });
    const { value } = await base.complete(task);
    if (role === 'forecaster') value.forecasts = value.forecasts.map(x => ({ ...x, expectedReturnBps: 10 * x.proposalId - 20, rationale: `${agent.model} view` }));
    return { value, usage: { inputTokens: 100, outputTokens: 10 } };
  } });
}

test('fixture swarm2 plan validates with explicit fixture provenance', async () => {
  const plan = await makeSwarm2Plan({ snapshot, market, now, fixture: true });
  assert.equal(plan.proposals.length, 5); assert.equal(plan.forecasts.length, 8); assert.equal(plan.records.length, 12);
  assert.deepEqual(plan.proposals.map(p => p.name), ['Hold', 'Conservative', 'Balanced', 'Momentum', 'HighBeta']);
  assert.equal(validateSwarm2Plan(plan, { ...options, fixture: true }), plan);
  assert.throws(() => validateSwarm2Plan(plan, options), /provenance mismatch/);
});

test('live swarm2 plan records a different model per agent, 12 capped calls, real-size inputs', async () => {
  const log = []; const requests = [];
  const plan = await makeSwarm2Plan({ snapshot, market, researchContext, now, providerFor: fakeLive(log), onRequest: r => requests.push(r) });
  assert.equal(plan.kind, 'live-multi-model'); assert.equal(plan.teeScope, 'none'); assert.equal(plan.attestationVerified, false);
  assert.deepEqual(requests.map(r => r.request), [...Array(12).keys()].map(i => i + 1));
  assert.deepEqual(plan.records.map(r => r.model), [...SWARM2_PROPOSERS, ...SWARM2_FORECASTERS].map(a => a.model));
  assert.deepEqual(plan.provider.models, plan.records.map(r => r.model));
  assert.ok(plan.forecasts.every((x, i) => x.model === SWARM2_FORECASTERS[i].model));
  assert.ok(requests.at(-1).reservedNanoUsd <= SWARM2_BUDGET_NANO_USD);
  const forecasterBytes = log.filter(x => x.role === 'forecaster').map(x => x.bytes);
  assert.ok(Math.max(...forecasterBytes) < 20480 && Math.min(...forecasterBytes) > 10000, `forecaster bytes ${forecasterBytes}`);
  assert.equal(validateSwarm2Plan(plan, options), plan);
  // Pre-registered trading terms and the literal forecaster prompt.
  assert.equal(plan.tradeRule, 'expected-payout-value-v1'); assert.equal(plan.minEdgeBps, 300);
  const prompt = plan.records.find(r => r.role === 'forecaster').input.system;
  assert.match(prompt, /expectedReturnBps/); assert.match(prompt, /180-second evaluation horizon/);
  assert.match(prompt, /One LONG token pays clamp\(\(1 \+ R - rMin\) \/ \(rMax - rMin\), 0, 1\) test USDC with rMin 0\.95 and rMax 1\.05/);
  assert.match(prompt, /One SHORT token pays 1 minus that/); assert.match(prompt, /at least 3 points/);
  assert.doesNotMatch(prompt, /probabilityBeatsHold|calibrated probability|confidenceBps/);
  assert.ok(plan.forecasts.every(x => x.forecasts.map(y => y.proposalId).join() === SWARM2_FORECAST_IDS.join() && SWARM2_FORECAST_IDS[0] === 0));
  assert.throws(() => validateSwarm2Plan({ ...plan, tradeRule: 'probability-beats-hold' }, options), /Changed swarm2 trading terms/);
  assert.throws(() => validateSwarm2Plan({ ...plan, minEdgeBps: 500 }, options), /Changed swarm2 trading terms/);
});

test('swarm2 validation rejects a changed or shared model and an attestation claim on forecasters', async () => {
  const fresh = () => makeSwarm2Plan({ snapshot, market, researchContext, now, providerFor: fakeLive() });
  let plan = await fresh(); plan.records[1].model = 'Qwen/Qwen3.6-35B-A3B-FP8';
  assert.throws(() => validateSwarm2Plan(plan, options), /Proposer model differs/);
  plan = await fresh(); plan.records[6].model = plan.forecasts[1].model = 'openai/gpt-4.1-mini';
  assert.throws(() => validateSwarm2Plan(plan, options), /Forecaster model differs/);
  plan = await fresh(); plan.provider.models = plan.provider.models.slice(1);
  assert.throws(() => validateSwarm2Plan(plan, options), /model list/);
  plan = await fresh(); plan.records[10].attestationVerified = true;
  assert.throws(() => validateSwarm2Plan(plan, options), /attestation provenance/);
  plan = await fresh(); plan.forecasts[0].forecasts[0].expectedReturnBps += 1;
  assert.throws(() => validateSwarm2Plan(plan, options), /Changed forecast decision/);
});

test('a provider answering with another model is refused before any paid call', async () => {
  let calls = 0; const live = fakeLive();
  const providerFor = (agent, role) => agent.name === 'Guardian' ? { info: { mode: 'near-ai', model: 'openai/gpt-4.1-mini' }, async complete() { calls++; return {}; } } : live(agent, role);
  await assert.rejects(makeSwarm2Plan({ snapshot, market, researchContext, now, providerFor }), /Provider model differs/);
  assert.equal(calls, 0);
});

test('live provider sends the allowlisted model body once and never retries', async () => {
  const sent = [];
  const fetchImpl = async (url, options) => { sent.push(JSON.parse(options.body)); return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"ok":1}' } }], usage: { prompt_tokens: 5, completion_tokens: 2 } })); };
  const agent = SWARM2_FORECASTERS.find(a => a.name === 'Guardian');
  const provider = swarm2LiveProvider(agent, 'forecaster', { apiKey: 'unit-test-placeholder', fetchImpl });
  assert.deepEqual(provider.info.model, 'anthropic/claude-haiku-5-5');
  assert.deepEqual((await provider.complete({ system: 's', context: {} })).value, { ok: 1 });
  await assert.rejects(provider.complete({ system: 's', context: {} }), /budget exhausted/);
  assert.equal(sent.length, 1); assert.equal(sent[0].model, 'anthropic/claude-haiku-5-5'); assert.equal('temperature' in sent[0], false); assert.equal(sent[0].response_format.type, 'json_schema');
  assert.throws(() => swarm2LiveProvider({ ...agent, model: 'openai/gpt-4.1-mini' }, 'forecaster', { apiKey: 'x', fetchImpl }), /differs from the swarm2 allowlist/);
});

test('old swarm profile still builds and validates unchanged', async () => {
  const plan = await makeStrategyPlan({ snapshot: { ...snapshot, portfolio: { ...snapshot.portfolio } }, market, now, fixture: true });
  assert.equal(plan.profile, 'diverse-v1'); assert.equal(plan.records.length, 8);
  assert.equal(validateStrategyPlan(plan, { ...options, fixture: true }), plan);
});

test('an unattested forecaster call that carries attestation fields is refused, not recorded', async () => {
  const live = fakeLive(); const records = [];
  const providerFor = (agent, role) => { const p = live(agent, role); return role === 'forecaster' ? { info: p.info, async complete(task) { return { ...(await p.complete(task)), privacy: { verified: true } }; } } : p; };
  await assert.rejects(makeSwarm2Plan({ snapshot, market, researchContext, now, providerFor, onRecord: r => records.push(r) }), /Unexpected attestation on an unattested call/);
  assert.equal(records.length, 4);
});
