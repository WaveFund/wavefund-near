import type { SelectionSignals, StageId } from './model.mjs';

export type LiveStageStatus = 'done' | 'current' | 'upcoming' | 'halted';
export type LiveProposal = { id: string; name: string; allocationBps: number; rationale: string; proposer: string | null; priceX18: string | null; twapX18: string | null };
export type LiveCountdown = { kind: 'trading' | 'evaluation'; target: string; done: string; seconds: number | null };
export type LiveRound = {
  roundId: string; status: 1 | 2 | 3 | 4; phase: string; settled: boolean; cancelled: boolean; live: boolean; current: StageId;
  stages: Array<{ id: StageId; label: string; status: LiveStageStatus }>; countdown: LiveCountdown | null; tradingOpen: boolean; tradingEnd: number | null; evaluationEnd: number | null;
  proposals: LiveProposal[]; challengers: number; winnerId: string | null; isHold: boolean; realisedReturnX18: string | null; piX18: string | null; note: string | null;
};
export declare const AURORA_MODE: 'aurora-testnet-readonly';
export declare const ROUND_STATUS: Readonly<{ none: 0; trading: 1; collapsed: 2; settled: 3; cancelled: 4 }>;
export declare const LIVE_STAGES: ReadonlyArray<{ id: StageId; label: string }>;
export declare function secondsUntil(endSeconds: number, nowMs: number): number | null;
export declare function formatCountdown(total: number): string | null;
export declare function liveStageFor(input: { status: number; tradingEnd: number | null; evaluationEnd: number | null; nowSec: number; challengers?: number }): StageId | null;
export declare function isLiveNow(state: unknown): boolean;
export declare function liveRound(state: unknown, nowMs: number): LiveRound | null;
export declare function liveSignals(view: LiveRound | null): { basis: string; final: boolean; signals: SelectionSignals } | null;
export declare function defaultLiveStage(view: LiveRound | null): StageId | null;
