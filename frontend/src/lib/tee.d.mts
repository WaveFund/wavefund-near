export type TeeProof = { proposalId: string; name: string; proposalBound: boolean; transactionHash: string; trustBasis?: string; privacy: { schemaVersion: number; verified: boolean; signatureKind: string; responseSha256: string; requestSha256: string; model: string; [key: string]: unknown } };
export declare const TEE_CHECKS: ReadonlyArray<readonly string[]>;
export declare function teeDisplay(value: unknown): { verified: boolean; checks: Array<{ key: string; label: string; detail: string; ok: boolean }>; model: string | null };
