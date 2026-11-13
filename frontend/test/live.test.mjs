// Live Aurora round view model. Inputs follow the read-only /api/state shape from runtime/operator/aurora.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultLiveStage, formatCountdown, isLiveNow, liveRound, liveSignals, liveStageFor, secondsUntil } from '../src/lib/arena/live.mjs';

const P = (id, bps, price, twap) => ({ id: String(id), label: '', allocationBps: bps, probabilityX18: price, twapX18: twap, rationale: 'r', proposer: '0x1' });
const E = (pct) => (BigInt(Math.round(pct * 10)) * 10n ** 15n).toString();
const TE = 1_000_000; const EE = TE + 900;
const state = (status, over = {}, props) => ({
  mode: 'aurora-testnet-readonly', chainId: 1313161555, roundId: '2', error: null,
  round: { status, tradingEnd: String(TE), evaluationEnd: String(EE), realisedReturnX18: '0', piX18: '0', winnerId: 0, ...over },
  proposals: props ?? [P(0, 0, E(50), '0'), P(1, 5000, E(60), '0'), P(2, 9000, E(40), '0')],
});
const at = (sec) => sec * 1000;

test('stage follows status and the contract boundaries', () => {
  const base = { tradingEnd: TE, evaluationEnd: EE, challengers: 2 };
  assert.equal(liveStageFor({ ...base, status: 1, nowSec: TE - 1 }), 'forecasting');
  assert.equal(liveStageFor({ ...base, status: 1, nowSec: TE + 50 }), 'forecasting', 'trading closed but not collapsed stays at forecasting');
  assert.equal(liveStageFor({ ...base, status: 1, nowSec: TE, challengers: 0 }), 'proposals');
  assert.equal(liveStageFor({ ...base, status: 2, nowSec: EE - 1 }), 'executed');
  assert.equal(liveStageFor({ ...base, status: 2, nowSec: EE }), 'evaluated', 'settle opens exactly at evaluationEnd');
  assert.equal(liveStageFor({ ...base, status: 3, nowSec: EE + 5 }), 'redeemed');
  assert.equal(liveStageFor({ ...base, status: 4, nowSec: EE + 5 }), 'executed');
  assert.equal(liveStageFor({ ...base, status: 0, nowSec: 1 }), null);
  assert.equal(liveStageFor({ status: 2, tradingEnd: TE, evaluationEnd: null, nowSec: EE + 99, challengers: 2 }), 'executed', 'unknown end time never advances the stage');
});

test('countdown is never negative and rounds up to whole seconds', () => {
  assert.equal(secondsUntil(100, at(40)), 60);
  assert.equal(secondsUntil(100, 39_500), 61);
  assert.equal(secondsUntil(100, at(100)), 0);
  assert.equal(secondsUntil(100, at(500)), 0);
  assert.equal(secondsUntil(NaN, at(1)), null);
  assert.equal(formatCountdown(0), '0 s'); assert.equal(formatCountdown(59), '59 s'); assert.equal(formatCountdown(60), '1 min 0 s');
  assert.equal(formatCountdown(372), '6 min 12 s'); assert.equal(formatCountdown(3900), '1 h 5 min'); assert.equal(formatCountdown(-1), null);
});

test('trading round: live prices only, no winner, no return, pulse on', () => {
  const view = liveRound(state(1), at(TE - 400));
  assert.equal(view.current, 'forecasting'); assert.equal(view.live, true); assert.equal(view.winnerId, null);
  assert.equal(view.realisedReturnX18, null); assert.equal(view.piX18, null);
  assert.deepEqual(view.stages.map((s) => s.status), ['done', 'done', 'current', 'upcoming', 'upcoming', 'upcoming', 'upcoming']);
  assert.equal(view.countdown.seconds, 400); assert.equal(view.proposals[1].priceX18, E(60)); assert.equal(view.proposals[1].twapX18, null);
  const sig = liveSignals(view);
  assert.equal(sig.final, false); assert.equal(sig.basis, 'live market price'); assert.equal(sig.signals.winnerId, '1');
});

test('an unfinalised on-chain twap of zero is not shown as an average before collapse', () => {
  const view = liveRound(state(1, {}, [P(0, 0, E(50), E(70)), P(1, 5000, E(60), E(90))]), at(TE - 1));
  assert.equal(view.proposals[1].twapX18, null);
  assert.equal(liveSignals(view).signals.rows[1].percent, 60, 'uses the price, not the stray twap');
});

test('trading closed but uncollapsed: countdown at zero, still live, phase says awaiting selection', () => {
  const view = liveRound(state(1), at(TE + 30));
  assert.equal(view.countdown.seconds, 0); assert.equal(view.tradingOpen, false); assert.match(view.phase, /awaiting selection/); assert.equal(view.winnerId, null);
});

test('collapsed: winner and final averages appear, return stays hidden until settlement', () => {
  const props = [P(0, 0, E(50), E(50)), P(1, 5000, E(52), E(51)), P(2, 9000, E(40), E(58))];
  const view = liveRound(state(2, { winnerId: 2, realisedReturnX18: '1050000000000000000', piX18: '5' }, props), at(EE - 100));
  assert.equal(view.winnerId, '2'); assert.equal(view.current, 'executed'); assert.equal(view.live, true);
  assert.equal(view.realisedReturnX18, null, 'a stored return before settlement is not a measurement'); assert.equal(view.piX18, null);
  assert.equal(view.countdown.kind, 'evaluation'); assert.equal(view.countdown.seconds, 100);
  const sig = liveSignals(view); assert.equal(sig.final, true); assert.equal(sig.signals.rows[2].percent, 58); assert.equal(sig.signals.winnerId, '2');
  assert.equal(liveRound(state(2, { winnerId: 2 }, props), at(EE + 1)).current, 'evaluated');
  assert.equal(liveRound(state(2, { winnerId: 2 }, props), at(EE + 1)).countdown.seconds, 0);
});

test('hold win is recognised only after collapse', () => {
  assert.equal(liveRound(state(1, { winnerId: 0 }), at(TE - 5)).isHold, false);
  assert.equal(liveRound(state(2, { winnerId: 0 }), at(TE + 5)).isHold, true);
});

test('settled: return and payout appear, every stage done, no pulse, no countdown', () => {
  const view = liveRound(state(3, { winnerId: 1, realisedReturnX18: '993541889635073190', piX18: '435418896350731900' }), at(EE + 10));
  assert.equal(view.realisedReturnX18, '993541889635073190'); assert.equal(view.piX18, '435418896350731900'); assert.equal(view.live, false); assert.equal(view.countdown, null);
  assert.deepEqual(view.stages.map((s) => s.status), ['done', 'done', 'done', 'done', 'done', 'done', 'current']);
});

test('cancelled: halted at execution, nothing measured, no pulse', () => {
  const view = liveRound(state(4, { winnerId: 1, realisedReturnX18: '1000000000000000000' }), at(EE + 10));
  assert.equal(view.cancelled, true); assert.equal(view.live, false); assert.equal(view.realisedReturnX18, null);
  assert.deepEqual(view.stages.map((s) => s.status), ['done', 'done', 'done', 'done', 'halted', 'upcoming', 'upcoming']);
});

test('no current round: wrong mode, round 0, missing round, unknown status', () => {
  assert.equal(liveRound({ ...state(1), mode: 'local-simulation' }, at(1)), null);
  assert.equal(liveRound({ ...state(1), roundId: '0' }, at(1)), null);
  assert.equal(liveRound({ ...state(1), roundId: null }, at(1)), null);
  assert.equal(liveRound({ ...state(1), round: null }, at(1)), null);
  assert.equal(liveRound(state(0), at(1)), null);
  assert.equal(liveRound(state(9), at(1)), null);
  assert.equal(liveRound(null, at(1)), null);
});

test('oracle note is passed through verbatim and values stay real', () => {
  const view = liveRound({ ...state(1), error: 'Oracle unavailable or stale. Monitoring never supplies a fallback price.' }, at(TE - 5));
  assert.match(view.note, /Oracle unavailable/); assert.equal(liveRound(state(1), at(TE - 5)).note, null);
});

test('invalid probabilities become null, not zero', () => {
  const view = liveRound(state(1, {}, [P(0, 0, E(50), '0'), P(1, 5000, 'x', '0'), P(2, 9000, '2000000000000000000', '0')]), at(TE - 5));
  assert.equal(view.proposals[1].priceX18, null); assert.equal(view.proposals[2].priceX18, null);
});

test('only open or evaluating Aurora rounds count as live now', () => {
  assert.equal(isLiveNow(state(1)), true); assert.equal(isLiveNow(state(2)), true);
  assert.equal(isLiveNow(state(3)), false); assert.equal(isLiveNow(state(4)), false);
  assert.equal(isLiveNow({ ...state(1), mode: 'local-simulation' }), false); assert.equal(isLiveNow({ ...state(1), roundId: '0' }), false);
});

test('default stage is the current one, except settled which opens on the result', () => {
  assert.equal(defaultLiveStage(liveRound(state(1), at(TE - 5))), 'forecasting');
  assert.equal(defaultLiveStage(liveRound(state(2, { winnerId: 1 }), at(EE - 5))), 'executed');
  assert.equal(defaultLiveStage(liveRound(state(3, { winnerId: 1 }), at(EE + 5))), 'evaluated');
  assert.equal(defaultLiveStage(null), null);
});

test('strategy names come from the backend label, Hold is always Hold', () => {
  const view = liveRound(state(1, {}, [{ ...P(0, 0, E(50), '0'), label: 'Hold current assets' }, { ...P(1, 7500, E(54), '0'), label: '75% approved asset' }]), at(TE - 5));
  assert.deepEqual(view.proposals.map((item) => item.name), ['Hold', '75% approved asset']);
});
