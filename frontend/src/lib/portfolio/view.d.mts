import type { TestnetRound } from "../record/model.mjs";
import type { TidepoolDemo } from "../tidepool/model.mjs";

export type SafeId = "tidepool" | "original" | "local";
export type TabId = "overview" | "funding" | "history" | "permissions";
export declare const SAFE_IDS: SafeId[];
export declare const TAB_IDS: TabId[];
export declare const DEFAULT_SAFE: SafeId;
export declare const DEFAULT_TAB: TabId;
export declare function parseSafeParam(value: unknown, options?: { localAllowed?: boolean }): SafeId;
export declare function parseTabParam(value: unknown): TabId;
export declare function safeOptions(options?: { localAllowed?: boolean }): Array<{ id: SafeId; label: string }>;
export declare function stackRounds(rounds: TestnetRound[] | null | undefined, safe: SafeId): TestnetRound[];

export type Holdings = {
  status: "loading" | "saved" | "live" | "unavailable" | "not-in-evidence";
  rows: Array<{ symbol: string; text: string | null }>;
  caption: string | null;
  value: { text: string; note: string | null } | null;
};
export type LocalBalances = { stableBalance: string | null; assetBalance: string | null; valueUsdX18?: string | null };
export declare function holdingsFor(input: { safe: SafeId; demo?: TidepoolDemo | null; latestSaved?: TestnetRound | null; local?: LocalBalances | null }): Holdings;

export type Inspection = { chainId: number; owners: string[]; threshold: number; moduleEnabled: boolean; maxSlippageBps: number; oracle: { usable: boolean }; activeRoundId: string; unsignedOnly: boolean };
export type PermissionCheck = { label: string; value: string; state: "ok" | "warn" | "info" | "unknown" };
export declare function permissionChecks(input: { safe: SafeId; inspection?: Inspection | null; latestSaved?: TestnetRound | null; swapRound?: TestnetRound | null }): PermissionCheck[];

export type HistoryRow = { slug: string; round: string; selected: string; swap: string; result: string; saved: string };
export declare function historyRows(rounds: TestnetRound[] | null | undefined): HistoryRow[];
export declare function lastSwapRound(rounds: TestnetRound[] | null | undefined): TestnetRound | null;
