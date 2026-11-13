import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SWARM2_MODELS, SWARM2_PROPOSERS, SWARM2_FORECASTERS, SWARM2_CALLS, SWARM2_ACTORS, SWARM2_BUDGET_NANO_USD, validateSwarmConfig, requestBodyFor, callAllowanceNanoUsd } from '../agents/swarm-config.mjs';
import { chooseProbabilityTrade, chooseTrade, validateProbabilityForecast } from '../agents/policy.mjs';
import { PROFILE_CALLS, roundCallCap } from '../agents/provider.mjs';
import { makeSwarm2Plan, validateSwarm2Plan, swarm2LiveProvider, swarm2FixtureProvider, makeStrategyPlan, validateStrategyPlan } from '../agents/strategy-team.mjs';

// Real-shaped inputs from the published round 7 plan (public evidence, not secrets).
const round7 = JSON.parse(readFileSync(new URL('../../docs/test-evidence/tidepool-rounds/round7/plan.json', import.meta.url)));
const now = round7.createdAt;
const { snapshot, market, researchContext } = round7;
const contracts = { safe: snapshot.safe, engine: snapshot.engine };
const options = { contracts, roundId: BigInt(snapshot.roundId), portfolio: snapshot.portfolio, now };

// ---------------------------------------------------------------- config

test('swarm2 config: 6 proposers + 8 forecasters, 14 distinct allowlisted models, attested proposers', () => {
  assert.equal(SWARM2_PROPOSERS.length, 6); assert.equal(SWARM2_FORECASTERS.length, 8); assert.equal(SWARM2_CALLS, 14);
  const models = [...SWARM2_PROPOSERS, ...SWARM2_FORECASTERS].map(a => a.model);
  assert.equal(new Set(models).size, 14);
  assert.ok(models.every(m => Object.hasOwn(SWARM2_MODELS, m)));
  assert.ok(SWARM2_PROPOSERS.every(p => SWARM2_MODELS[p.model].hosting === 'near-attested'));
  assert.ok(SWARM2_FORECASTERS.every(f => SWARM2_MODELS[f.model].hosting === 'proxied'));
  assert.ok(new Set(SWARM2_FORECASTERS.map(f => SWARM2_MODELS[f.model].family)).size >= 7);
  assert.equal(SWARM2_ACTORS.length, 14);
  assert.equal(PROFILE_CALLS.swarm2, 14); assert.equal(PROFILE_CALLS.swarm, 8); assert.equal(PROFILE_CALLS.hybrid, 4); assert.equal(PROFILE_CALLS.classic, 4);
});

test('swarm2 config rejects a shared model, an unknown model, a proxied proposer and overlapping mandates', () => {
  const p = SWARM2_PROPOSERS.map(x => ({ ...x })); const f = SWARM2_FORECASTERS.map(x => ({ ...x }));
  assert.throws(() => validateSwarmConfig({ proposers: p, forecasters: f.map((x, i) => i === 1 ? { ...x, model: f[0].model } : x) }), /different model/);
  assert.throws(() => validateSwarmConfig({ proposers: p, forecasters: f.map((x, i) => i === 0 ? { ...x, model: 'openai/gpt-5-mini' } : x) }), /Unknown model/);
  assert.throws(() => validateSwarmConfig({ proposers: p.map((x, i) => i === 0 ? { ...x, model: 'openai/gpt-4.1-mini' } : x), forecasters: f.map((x, i) => i === 0 ? { ...x, model: p[0].model } : x) }), /NEAR-attested/);
  assert.throws(() => validateSwarmConfig({ proposers: p.map((x, i) => i === 4 ? { ...x, max: 3500 } : x), forecasters: f }), /overlap/);
  assert.throws(() => validateSwarmConfig({ proposers: p.slice(0, 5), forecasters: f }), /six proposers/);
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
  for (let i = 1; i <= 14; i++) assert.equal(cap.take(), i);
  assert.throws(() => cap.take(), /Round model-call cap exhausted/);
  assert.throws(() => roundCallCap('swarm3'), /Unknown agent profile/);
});

// ---------------------------------------------------------------- calibrated trade rule

const CREDIT = 100000n; // 0.1 test USDC, the run-phase swarm credit amount
// outcomes (18 decimals) bought for CREDIT at a given entry price in bps: CREDIT * 1e12 * 10000 / priceBps.
const outcomesAt = priceBps => CREDIT * 10n ** 12n * 10000n / BigInt(priceBps);
const quotes = (rows) => rows.flatMap(([proposalId, longBps, shortBps]) => [{ proposalId, side: 'long', outcomeAmount: outcomesAt(longBps) }, { proposalId, side: 'short', outcomeAmount: outcomesAt(shortBps) }]);
const f = (proposalId, probabilityBeatsHoldBps) => ({ proposalId, probabilityBeatsHoldBps });

test('LONG at exactly the minimum edge, abstain one bp below', () => {
  const q = quotes([[3, 5000, 5000]]); // 2e17 outcomes each side: entry price exactly 50.00%
  assert.equal(q[0].outcomeAmount, 200000000000000000n);
  const trade = chooseProbabilityTrade({ forecasts: [f(3, 5500)], quotes: q, creditAmount: CREDIT });
  assert.equal(trade.side, 'long'); assert.equal(trade.proposalId, 3); assert.equal(trade.edgeMicroBps, 500000000n); assert.equal(trade.entryPriceMicroBps, 5000000000n);
  assert.equal(trade.minimumOutcomes, 199000000000000000n); // 0.5% slippage floor
  assert.equal(chooseProbabilityTrade({ forecasts: [f(3, 5499)], quotes: q, creditAmount: CREDIT }), null);
});

// Entry prices below divide 1e21 exactly (4000, 5000, 5120, 6250 bps), so edges are exact integers.
test('SHORT at exactly the minimum edge against the actual SHORT entry price, abstain one bp inside', () => {
  const q = quotes([[2, 6250, 4000]]);
  const trade = chooseProbabilityTrade({ forecasts: [f(2, 5500)], quotes: q, creditAmount: CREDIT }); // short prob 4500 - 4000 = 500
  assert.equal(trade.side, 'short'); assert.equal(trade.probabilityBps, 4500); assert.equal(trade.edgeMicroBps, 500000000n);
  assert.equal(chooseProbabilityTrade({ forecasts: [f(2, 5501)], quotes: q, creditAmount: CREDIT }), null);
  // Same probability against mirrored prices: the LONG side is cheap (4500 - 4000 = 500) => LONG, not SHORT.
  assert.equal(chooseProbabilityTrade({ forecasts: [f(2, 4500)], quotes: quotes([[2, 4000, 6250]]), creditAmount: CREDIT }).side, 'long');
});

test('abstain band includes the spread: no trade anywhere between the two thresholds', () => {
  const q = quotes([[1, 5120, 5120]]); // 2.4% round-trip spread: LONG needs p >= 5620, SHORT needs p <= 4380
  for (const p of [4381, 4500, 4900, 5000, 5120, 5619]) assert.equal(chooseProbabilityTrade({ forecasts: [f(1, p)], quotes: q, creditAmount: CREDIT }), null, `p=${p}`);
  assert.equal(chooseProbabilityTrade({ forecasts: [f(1, 5620)], quotes: q, creditAmount: CREDIT }).side, 'long');
  assert.equal(chooseProbabilityTrade({ forecasts: [f(1, 4380)], quotes: q, creditAmount: CREDIT }).side, 'short');
});

test('an inexact quote rounds against the trader: floor(outcomes) makes the edge just short of 500', () => {
  const q = quotes([[1, 4800, 5200]]); // 1e21/4800 is not an integer, so the true entry price is slightly above 48.00%
  assert.equal(chooseProbabilityTrade({ forecasts: [f(1, 5300)], quotes: q, creditAmount: CREDIT }), null);
  assert.equal(chooseProbabilityTrade({ forecasts: [f(1, 5301)], quotes: q, creditAmount: CREDIT }).side, 'long');
});

test('genuine round-7-style forecasts (near 50%) abstain; one strong view trades the largest edge', () => {
  const q = quotes([[1, 4000, 6250], [2, 5000, 5000], [3, 5120, 5120], [4, 6250, 4000]]);
  const shy = [f(1, 4400), f(2, 5200), f(3, 5300), f(4, 5800)];
  assert.equal(chooseProbabilityTrade({ forecasts: shy, quotes: q, creditAmount: CREDIT }), null);
  const strong = [f(1, 4800), f(2, 5600), f(3, 6100), f(4, 5900)];
  const trade = chooseProbabilityTrade({ forecasts: strong, quotes: q, creditAmount: CREDIT });
  assert.equal(trade.proposalId, 3); assert.equal(trade.side, 'long'); assert.equal(trade.edgeMicroBps, 980000000n);
});

test('probability rule validates inputs and never uses missing quotes', () => {
  assert.throws(() => chooseProbabilityTrade({ forecasts: [f(1, 10001)], quotes: [], creditAmount: CREDIT }), /Invalid probability/);
  assert.throws(() => chooseProbabilityTrade({ forecasts: [f(1, 6000)], quotes: [], creditAmount: 6000000n }), /local agent budget/);
  assert.throws(() => chooseProbabilityTrade({ forecasts: [f(1, 6000)], quotes: [], creditAmount: CREDIT, minEdgeBps: 0 }), /minimum edge/);
  assert.equal(chooseProbabilityTrade({ forecasts: [f(1, 9000)], quotes: [{ proposalId: 1, side: 'long', outcomeAmount: 0n }], creditAmount: CREDIT }), null);
  assert.equal(chooseProbabilityTrade({ forecasts: [f(1, 9000)], quotes: quotes([[2, 5000, 5000]]), creditAmount: CREDIT }), null);
});

test('old confidence rule is unchanged: real round-7 low confidence still abstains', () => {
  const forecasts = round7.forecasts[0].forecasts; const q = quotes([[0, 5000, 5000], [1, 5000, 5000], [2, 5000, 5000], [3, 5000, 5000], [4, 5000, 5000]]);
  assert.ok(forecasts.every(x => x.confidenceBps < 5000));
  assert.equal(chooseTrade({ forecasts, quotes: q, creditAmount: CREDIT }), null);
});

test('probability forecasts must cover challengers 1..6 exactly once and never Hold', () => {
  const ids = [1, 2, 3, 4, 5, 6]; const e = { rationale: 'r', risks: ['x'], evidenceIds: ['m'] };
  const ok = { forecasts: ids.map(id => ({ proposalId: id, probabilityBeatsHoldBps: 5000, ...e })) };
  assert.equal(validateProbabilityForecast(ok, { evidenceIds: ['m'], proposalIds: ids }).forecasts.length, 6);
  assert.throws(() => validateProbabilityForecast({ forecasts: [{ proposalId: 0, probabilityBeatsHoldBps: 5000, ...e }, ...ok.forecasts.slice(1)] }, { evidenceIds: ['m'], proposalIds: ids }), /Unknown or duplicate/);
  assert.throws(() => validateProbabilityForecast({ forecasts: ok.forecasts.slice(1) }, { evidenceIds: ['m'], proposalIds: ids }), /coverage/);
  assert.throws(() => validateProbabilityForecast({ forecasts: ok.forecasts.map(x => ({ ...x, confidenceBps: 1000 })) }, { evidenceIds: ['m'], proposalIds: ids }), /Invalid probability forecast fields/);
  assert.throws(() => validateProbabilityForecast({ forecasts: ok.forecasts.map((x, i) => i ? x : { ...x, probabilityBeatsHoldBps: -1 }) }, { evidenceIds: ['m'], proposalIds: ids }), /Invalid probability/);
});

// ---------------------------------------------------------------- plan

// One fake NEAR AI provider per agent, reporting the agent's own model. Values come from the fixture shape.
function fakeLive(log = []) {
  const base = swarm2FixtureProvider();
  return (agent, role) => ({ info: { mode: 'near-ai', model: agent.model, attestationVerified: false }, async complete(task) {
    log.push({ agent: agent.name, role, bytes: Buffer.byteLength(JSON.stringify({ system: task.system, context: task.context })) });
    const { value } = await base.complete(task);
    if (role === 'forecaster') value.forecasts = value.forecasts.map(x => ({ ...x, probabilityBeatsHoldBps: 4000 + 100 * x.proposalId, rationale: `${agent.model} view` }));
    return { value, usage: { inputTokens: 100, outputTokens: 10 } };
  } });
}

test('fixture swarm2 plan validates with explicit fixture provenance', async () => {
  const plan = await makeSwarm2Plan({ snapshot, market, now, fixture: true });
  assert.equal(plan.proposals.length, 7); assert.equal(plan.forecasts.length, 8); assert.equal(plan.records.length, 14);
  assert.deepEqual(plan.proposals.map(p => p.name), ['Hold', 'Conservative', 'Balanced', 'Momentum', 'HighBeta', 'Contrarian', 'VolAware']);
  assert.equal(validateSwarm2Plan(plan, { ...options, fixture: true }), plan);
  assert.throws(() => validateSwarm2Plan(plan, options), /provenance mismatch/);
});

test('live swarm2 plan records a different model per agent, 14 capped calls, real-size inputs', async () => {
  const log = []; const requests = [];
  const plan = await makeSwarm2Plan({ snapshot, market, researchContext, now, providerFor: fakeLive(log), onRequest: r => requests.push(r) });
  assert.equal(plan.kind, 'live-multi-model'); assert.equal(plan.teeScope, 'none'); assert.equal(plan.attestationVerified, false);
  assert.deepEqual(requests.map(r => r.request), [...Array(14).keys()].map(i => i + 1));
  assert.deepEqual(plan.records.map(r => r.model), [...SWARM2_PROPOSERS, ...SWARM2_FORECASTERS].map(a => a.model));
  assert.deepEqual(plan.provider.models, plan.records.map(r => r.model));
  assert.ok(plan.forecasts.every((x, i) => x.model === SWARM2_FORECASTERS[i].model));
  assert.ok(requests.at(-1).reservedNanoUsd <= SWARM2_BUDGET_NANO_USD);
  const forecasterBytes = log.filter(x => x.role === 'forecaster').map(x => x.bytes);
  assert.ok(Math.max(...forecasterBytes) < 20480 && Math.min(...forecasterBytes) > 10000, `forecaster bytes ${forecasterBytes}`);
  assert.equal(validateSwarm2Plan(plan, options), plan);
});

test('swarm2 validation rejects a changed or shared model and an attestation claim on forecasters', async () => {
  const fresh = () => makeSwarm2Plan({ snapshot, market, researchContext, now, providerFor: fakeLive() });
  let plan = await fresh(); plan.records[1].model = 'Qwen/Qwen3.6-35B-A3B-FP8';
  assert.throws(() => validateSwarm2Plan(plan, options), /Proposer model differs/);
  plan = await fresh(); plan.records[7].model = plan.forecasts[1].model = 'openai/gpt-4.1-mini';
  assert.throws(() => validateSwarm2Plan(plan, options), /Forecaster model differs/);
  plan = await fresh(); plan.provider.models = plan.provider.models.slice(1);
  assert.throws(() => validateSwarm2Plan(plan, options), /model list/);
  plan = await fresh(); plan.records[10].attestationVerified = true;
  assert.throws(() => validateSwarm2Plan(plan, options), /attestation provenance/);
  plan = await fresh(); plan.forecasts[0].forecasts[0].probabilityBeatsHoldBps += 1;
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
  assert.equal(records.length, 6);
});
