// Developer C: performance reputation API tests. The real shared reader runs against an injected fake chain
// client (no network). The test manifest keeps the deployed addresses and only swaps the runtime-code hash for
// the fake bytecode's hash, because the reader pins code by keccak256.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { keccak256 } from 'viem';
import { startServer } from '../server.mjs';
import { createReputationReader } from '../agents/reputation-readonly.mjs';
import { REPUTATION_STACKS, TRUSTED_PROPOSERS, createReputationBoard, reputationBoardFromEnvironment, reputationBoardsFromEnvironment } from '../operator/reputation-api.mjs';

const DEPLOYED = JSON.parse(readFileSync(new URL('../../deployments/aurora-testnet-reputation.json', import.meta.url), 'utf8'));
const MANIFEST = { ...DEPLOYED, runtimeHash: keccak256('0x6000') };
const runtime = () => ({ state: async () => ({ stage: 'idle' }), start: () => {}, close: async () => {} });
const lower = (value) => value.toLowerCase();
const [CONSERVATIVE, BALANCED, MOMENTUM, HIGHBETA] = TRUSTED_PROPOSERS.map((item) => lower(item.address));

// Per-agent on-chain values: Momentum's verified live history (-1, one negative), a zero-history agent,
// a positive agent and one whose RPC read fails.
function chain(overrides = {}) {
  const calls = [];
  const stats = { [CONSERVATIVE]: [0n, 0n, 0n, 0n], [MOMENTUM]: [1n, 0n, 1n, 0n], [HIGHBETA]: [2n, 1n, 0n, 1n] };
  const scores = { [CONSERVATIVE]: 0n, [MOMENTUM]: -1n, [HIGHBETA]: 1n };
  const client = {
    getChainId: async () => 1313161555,
    getBlock: async () => ({ number: 277300000n, timestamp: 990n }),
    getCode: async () => '0x6000',
    readContract: async ({ functionName, args, address }) => {
      calls.push({ functionName, agent: args?.[0] ? lower(args[0]) : null, address: lower(address) });
      if (functionName === 'engine') return MANIFEST.contracts.engine;
      if (functionName === 'tracker') return MANIFEST.contracts.tracker;
      const agent = lower(args[0]);
      if (agent === BALANCED) throw new Error('upstream https://secret-rpc.example/key=abc timed out');
      return functionName === 'statistics' ? stats[agent] : scores[agent];
    },
    ...overrides,
  };
  return { client, calls };
}
const boardFor = (client, options = {}) => createReputationBoard({ reader: createReputationReader({ client, manifest: MANIFEST, clock: () => 1000, ...options.reader }), manifest: MANIFEST, ...options.board });

async function withServer(port, options, run) {
  const app = await startServer({ port, runtime: runtime(), funding: null, ...options });
  try { await run((path, init = {}) => fetch(`http://127.0.0.1:${port}${path}`, init)); } finally { await app.close(); }
}
function rawGet(port, path, headers) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method: 'GET', headers }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject); req.end();
  });
}

test('the endpoint reads trusted proposers through the shared reader and returns integer strings', async () => {
  const { client, calls } = chain();
  await withServer(19261, { reputation: boardFor(client) }, async (call) => {
    // Hostile query parameters are ignored: no RPC URL, contract or agent can come from the request.
    const response = await call(`/api/agents/reputation?rpc=https://evil.example&contract=0x${'e'.repeat(40)}&agent=0x${'f'.repeat(40)}`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.label, 'Performance reputation');
    assert.equal(body.notCreditScore, true); assert.equal(body.selectionWinsIncluded, false);
    assert.deepEqual(body.network, { chainId: 1313161555, name: 'Aurora testnet' });
    assert.equal(body.contract, lower(DEPLOYED.contracts.reputation));
    assert.equal(body.status, 'partial');
    assert.deepEqual(body.agents.map((agent) => agent.name), ['Conservative', 'Balanced', 'Momentum', 'HighBeta']);
    const byName = Object.fromEntries(body.agents.map((agent) => [agent.name, agent]));
    const momentum = byName.Momentum.reputation;
    assert.equal(byName.Momentum.status, 'ok');
    assert.deepEqual([momentum.score, momentum.samples, momentum.positive, momentum.negative, momentum.flat], ['-1', '1', '0', '1', '0']);
    assert.equal(momentum.hasEvaluatedStrategies, true); assert.equal(momentum.blockNumber, '277300000');
    const conservative = byName.Conservative.reputation;
    assert.equal(byName.Conservative.status, 'ok', 'zero history is real data, not unavailable');
    assert.equal(conservative.samples, '0'); assert.equal(conservative.hasEvaluatedStrategies, false);
    assert.equal(byName.HighBeta.reputation.score, '1');
    assert.deepEqual([byName.Balanced.status, byName.Balanced.reputation, byName.Balanced.code], ['unavailable', null, 'REPUTATION_UNAVAILABLE'], 'a failed read is never a zero score');
    for (const agent of body.agents.filter((item) => item.reputation)) {
      for (const key of ['score', 'samples', 'positive', 'negative', 'flat', 'blockNumber', 'blockTimestamp']) assert.equal(typeof agent.reputation[key], 'string', `${agent.name}.${key}`);
    }
    const text = JSON.stringify(body);
    for (const leaked of ['evil.example', 'secret-rpc', 'key=abc', 'eeeeeeee', 'ffffffff']) assert.equal(text.includes(leaked), false, leaked);
  });
  const trusted = new Set(TRUSTED_PROPOSERS.map((item) => lower(item.address)));
  assert.ok(calls.length > 0);
  for (const item of calls) {
    assert.equal(item.address, lower(DEPLOYED.contracts.reputation));
    if (item.agent) assert.ok(trusted.has(item.agent), `unexpected agent ${item.agent}`);
  }
});

test('wrong network, stale blocks and a failing RPC are reported per agent, never as zero', async () => {
  const wrong = await boardFor(chain({ getChainId: async () => 42161 }).client).read();
  assert.equal(wrong.status, 'unavailable');
  for (const agent of wrong.agents) { assert.equal(agent.code, 'REPUTATION_WRONG_NETWORK'); assert.equal(agent.reputation, null); }
  const stale = await boardFor(chain().client, { reader: { clock: () => 5000 } }).read();
  assert.ok(stale.agents.every((agent) => agent.status === 'unavailable' && agent.code === 'REPUTATION_STALE'));
  const down = await boardFor(chain({ getBlock: async () => { throw new Error('ECONNREFUSED 10.0.0.1'); } }).client).read();
  assert.ok(down.agents.every((agent) => agent.code === 'REPUTATION_UNAVAILABLE' && agent.reputation === null));
  assert.equal(JSON.stringify(down).includes('ECONNREFUSED'), false);
  // A reader error that is not one of the reader's codes is still only "unavailable".
  const odd = await createReputationBoard({ reader: { read: async () => { throw Object.assign(new Error('x'), { code: 'EACCES /etc/passwd' }); } } }).read();
  assert.ok(odd.agents.every((agent) => agent.code === 'REPUTATION_UNAVAILABLE'));
});

test('only GET exists under /api/agents; disabled boards and foreign origins or hosts are refused', async () => {
  const { client } = chain();
  await withServer(19262, { reputation: boardFor(client) }, async (call) => {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) assert.equal((await call('/api/agents/reputation', { method, headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 404, method);
    for (const path of ['/api/agents', '/api/agents/reputation/0x8B6aF0B1738b941c0C7dd4deeC6fabEe3447888F', '/api/agents/sign', '/api/agents/execute', '/api/agents/retry']) assert.equal((await call(path)).status, 404, path);
    assert.equal((await call('/api/agents/reputation', { headers: { Origin: 'https://evil.example' } })).status, 403);
    const allowed = await call('/api/agents/reputation', { headers: { Origin: 'http://127.0.0.1:3000' } });
    assert.equal(allowed.status, 200); assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://127.0.0.1:3000');
    assert.equal(await rawGet(19262, '/api/agents/reputation', { Host: 'evil.example' }), 403);
    assert.deepEqual(await (await call('/api/state')).json(), { stage: 'idle' });
    assert.equal((await call('/api/demo/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 202);
  });
  await withServer(19263, { reputation: null }, async (call) => { assert.equal((await call('/api/agents/reputation')).status, 404); });
});

test('the board caches briefly and shares one in-flight read across concurrent requests', async () => {
  let reads = 0; let ms = 0;
  const board = createReputationBoard({ reader: { read: async () => { reads++; await new Promise((resolve) => setTimeout(resolve, 5)); return { score: '0', samples: '0' }; } }, nowMs: () => ms, cacheMs: 15_000 });
  await Promise.all([board.read(), board.read(), board.read()]);
  assert.equal(reads, TRUSTED_PROPOSERS.length, 'concurrent requests share one read per agent');
  ms = 14_000; await board.read(); assert.equal(reads, TRUSTED_PROPOSERS.length);
  ms = 16_000; await board.read(); assert.equal(reads, 2 * TRUSTED_PROPOSERS.length);
  assert.throws(() => createReputationBoard({ reader: null }), /shared reputation reader/);
  assert.throws(() => createReputationBoard({ reader: { read: async () => ({}) }, proposers: [{ name: 'X', address: 'javascript:alert(1)' }] }), /proposer list/);
});

test('the environment factory builds the shared reader offline and can be disabled', async () => {
  const board = await reputationBoardFromEnvironment({});
  assert.equal(typeof board.read, 'function', 'no network request is made until the endpoint is called');
  assert.equal(typeof (await reputationBoardFromEnvironment({ WAVEFUND_REPUTATION: 'live' })).read, 'function');
  assert.equal(await reputationBoardFromEnvironment({ WAVEFUND_REPUTATION: 'disabled' }), null);
  await assert.rejects(reputationBoardFromEnvironment({ WAVEFUND_REPUTATION: 'https://evil.example' }), /WAVEFUND_REPUTATION/);
});

test('the original and Tidepool stacks are separate contract histories and are never summed', async () => {
  const TIDEPOOL = { ...JSON.parse(readFileSync(new URL('../../deployments/aurora-testnet-tidepool-reputation.json', import.meta.url), 'utf8')), runtimeHash: keccak256('0x6000') };
  const tidepoolChain = chain({ readContract: async ({ functionName, args }) => {
    if (functionName === 'engine') return TIDEPOOL.contracts.engine; if (functionName === 'tracker') return TIDEPOOL.contracts.tracker;
    const agent = lower(args[0]); if (agent === MOMENTUM) return functionName === 'statistics' ? [1n, 0n, 1n, 0n] : -1n;
    return functionName === 'statistics' ? [0n, 0n, 0n, 0n] : 0n;
  } });
  const boards = {
    original: boardFor(chain().client),
    tidepool: createReputationBoard({ reader: createReputationReader({ client: tidepoolChain.client, manifest: TIDEPOOL, clock: () => 1000 }), manifest: TIDEPOOL, stack: REPUTATION_STACKS.tidepool }),
  };
  await withServer(19268, { reputation: boards }, async (call) => {
    const original = await (await call('/api/agents/reputation')).json();
    const alias = await (await call('/api/agents/reputation/original')).json();
    const tidepool = await (await call('/api/agents/reputation/tidepool')).json();
    assert.deepEqual([original.stack.id, alias.stack.id, tidepool.stack.id], ['original', 'original', 'tidepool']);
    assert.equal(original.contract, lower(DEPLOYED.contracts.reputation)); assert.equal(tidepool.contract, '0xfa71a652547284d1034ae6813ed4a882cb354e92');
    assert.equal(tidepool.stack.engine, '0xba96a117f4de33c38df72002651f11024ed14a14');
    const momentum = (board) => board.agents.find((agent) => agent.name === 'Momentum').reputation.score;
    assert.deepEqual([momentum(original), momentum(tidepool)], ['-1', '-1'], 'each stack reports its own -1');
    for (const board of [original, tidepool]) for (const key of ['total', 'combined', 'globalScore', 'sum']) assert.equal(key in board, false, key);
    assert.equal((await call('/api/agents/reputation/all')).status, 404, 'no combined endpoint');
  });
  const env = await reputationBoardsFromEnvironment({});
  assert.equal(typeof env.original.read, 'function'); assert.equal(typeof env.tidepool.read, 'function');
  assert.equal(await reputationBoardsFromEnvironment({ WAVEFUND_REPUTATION: 'disabled' }), null);
  assert.equal(typeof (await reputationBoardFromEnvironment({}, 'tidepool')).read, 'function');
  await assert.rejects(reputationBoardFromEnvironment({}, 'combined'), /Unknown reputation stack/);
});
