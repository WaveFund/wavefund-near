export const REPUTATION_CHAIN_ID: number;
export type ReputationStack = { id: "original" | "tidepool"; label: string; manifest: string };
export const REPUTATION_STACKS: { original: ReputationStack; tidepool: ReputationStack };
export const TRUSTED_PROPOSERS: ReadonlyArray<{ name: string; address: string }>;
export function createReputationBoard(options: { reader: { read(agent: string): Promise<unknown> }; manifest?: unknown; stack?: ReputationStack; proposers?: ReadonlyArray<{ name: string; address: string }>; clock?: () => number; nowMs?: () => number; cacheMs?: number }): { read(): Promise<unknown> };
