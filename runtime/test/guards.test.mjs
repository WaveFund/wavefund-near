import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assertLocalRpc, json } from '../config.mjs';
import { validHost, startServer } from '../server.mjs';
import { acquireLock, openJournal } from '../journal.mjs';

test('RPC accepts loopback and rejects public, credential and query URLs', () => {
  assert.equal(assertLocalRpc('http://127.0.0.1:8545'), 'http://127.0.0.1:8545/');
  for (const url of ['https://127.0.0.1:8545', 'http://example.com', 'http://127.0.0.1.evil.com', 'http://user:pass@localhost', 'http://localhost/?key=abc']) assert.throws(() => assertLocalRpc(url), /loopback/);
});
test('Host validation distinguishes local and hostile names', () => {
  assert.equal(validHost('127.0.0.1:3001'), true);
  for (const host of ['evil.com', 'localhost.evil.com', 'user@localhost', undefined]) assert.equal(validHost(host), false);
});
test('bigint amounts serialize exactly', () => assert.equal(json({ amount: 12345678901234567890n }), '{"amount":"12345678901234567890"}'));
test('journal lock and interruption prevent automatic replay', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wavefund-journal-'));
  try {
    const file = path.join(dir, 'journal.json'); const manifest = { chainId: 31337, deployedAtBlock: 1, contracts: { engine: '0x1234' } };
    const release = await acquireLock(file + '.lock');
    await assert.rejects(acquireLock(file + '.lock'), /Another runtime/); await release();
    const journal = await openJournal(file, manifest); journal.data.running = true; journal.data.actions.push({ status: 'unknown' }); await journal.save();
    const restored = await openJournal(file, manifest); assert.equal(restored.data.stage, 'interrupted'); assert.equal(restored.data.running, false);
    await assert.rejects(openJournal(file, { ...manifest, deployedAtBlock: 2 }), /another deployment/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('HTTP rejects hostile origins and caller-supplied transaction parameters', async () => {
  let started = 0; const runtime = { state: async () => ({ stage: 'idle' }), start: () => { started++; }, close: async () => {} };
  const app = await startServer({ port: 19231, runtime });
  try {
    const request = (body, origin) => fetch('http://127.0.0.1:19231/api/demo/start', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body });
    assert.equal((await request('{}', 'https://evil.example')).status, 403);
    assert.equal((await request('{"target":"arbitrary"}')).status, 400);
    assert.equal(started, 0);
    assert.equal((await request('{}', 'http://localhost:3000')).status, 202); assert.equal(started, 1);
  } finally { await app.close(); }
});

test('Safe receipt schema decodes the indexed execution hash', async () => {
  const { safeAbi } = await import('../chain.mjs');
  const { decodeEventLog, encodeEventTopics, encodeAbiParameters } = await import('viem');
  const topics = encodeEventTopics({ abi: safeAbi, eventName: 'ExecutionSuccess', args: { txHash: '0x' + '12'.repeat(32) } });
  const decoded = decodeEventLog({ abi: safeAbi, topics, data: encodeAbiParameters([{ type: 'uint256' }], [0n]) });
  assert.equal(decoded.eventName, 'ExecutionSuccess'); assert.equal(decoded.args.txHash, '0x' + '12'.repeat(32));
});
