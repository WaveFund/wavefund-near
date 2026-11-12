import { test } from 'node:test';
import assert from 'node:assert/strict';
import { historyRows, holdingsFor, lastSwapRound, parseSafeParam, parseTabParam, permissionChecks, safeOptions, stackRounds } from '../src/lib/portfolio/view.mjs';

const demo = { strategy: { roundId: '1' }, swap: { stableAfter: '99740000', assetOut: '50000000000000000' } };
const round = (id, stack, over = {}) => ({
  slug: `r${id}`, roundId: String(id), stack: { id: stack }, date: '2026-05-01',
  winner: { name: 'Tilt', allocationBps: 3000, isHold: false },
  swap: { stableDelta: '-100000000', assetDelta: '50000000000000000', slippageBps: 100 },
  realisedReturnX18: '1050000000000000000', ...over,
});
const inspection = (over = {}) => ({ chainId: 31337, owners: ['a', 'b', 'c'], threshold: 2, moduleEnabled: true, maxSlippageBps: 100, oracle: { usable: true }, activeRoundId: '0', unsignedOnly: true, ...over });

test('safe param: unknown falls back to tidepool, local only when the backend is local', () => {
  assert.equal(parseSafeParam('original'), 'original');
  assert.equal(parseSafeParam('bogus'), 'tidepool');
  assert.equal(parseSafeParam(null), 'tidepool');
  assert.equal(parseSafeParam('local'), 'tidepool');
  assert.equal(parseSafeParam('local', { localAllowed: false }), 'tidepool');
  assert.equal(parseSafeParam('local', { localAllowed: 'yes' }), 'tidepool');
  assert.equal(parseSafeParam('local', { localAllowed: true }), 'local');
});

test('tab param: only the four tabs, default overview', () => {
  for (const tab of ['overview', 'funding', 'history', 'permissions']) assert.equal(parseTabParam(tab), tab);
  assert.equal(parseTabParam('Funding'), 'overview');
  assert.equal(parseTabParam(undefined), 'overview');
  assert.equal(parseTabParam('constructor'), 'overview');
});

test('safe selector offers local only for a local backend', () => {
  assert.deepEqual(safeOptions().map((item) => item.id), ['tidepool', 'original']);
  assert.deepEqual(safeOptions({ localAllowed: true }).map((item) => item.id), ['tidepool', 'original', 'local']);
});

test('tidepool holdings are saved evidence, labelled by round, with no total value', () => {
  const holdings = holdingsFor({ safe: 'tidepool', demo, latestSaved: { roundId: '1' } });
  assert.deepEqual(holdings.rows, [{ symbol: 'Test USDC', text: '99.74' }, { symbol: 'Test ETH', text: '0.05' }]);
  assert.equal(holdings.caption, 'after round 1 · saved evidence');
  assert.equal(holdings.value.text, 'Value unavailable');
  assert.doesNotMatch(JSON.stringify(holdings), /\$/);
  assert.equal(holdingsFor({ safe: 'tidepool' }).status, 'loading');
  assert.equal(holdingsFor({ safe: 'tidepool', demo: { ...demo, swap: { ...demo.swap, stableAfter: null } } }).rows[0].text, null);
});

test('original Safe has no holdings; they are not in the evidence', () => {
  const holdings = holdingsFor({ safe: 'original', demo, latestSaved: round(7, 'original') });
  assert.equal(holdings.status, 'not-in-evidence');
  assert.deepEqual(holdings.rows, []);
});

test('local holdings show a USD value only when simulated prices supply one', () => {
  const withValue = holdingsFor({ safe: 'local', local: { stableBalance: '500000000', assetBalance: '0', valueUsdX18: '500000000000000000000' } });
  assert.deepEqual(withValue.value, { text: '$500.00', note: 'simulated prices' });
  assert.equal(withValue.rows[0].text, '500');
  const without = holdingsFor({ safe: 'local', local: { stableBalance: '1', assetBalance: '1', valueUsdX18: null } });
  assert.equal(without.value.text, 'Value unavailable');
  assert.equal(holdingsFor({ safe: 'local', local: null }).status, 'unavailable');
});

test('local permission checks are individual and carry no aggregate', () => {
  const checks = permissionChecks({ safe: 'local', inspection: inspection() });
  assert.deepEqual(checks.map((c) => c.label), ['Owners threshold', 'Module enabled', 'Max slippage per swap', 'Price oracle', 'Active round', 'Network']);
  assert.equal(checks[0].value, '2 of 3');
  assert.equal(checks[2].value, '1%');
  assert.equal(checks.find((c) => c.label === 'Active round').value, 'None');
  assert.ok(!checks.some((c) => /ready/i.test(c.label + c.value)));
  assert.ok(!('ready' in checks) && checks.every((c) => !('ready' in c)));
});

test('a disabled module or unusable oracle is flagged individually and does not hide the others', () => {
  const checks = permissionChecks({ safe: 'local', inspection: inspection({ moduleEnabled: false, oracle: { usable: false }, activeRoundId: '4' }) });
  const by = Object.fromEntries(checks.map((c) => [c.label, c]));
  assert.equal(by['Module enabled'].state, 'warn');
  assert.equal(by['Price oracle'].state, 'warn');
  assert.equal(by['Owners threshold'].state, 'info');
  assert.equal(by['Active round'].value, 'Round 4');
  assert.equal(permissionChecks({ safe: 'local', inspection: null }).length, 0);
});

test('saved Safes: slippage as executed, owners and module explicitly not in evidence', () => {
  const tide = permissionChecks({ safe: 'tidepool', latestSaved: round(1, 'tidepool', { swap: { slippageBps: 50 } }) });
  assert.equal(tide[0].value, '0.50% · as executed in round 1');
  const by = Object.fromEntries(tide.map((c) => [c.label, c]));
  assert.equal(by['Owners threshold'].state, 'unknown');
  assert.match(by['Module enabled'].value, /not part of the saved evidence/i);
  const orig = permissionChecks({ safe: 'original', latestSaved: round(1, 'tidepool'), swapRound: round(7, 'original', { swap: { slippageBps: 200 } }) });
  assert.equal(orig[0].value, '2% · as executed in round 7');
  assert.equal(permissionChecks({ safe: 'original', swapRound: null })[0].state, 'unknown');
});

test('history keeps stacks separate and does not invent a swap for Hold', () => {
  const all = [round(1, 'tidepool'), round(7, 'original'), round(2, 'tidepool', { winner: { name: 'Hold', allocationBps: 0, isHold: true }, swap: null, realisedReturnX18: null, date: null })];
  assert.deepEqual(stackRounds(all, 'tidepool').map((r) => r.slug), ['r1', 'r2']);
  assert.deepEqual(stackRounds(all, 'original').map((r) => r.slug), ['r7']);
  assert.deepEqual(stackRounds(all, 'local'), []);
  const rows = historyRows(stackRounds(all, 'tidepool'));
  assert.equal(rows[0].swap, '100 USDC → 0.05 ETH');
  assert.equal(rows[0].selected, 'Tilt · 30% ETH');
  assert.equal(rows[0].result, '+5%');
  assert.equal(rows[1].swap, 'No swap');
  assert.equal(rows[1].selected, 'Hold');
  assert.equal(rows[1].result, '—');
  assert.equal(rows[1].saved, '—');
});

test('last swap round skips rounds that did not trade', () => {
  const rounds = [round(5, 'original'), round(6, 'original', { swap: null })];
  assert.equal(lastSwapRound(rounds).slug, 'r5');
  assert.equal(lastSwapRound([]), null);
});
