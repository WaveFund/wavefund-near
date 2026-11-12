// Type declarations for model.mjs.
export type TidepoolDemo = {
  evidence: 'saved-independently-verified' | 'unlabelled'; official1Click: false; method: string | null; note: string | null;
  token: { address: string; symbol: string; decimals: number; label: string };
  contracts: { safe: string; engine: string; reputation: string; investmentPair: string };
  funding: { sourceAmount: string; deliveredAmount: string; bridgeCost: string; sourceTransaction: { hash: string; blockNumber: string | null }; destinationTransaction: { hash: string; blockNumber: string | null }; safeBalance: { before: string | null; after: string | null } };
  provider: { name: string; reportedStatus: string | null; reportedAt: string | null };
  nearSettlement: { hash: string; receiver: string; url: string | null };
  quote: { signatureVerified: true; signer: string; recipient: string; virtualChainRecipient: null };
  strategy: { roundId: string | null; roundSlug: string };
  swap: { hash: string; blockNumber: string | null; stableIn: string; assetOut: string; stableAfter: string | null };
};
export type FreshCheck = { status: 'verified'; observedAt: number; deliveredAmount: string; providerStatus: string | null } | { status: 'mismatch' | 'unavailable'; code: string; observedAt: number | null };
export declare function nearTestnetTxUrl(hash: unknown): string | null;
export declare function validateTidepoolDemo(input: unknown): { ok: true; demo: TidepoolDemo } | { ok: false; error: string };
export declare function validateFreshCheck(input: unknown): FreshCheck;
