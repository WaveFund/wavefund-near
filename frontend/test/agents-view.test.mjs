import test from 'node:test';
import assert from 'node:assert/strict';
import { rankAgents, attributableRounds } from '../src/lib/record/agents-view.mjs';

const rep = (score, samples, positive, negative, flat) => ({ score, samples, positive, negative, flat, blockNumber: '5', blockTimestamp: '6', hasEvaluatedStrategies: samples !== '0' });
const agent = (name, reputation, status = 'ok') => ({ name, address: `0x${'ab'.repeat(20)}`, status, code: status === 'ok' ? null : 'REPUTATION_UNAVAILABLE', reputation });
const board = (agents) => ({ agents });

test('rank: score descending, ties by name, negative below zero', () => {
  const rows = rankAgents(board([
    agent('Momentum', rep('-1', '1', '0', '1', '0')), agent('Balanced', rep('0', '0', '0', '0', '0')),
    agent('Zed', rep('2', '2', '2', '0', '0')), agent('Alpha', rep('0', '3', '1', '1', '1')),
  ]));
  assert.deepEqual(rows.map((r) => r.name), ['Zed', 'Alpha', 'Balanced', 'Momentum']);
});

test('rank: scores compare numerically, not as strings', () => {
  const rows = rankAgents(board([agent('A', rep('9', '9', '9', '0', '0')), agent('B', rep('10', '10', '10', '0', '0')), agent('C', rep('-10', '10', '0', '10', '0'))]));
  assert.deepEqual(rows.map((r) => r.name), ['B', 'A', 'C']);
});

test('rank: unavailable rows go last and are never coerced to zero', () => {
  const rows = rankAgents(board([agent('Bad', null, 'unavailable'), agent('Neg', rep('-1', '1', '0', '1', '0')), agent('Aaa', null, 'unavailable')]));
  assert.deepEqual(rows.map((r) => r.name), ['Neg', 'Aaa', 'Bad']);
  for (const row of rows.slice(1)) { assert.equal(row.available, false); assert.equal(row.score, null); assert.equal(row.samples, null); assert.equal(row.positive, null); }
});

test('rank: malformed counters make the row unavailable, status ok with a null reading too', () => {
  const rows = rankAgents(board([agent('X', rep('1.5', '1', '1', '0', '0')), agent('Y', null, 'ok'), agent('Z', rep('1', '', '1', '0', '0')), agent('P', rep('1', '1', 'x', '0', '0')), agent('N', rep('1', '1', '1', '', '0')), agent('F', rep('1', '1', '1', '0', null))]));
  assert.equal(rows.length, 6);
  assert.ok(rows.every((r) => !r.available && r.score === null));
});

test('rank: null or malformed board yields no rows', () => { assert.deepEqual(rankAgents(null), []); assert.deepEqual(rankAgents({}), []); });

const round = (over) => ({ slug: 's', roundId: '1', stack: { id: 'tidepool' }, winner: { id: '3', name: 'Momentum', allocationBps: 7500, isHold: false }, realisedReturnX18: '993541889635073190', reputation: { agent: '0x1', score: '-1' }, ...over });

test('attributable: only selected non-Hold rounds of this agent on this stack', () => {
  const rounds = [
    round({ slug: 'a', roundId: '1' }),
    round({ slug: 'b', roundId: '2', stack: { id: 'original' } }),
    round({ slug: 'c', roundId: '3', winner: { id: '0', name: 'Hold', allocationBps: 7489, isHold: true }, reputation: null }),
    round({ slug: 'd', roundId: '4', winner: { id: '2', name: 'Balanced', allocationBps: 5000, isHold: false } }),
  ];
  assert.deepEqual(attributableRounds(rounds, 'tidepool', 'Momentum').map((r) => r.slug), ['a']);
  assert.deepEqual(attributableRounds(rounds, 'original', 'Momentum').map((r) => r.slug), ['b']);
  assert.deepEqual(attributableRounds(rounds, 'tidepool', 'Balanced').map((r) => r.slug), ['d']);
});

test('attributable: unselected proposers and Hold get nothing', () => {
  const rounds = [round({})];
  assert.deepEqual(attributableRounds(rounds, 'tidepool', 'Conservative'), []);
  assert.deepEqual(attributableRounds(rounds, 'tidepool', 'Hold'), []);
});

test('attributable: Hold-named winner flagged isHold is excluded even if the name matches', () => {
  assert.deepEqual(attributableRounds([round({ winner: { id: '0', name: 'Momentum', allocationBps: 1, isHold: true } })], 'tidepool', 'Momentum'), []);
});

test('attributable: delta is the round score, null when none recorded, newest first, numeric order', () => {
  const rounds = [round({ slug: 'a', roundId: '9' }), round({ slug: 'b', roundId: '10', reputation: null }), round({ slug: 'c', roundId: '2', reputation: { agent: '0x1', score: '1' } })];
  const out = attributableRounds(rounds, 'tidepool', 'Momentum');
  assert.deepEqual(out.map((r) => r.slug), ['b', 'a', 'c']);
  assert.deepEqual(out.map((r) => r.delta), [null, '-1', '1']);
  assert.equal(out[1].allocationBps, 7500);
});
