import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateRoundEvidence } from '../src/lib/record/model.mjs';
import { selectionSignals } from '../src/lib/arena/model.mjs';
const saved = JSON.parse(await readFile(new URL('../public/evidence/testnet-rounds.json', import.meta.url)));
test('saved Round 9 passes exact selection averages to the comparison board', () => {
  const result = validateRoundEvidence(saved); assert.equal(result.ok, true);
  const round = result.rounds.find(r => r.roundId === '9');
  const signals = selectionSignals(round.proposals);
  assert.ok(signals); assert.equal(signals.winnerId, '3'); assert.equal(signals.holdPercent, 50); assert.equal(signals.thresholdPercent, 50.5);
  assert.equal(signals.rows.length, 5); assert.ok(signals.rows.find(r => r.id === '3').percent > 50.5);
});
test('missing, invalid or winner-contradicting TWAP evidence is never drawn', () => {
  for (const mutate of [r => { delete r.proposals[0].twapX18; }, r => { r.proposals[3].twapX18 = '505000000000000000'; }, r => { r.proposals[3].twapX18 = '1000000000000000001'; }]) {
    const copy = structuredClone(saved); mutate(copy.rounds.find(r => r.roundId === '9'));
    const result = validateRoundEvidence(copy);
    assert.ok(!result.ok || !result.rounds.some(r => r.roundId === '9'));
  }
});
