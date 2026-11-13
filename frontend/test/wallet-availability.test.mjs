import test from 'node:test';
import assert from 'node:assert/strict';
import { walletAvailability } from '../src/lib/wallet/flow.mjs';
test('wallet stays visible but an absent or mismatched round cannot unlock trading', () => {
  for (const v of [null, undefined, {}, { roundId: 1 }]) assert.deepEqual(walletAvailability(v), { visible: true, context: 'between-rounds', roundMatches: false });
  assert.deepEqual(walletAvailability({ roundId: '8' }), { visible: true, context: 'round', roundMatches: false });
  assert.equal(walletAvailability({ roundId: '8' }, 8n).roundMatches, true);
  assert.equal(walletAvailability({ roundId: '8' }, 9n).roundMatches, false);
  assert.equal(walletAvailability(null, 8n).roundMatches, false);
});
