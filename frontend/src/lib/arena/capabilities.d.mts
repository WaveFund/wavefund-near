// Type declarations for capabilities.mjs.
export type BackendKind = 'local' | 'aurora' | 'offline' | 'loading' | 'unknown';
type Snapshot = { mode?: string; chainId?: number; stage?: string; running?: boolean } | null | undefined;
export const LOCAL_MODE: 'local-simulation';
export const AURORA_MODE: 'aurora-testnet-readonly';
export function backendKind(state: Snapshot, status?: { loading?: boolean; error?: string | null }): BackendKind;
export function canStartLocalRound(state: Snapshot): boolean;
export function localRoundRunning(state: Snapshot): boolean;
export function localAvailability(state: Snapshot, status?: { loading?: boolean; error?: string | null }): { available: boolean; reason: string };
