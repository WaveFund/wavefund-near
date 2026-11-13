import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectReport, privacyVerified, proposalBinding, proposalRationale, replayRtmr3, verifyCompletion, verifyGpuToken } from '../agents/tee.mjs';
import { createTeeProvider, validateTeePolicy, verifyTeeEvidence } from '../agents/tee-client.mjs';
import { syntheticTee } from './fixtures/tee-synthetic.mjs';

test('synthetic exact-byte model signature and independently supplied report/GPU checks pass; not a live hardware claim', async () => {
  const f = await syntheticTee(); const p = await verifyTeeEvidence(f.evidence, f.policy, { quoteVerifier: f.quoteVerifier });
  assert.equal(p.verified, true); assert.equal(privacyVerified(p), true);
  await assert.rejects(verifyTeeEvidence({ ...f.evidence, schemaVersion: 2 }, f.policy, { quoteVerifier: f.quoteVerifier }), /TEE_EVIDENCE_SCHEMA_INVALID/);
  for (const field of ['nonceBound', 'tdxQuoteVerified', 'gpuAttested', 'signatureValid', 'signerMatchesAttestation', 'configurationBound', 'eventLogVerified', 'measurementPolicyMatched']) assert.equal(p[field], true, field);
  const record = { privacy: p, attestationVerified: true, teeEvidence: f.evidence, decision: { allocationBps: 4500 } };
  const rationale = proposalRationale(record, 'Balanced');
  assert.equal(proposalBinding(record, { rationale, allocationBps: 4500 }), true);
  assert.equal(proposalBinding(record, { rationale, allocationBps: 7500 }), false);
  assert.equal(proposalBinding({ ...record, decision: { allocationBps: 7500 } }, { rationale, allocationBps: 7500 }), false, 'a changed local decision and matching event still cannot replace the signed allocation');
  assert.equal(proposalBinding(record, { rationale: rationale.replace(p.responseSha256, '0'.repeat(64)), allocationBps: 4500 }), false);
});
test('tampered bytes, signer, unknown/gateway kind and duplicated signers cannot yield verified model evidence', async () => {
  const f = await syntheticTee();
  const r = { ...inspectReport(f.report, f.quoteResult, { nonce: f.nonce, allowedMeasurements: f.policy.modelMeasurements }), gpuAttested: true, signingAddress: f.report.signing_address, algorithm: 'ecdsa' };
  const input = { model: f.model, nonce: f.nonce, requestBody: f.evidence.requestBody, responseBody: f.evidence.responseBody, signature: f.evidence.signature, modelReports: [r] };
  assert.equal((await verifyCompletion(input)).verified, true);
  for (const mutation of [
    { responseBody: `${input.responseBody} ` }, { requestBody: `${input.requestBody} ` },
    { signature: { ...input.signature, signing_address: `0x${'00'.repeat(20)}` } },
    { signature: { ...input.signature, signature_kind: 'gateway' } }, { signature: { ...input.signature, signature_kind: 'unknown' } },
    { modelReports: [r, r] }, { modelReports: [] }, { modelReports: [{ ...r, gpuAttested: false }] },
  ]) assert.equal((await verifyCompletion({ ...input, ...mutation })).verified, false);
});
test('nonce, debug, TCB, configuration, events and measurement allowlist each fail closed', async () => {
  const f = await syntheticTee(); const inspect = (report = f.report, result = f.quoteResult, allowed = f.policy.modelMeasurements) => inspectReport(report, result, { nonce: f.nonce, allowedMeasurements: allowed });
  assert.equal(inspect({ ...f.report, request_nonce: '00'.repeat(32) }).nonceBound, false);
  f.td.reportData[63] ^= 1; assert.equal(inspect().nonceBound, false); f.td.reportData[63] ^= 1;
  f.td.tdAttributes[0] = 1; assert.equal(inspect().tdxQuoteVerified, false); f.td.tdAttributes[0] = 0;
  assert.equal(inspect(f.report, { ...f.quoteResult, status: 'SWHardeningNeeded' }).tdxQuoteVerified, false);
  assert.equal(inspect({ ...f.report, info: { tcb_info: { app_compose: 'changed' } } }).configurationBound, false);
  f.td.rtMr3[0] ^= 1; assert.equal(inspect().eventLogVerified, false); f.td.rtMr3[0] ^= 1;
  assert.equal(inspect(f.report, f.quoteResult, []).measurementPolicyMatched, false);
  assert.throws(() => replayRtmr3([{ imr: 3, event_type: 1, event: 'x', digest: '00'.repeat(48) }]), /TEE_EVENT_DIGEST_MISMATCH/);
});
test('NVIDIA token requires pinned ES384 key, nonce, issuer, freshness and true signed verdict', async () => {
  const f = await syntheticTee(); const check = token => verifyGpuToken(token, f.nonce, f.policy.nrasKeys, f.at);
  assert.equal(check(f.gpuToken()), true);
  for (const changes of [{ eat_nonce: '00'.repeat(32) }, { iss: 'https://attacker.example' }, { exp: f.at }, { iat: f.at + 1 }, { 'x-nvidia-overall-att-result': false }]) assert.equal(check(f.gpuToken(changes)), false);
  assert.equal(verifyGpuToken(f.gpuToken(), f.nonce, [], f.at), false);
  assert.equal(check('e30.e30.AA'), false);
  const e = structuredClone(f.evidence); e.gpuTokens = [];
  await assert.rejects(verifyTeeEvidence(e, f.policy, { quoteVerifier: f.quoteVerifier }), /TEE_GPU_REJECTED/);
});
test('empty template policy is blocked before network; no caller-provided verified flag suffices', () => {
  assert.throws(() => validateTeePolicy({ schemaVersion: 1, gatewayMeasurements: [], modelMeasurements: [], nrasKeys: [] }), /TEE_POLICY_NOT_CONFIGURED/);
  assert.equal(privacyVerified({ verified: true }), false);
  assert.throws(() => validateTeePolicy({ schemaVersion: 1, gatewayMeasurements: ['ab'.repeat(48) + ':' + 'cd'.repeat(48)], modelMeasurements: ['ab'.repeat(48) + ':' + 'cd'.repeat(48)], nrasKeys: [{ kty: 'EC', crv: 'P-384', kid: 'k', x: 'x', y: 'y', d: 'never-a-private-key' }] }), /TEE_POLICY_NOT_CONFIGURED/);
});
test('preflight failure never reaches paid completion; success preserves exact request/response and has no retries', async () => {
  const f = await syntheticTee(); const seen = []; let req; let resp;
  const fetchImpl = async (url, options) => {
    seen.push(url);
    if (url.includes('/attestation/report')) return Response.json(f.evidence.attestationReport);
    if (url.includes('nras.attestation')) return Response.json([['JWT', f.gpuToken()]]);
    if (url.endsWith('/chat/completions')) { req = options.body; resp = f.evidence.responseBody; assert.equal(options.headers['x-no-aliasing'], 'true'); return new Response(resp); }
    if (url.includes('/signature/')) return Response.json(await f.signature(req, resp));
    throw new Error('unexpected endpoint');
  };
  const options = { policy: f.policy, fetchImpl, quoteVerifier: f.quoteVerifier, getCollateral: async () => ({}), now: () => f.at, nonceFactory: () => f.nonce, maxCalls: 1 };
  const config = { mode: 'near-ai', model: f.model, apiKey: 'synthetic-not-a-real-key' };
  const p = createTeeProvider(config, options); const result = await p.complete({ system: 'system', context: {} });
  assert.equal(result.privacy.verified, true); assert.equal(result.teeEvidence.requestBody, req);
  await assert.rejects(p.complete({ system: 'system', context: {} }), /TEE_CALL_BUDGET_EXHAUSTED/);
  const hiddenRaw = JSON.stringify({ id: 'chat-test', choices: [{ finish_reason: 'stop', message: { content: '{"allocationBps":4500}', reasoning_content: 'synthetic hidden reasoning must not be exported' } }] });
  let hiddenRequest;
  const hidden = createTeeProvider(config, { ...options, fetchImpl: async (url, init) => {
    if (url.endsWith('/chat/completions')) { hiddenRequest = init.body; return new Response(hiddenRaw); }
    if (url.includes('/signature/')) return Response.json(await f.signature(hiddenRequest, hiddenRaw));
    return fetchImpl(url, init);
  } });
  await assert.rejects(hidden.complete({ system: 'system', context: {} }), /TEE_COMPLETION_INVALID/);
  const malformed = createTeeProvider(config, { ...options, fetchImpl: async (url, init) => url.endsWith('/chat/completions') ? new Response('{synthetic-private-error-detail') : fetchImpl(url, init) });
  await assert.rejects(malformed.complete({ system: 'system', context: {} }), error => error.message === 'TEE_INFERENCE_OR_VERIFICATION_FAILED');
  seen.length = 0;
  const bad = createTeeProvider(config, { ...options, quoteVerifier: async () => ({ status: 'Revoked' }) });
  await assert.rejects(bad.complete({ system: 's', context: {} }), /TEE_REPORT_REJECTED/);
  assert.equal(seen.length, 1, 'only attestation HTTP; no paid call or retry');
  for (const [report, expected] of [
    [{ ...f.evidence.attestationReport, model_attestations: [] }, /TEE_MODEL_REPORTS_MISSING/],
    [{ ...f.evidence.attestationReport, model_attestations: [{ ...f.report, nvidia_payload: JSON.stringify({ nonce: '00'.repeat(32) }) }] }, /TEE_GPU_NONCE_MISMATCH/],
  ]) {
    const attempted = [];
    const blocked = createTeeProvider(config, { ...options, fetchImpl: async (url, init) => { attempted.push(url); return url.includes('/attestation/report') ? Response.json(report) : fetchImpl(url, init); } });
    await assert.rejects(blocked.complete({ system: 'system', context: {} }), expected);
    assert.equal(attempted.length, 1, 'bad evidence must stop before NVIDIA or paid inference');
  }
});

test('signature checks discriminate claimed signer, exact model and all candidate results', async () => {
  const f = await syntheticTee();
  const report = { ...inspectReport(f.report, f.quoteResult, { nonce: f.nonce, allowedMeasurements: f.policy.modelMeasurements }), gpuAttested: true, signingAddress: f.report.signing_address, algorithm: 'ecdsa' };
  const base = { model: f.model, nonce: f.nonce, requestBody: f.evidence.requestBody, responseBody: f.evidence.responseBody, signature: f.evidence.signature, modelReports: [report] };
  const wrong = await verifyCompletion({ ...base, signature: { ...base.signature, signing_address: `0x${'34'.repeat(20)}` } });
  assert.equal(wrong.signatureValid, false);
  const mixed = await verifyCompletion({ ...base, modelReports: [report, { ...report, signingAddress: `0x${'34'.repeat(20)}`, gpuAttested: false }] });
  assert.equal(mixed.gpuAttested, false); assert.equal(mixed.verified, false);
  const requestBody = JSON.stringify({ ...JSON.parse(base.requestBody), model: 'another-model' });
  const result = await verifyCompletion({ ...base, requestBody, signature: await f.signature(requestBody, base.responseBody) });
  assert.equal(result.verified, false);
  const staleRequest = JSON.parse(base.requestBody);
  staleRequest.messages[1].content = JSON.stringify({ teeChallenge: '00'.repeat(32) });
  const staleBody = JSON.stringify(staleRequest);
  assert.equal((await verifyCompletion({ ...base, requestBody: staleBody, signature: await f.signature(staleBody, base.responseBody) })).verified, false, 'a real signature with a different request nonce cannot bind fresh hardware evidence');
});
test('tampered NVIDIA signature and unpinned kid fail despite valid-looking claims', async () => {
  const f = await syntheticTee(); const token = f.gpuToken(); const parts = token.split('.');
  const sig = Buffer.from(parts[2], 'base64url'); sig[0] ^= 1; parts[2] = sig.toString('base64url');
  assert.equal(verifyGpuToken(parts.join('.'), f.nonce, f.policy.nrasKeys, f.at), false);
  assert.equal(verifyGpuToken(token, f.nonce, f.policy.nrasKeys.map(k => ({ ...k, kid: 'different' })), f.at), false);
});

test('a stored "verified" flag is never trusted: kind, schema and every check are recomputed', async () => {
  const f = await syntheticTee(); const p = await verifyTeeEvidence(f.evidence, f.policy, { quoteVerifier: f.quoteVerifier });
  assert.equal(privacyVerified(p), true);
  assert.equal(privacyVerified({ ...p, signatureKind: 'other' }), false, 'only provider_tee signatures count');
  assert.equal(privacyVerified({ ...p, schemaVersion: 2 }), false, 'unknown schema is not verified');
  for (const field of ['nonceBound', 'tdxQuoteVerified', 'gpuAttested', 'signatureValid']) {
    const forged = { ...p, [field]: false, verified: true }; // claims verified, one check is false
    assert.throws(() => proposalRationale({ attestationVerified: true, privacy: forged }, 'x'), /TEE_RECORD_UNVERIFIED/, field);
  }
  assert.match(proposalRationale({ attestationVerified: true, privacy: p }, 'x'), /^NEAR AI \(TEE verified\) sha256:[a-f0-9]{64} · x$/);
});
test('committed policy validates with an observed-pinned trust basis; any changed measurement rejects a known-good fixture', async () => {
  const committed = JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../../docs/tee-policy.json', import.meta.url), 'utf8'));
  validateTeePolicy(committed);
  assert.equal(committed.trustBasis, 'observed-at-2026-11-13-not-independently-reproduced');
  assert.deepEqual(committed.gatewayMeasurements, ['7fe60787222bd394cb516abca2435f22f035ab2cc9c0a4b4b3b148e46297f3d931a237b72f359052c6e657d8c1409173:01b73eed6abc60fbe5eb0ce2bbaacf3bd9b83c9c84f3e6a5b1a091cb679bdbe66f000000000000000000000000000000']);
  // Qwen (shared), GLM, DeepSeek (two observed compose hashes): one mrTd, four observed mrConfigIds.
  assert.deepEqual(committed.modelMeasurements, ['01e8416a02d6f7ce47baaa52e3925b934fd30834b04fc9086b363db9b1d12c729d', '01c900dc7304663b73b623cd5d941fbdab6f02858017b371ae28de445a16d2e2d0', '01448683dd83e50727b9c5f6cdc84bd9d93fcf2c888001a85b1ba32f76b3612e3e', '01c53e254e8b70aa14b45ba3043730a0736ca2afb1df7fa3db9c61578845e470fe']
    .map(config => `df4d77c857de652bd0fafa343a2026b51071ee03773d076d283abf1a7d36ff91ffa279ee4a617ac664f7e2a2c8d5891b:${config}000000000000000000000000000000`));
  assert.ok(committed.sources.length > 0 && committed.sources.every(s => s.url.startsWith('https://') && s.matched));
  for (const trustBasis of [undefined, 'independently-verified', 'observed-at-2026-11-13', 'published-reference']) assert.throws(() => validateTeePolicy({ ...committed, trustBasis }), /TEE_POLICY_NOT_CONFIGURED/, String(trustBasis));
  const f = await syntheticTee(); const opts = { quoteVerifier: f.quoteVerifier };
  const good = { ...committed, gatewayMeasurements: f.policy.gatewayMeasurements, modelMeasurements: f.policy.modelMeasurements, nrasKeys: f.policy.nrasKeys };
  assert.equal((await verifyTeeEvidence(f.evidence, good, opts)).verified, true);
  const [mrTd, mrConfigId] = good.modelMeasurements[0].split(':'); const flip = h => (h[0] === '0' ? '1' : '0') + h.slice(1);
  for (const changed of [`${flip(mrTd)}:${mrConfigId}`, `${mrTd}:${flip(mrConfigId)}`]) {
    await assert.rejects(verifyTeeEvidence(f.evidence, { ...good, gatewayMeasurements: [changed] }, opts), /TEE_REPORT_REJECTED/);
    await assert.rejects(verifyTeeEvidence(f.evidence, { ...good, modelMeasurements: [changed] }, opts), /TEE_REPORT_REJECTED/);
  }
});
