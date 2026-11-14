import { resolveApiUrl } from "./api-url.mjs";
export type Receipt = {
  label: string;
  hash: string;
  status: string;
  blockNumber: string | null;
};

export type DemoState = {
  mode: string;
  chainId: number;
  running: boolean;
  stage: string;
  roundId: string | null;
  safe: { address: string; stableBalance: string | null; assetBalance: string | null; valueUsdX18?: string | null };
  forecast: {
    escrow: string | null;
    deposits: string | null;
    payouts?: Array<{ address: string; amount: string }>;
    participants?: Array<{ address: string; name: string; stableBalance: string; initialStableBalance: string; deposit: string; payout: string; profitLoss: string | null }>;
  };
  sponsor: { reserve: string | null };
  proposals: Array<{
    id: string;
    label: string;
    allocationBps: number;
    probabilityX18: string | null;
    twapX18?: string | null;
    rationale: string;
    proposer?: string;
  }>;
  inference?: { mode: string; model: string | null; status: string; evidenceSource?: string; attestationVerified: boolean };
  agentRecords?: Array<{ name: string; role: string; provider: string; model: string; inputHash: string; outputHash: string }>;
  agents: Array<{ name: string; role: string; rationale: string; action?: string; risks?: string[]; evidenceIds?: string[]; forecasts?: Array<{ proposalId: number; expectedReturnBps: number; confidenceBps: number; rationale: string; risks: string[] }> }>;
  receipts: Receipt[];
  messages?: Array<{ timestamp: string; stage: string; message: string }>;
  round?: {
    status?: string | number;
    tradingEnd?: string | null;
    evaluationEnd?: string | null;
    realisedReturnX18?: string | null;
    piX18?: string | null;
    winnerId?: string | number | null;
  };
  error: string | null;
};

export function decodeState(value: unknown): DemoState {
  if (!value || typeof value !== "object") throw new Error("The local API returned an invalid snapshot.");
  const item = value as Partial<DemoState>;
  if (!((item.chainId === 31337 && item.mode === "local-simulation") || (item.chainId === 1313161555 && item.mode === "aurora-testnet-readonly"))) {
    throw new Error("The dashboard only accepts local Anvil or verified Aurora testnet monitoring.");
  }
  if (!item.safe || !item.forecast || !item.sponsor || !Array.isArray(item.proposals) || !Array.isArray(item.agents) || !Array.isArray(item.receipts)) {
    throw new Error("The local API snapshot is incomplete. No balances have been assumed.");
  }
  return item as DemoState;
}

export function apiUrl(path: string): string {
  return resolveApiUrl(path, process.env.NEXT_PUBLIC_API_URL, typeof window === "undefined" ? undefined : window.location.origin);
}

export function units(raw: string | null | undefined, decimals: number, precision = 2): string {
  if (raw == null || !/^\d+$/.test(raw)) return "—";
  const value = BigInt(raw);
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = value % scale;
  const digits = Math.min(precision, decimals);
  const tail = (fraction / (10n ** BigInt(decimals - digits))).toString().padStart(digits, "0");
  return `${whole.toLocaleString("en-US")}${digits ? `.${tail}` : ""}`;
}

export function probability(raw: string | null | undefined): string {
  if (raw == null || !/^\d+$/.test(raw)) return "—";
  const value = BigInt(raw);
  if (value > 10n ** 18n) return "—";
  return `${(Number(value / 10n ** 14n) / 100).toFixed(1)}%`;
}

export function signedUnits(raw: string | null | undefined, decimals: number): string {
  if (raw == null || !/^-?\d+$/.test(raw)) return "—";
  const negative = raw.startsWith("-");
  return `${negative ? "−" : "+"}${units(negative ? raw.slice(1) : raw, decimals)}`;
}

export function returnPercent(raw: string | null | undefined): string {
  if (raw == null || !/^\d+$/.test(raw)) return "—";
  const scaled = (BigInt(raw) - 10n ** 18n) * 10_000n / 10n ** 18n;
  const negative = scaled < 0n;
  const absolute = negative ? -scaled : scaled;
  return `${negative ? "−" : "+"}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, "0")}%`;
}

export function shortAddress(value: string | undefined | null): string {
  if (!value) return "Not deployed";
  return value.length > 16 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

export const PHASES = [
  { id: "opening", label: "Open round", detail: "The owner’s terms are committed." },
  { id: "proposing", label: "Propose", detail: "Compare permitted allocations." },
  { id: "forecasting", label: "Forecast", detail: "Separate collateral backs the views." },
  { id: "selecting", label: "Select", detail: "The final market average selects." },
  { id: "executing", label: "Execute", detail: "The Safe module checks and trades." },
  { id: "evaluating", label: "Measure", detail: "Recorded holdings are valued." },
  { id: "settling", label: "Settle", detail: "Performance fixes the payout." },
  { id: "redeeming", label: "Redeem", detail: "The winning world pays out." },
] as const;

export function phaseIndex(stage: string): number {
  if (["completed", "complete", "redeemed"].includes(stage)) return PHASES.length;
  return PHASES.findIndex((phase) => phase.id === stage);
}
