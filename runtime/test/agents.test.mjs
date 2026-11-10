import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { AGENT_SPECS, chooseTrade, expectedLongPayout, validateProposal, validateForecast, ONE } from '../agents/policy.mjs';
import { localResearchFixture, validateMarket } from '../agents/market.mjs';
import { createProvider, providerConfig } from '../agents/provider.mjs';
import { createAgentTeam } from '../agents/team.mjs';

const context = { evidenceIds: ['market-1'] };
const proposal = { allocationBps: 10000, confidenceBps: 7000, rationale: 'Trend is positive, with downside risk.', risks: ['Prices can fall.'], evidenceIds: ['market-1'] };
const forecast = { proposalId: 1, expectedReturnBps: 500, confidenceBps: 7000, rationale: 'Synthetic positive trend.', risks: ['Trend may reverse.'], evidenceIds: ['market-1'] };
const quotes = [{ proposalId: 1, side: 'long', outcomeAmount: 3n * ONE }, { proposalId: 1, side: 'short', outcomeAmount: 3n * ONE }];

test('proposals permit full capital and reject forbidden fields, allocations, types and citations', () => {
  assert.equal(validateProposal(proposal, context).allocationBps, 10000);
  for (const patch of [{ allocationBps: 10001 }, { allocationBps: -1 }, { allocationBps: '5000' }, { confidenceBps: 10001 }, { recipient: 'attacker' }, { evidenceIds: ['invented'] }, { rationale: '\u0000bad' }]) assert.throws(() => validateProposal({ ...proposal, ...patch }, context), /Invalid|Unknown/);
  assert.throws(() => validateProposal(proposal, { ...context, maxAllocationBps: 9000 }), /allocation/);
});
test('forecasters must cover each supplied proposal exactly once', () => {
  const options = { ...context, proposalIds: [0, 1] }; const hold = { ...forecast, proposalId: 0 };
  assert.equal(validateForecast({ forecasts: [hold, forecast] }, options).forecasts.length, 2);
  assert.throws(() => validateForecast({ forecasts: [forecast] }, options), /coverage/);
  assert.throws(() => validateForecast({ forecasts: [forecast, forecast] }, options), /duplicate/);
  assert.throws(() => validateForecast({ forecasts: [hold, { ...forecast, proposalId: 9 }] }, options), /Unknown/);
  assert.throws(() => validateForecast({ forecasts: [{ ...hold, expectedReturnBps: NaN }, forecast] }, options), /expected return/);
});
test('continuous payout interpolation uses signed performance, with clipped endpoints', () => {
  assert.equal(expectedLongPayout(-1000), 0n); assert.equal(expectedLongPayout(-500), 0n);
  assert.equal(expectedLongPayout(0), ONE / 2n); assert.equal(expectedLongPayout(250), 3n * ONE / 4n);
  assert.equal(expectedLongPayout(500), ONE); assert.equal(expectedLongPayout(1000), ONE);
});
test('entry quote determines profitability and can cause abstention', () => {
  const trade = chooseTrade({ forecasts: [forecast], quotes });
  assert.equal(trade.side, 'long'); assert.equal(trade.expectedValue, 3000000n); assert.equal(trade.expectedProfit, 1000000n);
  assert.equal(chooseTrade({ forecasts: [forecast], quotes: quotes.map((q) => ({ ...q, outcomeAmount: ONE })) }), null);
  assert.equal(chooseTrade({ forecasts: [{ ...forecast, expectedReturnBps: -500 }], quotes }).side, 'short');
});
test('low confidence, zero edge and insufficient budget cannot force a trade', () => {
  assert.equal(chooseTrade({ forecasts: [{ ...forecast, confidenceBps: 4999 }], quotes }), null);
  assert.equal(chooseTrade({ forecasts: [{ ...forecast, expectedReturnBps: 0 }], quotes }), null);
  assert.throws(() => chooseTrade({ forecasts: [forecast], quotes, creditAmount: 6000000n }), /budget/);
  assert.throws(() => chooseTrade({ forecasts: [forecast], quotes, creditAmount: 0n }), /budget/);
});
test('research evidence rejects stale, future and unordered observations', () => {
  const market = localResearchFixture({ now: 200000 }); assert.equal(market.features.lookbackReturnBps, 810);
  assert.equal(market.source, 'fixture'); assert.equal(market.history.at(-1).assetUsdX18, (2000n * ONE).toString());
  assert.throws(() => validateMarket(market, { now: 200301 }), /stale/);
  assert.throws(() => validateMarket(market, { now: 199999 }), /future/);
  assert.throws(() => validateMarket({ ...market, history: [...market.history].reverse() }, { now: 200000 }), /ordered/);
  assert.ok(!JSON.stringify(market).includes('2100000000000000000000'));
});
test('provider config requires explicit remote enablement and confines local endpoints', () => {
  assert.equal(providerConfig({}), null);
  const near = { WAVEFUND_AGENT_MODE: 'near-ai', WAVEFUND_AGENT_MODEL: 'some/model', NEARAI_API_KEY: 'test-key' };
  assert.throws(() => providerConfig(near), /explicit/);
  assert.equal(providerConfig({ ...near, WAVEFUND_ALLOW_REMOTE_INFERENCE: '1' }).endpoint, 'https://cloud-api.near.ai/v1/chat/completions');
  assert.throws(() => providerConfig({ ...near, WAVEFUND_ALLOW_REMOTE_INFERENCE: '1', NEARAI_API_KEY: '' }), /locally/);
  for (const url of ['http://evil.example/v1/chat/completions', 'https://localhost/v1/chat/completions', 'http://localhost/v1/chat/completions?key=x']) assert.throws(() => providerConfig({ WAVEFUND_AGENT_MODE: 'local', WAVEFUND_AGENT_MODEL: 'test', WAVEFUND_LOCAL_MODEL_URL: url }), /loopback/);
});
async function mockProvider(handler, options = {}) {
  const requests = [];
  const server = createServer(async (req, res) => { let body = ''; for await (const part of req) body += part; requests.push(JSON.parse(body)); await handler(req, res, requests.at(-1)); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const provider = createProvider({ mode: 'local', model: 'test-fixture-not-a-model', endpoint: `http://127.0.0.1:${port}/v1/chat/completions` }, options);
  return { provider, requests, close: () => new Promise((resolve) => server.close(resolve)) };
}
function answer(res, value, extra = {}) { res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) }, ...extra }], usage: { prompt_tokens: 10, completion_tokens: 20 } })); }

test('actual HTTP adapter parses JSON, counts calls and never reflects secrets in metadata', async () => {
  const mock = await mockProvider((req, res) => answer(res, proposal), { maxCalls: 1 });
  try {
    assert.deepEqual((await mock.provider.complete({ system: 'Return JSON', context: {} })).value, proposal);
    await assert.rejects(mock.provider.complete({ system: 'Again', context: {} }), /budget/);
    assert.equal(mock.requests.length, 1); assert.equal(mock.requests[0].max_tokens, 1800);
    assert.equal(mock.provider.info.attestationVerified, false); assert.ok(!('apiKey' in mock.provider.info));
  } finally { await mock.close(); }
});
test('HTTP failures do not retry or leak provider error bodies', async () => {
  const mock = await mockProvider((req, res) => { res.statusCode = 503; res.end('secret-provider-body'); });
  try { await assert.rejects(mock.provider.complete({ system: 'test', context: {} }), { message: 'Inference HTTP 503' }); assert.equal(mock.requests.length, 1); } finally { await mock.close(); }
});
test('truncated answers, tool calls, markdown and oversize responses fail closed', async () => {
  for (const handler of [
    (req, res) => answer(res, proposal, { finish_reason: 'length' }),
    (req, res) => answer(res, proposal, { message: { content: '{}', tool_calls: [{}] } }),
    (req, res) => res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '```json\n{}\n```' } }] })),
    (req, res) => res.end('x'.repeat(70000)),
  ]) {
    const mock = await mockProvider(handler);
    try { await assert.rejects(mock.provider.complete({ system: 'test', context: {} }), /Inference failed/); } finally { await mock.close(); }
  }
});
test('inference timeout is bounded and does not retry', async () => {
  const mock = await mockProvider(async (req, res) => { await new Promise((resolve) => setTimeout(resolve, 80)); answer(res, {}); }, { timeoutMs: 20 });
  try { await assert.rejects(mock.provider.complete({ system: 'test', context: {} }), /timed-out/); assert.equal(mock.requests.length, 1); } finally { await mock.close(); }
});

test('four independent HTTP decisions are validated, hashed and reflect changed inputs', async () => {
  const inputs = [];
  const mock = await mockProvider((req, res, body) => {
    const input = JSON.parse(body.messages[1].content); inputs.push(input);
    const evidenceIds = [input.market.evidenceId];
    if (input.role === 'proposer') answer(res, { ...proposal, evidenceIds, allocationBps: input.agent === 'Momentum' ? 10000 : 5000 });
    else answer(res, { forecasts: input.proposals.map((p) => ({ ...forecast, evidenceIds, proposalId: p.id, expectedReturnBps: p.id === 0 ? 0 : p.allocationBps / 20 })) });
  });
  try {
    const market = localResearchFixture({ now: 200000 }); const records = [];
    const team = createAgentTeam({ provider: mock.provider, onRecord: (record) => records.push(record) });
    const plan = await team.plan({ market, portfolio: { stableBalance: '2000000000', assetBalance: '0', currentAllocationBps: 0, privateKey: 'MUST-NOT-LEAK' }, policy: { horizonSeconds: 180 } });
    assert.equal(plan.records.length, 4); assert.equal(records.length, 4); assert.equal(plan.proposals[1].allocationBps, 10000); assert.equal(plan.proposals[2].allocationBps, 5000);
    assert.ok(records.every((record) => /^[a-f0-9]{64}$/.test(record.inputHash) && record.attestationVerified === false));
    assert.deepEqual(inputs.map((input) => input.agent), AGENT_SPECS.map((agent) => agent.name));
    assert.ok(!JSON.stringify(inputs).includes('MUST-NOT-LEAK')); assert.ok(!JSON.stringify(inputs[3]).includes('forecasts'));
    assert.equal(inputs[2].proposals[0].swapFeeEstimatePortfolioBps, 0);
    assert.ok(inputs[2].proposals.every(p => !('name' in p)));
    assert.ok(!JSON.stringify(inputs).includes('2100000000000000000000'));
  } finally { await mock.close(); }
});
test('malicious model output halts the team before any forecasting decision', async () => {
  let calls = 0;
  const team = createAgentTeam({ provider: { info: { mode: 'test-fixture', model: 'malicious-fixture' }, complete: async () => { calls++; return { value: { ...proposal, allocationBps: 10001 } }; } } });
  await assert.rejects(team.plan({ market: localResearchFixture({ now: 200000 }), portfolio: { stableBalance: '1', assetBalance: '0', currentAllocationBps: 0 }, policy: { horizonSeconds: 180 } }), /allocation/);
  assert.equal(calls, 1);
});

test('configuration check reports readiness without printing a key or enabling remote calls', async () => {
  const { spawnSync } = await import('node:child_process');
  const file = new URL('../agents/check.mjs', import.meta.url);
  const check = spawnSync(process.execPath, [file.pathname], { env: { WAVEFUND_AGENT_MODE: 'near-ai', WAVEFUND_AGENT_MODEL: 'test/model', NEARAI_API_KEY: 'not-a-real-secret-test-only', WAVEFUND_ALLOW_REMOTE_INFERENCE: '0' }, encoding: 'utf8' });
  assert.equal(check.status, 0); const report = JSON.parse(check.stdout);
  assert.equal(report.credentialConfigured, true); assert.equal(report.readyForExplicitRun, false); assert.equal(report.remoteInferenceEnabled, false); assert.equal(report.requestsSent, 0);
  assert.ok(!check.stdout.includes('not-a-real-secret-test-only'));
});

test('inference credential is withheld from non-API child processes', async () => {
  const { subprocessEnvironment } = await import('../agents/provider.mjs');
  const input = { NEARAI_API_KEY: 'test-credential-only', PATH: '/tools', NEXT_TELEMETRY_DISABLED: '1' };
  assert.deepEqual(subprocessEnvironment(input), { PATH: '/tools', NEXT_TELEMETRY_DISABLED: '1' });
  assert.equal(subprocessEnvironment(input, true).NEARAI_API_KEY, 'test-credential-only');
  assert.equal(input.NEARAI_API_KEY, 'test-credential-only');
});
test('launcher rejects disabled remote inference before touching the workspace or starting tools', async () => {
  const { spawnSync } = await import('node:child_process');
  const { mkdtemp, readdir, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const dir = await mkdtemp(`${tmpdir()}/wavefund-preflight-`);
  try {
    const script = new URL('../../scripts/local-demo.mjs', import.meta.url).pathname;
    const result = spawnSync(process.execPath, [script], { cwd: dir, env: { PATH: '/missing-tools', WAVEFUND_AGENT_MODE: 'near-ai', WAVEFUND_AGENT_MODEL: 'test/model', NEARAI_API_KEY: 'test-credential-only', WAVEFUND_ALLOW_REMOTE_INFERENCE: '0' }, encoding: 'utf8' });
    assert.equal(result.status, 1); assert.match(result.stderr, /Remote inference requires explicit/); assert.deepEqual(await readdir(dir), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('changing provider configuration cannot relabel an old scripted round as model inference', async () => {
  const { inferenceSnapshot } = await import('../demo.mjs');
  const info = { mode: 'near-ai', model: 'test/model' };
  assert.equal(inferenceSnapshot({ stage: 'completed' }, info).mode, 'fixture');
  assert.equal(inferenceSnapshot({ stage: 'completed' }, info).model, null);
  assert.equal(inferenceSnapshot({ stage: 'idle' }, info).status, 'not-started');
  const stored = { mode: 'local', model: 'historical-model', status: 'complete' };
  assert.deepEqual(inferenceSnapshot({ stage: 'completed', inference: stored }, info), stored);
});
