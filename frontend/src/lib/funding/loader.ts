import { apiUrl } from "@/lib/state";
import { compareRaw, safeText, validateFundingConfig, validatePreview, type FundingConfig, type FundingPreview } from "@/lib/funding/model.mjs";
import { fixtureConfig, fixturePreview, fixtureScenarios, type FixtureScenario } from "@/lib/funding/fixtures.mjs";

// Injected funding data source. The API loader talks only to the local loopback API; the fixture loader is an
// explicitly labelled, in-browser stand-in until Developer A's service is wired. Both return validated data.

export type FundingSource = "api" | "fixture";
export type LoadedRecord = { record: unknown; receivedAt: number };

export interface FundingLoader {
  readonly source: FundingSource;
  config(): Promise<FundingConfig>;
  preview(routeId: string, amountIn: string, config: FundingConfig): Promise<FundingPreview>;
  record(fundingId: string): Promise<LoadedRecord>;
  scenarios(): FixtureScenario[];
}

export class FundingApiUnavailable extends Error {
  readonly reason: "offline" | "not-configured";
  constructor(message: string, reason: "offline" | "not-configured") {
    super(message);
    this.name = "FundingApiUnavailable";
    this.reason = reason;
  }
}

const FUNDING_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
// Endpoint names under /api/funding/ that can never be record ids.
const RESERVED_IDS = new Set(["config", "preview", "quote", "submitted"]);
export const nowSeconds = () => Math.floor(Date.now() / 1000);
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function requestJson(path: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const response = await fetch(apiUrl(path), { cache: "no-store", credentials: "omit", ...init, signal: AbortSignal.timeout(20_000) });
  let body: unknown = null;
  try { body = await response.json(); } catch { body = null; }
  return { status: response.status, body };
}

function apiMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "error" in body) return safeText((body as { error: unknown }).error, 240) ?? fallback;
  return fallback;
}

export function createApiFundingLoader(): FundingLoader {
  return {
    source: "api",
    async config() {
      let result: { status: number; body: unknown };
      try { result = await requestJson("/api/funding/config"); } catch { throw new FundingApiUnavailable("The local API did not respond.", "offline"); }
      if (result.status === 404) throw new FundingApiUnavailable("The local API is running without the funding read model.", "not-configured");
      if (result.status !== 200) throw new Error(apiMessage(result.body, "The funding configuration could not be loaded."));
      const checked = validateFundingConfig(result.body);
      if (!checked.ok) throw new Error(checked.error);
      return checked.config;
    },
    async preview(routeId, amountIn, config) {
      const result = await requestJson("/api/funding/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ routeId, amountIn }) });
      if (result.status !== 200) throw new Error(apiMessage(result.body, "The dry quote could not be previewed."));
      const checked = validatePreview(result.body, config);
      if (!checked.ok) throw new Error(checked.error);
      return checked.preview;
    },
    async record(fundingId) {
      if (!FUNDING_ID.test(fundingId)) throw new Error("Funding ids use letters, digits, dot, dash, underscore or colon.");
      if (RESERVED_IDS.has(fundingId)) throw new Error("That name is reserved by the funding API and is not a funding id.");
      const result = await requestJson(`/api/funding/${encodeURIComponent(fundingId)}`);
      if (result.status !== 200) throw new Error(apiMessage(result.body, "The funding record could not be loaded."));
      return { record: result.body, receivedAt: nowSeconds() };
    },
    scenarios: () => [],
  };
}

export function createFixtureFundingLoader(): FundingLoader {
  const catalogue = fixtureScenarios(nowSeconds());
  return {
    source: "fixture",
    async config() {
      const checked = validateFundingConfig(fixtureConfig(nowSeconds()));
      if (!checked.ok) throw new Error(checked.error);
      return checked.config;
    },
    async preview(routeId, amountIn, config) {
      const route = config.routes.find((item) => item.routeId === routeId);
      if (!route) throw new Error("That funding route is not available.");
      const belowMinimum = compareRaw(amountIn, route.minimumAmountIn); const aboveMaximum = compareRaw(amountIn, route.maximumAmountIn);
      if (belowMinimum === null || belowMinimum === -1) throw new Error("The amount is below the observed bridge minimum for this route.");
      if (aboveMaximum === null || aboveMaximum === 1) throw new Error("The amount is above the preview limit for this route.");
      await pause(700);
      const checked = validatePreview(fixturePreview(config, routeId, amountIn, nowSeconds()), config);
      if (!checked.ok) throw new Error(checked.error);
      return checked.preview;
    },
    async record(fundingId) {
      // Regenerated relative to "now" so countdowns and staleness stay meaningful during a demo.
      const found = fixtureScenarios(nowSeconds()).find((scenario) => scenario.id === fundingId);
      if (!found) throw new Error("No fixture scenario has that id.");
      await pause(150);
      return { record: found.record, receivedAt: nowSeconds() };
    },
    scenarios: () => catalogue,
  };
}
