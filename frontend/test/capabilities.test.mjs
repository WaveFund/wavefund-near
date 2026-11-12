import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backendKind, canStartLocalRound, localAvailability, localRoundRunning } from '../src/lib/arena/capabilities.mjs';

const local = (stage, running = false) => ({ mode: 'local-simulation', chainId: 31337, stage, running });
const aurora = (stage, running = false) => ({ mode: 'aurora-testnet-readonly', chainId: 1313161555, stage, running });

test('read-only Aurora can never start or run a local round, whatever its stage says', () => {
  for (const stage of ['idle', 'monitoring', 'forecasting', 'completed']) {
    assert.equal(canStartLocalRound(aurora(stage)), false, stage);
    assert.equal(localRoundRunning(aurora(stage, true)), false, stage);
  }
  assert.equal(localAvailability(aurora('idle')).available, false);
  assert.match(localAvailability(aurora('idle')).reason, /read-only Aurora/);
});

test('local start only when idle and not running', () => {
  assert.equal(canStartLocalRound(local('idle')), true);
  assert.equal(canStartLocalRound(local('idle', true)), false);
  assert.equal(canStartLocalRound(local('forecasting')), false);
  assert.equal(canStartLocalRound(local('completed')), false);
});

test('running is a known non-idle, non-terminal local stage', () => {
  assert.equal(localRoundRunning(local('forecasting')), true);
  assert.equal(localRoundRunning(local('idle')), false);
  for (const stage of ['completed', 'complete', 'redeemed', 'failed', 'interrupted']) assert.equal(localRoundRunning(local(stage)), false, stage);
});

test('unknown or mismatched modes disable everything', () => {
  const odd = [{ mode: 'local-simulation', chainId: 1313161555, stage: 'idle' }, { mode: 'something', chainId: 31337, stage: 'idle' }];
  for (const state of odd) { assert.equal(backendKind(state), 'unknown'); assert.equal(canStartLocalRound(state), false); assert.equal(localRoundRunning(state), false); }
  assert.equal(backendKind(null, { loading: true }), 'loading');
  assert.equal(backendKind(null, { loading: false, error: 'x' }), 'offline');
  assert.equal(canStartLocalRound(null), false);
  assert.equal(localAvailability(null, {}).available, false);
});
