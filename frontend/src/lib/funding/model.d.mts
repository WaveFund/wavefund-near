// Type declarations for model.mjs (kept as plain ESM so `node --test` exercises the exact UI logic).

export declare const AURORA_MAINNET: 1313161554;
export declare const AURORA_TESTNET: 1313161555;
export declare const ARBITRUM_SEPOLIA: 421614;

export type NetworkInfo = { chainId: number; name: string; short: string; explorer: string | null; testnet: boolean };
export declare const NETWORKS: Readonly<Record<number, NetworkInfo>>;

export type FundingAsset = { chainId: number; assetId: string | null; token: string; decimals: number; symbol: string | null };

export type FundingRoute = {
  routeId: string | null;
  label: string;
  source: FundingAsset;
  destination: FundingAsset;
  minimumAmountIn: string;
  maximumAmountIn: string;
  previewAvailable: boolean;
  approvedForFunding: boolean;
  deliveryProven: boolean;
  minimumConfirmations: number | null;
  notes: string[];
};

export type EligibilityCheck = { id: string; ok: boolean; label: string; detail: string };

/** The strategy stack a round runs on (its Safe and stable token). Display and readiness binding only. */
export type FundingStrategy = { chainId: number; safe: string; token: string; decimals: number; symbol: string | null; source: string | null };

export type FundingConfig = {
  schemaVersion: 1;
  mode: string;
  evidence: 'live' | 'fixture';
  configurationHash: string | null;
  destination: {
    chainId: 1313161554;
    safe: string;
    token: string;
    decimals: 6;
    assetId: string | null;
    symbol: string;
    safeVersion: string | null;
    purpose: string | null;
    wavefundModuleEnabled: boolean;
  };
  manager: string;
  refundRecipient: string;
  routes: FundingRoute[];
  unsupported: Array<{ id: string; label: string; reason: string }>;
  strategy: FundingStrategy | null;
  eligibility: { eligible: boolean; roundChainId: number; checks: EligibilityCheck[] };
  capabilities: { preview: boolean; executableQuote: false; submitted: boolean; records: boolean; signing: false; broadcast: false };
  observedAt: number | null;
};

export type FundingPreview = {
  kind: 'DRY_QUOTE';
  executable: false;
  routeId: string | null;
  evidence: 'live-provider-signed' | 'mocked' | 'fixture';
  signatureVerified: boolean;
  amounts: { amountIn: string; amountOut: string; minAmountOut: string };
  requestMinAmountOut: string | null;
  fees: { refundFee: string | null; withdrawFee: string | null; appFeeBps: number | null; feesSigned: boolean; appFeesSigned: boolean };
  quotedAt: number | null;
  expiresAt: number;
  timeEstimateSeconds: number | null;
  correlationId: string | null;
  payloadSha256: string | null;
};

export type FundingEvidence = {
  requestHash: string | null;
  quoteHash: string | null;
  sourceTransactionHash: string | null;
  transactionHash: string | null;
  chainId: number | null;
  token: string | null;
  recipient: string | null;
  amount: string | null;
  confirmations: number | null;
  observedAt: number | null;
  evidenceQuality: 'live-verified' | 'fixture' | null;
};

export type RecordAsset = { chainId: number | null; assetId: string | null; token: string | null; decimals: number | null };

/** Projection of Developer A's FundingRecordV1 (field names unchanged). */
export type FundingRecordView = {
  origin: 'funding-service' | 'fixture';
  schemaVersion: number | null;
  fundingId: string | null;
  configurationHash?: string | null;
  state: string | null;
  revision?: number | null;
  createdAt?: number | null;
  updatedAt?: number | null;
  reviewReason?: string | null;
  request?: {
    routeId: string | null;
    manager: string | null;
    safe: string | null;
    source: RecordAsset | null;
    destination: RecordAsset | null;
    amountIn: string | null;
    minAmountOut: string | null;
    refundRecipient: string | null;
    expiresAt: number | null;
  } | null;
  requestHash?: string | null;
  quoteHash?: string | null;
  quote?: { reference: string | null; depositAddress: string | null; amountIn: string | null; minAmountOut: string | null; expiresAt: number | null; evidenceQuality: string | null } | null;
  submission?: { reserved: boolean; txHash: string | null; reservedAt: number | null } | null;
  observation?: { source: string | null; status: string | null; observedAt: number | null } | null;
  delivery?: FundingEvidence | null;
  refund?: FundingEvidence | null;
  readiness?: {
    chainId: number | null;
    safe: string | null;
    consumedAt: number | null;
    snapshot?: {
      chainId: number | null; safe: string | null; stableToken: string | null; assetToken: string | null;
      stableBalance: string | null; assetBalance: string | null; compatible: boolean | null; activeRound: boolean | null;
      pendingAuthorization: boolean | null; observedAt: number | null; blockNumber: string | null;
    } | null;
  } | null;
  route?: { minimumConfirmations: number | null; maxObservationAgeSeconds: number | null };
  observedAt: number | null;
  integrity: 'ok' | 'invalid';
  integrityIssues: string[];
};

export type FundingBucket = 'awaiting-manager' | 'submitted' | 'provider-success' | 'delivered' | 'refund-pending' | 'refunded' | 'refund-partial' | 'failed' | 'needs-review' | 'unavailable';
export type FundingTone = 'neutral' | 'progress' | 'success' | 'warning' | 'danger' | 'muted';

export type FundingDisplay = {
  bucket: FundingBucket;
  tone: FundingTone;
  title: string;
  detail: string;
  verified: boolean;
  evidence: 'live' | 'fixture' | 'none';
  doNotPayAgain: boolean;
  stale: boolean;
  lastObservedAt: number | null;
  step: number;
  halted: boolean;
  warnings: string[];
  issues: string[];
};

export declare function isIntegerString(value: unknown): value is string;
export declare function isAddress(value: unknown): value is string;
export declare function isTxHash(value: unknown): value is string;
export declare function network(chainId: unknown): NetworkInfo | null;
export declare function networkName(chainId: unknown): string;
export declare function formatUnits(raw: unknown, decimals: unknown, options?: { maxFraction?: number; minFraction?: number; group?: boolean }): string | null;
export declare function parseUnits(text: string, decimals: number): { ok: true; raw: string } | { ok: false; error: string };
export declare function compareRaw(a: unknown, b: unknown): -1 | 0 | 1 | null;
export declare function percentOf(part: unknown, whole: unknown): string | null;
export declare function safeText(value: unknown, max?: number): string | null;
export declare function shortHex(value: unknown, head?: number, tail?: number): string;
export declare function explorerUrl(chainId: unknown, kind: 'tx' | 'address', value: unknown): string | null;
export declare function formatDuration(seconds: number): string;
export declare function formatAge(seconds: number): string;
export declare function validateFundingConfig(input: unknown): { ok: true; config: FundingConfig } | { ok: false; error: string };
export declare function roundEligibility(config: FundingConfig): { eligible: boolean; sameNetwork: boolean; checks: EligibilityCheck[] };
export declare function validatePreview(input: unknown, config: FundingConfig): { ok: true; preview: FundingPreview } | { ok: false; error: string };
export declare const REVIEW_REASONS: Readonly<Record<string, string>>;
export declare function reviewReasonText(code: unknown): string;
export declare function requiredConfirmations(record: FundingRecordView, config: FundingConfig): number | null;
export declare function evidenceFailures(kind: 'delivery' | 'refund', record: FundingRecordView, config: FundingConfig): string[];
export declare function classifyFunding(record: unknown, options: { config: FundingConfig; now: number; receivedAt?: number }): FundingDisplay;
export declare const BUCKET_LABELS: Readonly<Record<FundingBucket, string>>;

export type LaneId = 'official' | 'tidepool' | 'fixtures';
export type LaneInfo = { id: LaneId; kind: 'official' | 'community' | 'fixture'; title: string; provider: string; chainId: number | null; network: string; assets: string };
export type LaneStatus = { tone: 'live' | 'fixture' | 'warning' | 'danger' | 'muted' | 'neutral'; label: string; detail: string };
export declare const LANE_ORDER: readonly LaneId[];
export declare const FUNDING_LANES: Readonly<Record<LaneId, LaneInfo>>;
export declare function laneFromSearch(search: string): LaneId;
export declare function laneStatus(id: LaneId, context?: { source?: 'api' | 'fixture' | null; phase?: string | null; config?: FundingConfig | null }): LaneStatus;

export type SummaryTone = 'success' | 'fixture' | 'progress' | 'neutral' | 'warning' | 'danger' | 'muted';
export type DeliverySummary = { state: 'none' | 'verified' | 'fixture' | 'in-transit' | 'not-sent' | 'refund' | 'unconfirmed'; tone: SummaryTone; label: string; detail: string };
export declare function deliverySummary(display: FundingDisplay | null): DeliverySummary;
export type StrategyReadiness = {
  state: 'unknown' | 'not-delivered' | 'blocked' | 'awaiting-service' | 'rejected' | 'fixture' | 'ready';
  tone: SummaryTone; label: string; detail: string; failures: string[]; ready: boolean;
};
export declare const READINESS_FAILURES: Readonly<Record<string, string>>;
export declare function strategyReadiness(record: unknown, display: FundingDisplay | null, config: FundingConfig | null): StrategyReadiness;

export type LadderStep = { id: 'minted' | 'delivered' | 'ready'; title: string; detail: string; owner: string; state: 'not-tracked' | 'not-connected'; label: string };
export declare function tidepoolLadder(): LadderStep[];
