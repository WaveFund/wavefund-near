import type { Provenance, RoundForecaster, RoundProposal, TeeStatusId, TestnetRound } from './model.mjs';

export declare const TEE_LABELS: Readonly<Record<TeeStatusId, string>>;
export declare const TEE_TIPS: Readonly<Record<TeeStatusId, string>>;
export declare const PROVIDER_LABELS: Readonly<Record<'near-ai' | 'scripted', string>>;
export declare const SCRIPTED_TEXT: string;
export declare const UNKNOWN_TEXT: string;
export declare function shortModel(id: unknown): string | null;
export type ProvenanceLine = {
  kind: 'model' | 'scripted' | 'unknown'; text: string; model: string | null; fullModel: string | null; provider: string | null;
  tee: TeeStatusId | null; teeLabel: string | null; proof: 'tee' | 'record' | null;
};
export declare function provenanceLine(prov: Provenance | null | undefined): ProvenanceLine;
export declare function doesNotProve(tee: TeeStatusId): string[];
export type RecordClaim = { id: string; label: string; value: string; mono?: boolean; copy?: string | null; href?: string | null; keys: string[] };
export type RecordProofView = {
  title: string; claims: RecordClaim[]; notProven: string[]; json: string;
  rows: Array<{ n: number; text: string; key: string | null }>; truncated: boolean; evidenceUrl: string | null;
};
export declare function recordProofView(round: TestnetRound | null | undefined, agent: RoundProposal | RoundForecaster | null | undefined, role: 'proposer' | 'forecaster'): RecordProofView | null;
export declare function roundProvenance(round: TestnetRound): { models: string[]; verified: number; challengers: number; tee: TeeStatusId | 'partial' };
export declare function savedRoundForLive(rounds: TestnetRound[] | null | undefined, roundId: string | null | undefined, proposals: Array<{ id: string; name: string; allocationBps: number }> | null | undefined): TestnetRound | null;
