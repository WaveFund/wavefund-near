// Developer C: Track record display logic. Uses the real API projections (reputation board, round evidence) as input,
// so the UI validators are tested against exactly what the local API serves.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatPoints, formatReturnX18, formatSignedUnits, reputationState, snapshotStale, validateReputationBoard, validateRoundEvidence,
} from '../src/lib/record/model.mjs';
import { createReputationBoard } from '../../runtime/operator/reputation-api.mjs';
import { loadRoundEvidence } from '../../runtime/operator/round-evidence.mjs';

const MINUS = '−';
const reading = (score, samples, positive, negative, flat) => ({ schemaVersion: 1, chainId: 1313161555, contract: `0x${'ac'.repeat(20)}`, agent: `0x${'11'.repeat(20)}`,
  blockNumber: '277300000', blockTimestamp: '1794500000', samples, positive, negative, flat, score, hasEvaluatedStrategies: samples !== '0' });
async function board(overrides = {}) {
  const results = {
    conservative: () => reading('0', '0', '0', '0', '0'),
    balanced: () => { throw Object.assign(new Error('x'), { code: 'REPUTATION_UNAVAILABLE' }); },
    momentum: () => reading('-1', '1', '0', '1', '0'),
    highbeta: () => { throw Object.assign(new Error('x'), { code: 'REPUTATION_STALE' }); },
    ...overrides,
  };
  const names = { '0x5613c60b04fa16363c3a388aa4545073fb440345': 'conservative', '0xcbf919ed9a28da19786d97e1282c92b186500cb8': 'balanced', '0x8b6af0b1738b941c0c7dd4deec6fabee3447888f': 'momentum', '0x1ba3c5bf69b1dd2077d7550ee4f479bb35b5ea0a': 'highbeta' };
  return createReputationBoard({ reader: { read: async (address) => results[names[address]]() }, manifest: { contracts: { reputation: `0x${'ac'.repeat(20)}` } }, clock: () => 1794500010 }).read();
}

test('points, signed amounts and returns render with explicit signs and no floats', () => {
  assert.equal(formatPoints('-1'), `${MINUS}1`);
  assert.equal(formatPoints('3'), '+3');
  assert.equal(formatPoints('0'), '0');
  for (const bad of ['-0', '1.5', -1, 1, '', null, undefined, '01', '+1', '1e3']) assert.equal(formatPoints(bad), null, String(bad));
  assert.equal(formatSignedUnits('-31981', 6), `${MINUS}0.031981`);
  assert.equal(formatSignedUnits('11521', 6), '+0.011521');
  assert.equal(formatSignedUnits('0', 6), '0');
  assert.equal(formatSignedUnits(-31981, 6), null);
  assert.equal(formatReturnX18('997835674193170672'), `${MINUS}0.2164%`, 'round 7 measured return');
  assert.equal(formatReturnX18('999584491909995608'), `${MINUS}0.0416%`, 'round 8 Hold drift');
  assert.equal(formatReturnX18('1000000000000000000'), '0.0000%');
  assert.equal(formatReturnX18('1010000000000000000'), '+1.0000%');
  assert.equal(formatReturnX18('1046850000000000000'), '+4.6850%');
  for (const bad of ['-1', '0.99', 997835674193170672, null]) assert.equal(formatReturnX18(bad), null, String(bad));
});

test('the API board validates: negative scores, zero history, unavailable and stale are all distinct', async () => {
  const checked = validateReputationBoard(await board());
  assert.equal(checked.ok, true);
  const byName = Object.fromEntries(checked.board.agents.map((agent) => [agent.name, agent]));
  assert.equal(reputationState(byName.Momentum), 'scored');
  assert.equal(byName.Momentum.reputation.score, '-1'); assert.equal(formatPoints(byName.Momentum.reputation.score), `${MINUS}1`);
  assert.equal(reputationState(byName.Conservative), 'no-history');
  assert.equal(byName.Conservative.reputation.samples, '0');
  assert.equal(reputationState(byName.Balanced), 'unavailable');
  assert.equal(byName.Balanced.reputation, null, 'unavailable never carries a zero score');
  assert.equal(reputationState(byName.HighBeta), 'stale');
  assert.equal(reputationState(null), 'loading');
  assert.equal(checked.board.status, 'partial');
  assert.equal(checked.board.selectionWinsIncluded, false);
});

test('numbers, missing fields, wrong networks and odd codes never become zero', async () => {
  const numeric = validateReputationBoard(await board({ conservative: () => ({ ...reading('0', '0', '0', '0', '0'), samples: 0, score: 0 }) }));
  const conservative = numeric.board.agents.find((agent) => agent.name === 'Conservative');
  assert.deepEqual([conservative.status, conservative.code, conservative.reputation], ['unavailable', 'REPUTATION_INVALID_RESPONSE', null]);
  const missing = validateReputationBoard(await board({ momentum: () => { const value = reading('-1', '1', '0', '1', '0'); delete value.negative; return value; } }));
  assert.equal(missing.board.agents.find((agent) => agent.name === 'Momentum').reputation, null);
  const foreign = validateReputationBoard(await board({ momentum: () => ({ ...reading('-1', '1', '0', '1', '0'), chainId: 1313161554 }) }));
  assert.equal(foreign.board.agents.find((agent) => agent.name === 'Momentum').status, 'unavailable');
  const raw = await board();
  assert.equal(validateReputationBoard({ ...raw, network: { chainId: 1313161554 } }).ok, false);
  assert.equal(validateReputationBoard({ ...raw, schemaVersion: 2 }).ok, false);
  const odd = validateReputationBoard({ ...raw, agents: [{ name: '<b>x</b>', status: 'unavailable', code: 'rm -rf /', reputation: null }] });
  assert.deepEqual([odd.board.agents[0].name, odd.board.agents[0].code], ['Unknown agent', 'REPUTATION_UNAVAILABLE']);
});

test('a last good snapshot turns stale after failed refreshes', async () => {
  assert.equal(snapshotStale({ receivedAt: 1000, now: 1090 }), false);
  assert.equal(snapshotStale({ receivedAt: 1000, now: 1091 }), true);
  assert.equal(snapshotStale({ receivedAt: null, now: 1091 }), false);
  const momentum = validateReputationBoard(await board()).board.agents.find((agent) => agent.name === 'Momentum');
  assert.equal(reputationState(momentum, { stale: true }), 'stale');
});

test('published round evidence validates with explorer links and honest round 8 facts', async () => {
  const checked = validateRoundEvidence(await loadRoundEvidence());
  assert.equal(checked.ok, true);
  const [r7, r8] = checked.rounds;
  assert.equal(r7.winner.name, 'Momentum'); assert.equal(r7.winner.isHold, false);
  assert.equal(formatReturnX18(r7.realisedReturnX18), `${MINUS}0.2164%`);
  assert.ok(r7.forecasters.every((item) => item.scripted));
  assert.equal(r7.swap.url, 'https://explorer.testnet.aurora.dev/tx/0x63a743ae801bc7ee0e51b71397e87148e1838ffccbc6c7397d05a2e92a028ead');
  assert.equal(r7.reputation.score, '-1');
  assert.ok(r7.transactions.every((item) => item.url?.startsWith('https://explorer.testnet.aurora.dev/tx/0x')));
  assert.equal(r8.winner.isHold, true); assert.equal(r8.swap, null); assert.equal(r8.reputation, null);
  assert.ok(r8.forecasters.every((item) => item.action === 'abstain' && !item.scripted));
  assert.ok(r8.payouts.every((item) => item.profitLoss === '0' && item.payout === item.deposit));
  // Malformed transactions get no link and are counted, not rendered.
  const raw = await loadRoundEvidence();
  const tampered = structuredClone(raw); tampered.rounds[0].transactions[0].transactionHash = 'javascript:alert(1)';
  const dropped = validateRoundEvidence(tampered).rounds[0];
  assert.equal(dropped.droppedTransactions, 1); assert.equal(dropped.transactions.length, raw.rounds[0].transactions.length - 1);
  assert.equal(validateRoundEvidence({ ...structuredClone(raw), network: { chainId: 1313161554 } }).ok, false);
});
