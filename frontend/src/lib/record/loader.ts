import { apiUrl } from "@/lib/state";
import { safeText } from "@/lib/funding/model.mjs";
import { validateReputationBoard, validateRoundEvidence, type ReputationBoard, type TestnetRound } from "@/lib/record/model.mjs";

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

export async function loadReputation(): Promise<ReputationBoard> {
  const checked = validateReputationBoard(await getJson("/api/agents/reputation"));
  if (!checked.ok) throw new RecordUnavailable(checked.error, "invalid");
  return checked.board;
}

export async function loadRoundEvidence(): Promise<TestnetRound[]> {
  const checked = validateRoundEvidence(await getJson("/api/evidence/testnet-rounds"));
  if (!checked.ok) throw new RecordUnavailable(checked.error, "invalid");
  return checked.rounds;
}
