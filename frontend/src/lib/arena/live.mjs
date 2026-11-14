// Pure view model for the live Aurora round. It maps the read-only /api/state snapshot onto the journey and never invents a
// step: no winner before collapse, no return before settlement, no negative countdown, and future stages carry no value.
// Round.status is QuantumRound's RoundStatus: 0 None, 1 Trading, 2 Collapsed, 3 Settled, 4 Cancelled.
import { isIntegerString } from '../funding/model.mjs';
import { selectionSignals } from './model.mjs';

const ONE = 10n ** 18n;
export const AURORA_MODE = 'aurora-testnet-readonly';
export const ROUND_STATUS = Object.freeze({ none: 0, trading: 1, collapsed: 2, settled: 3, cancelled: 4 });

export const LIVE_STAGES = Object.freeze([
  Object.freeze({ id: 'funded', label: 'Funded' }), Object.freeze({ id: 'proposals', label: 'Proposals' }), Object.freeze({ id: 'forecasting', label: 'Forecasting' }),
  Object.freeze({ id: 'selected', label: 'Selected' }), Object.freeze({ id: 'executed', label: 'Executed' }), Object.freeze({ id: 'evaluated', label: 'Measured' }),
  Object.freeze({ id: 'redeemed', label: 'Redeemed' }),
]);
const INDEX = Object.freeze(Object.fromEntries(LIVE_STAGES.map((stage, index) => [stage.id, index])));

const seconds = (raw) => (isIntegerString(raw) && BigInt(raw) < 10n ** 12n ? Number(raw) : null);
const probability = (raw) => (isIntegerString(raw) && BigInt(raw) <= ONE ? raw : null);

/** Whole seconds until a chain timestamp (seconds). Never negative; null when the timestamp is unknown. */
export function secondsUntil(endSeconds, nowMs) {
  if (!Number.isFinite(endSeconds) || !Number.isFinite(nowMs)) return null;
  return Math.max(0, Math.ceil(endSeconds - nowMs / 1000));
}

/** "6 min 12 s", "45 s", "1 h 5 min", "0 s". */
export function formatCountdown(total) {
  if (!Number.isSafeInteger(total) || total < 0) return null;
  if (total < 60) return `${total} s`;
  if (total < 3600) return `${Math.floor(total / 60)} min ${total % 60} s`;
  return `${Math.floor(total / 3600)} h ${Math.floor((total % 3600) / 60)} min`;
}

/** The step the round is in right now. Boundaries match the contract: trading ends at tradingEnd, settling opens at evaluationEnd. */
export function liveStageFor({ status, tradingEnd, evaluationEnd, nowSec, challengers = 0, executed }) {
  if (status === ROUND_STATUS.trading) return challengers < 1 ? 'proposals' : 'forecasting';
  // Selected but the Safe has not executed yet (backend reports engine.roundExecuted).
  if (status === ROUND_STATUS.collapsed && executed === false) return 'selected';
  if (status === ROUND_STATUS.collapsed) return Number.isFinite(evaluationEnd) && Number.isFinite(nowSec) && nowSec >= evaluationEnd ? 'evaluated' : 'executed';
  if (status === ROUND_STATUS.settled) return 'redeemed';
  if (status === ROUND_STATUS.cancelled) return 'executed';
  return null;
}

/** True when the dashboard should treat this snapshot as a current Aurora round (open or awaiting settlement). */
export function isLiveNow(state) {
  const status = state?.round?.status;
  return state?.mode === AURORA_MODE && roundIdOf(state) !== null && (status === ROUND_STATUS.trading || status === ROUND_STATUS.collapsed);
}

function roundIdOf(state) { const id = state?.roundId; return typeof id === 'string' && /^[1-9]\d*$/.test(id) ? id : null; }

/** Strategy rows: live price always, final-window average only once the round has collapsed. */
function liveProposals(state, collapsed) {
  return (Array.isArray(state?.proposals) ? state.proposals : []).map((item) => ({
    id: String(item.id), name: String(item.id) === '0' ? 'Hold' : typeof item.name === 'string' && /^[A-Za-z][A-Za-z0-9]{0,31}$/.test(item.name) ? item.name : (typeof item.label === 'string' && item.label ? item.label : `Strategy ${item.id}`), allocationBps: Number.isSafeInteger(item.allocationBps) ? item.allocationBps : 0,
    rationale: typeof item.rationale === 'string' ? item.rationale : '', proposer: typeof item.proposer === 'string' ? item.proposer : null,
    priceX18: probability(item.probabilityX18), twapX18: collapsed ? probability(item.twapX18) : null,
  }));
}

/** Everything the live page shows, or null when there is no current Aurora round. Pass Date.now() as nowMs. */
export function liveRound(state, nowMs) {
  const id = roundIdOf(state); const round = state?.round;
  if (state?.mode !== AURORA_MODE || id === null || !round || !Number.isInteger(round.status) || round.status < 1 || round.status > 4) return null;
  const status = round.status;
  const tradingEnd = seconds(round.tradingEnd); const evaluationEnd = seconds(round.evaluationEnd);
  const afterCollapse = status >= ROUND_STATUS.collapsed; const settled = status === ROUND_STATUS.settled; const cancelled = status === ROUND_STATUS.cancelled;
  const proposals = liveProposals(state, afterCollapse);
  const challengers = proposals.filter((item) => item.id !== '0').length;
  const nowSec = Number.isFinite(nowMs) ? nowMs / 1000 : NaN;
  const current = liveStageFor({ status, tradingEnd, evaluationEnd, nowSec, challengers, executed: typeof round.executed === 'boolean' ? round.executed : undefined });
  const at = INDEX[current];
  const stages = LIVE_STAGES.map((stage, index) => ({ ...stage, status: index < at ? 'done' : index === at ? (cancelled ? 'halted' : 'current') : 'upcoming' }));
  if (settled) for (const stage of stages) if (stage.id !== 'redeemed') stage.status = 'done';
  const tradingOpen = status === ROUND_STATUS.trading && tradingEnd !== null && nowSec < tradingEnd;
  let countdown = null;
  if (status === ROUND_STATUS.trading && tradingEnd !== null) countdown = { kind: 'trading', target: 'Trading closes', done: 'Trading closed', seconds: secondsUntil(tradingEnd, nowMs) };
  else if (status === ROUND_STATUS.collapsed && evaluationEnd !== null) countdown = { kind: 'evaluation', target: 'Evaluation ends', done: 'Evaluation window ended', seconds: secondsUntil(evaluationEnd, nowMs) };
  const winnerKnown = afterCollapse && Number.isInteger(round.winnerId) && proposals.some((item) => item.id === String(round.winnerId));
  const phase = cancelled ? 'Cancelled' : settled ? 'Settled' : status === ROUND_STATUS.trading
    ? (challengers < 1 ? 'Waiting for proposals' : tradingOpen ? 'Forecasting open' : 'Trading closed · awaiting selection')
    : (current === 'evaluated' ? 'Evaluation ended · awaiting settlement' : current === 'selected' ? 'Selected · awaiting execution' : 'Executed · measuring');
  return {
    roundId: id, status, phase, settled, cancelled, live: !settled && !cancelled, current, stages, countdown, tradingOpen, tradingEnd, evaluationEnd,
    proposals, challengers, winnerId: winnerKnown ? String(round.winnerId) : null, isHold: winnerKnown && String(round.winnerId) === '0',
    realisedReturnX18: settled && isIntegerString(round.realisedReturnX18) ? round.realisedReturnX18 : null,
    piX18: settled && isIntegerString(round.piX18) ? round.piX18 : null,
    note: typeof state.error === 'string' && state.error ? state.error : null,
  };
}

/** Bars vs Hold. Before collapse they use the live price and are indicative; after collapse the final-window average decides. */
export function liveSignals(view) {
  if (!view) return null;
  const final = view.status >= ROUND_STATUS.collapsed;
  const signals = selectionSignals(view.proposals.map((item) => ({ id: item.id, twapX18: final ? item.twapX18 : item.priceX18 })));
  return signals ? { basis: final ? 'final-window average' : 'live market price', final, signals } : null;
}

/** The stage shown first: where the round is now. A settled round opens on its result, not on the open redemption window. */
export function defaultLiveStage(view) {
  if (!view) return null;
  return view.settled ? 'evaluated' : view.current;
}
