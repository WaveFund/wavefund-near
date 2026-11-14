import test from 'node:test';
import assert from 'node:assert/strict';
import { createKeyFallback } from '../agents/key-fallback.mjs';
import { createProvider, providerConfig, subprocessEnvironment } from '../agents/provider.mjs';
import { createTeeProvider } from '../agents/tee-client.mjs';
import { syntheticTee } from './fixtures/tee-synthetic.mjs';
const url = 'https://cloud-api.near.ai/v1/chat/completions';
const task = { system: 'test', context: {} };
const config = { mode: 'near-ai', model: 'unit/model', apiKey: 'synthetic-primary', backupApiKeys: ['synthetic-backup', 'synthetic-third'] };
const answer = () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }] });

test('explicit credential/quota/rate rejection tries ordered backups, preserving payload and deadline', async () => {
  for (const status of [401, 402, 429]) {
    const seen = []; const signal = AbortSignal.timeout(5000);
    const keyed = createKeyFallback({ ...config, fetchImpl: async (u, o) => { seen.push({ key: new Headers(o.headers).get('Authorization'), body: o.body, signal: o.signal }); return seen.length < 3 ? new Response('', { status }) : answer(); } });
    const response = await keyed.fetch(url, { headers: { Authorization: 'Bearer synthetic-primary' }, body: 'exact bytes', signal });
    assert.equal(response.status, 200); assert.equal(seen.length, 3);
    assert.deepEqual(seen.map(x => x.key), ['Bearer synthetic-primary', 'Bearer synthetic-backup', 'Bearer synthetic-third']);
    assert.ok(seen.every(x => x.body === 'exact bytes' && x.signal === signal));
    await keyed.fetch(url, { headers: { Authorization: 'Bearer synthetic-primary' }, body: 'next bytes', signal });
    assert.equal(seen[3].key, 'Bearer synthetic-third', 'stick with selected key within the provider');
    assert.deepEqual(keyed.usage(), { slot: 'backup-2', switches: 2, lastRejectionStatus: status });
  }
});

test('unconfigured/duplicate backup cannot create a loop and all-key rejection is bounded', async () => {
  for (const backups of [[], ['synthetic-primary'], ['synthetic-backup','synthetic-backup'], config.backupApiKeys]) {
    let calls = 0;
    const p = createKeyFallback({ ...config, backupApiKeys: backups, fetchImpl: async () => { calls++; return new Response('', { status: 402 }); } });
    assert.equal((await p.fetch(url, { headers: { Authorization: 'Bearer synthetic-primary' } })).status, 402);
    assert.equal(calls, new Set([config.apiKey, ...backups]).size);
  }
});

test('successful/uncertain/server/permission failures never trigger another generation', async () => {
  for (const result of [200, 403, 400, 408, 500, 502, 'timeout']) {
    let calls = 0; const p = createKeyFallback({ ...config, fetchImpl: async () => { calls++; if (result === 'timeout') throw new Error('synthetic timeout'); return new Response('', { status: result }); } });
    if (result === 'timeout') await assert.rejects(p.fetch(url, { headers: { Authorization: 'Bearer synthetic-primary' } }), /synthetic timeout/);
    else await p.fetch(url, { headers: { Authorization: 'Bearer synthetic-primary' } });
    assert.equal(calls, 1, String(result));
  }
});

test('auxiliary signature endpoints do not fall back and unauthenticated endpoints receive no credentials', async () => {
  const sent = []; const p = createKeyFallback({ ...config, fetchImpl: async (u, o) => { sent.push([u, new Headers(o.headers).get('Authorization')]); return new Response('', { status: 402 }); } });
  await p.fetch('https://cloud-api.near.ai/v1/signature/id', { headers: { Authorization: 'Bearer synthetic-primary' } });
  await p.fetch('https://nras.attestation.nvidia.com/v3/attest/gpu', { headers: {} });
  assert.equal(sent.length, 2); assert.equal(sent[1][1], null);
});

test('ordinary provider retains logical cap and sanitizes failures after fallback', async () => {
  let calls = 0; const p = createProvider(config, { maxCalls: 1, fetchImpl: async () => ++calls === 1 ? new Response('synthetic-private-error', { status: 402 }) : answer() });
  const response = await p.complete(task); assert.deepEqual(response.value, { ok: true }); assert.equal(response.credentialUse.slot, 'backup-1');
  assert.ok(!JSON.stringify(response).includes(config.apiKey)); assert.ok(!JSON.stringify(response).includes(config.backupApiKeys[0]));
  await assert.rejects(p.complete(task), /budget exhausted/); assert.equal(calls, 2);
  let malformedCalls = 0;
  const bad = createProvider(config, { fetchImpl: async () => { malformedCalls++; return new Response('synthetic-private-error'); } });
  await assert.rejects(bad.complete(task), e => !e.message.includes('synthetic-private-error')); assert.equal(malformedCalls, 1);
});

test('both backup keys are inference-only and config validates them', () => {
  const env = { WAVEFUND_AGENT_MODE: 'near-ai', WAVEFUND_AGENT_MODEL: 'unit/model', WAVEFUND_ALLOW_REMOTE_INFERENCE: '1', NEARAI_API_KEY: 'synthetic-primary', NEARAI_API_KEY_1: 'synthetic-backup', NEARAI_API_KEY_2: 'synthetic-third' };
  assert.deepEqual(providerConfig(env).backupApiKeys, config.backupApiKeys);
  for (const name of ['NEARAI_API_KEY','NEARAI_API_KEY_1','NEARAI_API_KEY_2']) assert.equal(subprocessEnvironment(env)[name], undefined);
  assert.equal(subprocessEnvironment(env, true).NEARAI_API_KEY_2, 'synthetic-third');
  assert.throws(() => providerConfig({ ...env, NEARAI_API_KEY_1: 'synthetic\ninvalid' }), /Invalid backup/);
});

test('TEE fallback keeps exact signed bytes, uses selected key for signature, and never retries a rejected proof', async () => {
  const f = await syntheticTee();
  for (const rejectProof of [false, true]) {
    let calls = 0; let req; let signatureKey;
    const fetchImpl = async (u, o) => {
      if (u.includes('/attestation/report')) return Response.json(f.evidence.attestationReport);
      if (u.includes('nras.attestation')) return Response.json([['JWT',f.gpuToken()]]);
      if (u.endsWith('/chat/completions')) { calls++; if (calls === 1) return new Response('', { status: 402 }); req = o.body; return new Response(f.evidence.responseBody); }
      if (u.includes('/signature/')) { signatureKey = new Headers(o.headers).get('Authorization'); const sig = await f.signature(req, f.evidence.responseBody); return Response.json(rejectProof ? { ...sig, signature_kind: 'gateway' } : sig); }
      throw new Error('unexpected endpoint');
    };
    const p = createTeeProvider({ ...config, model:f.model }, { policy:f.policy, fetchImpl, quoteVerifier:f.quoteVerifier, getCollateral:async()=>({}), now:()=>f.at, nonceFactory:()=>f.nonce, maxCalls:1 });
    if (rejectProof) await assert.rejects(p.complete(task), /TEE_RESPONSE_REJECTED/);
    else { const response = await p.complete(task); assert.equal(response.privacy.verified,true); assert.equal(response.teeEvidence.requestBody,req); assert.equal(response.credentialUse.slot,'backup-1'); }
    assert.equal(signatureKey,'Bearer synthetic-backup'); assert.equal(calls,2,'no third generation even if the proof fails');
    await assert.rejects(p.complete(task),/TEE_CALL_BUDGET_EXHAUSTED/);
  }
});
