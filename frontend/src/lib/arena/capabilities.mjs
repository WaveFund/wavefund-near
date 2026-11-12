// What the connected backend can actually do. Screens read capabilities from here instead of guessing from a stage
// string, so a read-only Aurora backend can never present a runnable local round, and an unknown mode disables actions.

export const LOCAL_MODE = 'local-simulation';
export const AURORA_MODE = 'aurora-testnet-readonly';

/** 'local' | 'aurora' | 'offline' | 'loading' | 'unknown' from a decoded /api/state snapshot (or null) plus fetch status. */
export function backendKind(state, { loading = false, error = null } = {}) {
  if (state && typeof state === 'object') {
    if (state.mode === LOCAL_MODE && state.chainId === 31337) return 'local';
    if (state.mode === AURORA_MODE && state.chainId === 1313161555) return 'aurora';
    return 'unknown';
  }
  if (loading && !error) return 'loading';
  return 'offline';
}

const TERMINAL = new Set(['completed', 'complete', 'redeemed', 'failed', 'interrupted']);

/** True only for a local-simulation backend that is idle and not running. Every other case is false. */
export function canStartLocalRound(state) {
  return backendKind(state) === 'local' && state.stage === 'idle' && state.running !== true;
}

/** A local round is running only on a local backend, in a known non-idle, non-terminal stage. Aurora monitoring never counts. */
export function localRoundRunning(state) {
  if (backendKind(state) !== 'local') return false;
  if (state.running === true) return true;
  return typeof state.stage === 'string' && state.stage !== 'idle' && !TERMINAL.has(state.stage);
}

/** Why local simulation is or is not available, as one short line for the context selector. */
export function localAvailability(state, status = {}) {
  const kind = backendKind(state, status);
  if (kind === 'local') return { available: true, reason: canStartLocalRound(state) ? 'Ready to start on a local chain' : localRoundRunning(state) ? 'A local round is running' : 'Local round finished or halted' };
  if (kind === 'aurora') return { available: false, reason: 'The backend is in read-only Aurora testnet mode' };
  if (kind === 'loading') return { available: false, reason: 'Checking the local backend…' };
  if (kind === 'unknown') return { available: false, reason: 'Unrecognised backend mode' };
  return { available: false, reason: 'No local backend is running' };
}
