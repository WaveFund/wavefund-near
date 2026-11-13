import { test } from 'node:test';
import assert from 'node:assert/strict';
import { externalDepositors, collateralReconciles } from '../agents/round-rules.mjs';

const A = '0x' + 'a'.repeat(40), B = '0x' + 'b'.repeat(40), OWN = '0x' + 'c'.repeat(40);
test('outside depositors exclude operator forecasters and sum repeat deposits', () => {
  const out = externalDepositors({ deposits: [{ user: OWN, amount: 10n }, { user: A, amount: 5n }, { user: A.toUpperCase().replace('0X', '0x'), amount: 3n }, { user: B, amount: 1n }], own: [OWN] });
  assert.deepEqual(out, [{ user: A, amount: 8n }, { user: B, amount: 1n }]);
  assert.deepEqual(externalDepositors({ deposits: [{ user: OWN, amount: 10n }], own: [OWN.toUpperCase().replace('0X', '0x')] }), []);
  assert.throws(() => externalDepositors({ deposits: [{ user: '0x12', amount: 1n }], own: [] }));
  assert.throws(() => externalDepositors({ deposits: [{ user: A, amount: 0n }], own: [] }));
});
test('collateral conservation counts outside deposits and payouts', () => {
  const base = { beforeEngine: 100n, ownDeposits: 40n, externalDeposits: 10n, reserve: 100n, engineBalance: 100n };
  assert.equal(collateralReconciles({ ...base, payouts: [39n, 11n] }), true);
  assert.equal(collateralReconciles({ ...base, payouts: [39n] }), false, 'missing outside payout');
  assert.equal(collateralReconciles({ ...base, externalDeposits: 0n, payouts: [39n, 11n] }), false, 'outside deposit ignored');
  assert.equal(collateralReconciles({ ...base, engineBalance: 101n, payouts: [38n, 11n] }), false, 'engine keeps more than the reserve');
});
