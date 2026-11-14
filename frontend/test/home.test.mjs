import test from 'node:test';
import assert from 'node:assert/strict';
import { homeRoundView } from '../src/lib/home.mjs';
const round = (id, attested = false) => ({ roundId: String(id), stack: { id: 'tidepool' }, attestationVerified: attested, forecasters: [], payouts: [] });
test('new completed round replaces every recap source without inheriting old attestation', () => {
  const older = round(9, true), newer = round(10);
  const result = homeRoundView([newer, { ...round(99), stack: { id: 'original' } }, older]);
  assert.equal(result.latest, newer); assert.equal(result.completed, 2);
  assert.equal(result.latest.attestationVerified, false); assert.equal(result.attestedExample, older);
});
test('human participants remain separate from AI trades and abstentions', () => {
  const r = round(9); r.forecasters = [{ action: 'buy', name: 'Quant' }, { action: 'abstain', name: 'Guardian' }];
  r.payouts = [{ name: 'Quant' }, { external: true, name: 'OutsideWallet1' }];
  const result = homeRoundView([r]);
  assert.deepEqual(result.trades.map(x => x.name), ['Quant']);
  assert.deepEqual(result.abstentions.map(x => x.name), ['Guardian']);
  assert.deepEqual(result.humans.map(x => x.name), ['OutsideWallet1']);
});
test('missing history produces no invented recap or participants', () => {
  const result = homeRoundView(); assert.equal(result.latest, null); assert.equal(result.completed, 0);
  assert.deepEqual(result.trades, []); assert.deepEqual(result.humans, []);
});
