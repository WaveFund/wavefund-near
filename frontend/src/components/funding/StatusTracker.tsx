"use client";

import type { ReactNode } from "react";
import {
  evidenceFailures, formatAge, formatUnits, isTxHash, networkName, percentOf, requiredConfirmations, reviewReasonText, safeText,
  type FundingConfig, type FundingDisplay, type FundingRecordView, type FundingTone,
} from "@/lib/funding/model.mjs";
import { Address, Amount, CopyText, ExplorerLink, Icon, Pill, type IconName } from "./primitives";

type TimelineStatus = "done" | "active" | "halted" | "upcoming";
const TONE_ICON: Record<FundingTone, IconName> = { success: "check", danger: "alert", warning: "alert", progress: "clock", neutral: "clock", muted: "eye" };
const num = (value: unknown): number | null => (Number.isSafeInteger(value) && (value as number) > 0 ? (value as number) : null);
const asRecord = (value: unknown): FundingRecordView | null => (value && typeof value === "object" && !Array.isArray(value) ? (value as FundingRecordView) : null);

function outcomeFor(display: FundingDisplay): { title: string; status: TimelineStatus; detail: string } {
  switch (display.bucket) {
    case "delivered": return { title: display.verified ? "Delivery verified on Aurora" : "Delivery evidence complete", status: "done", detail: display.verified ? "Bound, final Aurora receipt to your Safe." : "Complete evidence, but fixture quality, not live." };
    case "refunded": return { title: "Refund evidence recorded", status: "done", detail: display.verified ? "Verified refund receipt to the manager wallet." : "Fixture-quality refund evidence." };
    case "refund-partial": return { title: "Partial refund · needs reconciliation", status: "halted", detail: "The actual returned amount is shown below." };
    case "refund-pending": return { title: "Refund receipt pending verification", status: "halted", detail: "Not shown as refunded until verified." };
    case "failed": return { title: "Provider failure · not a refund", status: "halted", detail: "Funds are not shown as returned." };
    case "needs-review": return { title: "Needs operator review", status: "halted", detail: "No automatic retry, release or cancellation." };
    case "unavailable": return { title: "Status unavailable", status: "halted", detail: "Missing or invalid information is never treated as success." };
    case "submitted":
    case "provider-success": return { title: "Awaiting a verified Aurora receipt", status: "active", detail: "Delivery needs a bound receipt with enough confirmations." };
    default: return { title: "Delivery or refund", status: "upcoming", detail: "Shown only from verified receipts." };
  }
}

function Timeline({ view, display, now, live }: { view: FundingRecordView; display: FundingDisplay; now: number; live: boolean }) {
  const state = view.state;
  const quote = view.quote ?? null; const submission = view.submission ?? null; const observation = view.observation ?? null;
  const sourceChain = num(view.request?.source?.chainId);
  const sourceDecimals = view.request?.source?.decimals ?? null; const destinationDecimals = view.request?.destination?.decimals ?? null;
  const quoteExpiry = num(quote?.expiresAt);
  const expired = state === "quoted" && quoteExpiry !== null && now > 0 && now >= quoteExpiry;
  const rawTx = submission?.txHash; const tx = isTxHash(rawTx) ? rawTx : null;
  const broadcastUnknown = view.reviewReason === "BROADCAST_UNKNOWN";
  const observed = safeText(observation?.status, 24);
  const outcome = outcomeFor(display);
  const items: Array<{ key: string; title: string; status: TimelineStatus; time: number | null; detail: ReactNode }> = [
    { key: "quote", title: "Executable quote recorded", status: quote ? "done" : "upcoming", time: num(view.createdAt),
      detail: quote ? <>Send exactly <Amount raw={view.request?.amountIn} decimals={sourceDecimals} symbol="USDC" /> · signed minimum out <Amount raw={quote.minAmountOut} decimals={destinationDecimals} symbol="USDC" /></> : "No executable quote" },
    { key: "reserve", title: "Wallet send reserved", status: submission?.reserved ? "done" : state === "quoted" ? (expired ? "halted" : "active") : "upcoming", time: num(submission?.reservedAt),
      detail: submission?.reserved ? "Reserved durably before any wallet prompt" : expired ? "Quote expired before sending · do not reuse its deposit address" : "Awaiting manager · signing disabled in this build" },
    { key: "source", title: "Source transaction recorded", status: tx ? "done" : broadcastUnknown ? "halted" : state === "dispatching" ? "active" : "upcoming", time: null,
      detail: tx ? <span className="tx-inline"><CopyText value={tx} label="source transaction" /><ExplorerLink chainId={sourceChain} kind="tx" value={tx} enabled={live} /><small>{networkName(sourceChain)}</small></span>
        : broadcastUnknown ? "Unknown whether the wallet broadcast. Reconcile on-chain first." : "Not recorded yet" },
    { key: "observe", title: "Provider observation", status: observed ? "done" : tx ? "active" : "upcoming", time: num(observation?.observedAt),
      detail: observed ? <><code>{observed}</code> · unverified provider report</> : "No provider status yet" },
    { key: "outcome", title: outcome.title, status: outcome.status, time: num(display.bucket === "delivered" ? view.delivery?.observedAt : view.refund?.observedAt), detail: outcome.detail },
  ];
  return <ol className="timeline">
    {items.map((item) => <li key={item.key} className={`t-${item.status}`}>
      <span className="t-dot">{item.status === "done" ? <Icon name="check" /> : item.status === "halted" ? <Icon name="alert" /> : null}</span>
      <div className="t-body">
        <div className="t-row"><b>{item.title}</b>{item.time && now ? <time>{formatAge(now - item.time)}</time> : null}</div>
        <div className="t-detail">{item.detail}</div>
      </div>
    </li>)}
  </ol>;
}

function EvidenceTable({ kind, view, config, live }: { kind: "delivery" | "refund"; view: FundingRecordView; config: FundingConfig; live: boolean }) {
  const item = kind === "delivery" ? view.delivery : view.refund;
  if (!item || typeof item !== "object") return null;
  const failures = new Set(evidenceFailures(kind, view, config));
  const request = view.request ?? null;
  const decimals = kind === "delivery" ? request?.destination?.decimals ?? null : request?.source?.decimals ?? null;
  // Same policy as the classifier: the stricter of trusted config and the record; unknown is never "final".
  const required = requiredConfirmations(view, config);
  const confirmations = Number.isSafeInteger(item.confirmations) ? (item.confirmations as number) : null;
  const filled = confirmations === null || required === null ? 0 : Math.min(100, Math.round((confirmations / required) * 100));
  const rawTx = item.transactionHash; const tx = isTxHash(rawTx) ? rawTx : null;
  const chainId = num(item.chainId);
  const rows: Array<{ label: string; ok: boolean; value: ReactNode }> = [
    { label: "Network", ok: !failures.has("WRONG_NETWORK"), value: networkName(chainId) },
    { label: "Receipt", ok: !failures.has("TRANSACTION_MISSING"), value: tx ? <span className="tx-inline"><CopyText value={tx} label="receipt" /><ExplorerLink chainId={chainId} kind="tx" value={tx} enabled={live} /></span> : <span className="unavailable">Unavailable</span> },
    { label: kind === "delivery" ? "Recipient · your Safe" : "Recipient · manager wallet", ok: !failures.has("WRONG_RECIPIENT"), value: <Address value={item.recipient} chainId={chainId} label="recipient" live={live} /> },
    { label: "Asset", ok: !failures.has("WRONG_TOKEN"), value: <Address value={item.token} chainId={chainId} label="token" live={live} /> },
    { label: kind === "delivery" ? "Amount · vs signed minimum" : "Amount · vs amount sent", ok: !["AMOUNT_MISSING", "BELOW_MINIMUM", "REFUND_EXCEEDS_INPUT"].some((code) => failures.has(code)),
      value: <><Amount raw={item.amount} decimals={decimals} symbol="USDC" /><small className="evidence-note">{kind === "delivery"
        ? `minimum ${formatUnits(view.quote?.minAmountOut, request?.destination?.decimals) ?? "unavailable"}`
        : `${percentOf(item.amount, request?.amountIn) ?? "—"} of ${formatUnits(request?.amountIn, decimals) ?? "unavailable"} sent`}</small></> },
    { label: "Confirmations", ok: !failures.has("NOT_FINAL") && !failures.has("CONFIRMATION_POLICY_UNKNOWN"), value: <span className="confirmations"><span className="confirm-bar"><span style={{ width: `${filled}%` }} /></span><small>{confirmations ?? "—"} / {required ?? "policy unknown"}</small></span> },
    { label: "Bound to this request & quote", ok: !["REQUEST_NOT_BOUND", "QUOTE_NOT_BOUND", "SOURCE_TRANSACTION_NOT_LINKED"].some((code) => failures.has(code)), value: "Request hash · quote hash · source transaction" },
    { label: "Evidence quality", ok: !failures.has("EVIDENCE_QUALITY_MISMATCH"), value: safeText(item.evidenceQuality, 20) ?? <span className="unavailable">Unavailable</span> },
  ];
  return <div className="evidence">
    <h5>{kind === "delivery" ? "Aurora delivery receipt" : "Refund receipt"}</h5>
    <dl>{rows.map((row) => <div key={row.label} className={row.ok ? "ok" : "bad"}><dt><Icon name={row.ok ? "check" : "cross"} />{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
  </div>;
}

export function StatusTracker({ record, display, config, now, loading, scenarioLabel }: { record: unknown; display: FundingDisplay | null; config: FundingConfig; now: number; loading: boolean; scenarioLabel?: string | null }) {
  const view = asRecord(record);
  const head = (tags: ReactNode) => <header className="tracker-head">
    <div><span className="kicker">Transfer status</span><h3>Funding record</h3></div>
    <div className="tracker-tags">{loading ? <span className="spinner" aria-label="Loading" /> : tags}</div>
  </header>;
  if (!view || !display) {
    return <section className="card tracker" aria-live="polite" aria-busy={loading}>
      {head(null)}
      <div className="tracker-empty">
        <span className="tracker-empty-icon"><Icon name="eye" /></span>
        <h4>No funding record yet</h4>
        <p>A record appears once the funding service stores an executable quote and a manager-submitted transaction. Sending is disabled in this build, so nothing can be created from this page.</p>
        <ol className="tracker-legend">
          <li><b>Submitted</b><span>source transaction recorded</span></li>
          <li><b>Provider observation</b><span>always labelled unverified</span></li>
          <li><b>Verified delivery or refund</b><span>only from bound, final receipts</span></li>
        </ol>
      </div>
    </section>;
  }
  const live = display.evidence === "live";
  const fundingId = safeText(view.fundingId, 80) ?? "Unavailable";
  const inFlight = display.doNotPayAgain && !["delivered", "refunded"].includes(display.bucket);
  return <section className={`card tracker tone-${display.tone}`} aria-live="polite" aria-busy={loading}>
    {head(<>{display.verified ? <Pill tone="success"><Icon name="check" />Verified</Pill> : null}{display.evidence === "fixture" ? <Pill tone="fixture">Fixture</Pill> : display.evidence === "live" ? <Pill tone="live">Live service</Pill> : null}</>)}
    <p className="tracker-id"><span>fundingId</span><code title={fundingId}>{fundingId}</code>{scenarioLabel ? <em>{scenarioLabel}</em> : null}</p>
    <div className={`status-hero tone-${display.tone}`}>
      <span className="status-hero-icon"><Icon name={TONE_ICON[display.tone]} /></span>
      <div><h4>{display.title}</h4><p>{display.detail}</p></div>
    </div>
    {inFlight && <div className="do-not-pay" role="alert"><Icon name="shield" /><div><b>Do not send a second payment.</b><span>A transfer may already be in flight. Pending transfers are never shown as safely cancelled.</span></div></div>}
    {display.warnings.map((warning) => <p className="tracker-warning" key={warning}><Icon name="clock" />{warning}</p>)}
    <Timeline view={view} display={display} now={now} live={live} />
    {display.bucket !== "unavailable" && view.delivery ? <EvidenceTable kind="delivery" view={view} config={config} live={live} /> : null}
    {display.bucket !== "unavailable" && view.refund ? <EvidenceTable kind="refund" view={view} config={config} live={live} /> : null}
    {display.issues.length ? <details className="tracker-issues" open={display.bucket === "unavailable"}><summary>{display.issues.length} validation issue{display.issues.length === 1 ? "" : "s"}</summary><ul>{display.issues.map((issue) => <li key={issue}><code>{issue}</code></li>)}</ul></details> : null}
    {display.bucket !== "unavailable" && safeText(view.reviewReason, 64) ? <p className="review-reason"><code>{safeText(view.reviewReason, 64)}</code>{reviewReasonText(view.reviewReason)}</p> : null}
    <p className="tracker-foot">{display.lastObservedAt && now ? `Last observed ${formatAge(now - display.lastObservedAt)}` : "Observation time unavailable"} · Provider statuses are never treated as verified delivery.</p>
  </section>;
}
