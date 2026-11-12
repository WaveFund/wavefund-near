import { apiUrl } from "@/lib/state";
import { safeText } from "@/lib/funding/model.mjs";
import { validateReputationBoard, validateRoundEvidence, type ReputationBoard, type TestnetRound } from "@/lib/record/model.mjs";
import { validateFreshCheck, validateTidepoolDemo, type FreshCheck, type TidepoolDemo } from "@/lib/tidepool/model.mjs";

// Reads the two read-only record endpoints from the local loopback API. A 404 means the capability is not enabled,
// which is shown differently from an offline API or a malformed response.

export class RecordUnavailable extends Error {
  readonly reason: "offline" | "not-configured" | "invalid";
  constructor(message: string, reason: "offline" | "not-configured" | "invalid") {
    super(message);
    this.name = "RecordUnavailable";
    this.reason = reason;
  }
}

async function getJson(path: string): Promise<unknown> {
  let response: Response;
  try { response = await fetch(apiUrl(path), { cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(25_000) }); }
  catch { throw new RecordUnavailable("The local API did not respond.", "offline"); }
  if (response.status === 404) throw new RecordUnavailable("This API is running without that read model.", "not-configured");
  let body: unknown = null;
  try { body = await response.json(); } catch { body = null; }
  if (response.status !== 200) {
    const message = body && typeof body === "object" && "error" in body ? safeText((body as { error: unknown }).error, 200) : null;
    throw new RecordUnavailable(message ?? "The read model is unavailable.", "invalid");
  }
  return body;
}

export type ReputationStackId = "original" | "tidepool";
export async function loadReputation(stack: ReputationStackId = "original"): Promise<ReputationBoard> {
  const checked = validateReputationBoard(await getJson(stack === "original" ? "/api/agents/reputation" : "/api/agents/reputation/tidepool"));
  if (!checked.ok) throw new RecordUnavailable(checked.error, "invalid");
  return checked.board;
}

export async function loadRoundEvidence(): Promise<TestnetRound[]> {
  const checked = validateRoundEvidence(await getJson("/api/evidence/testnet-rounds"));
  if (!checked.ok) throw new RecordUnavailable(checked.error, "invalid");
  return checked.rounds;
}

export async function loadTidepoolDemo(): Promise<TidepoolDemo> {
  const checked = validateTidepoolDemo(await getJson("/api/tidepool/demo"));
  if (!checked.ok) throw new RecordUnavailable(checked.error, "invalid");
  return checked.demo;
}

/** Runs the read-only fresh receipt check on demand. Failures come back as an unavailable result, never as verified. */
export async function runTidepoolFreshCheck(): Promise<FreshCheck> {
  try { return validateFreshCheck(await getJson("/api/tidepool/demo/fresh-check")); }
  catch { return { status: "unavailable", code: "FRESH_CHECK_UNAVAILABLE", observedAt: null }; }
}
