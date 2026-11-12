"use client";

import type { ReactNode } from "react";
import {
  evidenceFailures, formatAge, formatUnits, isTxHash, networkName, percentOf, requiredConfirmations, reviewReasonText, safeText,
  type FundingConfig, type FundingDisplay, type FundingRecordView, type FundingTone,
} from "@/lib/funding/model.mjs";
import { Address, Amount, CopyText, ExplorerLink, Icon } from "./primitives";
import { Badge, EmptyState, Notice, Timeline, type TimelineItem, type TimelineState, type Tone } from "@/components/ui";

const TONE: Record<FundingTone, Tone> = { success: "success", danger: "danger", warning: "warning", progress: "info", neutral: "neutral", muted: "neutral" };
const num = (value: unknown): number | null => (Number.isSafeInteger(value) && (value as number) > 0 ? (value as number) : null);
const asRecord = (value: unknown): FundingRecordView | null => (value && typeof value === "object" && !Array.isArray(value) ? (value as FundingRecordView) : null);

function outcomeFor(display: FundingDisplay): { title: string; state: TimelineState; detail: string } {
  switch (display.bucket) {
    case "delivered": return { title: display.verified ? "Delivery verified on Aurora" : "Delivery evidence complete", state: "done", detail: display.verified ? "Bound, final Aurora receipt to the Safe." : "Complete evidence, but fixture data, not live." };
    case "refunded": return { title: "Refund recorded", state: "done", detail: display.verified ? "Verified refund receipt to the manager wallet." : "Fixture refund evidence." };
    case "refund-partial": return { title: "Partial refund · needs reconciliation", state: "halted", detail: "The actual returned amount is shown below." };
    case "refund-pending": return { title: "Refund receipt not yet verified", state: "halted", detail: "Not shown as refunded until verified." };
    case "failed": return { title: "Provider failure · not a refund", state: "halted", detail: "Funds are not shown as returned." };
    case "needs-review": return { title: "Needs operator review", state: "halted", detail: "No automatic retry, release or cancellation." };
    case "unavailable": return { title: "Status unavailable", state: "halted", detail: "Missing or invalid information is never treated as success." };
    case "submitted":
    case "provider-success": return { title: "Waiting for a verified Aurora receipt", state: "current", detail: "Delivery needs a bound receipt with enough confirmations." };
    default: return { title: "Delivery or refund", state: "upcoming", detail: "Shown only from verified receipts." };
  }
}

function steps(view: FundingRecordView, display: FundingDisplay, now: number, live: boolean): TimelineItem[] {
  const state = view.state;
  const quote = view.quote ?? null; const submission = view.submission ?? null; const observation = view.observation ?? null;
  const sourceChain = num(view.request?.source?.chainId);
  const sourceDecimals = view.request?.source?.decimals ?? null; const destinationDecimals = view.request?.destination?.decimals ?? null;
  const quoteExpiry = num(quote?.expiresAt);
  const expired = state === "quoted" && quoteExpiry !== null && now > 0 && now >= quoteExpiry;
  const tx = isTxHash(submission?.txHash) ? (submission?.txHash as string) : null;
  const broadcastUnknown = view.reviewReason === "BROADCAST_UNKNOWN";
  const observed = safeText(observation?.status, 24);
  const outcome = outcomeFor(display);
  const age = (value: unknown) => { const t = num(value); return t && now ? formatAge(now - t) : undefined; };
  return [
    { key: "quote", title: "Executable quote recorded", state: quote ? "done" : "upcoming", time: age(view.createdAt),
      detail: quote ? <>Send exactly <Amount raw={view.request?.amountIn} decimals={sourceDecimals} symbol="USDC" /> · signed minimum <Amount raw={quote.minAmountOut} decimals={destinationDecimals} symbol="USDC" /></> : "No executable quote" },
    { key: "reserve", title: "Wallet send reserved", state: submission?.reserved ? "done" : state === "quoted" ? (expired ? "halted" : "current") : "upcoming", time: age(submission?.reservedAt),
      detail: submission?.reserved ? "Reserved before any wallet prompt" : expired ? "Quote expired before sending · do not reuse its deposit address" : "Awaiting manager · sending is disabled in this build" },
    { key: "source", title: "Source transaction recorded", state: tx ? "done" : broadcastUnknown ? "halted" : state === "dispatching" ? "current" : "upcoming",
      detail: tx ? <span className="tx-inline"><CopyText value={tx} label="source transaction" /><ExplorerLink chainId={sourceChain} kind="tx" value={tx} enabled={live} /><small className="subtle">&nbsp;{networkName(sourceChain)}</small></span>
        : broadcastUnknown ? "Unknown whether the wallet broadcast. Reconcile on-chain first." : "Not recorded yet" },
    { key: "observe", title: "Provider status", state: observed ? "done" : tx ? "current" : "upcoming", time: age(observation?.observedAt),
      detail: observed ? <><code>{observed}</code> · unverified provider report</> : "No provider status yet" },
    { key: "outcome", title: outcome.title, state: outcome.state, detail: outcome.detail, time: age(display.bucket === "delivered" ? view.delivery?.observedAt : view.refund?.observedAt) },
  ];
}

function Evidence({ kind, view, config, live }: { kind: "delivery" | "refund"; view: FundingRecordView; config: FundingConfig; live: boolean }) {
  const item = kind === "delivery" ? view.delivery : view.refund;
  if (!item || typeof item !== "object") return null;
  const failures = new Set(evidenceFailures(kind, view, config));
  const request = view.request ?? null;
  const decimals = kind === "delivery" ? request?.destination?.decimals ?? null : request?.source?.decimals ?? null;
  const required = requiredConfirmations(view, config);
  const confirmations = Number.isSafeInteger(item.confirmations) ? (item.confirmations as number) : null;
  const tx = isTxHash(item.transactionHash) ? (item.transactionHash as string) : null;
  const chainId = num(item.chainId);
  const rows: Array<{ label: string; ok: boolean; value: ReactNode }> = [
    { label: "Network", ok: !failures.has("WRONG_NETWORK"), value: networkName(chainId) },
    { label: "Receipt", ok: !failures.has("TRANSACTION_MISSING"), value: tx ? <span className="tx-inline"><CopyText value={tx} label="receipt" /><ExplorerLink chainId={chainId} kind="tx" value={tx} enabled={live} /></span> : <span className="unavailable">Unavailable</span> },
    { label: kind === "delivery" ? "Recipient (the Safe)" : "Recipient (manager wallet)", ok: !failures.has("WRONG_RECIPIENT"), value: <Address value={item.recipient} chainId={chainId} label="recipient" live={live} /> },
    { label: "Asset", ok: !failures.has("WRONG_TOKEN"), value: <Address value={item.token} chainId={chainId} label="token" live={live} /> },
    { label: kind === "delivery" ? "Amount vs signed minimum" : "Amount vs amount sent", ok: !["AMOUNT_MISSING", "BELOW_MINIMUM", "REFUND_EXCEEDS_INPUT"].some((code) => failures.has(code)),
      value: <><Amount raw={item.amount} decimals={decimals} symbol="USDC" /><small className="subtle">&nbsp;{kind === "delivery" ? `min ${formatUnits(view.quote?.minAmountOut, request?.destination?.decimals) ?? "?"}` : `${percentOf(item.amount, request?.amountIn) ?? "—"} of sent`}</small></> },
    { label: "Confirmations", ok: !failures.has("NOT_FINAL") && !failures.has("CONFIRMATION_POLICY_UNKNOWN"), value: <span className="tnum">{confirmations ?? "—"} / {required ?? "policy unknown"}</span> },
    { label: "Bound to request and quote", ok: !["REQUEST_NOT_BOUND", "QUOTE_NOT_BOUND", "SOURCE_TRANSACTION_NOT_LINKED"].some((code) => failures.has(code)), value: "Request · quote · source tx" },
    { label: "Evidence quality", ok: !failures.has("EVIDENCE_QUALITY_MISMATCH"), value: safeText(item.evidenceQuality, 20) ?? <span className="unavailable">Unavailable</span> },
  ];
  return <div className="evidence">
    <h4 className="mini-title">{kind === "delivery" ? "Aurora delivery receipt" : "Refund receipt"}</h4>
    <dl className="dl evidence-dl">{rows.map((row) => <div key={row.label} className={row.ok ? "ok" : "bad"}><dt><Icon name={row.ok ? "check" : "cross"} />{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
  </div>;
}

export function StatusTracker({ record, display, config, now, loading, scenarioLabel, children }: { record: unknown; display: FundingDisplay | null; config: FundingConfig; now: number; loading: boolean; scenarioLabel?: string | null; children?: ReactNode }) {
  const view = asRecord(record);
  const live = display?.evidence === "live";
  const head = <header className="card-header">
    <div><h2><Icon name="receipt" />Transfer status</h2><p>{view && display ? <>Record <code>{safeText(view.fundingId, 48) ?? "unavailable"}</code>{scenarioLabel ? ` · ${scenarioLabel}` : ""}</> : "Every step is proven by a receipt, never by a status message alone."}</p></div>
    <div className="page-actions">{loading ? <span className="spinner" aria-label="Loading" /> : display ? <>
      {display.verified ? <Badge tone="success"><Icon name="check" />Verified</Badge> : null}
      {display.evidence === "fixture" ? <Badge tone="warning">Fixture</Badge> : display.evidence === "live" ? <Badge tone="info">Live service</Badge> : null}
    </> : null}</div>
  </header>;
  if (!view || !display) {
    return <section className="card tracker" aria-live="polite" aria-busy={loading}>
      {head}
      <EmptyState icon="receipt" title="No transfer yet">A transfer appears once the funding service records an executable quote and a manager-submitted transaction. Sending is disabled in this build, so nothing can be created from this page.</EmptyState>
      {children}
    </section>;
  }
  const inFlight = display.doNotPayAgain && !["delivered", "refunded"].includes(display.bucket);
  return <section className="card tracker" aria-live="polite" aria-busy={loading}>
    {head}
    <div className="card-body stack">
      <div className={`status-block tone-${TONE[display.tone]}`}><Badge tone={TONE[display.tone]} dot>{display.title}</Badge><p>{display.detail}</p></div>
      {inFlight ? <Notice tone="danger" title="Do not send a second payment"><p>A transfer may already be in flight. Pending transfers are never shown as safely cancelled.</p></Notice> : null}
      {display.warnings.map((warning) => <Notice key={warning} tone="warning" icon="clock"><p>{warning}</p></Notice>)}
      <Timeline items={steps(view, display, now, live)} label="Transfer steps" />
      {display.bucket !== "unavailable" && view.delivery ? <Evidence kind="delivery" view={view} config={config} live={live} /> : null}
      {display.bucket !== "unavailable" && view.refund ? <Evidence kind="refund" view={view} config={config} live={live} /> : null}
      {display.issues.length ? <details className="issues" open={display.bucket === "unavailable"}><summary>{display.issues.length} validation issue{display.issues.length === 1 ? "" : "s"}</summary><ul>{display.issues.map((issue) => <li key={issue}><code>{issue}</code></li>)}</ul></details> : null}
      {display.bucket !== "unavailable" && safeText(view.reviewReason, 64) ? <p className="panel-foot"><code>{safeText(view.reviewReason, 64)}</code> {reviewReasonText(view.reviewReason)}</p> : null}
    </div>
    <div className="card-footer">{display.lastObservedAt && now ? `Last observed ${formatAge(now - display.lastObservedAt)}` : "Observation time unavailable"} · Provider statuses are never treated as verified delivery.</div>
    {children}
  </section>;
}
