import test from 'node:test';
import assert from 'node:assert/strict';
import { inferenceSmoke } from '../agents/smoke.mjs';

const env = { WAVEFUND_AGENT_MODE: 'near-ai', WAVEFUND_AGENT_MODEL: 'test/model', WAVEFUND_ALLOW_REMOTE_INFERENCE: '1', NEARAI_API_KEY: 'synthetic-test-credential' };
function responder(transform = (value) => value) {
  return async (url, options) => {
    assert.equal(url, 'https://cloud-api.near.ai/v1/chat/completions');
    assert.equal(options.redirect, 'error');
    const request = JSON.parse(options.body);
    assert.equal(request.max_tokens, 1800);
    const { nonce } = JSON.parse(request.messages[1].content);
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(transform({ status: 'ok', nonce })) } }], usage: { prompt_tokens: 40, completion_tokens: 20 } }));
  };
}
test('smoke dry run and disabled inference never send HTTP', async () => {
  const fetchImpl = () => { throw new Error('Unexpected HTTP'); };
  assert.equal((await inferenceSmoke({}, { fetchImpl })).requestsSent, 0);
  await assert.rejects(inferenceSmoke({ ...env, WAVEFUND_ALLOW_REMOTE_INFERENCE: '0' }, { run: true, fetchImpl }), /explicit/);
  await assert.rejects(inferenceSmoke({ WAVEFUND_AGENT_MODE: 'fixture' }, { run: true, fetchImpl }), /near-ai/);
});
test('one validated response produces a credential-free report without attestation claims', async () => {
  let calls = 0;
  const report = await inferenceSmoke(env, { run: true, fetchImpl: async (...args) => { calls++; return responder()(...args); } });
  assert.equal(calls, 1); assert.equal(report.status, 'passed'); assert.equal(report.attestationVerified, false);
  assert.equal(report.tradesSubmitted, 0); assert.equal(JSON.stringify(report).includes(env.NEARAI_API_KEY), false);
});
test('stale nonce, wrong status, extra fields and HTTP errors fail closed without retry', async () => {
  for (const transform of [(v) => ({ ...v, nonce: 'stale' }), (v) => ({ ...v, status: 'failed' }), (v) => ({ ...v, extra: true })]) {
    await assert.rejects(inferenceSmoke(env, { run: true, fetchImpl: responder(transform) }), /challenge validation/);
  }
  let calls = 0;
  await assert.rejects(inferenceSmoke(env, { run: true, fetchImpl: async () => { calls++; return new Response('private body', { status: 401 }); } }), /^Error: Inference HTTP 401$/);
  assert.equal(calls, 1);
});
