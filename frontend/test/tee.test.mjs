import test from 'node:test';
import assert from 'node:assert/strict';
import { teeDisplay, TEE_CHECKS } from '../src/lib/tee.mjs';
test('TEE presentation requires every independent check plus on-chain binding', () => {
  const proof = { proposalBound: true, trustBasis: 'observed-at-2026-11-13-not-independently-reproduced', privacy: { schemaVersion: 1, verified: true, signatureKind: 'provider_tee', responseSha256: 'ab'.repeat(32), requestSha256: 'cd'.repeat(32), ...Object.fromEntries(TEE_CHECKS.map(([key]) => [key, true])) } };
  assert.equal(teeDisplay(proof).verified, true);
  for (const [key] of TEE_CHECKS) assert.equal(teeDisplay({ ...proof, privacy: { ...proof.privacy, [key]: false } }).verified, false, key);
  for (const variant of [null, {}, { ...proof, proposalBound: false }, { ...proof, privacy: { ...proof.privacy, signatureKind: 'gateway' } }, { ...proof, privacy: { ...proof.privacy, verified: false } }]) assert.equal(teeDisplay(variant).verified, false);
});
test('measurement check states the observed-pinned basis and never claims independent verification', () => {
  const proof = { proposalBound: true, trustBasis: 'observed-at-2026-11-13-not-independently-reproduced', privacy: { schemaVersion: 1, verified: true, signatureKind: 'provider_tee', responseSha256: 'ab'.repeat(32), requestSha256: 'cd'.repeat(32), ...Object.fromEntries(TEE_CHECKS.map(([key]) => [key, true])) } };
  const m = teeDisplay(proof).checks.find(c => c.key === 'measurementPolicyMatched');
  assert.equal(m.detail, "Measurements pinned from NEAR AI's live attestation on 2026-11-13; not independently reproduced.");
  assert.ok(teeDisplay(proof).checks.every(c => !/independently verified/i.test(c.detail)));
  for (const trustBasis of [undefined, 'independently-verified', 'published-reference']) assert.equal(teeDisplay({ ...proof, trustBasis }).verified, false, String(trustBasis));
});
