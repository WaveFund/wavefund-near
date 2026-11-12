// Pure view models for the round journey (Funded → Proposals → Forecasting → Selected → Executed → Evaluated → Redeemed).
// They map real backend states onto one timeline and never invent a step: no return before evaluation, no payout before
// settlement, Hold is a valid outcome with no swap, and a halted round stays halted. Integer maths only for money.
import { formatUnits, isIntegerString } from '../funding/model.mjs';

const ONE = 10n ** 18n;
const MINUS = '−';

/** QuantumRound.EPSILON: the best challenger's final-window average must beat Hold's by more than this (0.5 points). */
export const QUALIFYING_MARGIN_X18 = 5_000_000_000_000_000n;

export const STAGES = Object.freeze([
  Object.freeze({ id: 'funded', label: 'Funded', question: "Where is the manager's capital?" }),
  Object.freeze({ id: 'proposals', label: 'Proposals', question: 'What are the alternatives?' }),
  Object.freeze({ id: 'forecasting', label: 'Forecasting', question: 'What positions back each strategy?' }),
  Object.freeze({ id: 'selected', label: 'Selected', question: 'What won, and why did it qualify?' }),
  Object.freeze({ id: 'executed', label: 'Executed', question: 'What actually changed in the Safe?' }),
  Object.freeze({ id: 'evaluated', label: 'Evaluated', question: 'How did the portfolio perform?' }),
  Object.freeze({ id: 'redeemed', label: 'Redeemed', question: 'What could forecasters redeem?' }),
]);
const STAGE_INDEX = Object.freeze(Object.fromEntries(STAGES.map((stage, index) => [stage.id, index])));

const positive = (raw) => isIntegerString(raw) && BigInt(raw) > 0n;
const isProbability = (raw) => isIntegerString(raw) && BigInt(raw) <= ONE;

/** Allocation in basis points as a whole or two-decimal percentage, e.g. 7500 → "75%". */
export function percentFromBps(bps) {
  if (!Number.isSafeInteger(bps) || bps < 0 || bps > 10_000) return null;
  const rest = bps % 100;
  return `${Math.floor(bps / 100)}${rest ? `.${String(rest).padStart(2, '0')}` : ''}%`;
}

/** A 1e18 return factor as a signed percentage to four decimals with trailing zeros trimmed, e.g. "−0.6458%", "+4.685%", "+5%". */
export function shortReturnX18(x18) {
  if (!isIntegerString(x18)) return null;
  const diff = BigInt(x18) - ONE;
  const magnitude = ((diff < 0n ? -diff : diff) * 10n ** 7n / ONE + 5n) / 10n; // percent × 10^4, half away from zero
  if (magnitude === 0n) return '0%';
  const fraction = (magnitude % 10_000n).toString().padStart(4, '0').replace(/0+$/, '');
  return `${diff < 0n ? MINUS : '+'}${magnitude / 10_000n}${fraction ? `.${fraction}` : ''}%`;
}

/** Where a return falls between the round's payout bounds, as 0–100 for a marker. Outside the bounds it pins to an edge. */
export function returnOnScale(x18, bounds) {
  if (!isIntegerString(x18) || !bounds || !isIntegerString(bounds.minX18) || !isIntegerString(bounds.maxX18)) return null;
  const min = BigInt(bounds.minX18); const max = BigInt(bounds.maxX18); const value = BigInt(x18);
  if (max <= min) return null;
  const clamped = value < min ? min : value > max ? max : value;
  return Number((clamped - min) * 10_000n / (max - min)) / 100;
}

/** Seconds as a compact duration: "90 s", "3 min", "1 h 5 min". */
export function shortDuration(seconds) {
  if (!Number.isSafeInteger(seconds) || seconds < 0) return null;
  if (seconds < 120) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
}

/** Trading and measurement windows from a round's recorded market terms. */
export function roundWindows(market) {
  if (!market || ![market.tradingStart, market.tradingEnd, market.evaluationEnd, market.twapWindowSeconds].every(isIntegerString)) return null;
  const span = (a, b) => { const value = BigInt(b) - BigInt(a); return value > 0n && value < 10n ** 9n ? Number(value) : null; };
  return { trading: shortDuration(span(market.tradingStart, market.tradingEnd)), evaluation: shortDuration(span(market.tradingEnd, market.evaluationEnd)), twap: shortDuration(Number(market.twapWindowSeconds)) };
}

// ---------------------------------------------------------------- local simulation

// Backend stage → index of the journey step in progress. "evaluating" and "settling" are both the Evaluated step.
const LOCAL_PROGRESS = Object.freeze({ idle: 0, opening: 1, proposing: 1, forecasting: 2, selecting: 3, executing: 4, evaluating: 5, settling: 5, redeeming: 6, completed: 7, complete: 7, redeemed: 7 });

/** Journey step for a local receipt label. Oracle refreshes belong to the step they prepare, so they return "carry". */
export function localReceiptStage(label) {
  const text = typeof label === 'string' ? label : '';
  if (/oracle/i.test(text)) return 'carry';
  if (/collapse/i.test(text)) return 'selected';
  if (/redeem/i.test(text)) return 'redeemed';
  if (/settle/i.test(text)) return 'evaluated';
  if (/execute/i.test(text)) return 'executed';
  if (/authoriz|opens/i.test(text)) return 'proposals';
  if (/register|bond|propos/i.test(text)) return 'proposals';
  if (/deposit|claim|buys|trade|respond|react|collateral|entitlement/i.test(text)) return 'forecasting';
  return 'setup';
}

/** Receipts grouped by journey step, in order. Pending oracle refreshes attach to the next step that follows them. */
export function groupLocalReceipts(receipts) {
  const groups = Object.fromEntries(['setup', ...STAGES.map((stage) => stage.id)].map((id) => [id, []]));
  let pending = []; let last = 'setup';
  for (const receipt of Array.isArray(receipts) ? receipts : []) {
    if (!receipt || typeof receipt.label !== 'string') continue;
    const stage = localReceiptStage(receipt.label);
    if (stage === 'carry') { pending.push(receipt); continue; }
    groups[stage].push(...pending, receipt); pending = []; last = stage;
  }
  groups[last].push(...pending);
  return groups;
}

function localProposerName(proposal, agents) {
  const label = percentFromBps(proposal.allocationBps);
  const match = (Array.isArray(agents) ? agents : []).find((agent) => typeof agent?.role === 'string' && /propos/i.test(agent.role) && typeof agent.action === 'string' && label && agent.action.startsWith(label));
  return match && typeof match.name === 'string' ? match.name : null;
}

/** The local round mapped onto the journey from the live /api/state snapshot. */
export function localJourney(state) {
  const stage = typeof state?.stage === 'string' ? state.stage : 'idle';
  const halted = stage === 'failed' || stage === 'interrupted';
  const receipts = groupLocalReceipts(state?.receipts);
  let progress = LOCAL_PROGRESS[stage];
  if (halted) progress = Math.max(1, ...STAGES.map((item, index) => (receipts[item.id].length ? index : 0)));
  if (progress === undefined) progress = 0;
  const proposals = (Array.isArray(state?.proposals) ? state.proposals : []).map((item) => ({
    id: String(item.id), name: String(item.id) === '0' ? 'Hold' : localProposerName(item, state?.agents) ?? `Strategy ${item.id}`,
    label: typeof item.label === 'string' ? item.label : '', allocationBps: item.allocationBps, rationale: typeof item.rationale === 'string' ? item.rationale : '',
    twapX18: isProbability(item.twapX18) ? item.twapX18 : null,
  }));
  const funded = positive(state?.safe?.valueUsdX18) || positive(state?.safe?.stableBalance) || positive(state?.safe?.assetBalance);
  const winnerKnown = progress >= 4;
  const winnerId = winnerKnown && state?.round?.winnerId !== undefined && state?.round?.winnerId !== null ? String(state.round.winnerId) : null;
  const winner = winnerId === null ? null : proposals.find((item) => item.id === winnerId) ?? null;
  const isHold = winnerId === '0';
  const evaluated = progress >= 6 && isIntegerString(state?.round?.realisedReturnX18);
  const complete = progress >= 7;
  const participants = Array.isArray(state?.forecast?.participants) ? state.forecast.participants : [];
  const depositors = participants.filter((item) => positive(item?.deposit)).length;
  const paid = Array.isArray(state?.forecast?.payouts) ? state.forecast.payouts.length : 0;
  const challengers = proposals.filter((item) => item.id !== '0').length;
  const running = Boolean(state?.running) || (stage !== 'idle' && !complete && !halted);
  const status = (index) => {
    if (index === 0) return funded ? 'done' : 'upcoming';
    if (complete || index < progress) return index === 4 && isHold ? 'skipped' : 'done';
    if (index === progress) return halted ? 'halted' : running ? 'current' : 'upcoming';
    return 'upcoming';
  };
  const summaries = [
    funded ? 'Test capital in Safe' : 'Not funded yet',
    progress >= 1 && challengers ? `${challengers} strategies + Hold` : null,
    progress >= 2 && depositors ? `${depositors} forecasters` : null,
    winner ? (isHold ? 'Hold kept' : `${percentFromBps(winner.allocationBps)} test ETH`) : null,
    progress >= 5 ? (isHold ? 'No swap' : 'Swap executed') : null,
    evaluated ? shortReturnX18(state.round.realisedReturnX18) : null,
    complete ? `${paid} redeemed` : null,
  ];
  return {
    mode: 'local', progress, halted, running, complete, funded, winnerId, isHold, evaluated, proposals, receipts,
    returnX18: evaluated ? state.round.realisedReturnX18 : null, longPayoutX18: evaluated && isProbability(state?.round?.piX18) ? state.round.piX18 : null,
    stages: STAGES.map((item, index) => ({ ...item, status: status(index), summary: summaries[index] })),
  };
}

/** Final-window market signals against Hold, using the contract's own rule. Null when Hold has no recorded average. */
export function selectionSignals(proposals) {
  const list = Array.isArray(proposals) ? proposals : [];
  const hold = list.find((item) => String(item.id) === '0');
  if (!hold || !isProbability(hold.twapX18)) return null;
  const holdTwap = BigInt(hold.twapX18); const threshold = holdTwap + QUALIFYING_MARGIN_X18;
  let best = null;
  for (const item of list) {
    if (String(item.id) === '0' || !isProbability(item.twapX18)) continue;
    if (best === null || BigInt(item.twapX18) > BigInt(best.twapX18)) best = item;
  }
  const winnerId = best && BigInt(best.twapX18) > threshold ? String(best.id) : '0';
  const percent = (raw) => Number(BigInt(raw) / 10n ** 14n) / 100;
  return {
    holdPercent: percent(hold.twapX18), thresholdPercent: percent(threshold > ONE ? ONE : threshold), winnerId,
    rows: list.map((item) => ({ id: String(item.id), isHold: String(item.id) === '0', percent: isProbability(item.twapX18) ? percent(item.twapX18) : null,
      qualifies: String(item.id) !== '0' && isProbability(item.twapX18) && BigInt(item.twapX18) > threshold })),
  };
}

// ---------------------------------------------------------------- saved public rounds

const SAVED_ACTION_STAGE = Object.freeze({ gas: 'setup', mint: 'setup', transfer: 'setup', register: 'setup', bondApproval: 'setup', depositApproval: 'setup',
  authorize: 'proposals', open: 'proposals', propose: 'proposals', deposit: 'forecasting', claim: 'forecasting', trade: 'forecasting',
  collapse: 'selected', execute: 'executed', settle: 'evaluated', redeem: 'redeemed' });
const ORACLE_STAGE = Object.freeze({ open: 'proposals', execute: 'executed', settle: 'evaluated' });
const SAVED_ACTION_TEXT = Object.freeze({ gas: 'Gas top-up', mint: 'Mint test tokens', transfer: 'Send test tokens', register: 'Register agent', bondApproval: 'Approve proposal bond',
  depositApproval: 'Approve forecast deposit', authorize: 'Safe authorizes the round', open: 'Open the round', propose: 'Propose a strategy', deposit: 'Deposit collateral',
  claim: 'Claim credits', trade: 'Take a position', collapse: 'Close markets and select', execute: 'Execute through the Safe', settle: 'Settle the measured return', redeem: 'Redeem' });

/** Journey step for a saved transaction label such as "round1:propose:Momentum". */
export function savedTxStage(label) {
  const [, action, detail] = typeof label === 'string' ? label.split(':') : [];
  if (action === 'oracle') return ORACLE_STAGE[detail] ?? 'setup';
  return SAVED_ACTION_STAGE[action] ?? 'setup';
}

/** Readable text for a saved transaction label: "round1:propose:Momentum" → "Propose a strategy · Momentum". */
export function describeSavedTx(label) {
  const [, action, detail] = typeof label === 'string' ? label.split(':') : [];
  if (action === 'oracle') return `Refresh the price oracle${detail ? ` (${detail})` : ''}`;
  const text = SAVED_ACTION_TEXT[action] ?? (action || 'Transaction');
  return detail ? `${text} · ${detail}` : text;
}

/** Saved transactions grouped by journey step, keeping their recorded order. */
export function groupSavedTransactions(transactions) {
  const groups = Object.fromEntries(['setup', ...STAGES.map((stage) => stage.id)].map((id) => [id, []]));
  for (const item of Array.isArray(transactions) ? transactions : []) if (item && typeof item.label === 'string') groups[savedTxStage(item.label)].push(item);
  return groups;
}

/** A completed public round mapped onto the journey. The linked Tidepool demonstration supplies the funding step. */
export function savedJourney(round, demo = null) {
  const linked = demo && demo.strategy?.roundSlug === round.slug ? demo : null;
  const isHold = round.winner.isHold === true;
  const buys = round.forecasters.filter((item) => item.action === 'buy').length;
  const redeemed = round.payouts.filter((item) => item.payout !== null).length;
  const challengers = round.proposals.filter((item) => item.id !== '0').length;
  const spent = round.swap?.stableDelta && round.swap.stableDelta.startsWith('-') ? round.swap.stableDelta.slice(1) : null;
  const received = round.swap?.assetDelta && !round.swap.assetDelta.startsWith('-') ? round.swap.assetDelta : null;
  const summaries = [
    linked ? `${formatUnits(linked.funding.deliveredAmount, 6)} USDC delivered` : 'Safe funded earlier',
    `${challengers} strategies + Hold`,
    buys ? `${buys} positions` : 'All abstained',
    isHold ? 'Hold kept' : `${round.winner.name} · ${percentFromBps(round.winner.allocationBps)}`,
    isHold ? 'No swap' : spent && received ? `${formatUnits(spent, 6, { maxFraction: 2 })} USDC → ${formatUnits(received, 18, { maxFraction: 6 })} ETH` : 'Executed',
    shortReturnX18(round.realisedReturnX18) ?? 'Not recorded',
    `${redeemed} redeemed`,
  ];
  return {
    mode: 'saved', progress: 7, halted: false, running: false, complete: true, funded: true, winnerId: round.winner.id, isHold, evaluated: round.realisedReturnX18 !== null,
    linkedDemo: linked, transactions: groupSavedTransactions(round.transactions), returnX18: round.realisedReturnX18, longPayoutX18: round.market?.longPayoutX18 ?? null,
    stages: STAGES.map((item, index) => ({ ...item, status: index === 4 && isHold ? 'skipped' : 'done', summary: summaries[index] })),
  };
}

/** LONG and SHORT positions per proposal, plus forecasters who abstained. Credits stay per world; they are never summed. */
export function positionGroups(proposals, forecasters) {
  const groups = (Array.isArray(proposals) ? proposals : []).map((item) => ({ proposalId: String(item.id), long: [], short: [] }));
  const byId = new Map(groups.map((group) => [group.proposalId, group]));
  const abstained = [];
  for (const item of Array.isArray(forecasters) ? forecasters : []) {
    if (item?.action === 'buy' && (item.side === 'long' || item.side === 'short') && byId.has(item.proposalId)) {
      byId.get(item.proposalId)[item.side].push({ name: item.name, credits: isIntegerString(item.credits) ? item.credits : null, scripted: item.scripted === true });
    } else if (item?.action === 'abstain') abstained.push({ name: item.name, reason: item.reason ?? null, scripted: item.scripted === true });
  }
  return { groups, abstained, positions: groups.reduce((total, group) => total + group.long.length + group.short.length, 0) };
}

export { STAGE_INDEX };
