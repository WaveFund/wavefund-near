import test from 'node:test';
import assert from 'node:assert/strict';
import { verifySupraAtChainTime } from '../agents/supra-clock.mjs';
const future = (lead = 3124n) => ({ cause: { data: { errorName: 'IncorrectFutureUpdate', args: [lead] } } });
test('a verified proof returns without waiting or retrying', async () => {
  let calls = 0; const value = await verifySupraAtChainTime({ verify: async () => { calls++; return 'authenticated'; }, waitUntil: async () => assert.fail('Unexpected wait') });
  assert.equal(value, 'authenticated'); assert.equal(calls, 1);
});
test('bounded named clock rejection waits for chain time before re-verifying the same proof', async () => {
  let calls = 0; const waits = [];
  const value = await verifySupraAtChainTime({ verify: async () => { if (++calls === 1) throw future(); return 'authenticated'; }, blockTime: async () => 1000n, waitUntil: async until => waits.push(until) });
  assert.equal(value, 'authenticated'); assert.equal(calls, 2); assert.deepEqual(waits, [1005n]);
});
test('invalid proofs, unknown errors and excessive clock skew are never retried', async () => {
  for (const error of [new Error('InvalidProof'), { data: { errorName: 'InvalidProof', args: [] } }, future(30001n)]) {
    let calls = 0;
    await assert.rejects(verifySupraAtChainTime({ verify: async () => { calls++; throw error; }, waitUntil: async () => assert.fail('Unexpected wait') }), e => e === error);
    assert.equal(calls, 1);
  }
});
test('a second verification rejection propagates without a third attempt', async () => {
  let calls = 0; const error = future();
  await assert.rejects(verifySupraAtChainTime({ verify: async () => { calls++; throw error; }, blockTime: async () => 1000n, waitUntil: async () => {} }), e => e === error);
  assert.equal(calls, 2);
});
