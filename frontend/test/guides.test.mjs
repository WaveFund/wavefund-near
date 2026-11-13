import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { roleGuides, guideFor, ROUND_STEPS } from '../src/lib/guides.mjs';
import { walletAvailability } from '../src/lib/wallet/flow.mjs';
import { loadRoundEvidence } from '../../runtime/operator/round-evidence.mjs';
import { validateRoundEvidence, findRound } from '../src/lib/record/model.mjs';

const root = new URL('../src/app/', import.meta.url);
test('role guides are bounded, known and have safe existing route targets', async () => {
  const checked = validateRoundEvidence(await loadRoundEvidence());
  assert.equal(checked.ok, true);
  const rounds = checked.rounds;
  for (const guide of roleGuides(rounds)) {
    assert.equal(guide.steps.length, 4);
    for (const step of guide.steps) {
      const url = new URL(step.href, 'http://localhost');
      assert.equal(url.origin, 'http://localhost');
      const route = url.pathname.startsWith('/rounds/1313161555-') ? 'rounds/[id]/page.tsx' : `${url.pathname.slice(1)}/page.tsx`;
      assert.ok(existsSync(new URL(route, root)), `missing route ${step.href}`);
      if (url.pathname.startsWith('/rounds/1313161555-')) assert.ok(findRound(rounds, url.pathname.split('/').at(-1)).round, 'round link must resolve in published evidence');
    }
  }
  assert.equal(guideFor('invalid', rounds), null);
  assert.equal(guideFor('manager', []).steps[2].href, '/rounds', 'missing saved round must fall back to a real list');
  assert.equal(guideFor('observer', rounds).steps[1].href.endsWith('?stage=proposals'), true);
  assert.deepEqual(ROUND_STEPS, ['Funded', 'Proposals', 'Forecasting', 'Selected', 'Executed', 'Measured']);
});
test('wallet is visible between rounds and unavailable monitoring never fabricates a round', () => {
  for (const v of [null, undefined, {}, { roundId: 1 }]) assert.deepEqual(walletAvailability(v), { visible: true, context: 'between-rounds' });
  assert.deepEqual(walletAvailability({ roundId: '8' }), { visible: true, context: 'round' });
});
