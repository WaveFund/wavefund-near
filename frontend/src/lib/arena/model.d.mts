// Type declarations for model.mjs.
import type { RoundMarket, TestnetRound } from '../record/model.mjs';
import type { TidepoolDemo } from '../tidepool/model.mjs';

export type StageId = 'funded' | 'proposals' | 'forecasting' | 'selected' | 'executed' | 'evaluated' | 'redeemed';
export type StageStatus = 'done' | 'current' | 'upcoming' | 'halted';
export type StageInfo = { id: StageId; label: string; question: string };
export type JourneyStage = StageInfo & { status: StageStatus; summary: string | null };
export type TxGroups<T> = Record<'setup' | StageId, T[]>;

export type LocalProposal = { id: string; name: string; label: string; allocationBps: number; rationale: string; twapX18: string | null };
export type LocalReceiptLike = { label: string; hash: string; status: string; blockNumber: string | null };

export type LocalJourney = {
  mode: 'local'; progress: number; halted: boolean; running: boolean; complete: boolean; funded: boolean; winnerId: string | null; isHold: boolean; evaluated: boolean;
  proposals: LocalProposal[]; receipts: TxGroups<LocalReceiptLike>; returnX18: string | null; longPayoutX18: string | null; stages: JourneyStage[];
};
export type SavedJourney = {
  mode: 'saved'; progress: 7; halted: false; running: false; complete: true; funded: true; winnerId: string; isHold: boolean; evaluated: boolean;
  linkedDemo: TidepoolDemo | null; transactions: TxGroups<TestnetRound['transactions'][number]>; returnX18: string | null; longPayoutX18: string | null; stages: JourneyStage[];
};

export type SelectionSignals = { holdPercent: number; thresholdPercent: number; winnerId: string; rows: Array<{ id: string; isHold: boolean; percent: number | null; qualifies: boolean }> };
export type Position = { name: string; credits: string | null; scripted: boolean };
export type PositionGroups = { groups: Array<{ proposalId: string; long: Position[]; short: Position[] }>; abstained: Array<{ name: string; reason: string | null; scripted: boolean }>; positions: number };

export declare const QUALIFYING_MARGIN_X18: bigint;
export declare const STAGES: readonly StageInfo[];
export declare const STAGE_INDEX: Readonly<Record<StageId, number>>;
export declare function percentFromBps(bps: number): string | null;
export declare function shortReturnX18(x18: unknown): string | null;
export declare function returnOnScale(x18: unknown, bounds: { minX18: string; maxX18: string } | null | undefined): number | null;
export declare function shortDuration(seconds: number | null): string | null;
export declare function roundWindows(market: RoundMarket | null | undefined): { trading: string | null; evaluation: string | null; twap: string | null } | null;
export declare function localReceiptStage(label: unknown): 'carry' | 'setup' | StageId;
export declare function groupLocalReceipts<T extends { label: string }>(receipts: T[] | null | undefined): TxGroups<T>;
export declare function localJourney(state: unknown): LocalJourney;
export declare function selectionSignals(proposals: Array<{ id: string | number; twapX18?: string | null }> | null | undefined): SelectionSignals | null;
export declare function savedTxStage(label: unknown): 'setup' | StageId;
export declare function describeSavedTx(label: unknown): string;
export declare function groupSavedTransactions<T extends { label: string }>(transactions: T[] | null | undefined): TxGroups<T>;
export declare function savedJourney(round: TestnetRound, demo?: TidepoolDemo | null): SavedJourney;
export declare function positionGroups(proposals: Array<{ id: string | number }>, forecasters: Array<{ name: string; action: string; side?: string | null; proposalId?: string | null; credits?: string | null; reason?: string | null; scripted?: boolean }>): PositionGroups;

export type StageSelection = 'result' | StageId;
export type RoundSummary = { isHold: boolean; selectedName: string; allocation: string | null; measured: string | null; trades: number; tradesText: string; strategies: number };
export type ParticipantView = {
  name: string; scripted: boolean; deposit: string | null; redeemed: string | null; net: string | null; abstained: boolean; reason: string | null;
  position: { side: 'long' | 'short'; strategy: string; credits: string | null } | null;
};
export declare const HOLD_APPLIED: string;
export declare const HOLD_AWAITING: string;
export declare const RESULT_STAGE: 'result';
export declare function defaultStage(journey: { complete: boolean; running: boolean; stages: JourneyStage[] } | null | undefined): StageSelection;
export declare function stageOrder(journey: { complete: boolean } | null | undefined): StageSelection[];
export declare function resolveStage(requested: unknown, journey: { complete: boolean } | null | undefined): StageSelection | null;
export declare function stepStage(current: StageSelection, delta: number): StageId | null;
export declare function roundSummary(round: TestnetRound): RoundSummary;
export declare function settlementShares(longPayoutX18: unknown): { long: string; short: string } | null;
export declare function participantViews(round: TestnetRound): ParticipantView[];
export declare function localWorkspaceAccess(state: { mode?: string; chainId?: number; stage?: string; running?: boolean } | null | undefined, status?: { loading?: boolean; error?: string | null }): { available: boolean; reason: string; canStart: boolean };
