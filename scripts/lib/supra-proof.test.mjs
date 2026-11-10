import test from 'node:test';
import assert from 'node:assert/strict';
import { supraProofBytes } from './supra-proof.mjs';
test('bare REST hex is normalized without changing bytes', () => {
  assert.equal(supraProofBytes({ proof_bytes: '00aBcD' }), '0x00aBcD');
});
test('already prefixed hex is preserved', () => {
  assert.equal(supraProofBytes({ proof_bytes: '0x00ab' }), '0x00ab');
});
test('empty, odd, oversized and nonhex payloads are rejected', () => {
  for (const proof_bytes of ['', '0x', 'abc', '0xabc', 'zz', '0xgg', 123, null, '00'.repeat(500001)]) {
    assert.throws(() => supraProofBytes({ proof_bytes }), /Malformed Supra proof bytes/);
  }
  assert.throws(() => supraProofBytes({}), /Malformed Supra proof bytes/);
});
