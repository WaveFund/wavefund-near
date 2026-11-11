// Type declarations for model.mjs (kept as plain ESM so `node --test` exercises the exact UI logic).

export declare const AURORA_MAINNET: 1313161554;
export declare const AURORA_TESTNET: 1313161555;

export type NetworkInfo = { chainId: number; name: string; short: string; explorer: string; testnet: boolean };
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
  readiness?: { chainId: number | null; safe: string | null; consumedAt: number | null } | null;
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
