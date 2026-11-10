// Explicit opt-in local Anvil integration; the HTTP responder is a test fixture, NOT an LLM.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createPublicClient, http } from 'viem';
import { createRuntime } from '../demo.mjs';
import { createProvider } from '../agents/provider.mjs';
import { createAgentTeam } from '../agents/team.mjs';
import { loadManifest } from '../config.mjs';

if (process.env.WAVEFUND_AGENT_INTEGRATION !== '1') throw new Error('Set WAVEFUND_AGENT_INTEGRATION=1 only in a disposable isolated Anvil environment');
const manifestPath = process.env.LOCAL_MANIFEST ?? 'deployments/local.json';
const manifest = await loadManifest(manifestPath);
const client = createPublicClient({ transport: http(manifest.rpcUrl) });
assert.equal(await client.getChainId(), 31337);
assert.match(await client.request({ method: 'web3_clientVersion' }), /anvil/i);
const evidence = { kind: 'mock-http-integration-not-live-inference', cases: [] };
await mkdir('.run/agent-integration', { recursive: true });
const runDir = await mkdtemp('.run/agent-integration/run-');
let snapshot;
async function fresh() {
  if (snapshot) assert.equal(await client.request({ method: 'evm_revert', params: [snapshot] }), true);
  snapshot = await client.request({ method: 'evm_snapshot' });
}
async function responder({ invalid = false, lowConfidence = false, allocations = [6500, 2500], favoured = 1 }) {
  const requests = [];
  const server = createServer(async (request, response) => {
    let raw = ''; for await (const part of request) raw += part;
    const body = JSON.parse(raw); const context = JSON.parse(body.messages[1].content); requests.push(context);
    assert.ok(!raw.includes(manifest.contracts.safe));
    const summary = { confidenceBps: lowConfidence ? 0 : 8500, rationale: 'Scripted HTTP test response based on synthetic evidence; not real inference.', risks: ['Synthetic observations do not establish a profitable real strategy.'], evidenceIds: [context.market.evidenceId] };
    const value = context.role === 'proposer' ? { ...summary, allocationBps: invalid ? 10001 : allocations[context.agent === 'Momentum' ? 0 : 1] } : { forecasts: context.proposals.map((proposal) => ({ ...summary, proposalId: proposal.id, expectedReturnBps: proposal.id === favoured ? 500 : 0 })) };
    response.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }], usage: { prompt_tokens: 100, completion_tokens: 100 } }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const provider = createProvider({ mode: 'local', model: 'scripted-http-fixture', endpoint: `http://127.0.0.1:${server.address().port}/v1/chat/completions` });
  const team = createAgentTeam({ provider: { ...provider, info: { ...provider.info, mode: 'test-fixture' } } });
  return { team, requests, close: () => new Promise((resolve) => server.close(resolve)) };
}
async function execute(name, modelOptions, verify) {
  await fresh(); const mock = await responder(modelOptions);
  const runtime = await createRuntime({ manifestPath, journalPath: `${runDir}/${name}.json`, agentTeam: mock.team, paceMs: 0 });
  try { await verify(runtime, mock); } finally { await runtime.close(); await mock.close(); }
  console.log(`PASS ${name}`);
}
await execute('invalid-output-no-transactions', { invalid: true }, async (runtime, mock) => {
  await assert.rejects(runtime.start(), /allocation/);
  const state = await runtime.state(); assert.equal(state.stage, 'failed'); assert.equal(state.receipts.length, 0); assert.equal(state.roundId, null); assert.equal(state.safe.stableBalance, '2000000000'); assert.equal(state.forecast.escrow, '0'); assert.equal(mock.requests.length, 1);
  evidence.cases.push({ name: 'invalid-output-no-transactions', passed: true, receipts: 0 });
});
await execute('abstention-preserves-hold', { lowConfidence: true }, async (runtime, mock) => {
  const state = await runtime.start();
  assert.equal(state.stage, 'completed'); assert.equal(mock.requests.length, 4); assert.equal(state.agentRecords.length, 4); assert.equal(state.round.winnerId, 0); assert.equal(state.safe.stableBalance, '2000000000'); assert.equal(state.safe.assetBalance, '0'); assert.equal(state.round.realisedReturnX18, '1000000000000000000'); assert.ok(state.tradeDecisions.every((decision) => decision.action === 'abstain')); assert.ok(state.receipts.every((receipt) => receipt.status === 'success'));
  evidence.cases.push({ name: 'abstention-preserves-hold', passed: true, state });
});
await execute('model-allocation-6500-executes', {}, async (runtime, mock) => {
  const state = await runtime.start();
  assert.equal(state.stage, 'completed'); assert.equal(mock.requests.length, 4); assert.equal(state.proposals[1].allocationBps, 6500); assert.equal(state.proposals[2].allocationBps, 2500); assert.equal(state.round.winnerId, 1); assert.equal(state.safe.stableBalance, '700000000'); assert.equal(state.safe.assetBalance, '648050000000000000'); assert.equal(state.round.realisedReturnX18, '1030452500000000000'); assert.equal(state.inference.mode, 'test-fixture'); assert.equal(state.agentRecords.length, 4); assert.ok(state.tradeDecisions.some((decision) => decision.action === 'buy')); assert.ok(state.receipts.every((receipt) => receipt.status === 'success'));
  evidence.cases.push({ name: 'model-allocation-6500-executes', passed: true, state });
});
await execute('changed-model-output-changes-execution', { allocations: [2000, 8000], favoured: 2 }, async (runtime, mock) => {
  const state = await runtime.start();
  assert.equal(state.stage, 'completed'); assert.equal(state.round.winnerId, 2); assert.equal(state.safe.stableBalance, '400000000'); assert.equal(state.safe.assetBalance, '797600000000000000'); assert.equal(mock.requests.length, 4); assert.ok(state.receipts.every((receipt) => receipt.status === 'success'));
  evidence.cases.push({ name: 'changed-model-output-changes-execution', passed: true, state });
});
// Preserve the chain's latest completed reference case; never mutate any public network.
await writeFile('.run/agent-integration/latest-evidence.json', JSON.stringify(evidence, null, 2) + '\n');
console.log('COMPLETE: 4 isolated agent-to-contract cases; no live inference or public transaction');
