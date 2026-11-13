import test from 'node:test';
import assert from 'node:assert/strict';
import { proofView, sanitizeProof, explorerTxUrl, evidenceFileUrl, recheckCommand } from '../src/lib/tee-proof-view.mjs';
import { TEE_CHECKS } from '../src/lib/tee.mjs';

const privacy = { schemaVersion: 1, verified: true, signatureKind: 'provider_tee', responseSha256: 'ab'.repeat(32), requestSha256: 'cd'.repeat(32), model: 'Qwen/Qwen3.6-35B-A3B-FP8', nonce: '17'.repeat(32), signer: '0x' + '12'.repeat(20), ...Object.fromEntries(TEE_CHECKS.map(([k]) => [k, true])) };
const tx = '0x' + 'EF'.repeat(32);
const proof = { proposalId: '1', name: 'Tidepool', proposalBound: true, transactionHash: tx, trustBasis: 'observed-at-2026-11-13-not-independently-reproduced', privacy };

test('secret-looking keys are removed at every depth, public claims survive', () => {
  const dirty = { ...proof, apiKey: 'sk-1', privacy: { ...privacy, Authorization: 'Bearer x', headers: { a: 1 }, token: 't', nested: [{ api_key: 'k', gpuTokenSha256: 'ok', eat_nonce: 'n' }] } };
  const clean = sanitizeProof(dirty);
  const text = JSON.stringify(clean);
  for (const leak of ['sk-1', 'Bearer', '"headers"', '"token"', '"api_key"']) assert.ok(!text.includes(leak), leak);
  assert.equal(clean.privacy.nested[0].gpuTokenSha256, 'ok'); assert.equal(clean.privacy.nested[0].eat_nonce, 'n');
  assert.ok(!proofView(dirty, '9').json.includes('sk-1'));
});
test('explorer link only for a valid 32-byte hash; github/command only for a valid round', () => {
  assert.equal(explorerTxUrl(tx), 'https://explorer.testnet.aurora.dev/tx/' + tx.toLowerCase());
  for (const bad of [undefined, '0x12', tx + '00', 'ef'.repeat(32), '0x' + 'zz'.repeat(32), 5]) assert.equal(explorerTxUrl(bad), null);
  assert.equal(evidenceFileUrl('9'), 'https://github.com/WaveFund/wavefund-near/blob/main/docs/test-evidence/tidepool-rounds/round9/plan.json');
  for (const bad of ['0', '', '../9', '09', '10000', undefined, '9/../x']) { assert.equal(evidenceFileUrl(bad), null, String(bad)); assert.equal(recheckCommand(bad), null, String(bad)); }
  assert.equal(recheckCommand('9'), 'node scripts/verify-tee.mjs 9 --policy <reviewed-public-policy.json>');
});
test('summary never claims verified when any check is false', () => {
  assert.equal(proofView(proof, '9').verified, true);
  for (const [key] of TEE_CHECKS) {
    const v = proofView({ ...proof, privacy: { ...privacy, [key]: false } }, '9');
    assert.equal(v.verified, false, key); assert.ok(v.checks.some(c => !c.ok)); assert.match(v.headline, /did not pass/);
  }
  assert.equal(proofView({ ...proof, proposalBound: false }, '9').verified, false);
  assert.equal(proofView(undefined, '9').verified, false);
});
test('view carries the model, trust basis and exact public JSON', () => {
  const v = proofView(proof, '9');
  assert.equal(v.model, 'Qwen/Qwen3.6-35B-A3B-FP8'); assert.equal(v.trustBasis, proof.trustBasis);
  assert.deepEqual(JSON.parse(v.json), proof);
  assert.equal(v.txUrl, 'https://explorer.testnet.aurora.dev/tx/' + tx.toLowerCase());
});

import { jsonRows, NOT_VERIFIED } from '../src/lib/tee-proof-view.mjs';
test('long values are shortened for display only and lines map to keys', () => {
  const long = 'f'.repeat(200);
  const { rows, truncated } = jsonRows(JSON.stringify({ a: long, b: 'short' }, null, 2));
  assert.equal(truncated, true);
  assert.ok(rows.every(r => r.text.length < 120)); assert.equal(rows[1].key, 'a'); assert.equal(rows[1].n, 2);
  assert.equal(jsonRows('{\n  "b": "short"\n}').truncated, false);
  assert.equal(proofView(proof, '9').json.includes('ab'.repeat(32)), true); // copy payload is full
});
test('claims exist only when verified and highlight the matching keys; limits always listed', () => {
  const v = proofView(proof, '9');
  assert.deepEqual(v.claims.map(c => c.id), ['model', 'ai', 'tee', 'bound']);
  assert.ok(v.claims.find(c => c.id === 'bound').keys.includes('transactionHash'));
  assert.equal(v.title, 'Proposal #1 · Tidepool · round 9');
  const bad = proofView({ ...proof, privacy: { ...privacy, gpuAttested: false } }, '9');
  assert.deepEqual(bad.claims, []);
  assert.ok(NOT_VERIFIED.some(t => /not independently reproduced/.test(t)) && NOT_VERIFIED.some(t => /serving instance/.test(t)) && v.notVerified === NOT_VERIFIED);
});
