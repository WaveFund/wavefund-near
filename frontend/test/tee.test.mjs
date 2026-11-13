import test from 'node:test';
import assert from 'node:assert/strict';
import { teeDisplay, TEE_CHECKS } from '../src/lib/tee.mjs';
test('TEE presentation requires every independent check plus on-chain binding', () => {
  const proof = { proposalBound: true, privacy: { schemaVersion: 1, verified: true, signatureKind: 'provider_tee', responseSha256: 'ab'.repeat(32), requestSha256: 'cd'.repeat(32), ...Object.fromEntries(TEE_CHECKS.map(([key]) => [key, true])) } };
  assert.equal(teeDisplay(proof).verified, true);
  for (const [key] of TEE_CHECKS) assert.equal(teeDisplay({ ...proof, privacy: { ...proof.privacy, [key]: false } }).verified, false, key);
  for (const variant of [null, {}, { ...proof, proposalBound: false }, { ...proof, privacy: { ...proof.privacy, signatureKind: 'gateway' } }, { ...proof, privacy: { ...proof.privacy, verified: false } }]) assert.equal(teeDisplay(variant).verified, false);
});
