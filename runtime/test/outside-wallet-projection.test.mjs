import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadRoundEvidence } from '../operator/round-evidence.mjs';

const policy = JSON.parse(await readFile(new URL('../../docs/tee-policy.json', import.meta.url), 'utf8'));
const evidence = await loadRoundEvidence({ teePolicy: policy });
const r9 = evidence.rounds.find((r) => r.stack.id === 'tidepool' && r.roundId === '9');

test('round 9 lists the outside browser wallet as a participant, so rows add up to the totals', () => {
  const outside = r9.payouts.filter((p) => p.external === true);
  assert.deepEqual(outside.map((p) => [p.name, p.deposit, p.payout, p.profitLoss]), [['OutsideWallet1', '1000000', '1000000', '0']]);
  const sum = (k) => r9.payouts.reduce((a, p) => a + BigInt(p[k]), 0n);
  assert.equal(sum('deposit'), 81000000n);
  assert.equal(sum('payout'), 80998771n);
  assert.equal(r9.checks.payoutsRecomputed, true);
});
test('rounds without outside wallets gain no external rows', () => {
  const r2 = evidence.rounds.find((r) => r.stack.id === 'tidepool' && r.roundId === '2');
  assert.equal(r2.payouts.some((p) => p.external), false);
});
