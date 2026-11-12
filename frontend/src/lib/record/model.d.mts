// Type declarations for model.mjs (plain ESM so `node --test` exercises the exact UI logic).

export type AgentReputation = {
  score: string; samples: string; positive: string; negative: string; flat: string;
  blockNumber: string; blockTimestamp: string; hasEvaluatedStrategies: boolean;
};
export type ReputationAgent = { name: string; address: string | null; status: 'ok' | 'unavailable'; code: string | null; reputation: AgentReputation | null };
export type ReputationStack = { id: 'original' | 'tidepool'; label: string; engine: string | null };
export type ReputationBoard = {
  label: 'Outcome reputation'; stack: ReputationStack | null; contract: string | null; observedAt: number | null; notCreditScore: boolean; selectionWinsIncluded: false;
  status: 'ok' | 'partial' | 'unavailable'; agents: ReputationAgent[];
};
export type ReputationState = 'loading' | 'unavailable' | 'stale' | 'no-history' | 'scored';

export type RoundProposal = { id: string; name: string; allocationBps: number; rationale: string };
export type RoundForecaster = { name: string; action: 'buy' | 'abstain' | 'unknown'; side: 'long' | 'short' | null; proposalId: string | null; reason: string | null; scripted: boolean; credits: string | null };
export type RoundPayout = { name: string; deposit: string | null; payout: string | null; profitLoss: string | null };
export type RoundTransaction = { label: string; transactionHash: string; blockNumber: string; url: string | null };
export type RoundMarket = { tradingStart: string; tradingEnd: string; evaluationEnd: string; twapWindowSeconds: string; returnBounds: { minX18: string; maxX18: string }; longPayoutX18: string };
export type RoundStack = { id: 'original' | 'tidepool'; label: string; engine: string; safe: string | null; reputation: string | null };
export type TestnetRound = {
  slug: string; roundId: string; stack: RoundStack; evidence: 'saved-independently-verified' | 'unlabelled';
  collateral: { atCollapse: string; ending: string; seed: string } | null;
  totals: { deposits: string | null; paid: string | null }; title: string; date: string | null; kind: string | null;
  genuineModelCalls: number | null; scriptedForecasters: number | null; model: string | null; attestationVerified: boolean;
  proposals: RoundProposal[]; winner: RoundProposal & { isHold: boolean }; forecasters: RoundForecaster[];
  swap: { transactionHash: string; url: string | null; stableDelta: string | null; assetDelta: string | null; independentlyChecked: boolean; slippageBps: number | null } | null;
  market: RoundMarket | null;
  realisedReturnX18: string | null; payouts: RoundPayout[]; transactions: RoundTransaction[]; droppedTransactions: number;
  reputation: { agent: string; score: string; transactionHash: string; url: string | null } | null;
  checks: { independentPassed: boolean; returnRecomputed: boolean; payoutsRecomputed: boolean; swapChecked: boolean | null };
  scope: string | null; correction: string | null; limitations: string[];
};

export declare const STALE_AFTER_SECONDS: number;
export declare function isSignedInteger(value: unknown): value is string;
export declare function formatPoints(score: unknown): string | null;
export declare function formatReturnX18(x18: unknown): string | null;
export declare function formatSignedUnits(raw: unknown, decimals: number): string | null;
export declare function validateReputationBoard(input: unknown): { ok: true; board: ReputationBoard } | { ok: false; error: string };
export declare function snapshotStale(options: { receivedAt: number | null; now: number }): boolean;
export declare function reputationState(agent: ReputationAgent | null | undefined, options?: { stale?: boolean }): ReputationState;
export declare const STATE_LABELS: Readonly<Record<ReputationState, string>>;
export declare const REPUTATION_CODE_TEXT: Readonly<Record<string, string>>;
export declare function reputationCodeText(code: unknown): string;
export declare function validateRoundEvidence(input: unknown): { ok: true; rounds: TestnetRound[] } | { ok: false; error: string };
export declare function findRound(rounds: TestnetRound[] | null, param: string): { round: TestnetRound | null; ambiguous: boolean };
export declare function exactFactorX18(x18: unknown): string | null;
