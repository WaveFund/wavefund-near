// Pure derivations for the Portfolio workspace. No React, no fetching: every rule here is unit-tested.
// A permission list is individual checks only; nothing in this module ever produces an overall "ready" flag.
import { formatUnits } from '../funding/model.mjs';
import { percentFromBps, shortReturnX18 } from '../arena/model.mjs';

export const SAFE_IDS = ['tidepool', 'original', 'local'];
export const TAB_IDS = ['overview', 'funding', 'history', 'permissions'];
export const DEFAULT_SAFE = 'tidepool';
export const DEFAULT_TAB = 'overview';

/** ?safe= value to a Safe id. Unknown values fall back to tidepool; 'local' only counts when the backend is local. */
export function parseSafeParam(value, { localAllowed = false } = {}) {
  if (value === 'original' || value === 'tidepool') return value;
  if (value === 'local' && localAllowed === true) return 'local';
  return DEFAULT_SAFE;
}

/** ?tab= value to a tab id. Unknown values open Overview. */
export function parseTabParam(value) {
  return TAB_IDS.includes(value) ? value : DEFAULT_TAB;
}

/** The Safes the selector offers. Local simulation appears only for a local backend. */
export function safeOptions({ localAllowed = false } = {}) {
  const options = [{ id: 'tidepool', label: 'Tidepool testnet Safe' }, { id: 'original', label: 'Original testnet Safe' }];
  if (localAllowed === true) options.push({ id: 'local', label: 'Local simulation Safe' });
  return options;
}

/** Saved rounds belonging to one testnet stack, in supplied order. */
export function stackRounds(rounds, safe) {
  return (rounds ?? []).filter((item) => item.stack.id === safe);
}

const usdc = (raw) => formatUnits(raw, 6, { maxFraction: 2 });
const eth = (raw, max = 6) => formatUnits(raw, 18, { maxFraction: max });
const row = (symbol, text) => ({ symbol, text: text ?? null });

/**
 * Token holdings for the selected Safe.
 * Tidepool: only the saved post-swap amounts. Original: none (not in the evidence). Local: live balances, with a USD
 * value only when the simulated prices supply one. A testnet Safe never gets a total value.
 */
export function holdingsFor({ safe, demo = null, latestSaved = null, local = null }) {
  if (safe === 'tidepool') {
    if (!demo) return { status: 'loading', rows: [], caption: null, value: null };
    return {
      status: 'saved',
      rows: [row('Test USDC', demo.swap.stableAfter ? usdc(demo.swap.stableAfter) : null), row('Test ETH', eth(demo.swap.assetOut, 6))],
      caption: `after round ${latestSaved?.roundId ?? demo.strategy.roundId ?? '?'} · saved evidence`,
      value: { text: 'Value unavailable', note: 'Testnet prices are not reliably available.' },
    };
  }
  if (safe === 'local') {
    if (!local) return { status: 'unavailable', rows: [], caption: null, value: null };
    const usd = local.valueUsdX18 ? formatUnits(local.valueUsdX18, 18, { maxFraction: 2, minFraction: 2 }) : null;
    return {
      status: 'live',
      rows: [row('Test USDC', usdc(local.stableBalance)), row('Test ETH', eth(local.assetBalance, 5))],
      caption: 'live · local chain',
      value: usd ? { text: `$${usd}`, note: 'simulated prices' } : { text: 'Value unavailable', note: null },
    };
  }
  return { status: 'not-in-evidence', rows: [], caption: null, value: null };
}

const check = (label, value, state) => ({ label, value, state });
const NOT_SAVED = 'Not part of the saved evidence';

/**
 * Individual permission and context checks. state: ok | warn | info | unknown.
 * Returns a plain list. It never sums the checks into one verdict.
 */
export function permissionChecks({ safe, inspection = null, latestSaved = null, swapRound = null }) {
  if (safe === 'local') {
    if (!inspection) return [];
    const active = String(inspection.activeRoundId ?? '0');
    return [
      check('Owners threshold', `${inspection.threshold} of ${inspection.owners.length}`, 'info'),
      check('Module enabled', inspection.moduleEnabled ? 'Enabled' : 'Not enabled', inspection.moduleEnabled ? 'ok' : 'warn'),
      check('Max slippage per swap', percentFromBps(inspection.maxSlippageBps) ?? 'unavailable', 'info'),
      check('Price oracle', inspection.oracle?.usable ? 'Usable' : 'Not usable', inspection.oracle?.usable ? 'ok' : 'warn'),
      check('Active round', active === '0' ? 'None' : `Round ${active}`, 'info'),
      check('Network', `Anvil local · ${inspection.chainId}`, 'info'),
    ];
  }
  const executed = safe === 'tidepool' ? latestSaved : swapRound;
  const slippage = executed?.swap?.slippageBps;
  return [
    check('Max slippage per swap', slippage != null ? `${percentFromBps(slippage)} · as executed in round ${executed.roundId}` : 'unavailable', slippage != null ? 'info' : 'unknown'),
    check('Owners threshold', NOT_SAVED, 'unknown'),
    check('Module enabled', NOT_SAVED, 'unknown'),
    check('Network', 'Aurora testnet · 1313161555', 'info'),
  ];
}

/** Compact history rows for one stack. The swap cell never invents a trade for a Hold round. */
export function historyRows(rounds) {
  return (rounds ?? []).map((round) => {
    const spent = round.swap?.stableDelta?.startsWith('-') ? round.swap.stableDelta.slice(1) : null;
    let swap = 'Executed';
    if (round.winner.isHold) swap = 'No swap';
    else if (spent && round.swap?.assetDelta) swap = `${formatUnits(spent, 6, { maxFraction: 2 })} USDC → ${eth(round.swap.assetDelta, 6)} ETH`;
    return {
      slug: round.slug,
      round: `Round ${round.roundId}`,
      selected: round.winner.isHold ? 'Hold' : `${round.winner.name} · ${percentFromBps(round.winner.allocationBps)} ETH`,
      swap,
      result: shortReturnX18(round.realisedReturnX18) ?? '—',
      saved: round.date ?? '—',
    };
  });
}

/** The latest saved round of a stack that actually swapped; the Original Safe's executed slippage comes from it. */
export function lastSwapRound(rounds) {
  return [...(rounds ?? [])].reverse().find((item) => item.swap) ?? null;
}
