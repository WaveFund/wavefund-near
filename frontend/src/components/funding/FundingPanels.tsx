"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import {
  AURORA_MAINNET, AURORA_TESTNET, FUNDING_LANES, LANE_ORDER, READINESS_FAILURES, compareRaw, formatDuration, formatUnits, networkName, parseUnits, roundEligibility,
  type DeliverySummary, type FundingConfig, type FundingPreview, type FundingRoute, type FundingStrategy, type LaneId, type LaneStatus,
  type StrategyReadiness, type SummaryTone,
} from "@/lib/funding/model.mjs";
import { FIXTURE_LABEL, type FixtureScenario } from "@/lib/funding/fixtures.mjs";
import { Address, Amount, CountdownRing, Icon, Pill, identiconStyle, type IconName, type PillTone } from "./primitives";

const MONOGRAMS: Record<number, string> = { 42161: "ARB", 1: "ETH" };
const symbolOf = (route: FundingRoute) => route.source.symbol ?? "token";

export function amountValidation(route: FundingRoute, text: string): { raw: string | null; error: string | null } {
  const parsed = parseUnits(text, route.source.decimals);
  if (!parsed.ok) return { raw: null, error: text.trim() ? parsed.error : null };
  const unit = symbolOf(route);
  // A failed comparison (null) is treated as out of bounds, never as a pass.
  const belowMinimum = compareRaw(parsed.raw, route.minimumAmountIn);
  if (belowMinimum === null || belowMinimum === -1) return { raw: null, error: `The minimum for this route is ${formatUnits(route.minimumAmountIn, route.source.decimals)} ${unit}.` };
  const aboveMaximum = compareRaw(parsed.raw, route.maximumAmountIn);
  if (aboveMaximum === null || aboveMaximum === 1) return { raw: null, error: `The preview limit is ${formatUnits(route.maximumAmountIn, route.source.decimals)} ${unit}.` };
  return { raw: parsed.raw, error: null };
}

export function NetworkTruth({ roundChainId }: { roundChainId: number }) {
  return <div className="card truth" role="note" aria-label="Network separation">
    <div className="truth-net mainnet"><i className="chain-dot mainnet" /><div><b>Aurora mainnet</b><span>Funding destination · NEAR Intents</span></div><code>{AURORA_MAINNET}</code></div>
    <span className="truth-neq" aria-hidden="true">≠</span>
    <div className="truth-net testnet"><i className="chain-dot testnet" /><div><b>{networkName(roundChainId)}</b><span>Verified strategy rounds</span></div><code>{roundChainId}</code></div>
    <p>NEAR Intents 1Click has no testnet. Mainnet funds never enter a testnet round; testnet funding is a separate community lane.</p>
  </div>;
}

const LANE_ICON: Record<LaneId, IconName> = { official: "intents", tidepool: "route", fixtures: "layers" };
const LANE_DOT: Record<LaneId, string> = { official: "mainnet", tidepool: "testnet", fixtures: "local" };

export function LaneSelector({ lane, statuses, onSelect }: { lane: LaneId; statuses: Record<LaneId, LaneStatus>; onSelect: (id: LaneId) => void }) {
  return <section className="lanes" aria-labelledby="lanes-heading">
    <div className="lanes-head"><span className="kicker" id="lanes-heading">Funding source</span><p>Three separate lanes. Networks, tokens and evidence never mix.</p></div>
    <div className="lane-grid" role="radiogroup" aria-labelledby="lanes-heading">
      {LANE_ORDER.map((id) => {
        const info = FUNDING_LANES[id]; const status = statuses[id]; const active = lane === id;
        return <button type="button" role="radio" aria-checked={active} key={id} data-lane={id} className={`lane lane-${info.kind} ${active ? "active" : ""}`} onClick={() => onSelect(id)} title={status.detail}>
          <span className="lane-top"><span className="lane-ico"><Icon name={LANE_ICON[id]} /></span><Pill tone={status.tone}>{status.label}</Pill></span>
          <b>{info.title}</b>
          <small>{info.provider}</small>
          <span className="lane-net"><i className={`chain-dot ${LANE_DOT[id]}`} />{info.network}{info.chainId ? <code>{info.chainId}</code> : null}</span>
          <span className="lane-assets">{info.assets}</span>
        </button>;
      })}
    </div>
  </section>;
}

function strategySource(strategy: FundingStrategy, live: boolean) {
  return live ? `${strategy.source ?? "trusted configuration"} · not independently verified` : "Fixture identity · fake addresses";
}

// Pending community lane: shows explicit identities only. No route, quote, deposit address or live status exists for it.
export function TidepoolLaneCard({ strategy, live, notice }: { strategy: FundingStrategy | null; live: boolean; notice: string | null }) {
  const missing = <span className="unavailable">Unavailable</span>;
  const pending = <span className="unavailable">Not configured</span>;
  return <section className="card bridge tidepool" aria-labelledby="tidepool-heading">
    <div className="bridge-head">
      <h2 id="tidepool-heading"><Icon name="route" />Tidepool testnet</h2>
      <div className="bridge-tags"><Pill tone="violet">Community</Pill><Pill tone="warning">Pending integration</Pill></div>
    </div>
    <p className="lane-note">A community relayer from a testnet source chain into Aurora testnet, including Safe payouts. Worthless test assets. Not official NEAR Intents 1Click settlement.</p>
    <div className="identity-pair">
      <div className="identity-box">
        <span className="identity-head"><i className="chain-dot testnet" />Strategy needs</span>
        <dl>
          <div><dt>Network</dt><dd>Aurora testnet <code>{AURORA_TESTNET}</code></dd></div>
          <div><dt>Strategy Safe</dt><dd>{strategy ? <Address value={strategy.safe} chainId={strategy.chainId} label="strategy Safe" live={live} /> : missing}</dd></div>
          <div><dt>Stable token</dt><dd>{strategy ? <><span>{strategy.symbol ?? "token"}</span><Address value={strategy.token} chainId={strategy.chainId} label="strategy token" live={live} /></> : missing}</dd></div>
          <div><dt>Decimals</dt><dd>{strategy ? strategy.decimals : "—"}</dd></div>
        </dl>
        <small>{strategy ? strategySource(strategy, live) : notice ?? "Loads from the local funding API."}</small>
      </div>
      <div className="identity-box pending">
        <span className="identity-head"><Icon name="clock" />Tidepool would deliver</span>
        <dl>
          <div><dt>Source network</dt><dd>{pending}<small>announced: Arbitrum Sepolia</small></dd></div>
          <div><dt>Recipient Safe</dt><dd>{pending}</dd></div>
          <div><dt>Delivered token</dt><dd>{pending}</dd></div>
          <div><dt>Status feed</dt><dd><span className="unavailable">Not connected</span></dd></div>
        </dl>
        <small>Supplied by B’s interface and A’s verified configuration.</small>
      </div>
    </div>
    <div className="compat-note" role="note"><Icon name="alert" /><div><b>Tidepool’s test token may differ from the strategy token.</b><p>A delivery of any other token never makes the strategy ready. Readiness comes only from the funding service, for this Safe and this token.</p></div></div>
    <div className="bridge-actions"><button type="button" className="btn btn-locked btn-lg" disabled><Icon name="lock" /><span>No Tidepool quote · integration pending</span></button></div>
    <details className="why-locked">
      <summary><Icon name="lock" />What unlocks this lane?</summary>
      <ol>
        <li><Icon name="lock" />B: a read-only Tidepool quote, status and receipt interface for the local API</li>
        <li><Icon name="lock" />A: a verified testnet route and funding-record support for Aurora testnet</li>
        <li><Icon name="lock" />Team: confirm the recipient Safe and the token the strategy accepts</li>
        <li><Icon name="lock" />Review: executable quotes, signing and sending stay disabled</li>
      </ol>
      <p>Until then this lane shows identities only. It invents no route, quote or live status.</p>
    </details>
  </section>;
}

const CHIPS: Array<{ label: string; value: string }> = [{ label: "1", value: "1" }, { label: "25", value: "25" }, { label: "100", value: "100" }, { label: "1K", value: "1000" }];

export function BridgeCard({ config, live, route, onRoute, amountText, onAmountChange, onPreview, previewing, previewError, preview, now, canPreview }: {
  config: FundingConfig; live: boolean; route: FundingRoute; onRoute: (routeId: string) => void; amountText: string; onAmountChange: (value: string) => void;
  onPreview: (raw: string) => void; previewing: boolean; previewError: string | null; preview: FundingPreview | null; now: number; canPreview: boolean;
}) {
  const [routesOpen, setRoutesOpen] = useState(false);
  const unit = symbolOf(route); const target = route.destination.symbol ?? "token";
  const { raw, error } = amountValidation(route, amountText);
  const ready = raw !== null && canPreview && !previewing;
  const sending = preview ? formatUnits(preview.amounts.amountIn, route.source.decimals) : null;
  return <section className="card bridge" aria-labelledby="bridge-heading">
    <div className="bridge-head">
      <h2 id="bridge-heading"><Icon name="fund" />Fund Safe</h2>
      <div className="bridge-tags"><Pill tone="violet">Dry quote</Pill><Pill tone={live ? "live" : "fixture"}>{live ? "Live" : "Fixture"}</Pill></div>
    </div>

    <div className={`token-box ${error ? "invalid" : ""}`}>
      <div className="token-box-top">
        <span>You send</span>
        <button type="button" className="chain-select" onClick={() => setRoutesOpen((open) => !open)} aria-expanded={routesOpen} aria-controls="route-menu">
          <span className="chain-badge arb">{MONOGRAMS[route.source.chainId] ?? "EVM"}</span>{networkName(route.source.chainId)}<Icon name="chevron" />
        </button>
      </div>
      <div className="token-box-main">
        <input value={amountText} onChange={(event) => onAmountChange(event.target.value)} inputMode="decimal" autoComplete="off" spellCheck={false} aria-label={`Amount of ${unit} to send`} aria-invalid={Boolean(error)} aria-describedby="amount-help" placeholder="0.00" />
        <span className="token-chip"><i className="token-dot" />{unit}</span>
      </div>
      <div className="token-box-foot">
        <span id="amount-help" className={error ? "error" : undefined}>{error ?? `min ${formatUnits(route.minimumAmountIn, route.source.decimals)} · max ${formatUnits(route.maximumAmountIn, route.source.decimals)} · ${raw ?? "—"} base units`}</span>
        <span className="quick" role="group" aria-label="Quick amounts">{CHIPS.map((chip) => <button type="button" key={chip.value} className={amountText === chip.value ? "active" : undefined} onClick={() => onAmountChange(chip.value)}>{chip.label}</button>)}</span>
      </div>
    </div>

    {routesOpen && <div className="route-menu" id="route-menu" role="radiogroup" aria-label="Source route">
      {config.routes.map((item) => {
        const id = item.routeId; const active = id !== null && id === route.routeId;
        return <button type="button" role="radio" aria-checked={active} key={id ?? item.label} disabled={!id || !item.previewAvailable} className={`route-option ${active ? "active" : ""}`} onClick={() => { if (id) { onRoute(id); setRoutesOpen(false); } }}>
          <span className="chain-badge arb">{MONOGRAMS[item.source.chainId] ?? "EVM"}</span>
          <span className="route-option-main"><b>{item.label}</b><small>{item.deliveryProven ? "Delivery observed" : "Delivery not yet observed"} · {item.approvedForFunding ? "approved for sending" : "not approved for sending"}</small></span>
          {active ? <Icon name="check" /> : null}
        </button>;
      })}
      {config.unsupported.map((item) => <div className="route-option unsupported" key={item.id} role="radio" aria-checked={false} aria-disabled="true">
        <span className="chain-badge muted">{item.label.slice(0, 3).toUpperCase()}</span>
        <span className="route-option-main"><b>{item.label}</b><small>{item.reason}</small></span>
        <Pill tone="muted">Unavailable</Pill>
      </div>)}
    </div>}

    <div className="bridge-arrow" aria-hidden="true"><Icon name="down" /></div>

    <div className="token-box to">
      <div className="token-box-top"><span>Your Trading Safe receives</span><span className="chain-select static"><span className="chain-badge aurora">AUR</span>Aurora mainnet</span></div>
      <div className="token-box-main">
        <span className={`token-out ${preview ? "" : "placeholder"}`}>{preview ? <Amount raw={preview.amounts.amountOut} decimals={route.destination.decimals} /> : "0.00"}</span>
        <span className="token-chip"><i className="token-dot" />{target}</span>
      </div>
      <div className="token-box-foot">
        <span className="recipient"><span className="safe-avatar" style={identiconStyle(config.destination.safe)} aria-hidden="true" /><Address value={config.destination.safe} chainId={AURORA_MAINNET} label="Safe address" live={live} /></span>
        <Pill tone={live ? "live" : "fixture"}>{live ? "Trusted config" : "Example Safe"}</Pill>
      </div>
    </div>

    <div className="route-line">
      <span className="via"><Icon name="intents" /></span>
      <span className="route-line-main"><b>NEAR Intents · 1Click</b><small>{route.deliveryProven ? "Delivery observed" : "Delivery not yet observed"} · {route.approvedForFunding ? "approved" : "not approved for sending"}</small></span>
      <span className="route-line-meta">{preview?.timeEstimateSeconds != null ? <><Icon name="clock" />~{preview.timeEstimateSeconds}s</> : <>{route.minimumConfirmations ? `${route.minimumConfirmations} conf.` : "dry quotes"}</>}</span>
    </div>

    {preview && <QuoteDetails preview={preview} route={route} config={config} now={now} />}
    {previewError && <p className="inline-error" role="alert"><Icon name="alert" />{previewError}</p>}
    {!canPreview && <p className="inline-error"><Icon name="alert" />Dry-quote preview is not connected for this source.</p>}

    <div className="bridge-actions">
      {!preview
        ? <button type="button" className="btn btn-primary btn-lg" disabled={!ready} onClick={() => { if (raw) onPreview(raw); }}>{previewing ? <span className="spinner dark" /> : <Icon name="bolt" />}<span>{previewing ? "Requesting dry quote…" : "Preview dry quote"}</span></button>
        : <>
          <button type="button" className="btn btn-locked btn-lg" disabled><Icon name="lock" /><span>Send {sending} {unit} · disabled for review</span></button>
          <button type="button" className="btn btn-ghost full" disabled={!ready} onClick={() => { if (raw) onPreview(raw); }}>{previewing ? <span className="spinner" /> : <Icon name="refund" />}<span>Refresh dry quote</span></button>
        </>}
    </div>
    <details className="why-locked">
      <summary><Icon name="lock" />Why is sending locked?</summary>
      <ol>
        <li className={preview ? "ok" : undefined}><Icon name={preview ? "check" : "lock"} />Dry-quote preview for the trusted Safe</li>
        <li><Icon name="lock" />Executable quote approved by the funding service</li>
        <li><Icon name="lock" />Submission reserved durably before any wallet prompt</li>
        <li><Icon name="lock" />Manager wallet sends exactly the quoted amount on {networkName(route.source.chainId)}</li>
      </ol>
      <p>This dashboard never holds keys and has no send, retry or cancel action.</p>
    </details>
    <dl className="bridge-facts">
      <div><dt>Accepted asset</dt><dd>{config.destination.symbol} · <Address value={config.destination.token} chainId={AURORA_MAINNET} label="accepted token" live={live} /></dd></div>
      <div><dt>Refunds return to</dt><dd>Manager · <Address value={config.refundRecipient} label="refund wallet" live={false} /></dd></div>
      <div><dt>Wavefund module</dt><dd>{config.destination.wavefundModuleEnabled ? "Enabled" : "Not enabled · funding-proof Safe"}</dd></div>
    </dl>
  </section>;
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <div><dt>{label}{hint ? <small>{hint}</small> : null}</dt><dd>{children}</dd></div>;
}
const bpsText = (bps: number) => `${Math.floor(bps / 100)}.${String(bps % 100).padStart(2, "0")}% · ${bps} bp`;

export function QuoteDetails({ preview, route, config, now }: { preview: FundingPreview; route: FundingRoute; config: FundingConfig; now: number }) {
  const unit = symbolOf(route); const target = route.destination.symbol ?? "token";
  const expired = now > 0 && now >= preview.expiresAt;
  const total = preview.quotedAt ? Math.max(1, preview.expiresAt - preview.quotedAt) : 300;
  // Integer rate: destination base units received per whole source unit. Never divides by zero.
  const rate = preview.amounts.amountIn === "0" ? null : (BigInt(preview.amounts.amountOut) * 10n ** BigInt(route.source.decimals) / BigInt(preview.amounts.amountIn)).toString();
  const evidence = preview.evidence === "live-provider-signed" && preview.signatureVerified
    ? <Pill tone="live"><Icon name="check" />Provider-signed · verified</Pill>
    : preview.evidence === "live-provider-signed" ? <Pill tone="warning">Provider quote · signature unverified</Pill>
    : preview.evidence === "mocked" ? <Pill tone="warning">Mocked provider</Pill> : <Pill tone="fixture">Fixture quote</Pill>;
  return <details className={`quote-card ${expired ? "expired" : ""}`} open aria-live="polite">
    <summary>
      <span className="quote-summary-main"><b>1 {unit} ≈ <Amount raw={rate} decimals={route.destination.decimals} maxFraction={6} /> {target}</b>{evidence}</span>
      <CountdownRing expiresAt={preview.expiresAt} total={total} now={now} />
    </summary>
    <dl className="quote-rows">
      <Row label="Minimum received" hint={preview.signatureVerified ? "signed by 1Click" : "not signature-verified"}><Amount raw={preview.amounts.minAmountOut} decimals={route.destination.decimals} symbol={target} /></Row>
      <Row label="Requested floor" hint="server-set · 98% of input"><Amount raw={preview.requestMinAmountOut} decimals={route.destination.decimals} symbol={target} /></Row>
      <Row label="Refund fee" hint={preview.fees.feesSigned ? "signed · deducted if refunded" : "unsigned in dry quotes · deducted if refunded"}><Amount raw={preview.fees.refundFee} decimals={route.source.decimals} symbol={unit} /></Row>
      <Row label="Withdraw fee" hint={preview.fees.feesSigned ? "signed" : "unsigned in dry quotes"}><Amount raw={preview.fees.withdrawFee} decimals={route.destination.decimals} symbol={target} /></Row>
      <Row label="App fee" hint={preview.fees.appFeesSigned ? "signed" : "never signed by the provider"}>{preview.fees.appFeeBps === null ? <span className="unavailable">Unavailable</span> : bpsText(preview.fees.appFeeBps)}</Row>
      <Row label="Refund destination">Manager · <Address value={config.refundRecipient} label="refund wallet" live={false} /></Row>
      <Row label="Quote expiry">{expired ? "Expired · refresh the quote" : now ? `in ${formatDuration(preview.expiresAt - now)}` : "—"}</Row>
    </dl>
    <p className="quote-foot"><Icon name="lock" /><span>Preview only. Not funded, not executable, no deposit address exists.</span>{preview.correlationId ? <code title="Provider correlation id">{preview.correlationId.slice(0, 13)}…</code> : null}</p>
  </details>;
}

const SUMMARY_PILL: Record<SummaryTone, PillTone> = { success: "success", fixture: "fixture", progress: "violet", neutral: "neutral", warning: "warning", danger: "danger", muted: "muted" };

// Funding delivered and strategy ready are separate facts from separate sources, shown side by side.
export function ReadinessCard({ config, delivery, readiness, live }: { config: FundingConfig; delivery: DeliverySummary; readiness: StrategyReadiness; live: boolean }) {
  const prerequisites = roundEligibility(config);
  const strategy = config.strategy;
  return <section className={`card eligibility ${readiness.ready ? "eligible" : ""}`} aria-labelledby="readiness-heading">
    <div className="card-head"><h2 id="readiness-heading" className="card-title"><Icon name="shield" />Delivered ≠ ready</h2><Pill tone={readiness.ready ? "success" : "danger"}>{readiness.ready ? "Ready to run strategy" : "Strategy not ready"}</Pill></div>
    <div className="card-pad">
      <div className="ready-split" role="group" aria-label="Funding delivery and strategy readiness">
        <div className={`ready-tile tone-${delivery.tone}`} data-delivery={delivery.state}>
          <span className="ready-label"><Icon name="receipt" />Funding delivered</span>
          <b>{delivery.label}</b><p>{delivery.detail}</p><small>From bound, final receipts</small>
        </div>
        <span className="ready-op" aria-hidden="true">≠</span>
        <div className={`ready-tile tone-${readiness.tone}`} data-readiness={readiness.state}>
          <span className="ready-label"><Icon name="play" />Strategy ready</span>
          <b>{readiness.label}</b><p>{readiness.detail}</p><small>Only from the funding service</small>
        </div>
      </div>
      {readiness.failures.length > 0 && <ul className="readiness-failures" aria-label="Why the strategy is not ready">
        {readiness.failures.map((code) => <li key={code}><Pill tone={SUMMARY_PILL[readiness.tone]}>{code}</Pill><span>{READINESS_FAILURES[code] ?? "Unknown reason."}</span></li>)}
      </ul>}
      <div className="network-compare">
        <div className="net mainnet"><span>1Click funding lands on</span><b>Aurora mainnet</b><code>{AURORA_MAINNET}</code></div>
        <div className="neq" aria-label={prerequisites.sameNetwork ? "same network" : "different networks"}>{prerequisites.sameNetwork ? "=" : "≠"}</div>
        <div className="net testnet"><span>Strategy rounds run on</span><b>{networkName(config.eligibility.roundChainId)}</b><code>{config.eligibility.roundChainId}</code></div>
      </div>
      {strategy ? <dl className="identity-list">
        <div><dt>Strategy Safe</dt><dd><Address value={strategy.safe} chainId={strategy.chainId} label="strategy Safe" live={live} /></dd></div>
        <div><dt>Strategy token</dt><dd><span>{strategy.symbol ?? "token"} · {strategy.decimals} dp</span><Address value={strategy.token} chainId={strategy.chainId} label="strategy token" live={live} /></dd></div>
        <div><dt>Identity source</dt><dd><small>{strategySource(strategy, live)}</small></dd></div>
      </dl> : <p className="identity-missing"><Icon name="alert" />The strategy Safe and token are not configured, so readiness is never shown.</p>}
      <h3 className="sub-head">Round prerequisites</h3>
      <ul className="checklist">
        {prerequisites.checks.map((check) => <li key={check.id} className={check.ok ? "ok" : "no"}><Icon name={check.ok ? "check" : "cross"} /><div><b>{check.label}</b><p>{check.detail}</p></div></li>)}
      </ul>
      <p className="fine-print">The funding service consumes readiness once (prepareRound), after verified delivery, for the same network, Safe and stable token. This page never marks a Safe ready on its own.</p>
    </div>
  </section>;
}

export function ScenarioExplorer({ scenarios, selected, onSelect, busy }: { scenarios: FixtureScenario[]; selected: string | null; onSelect: (id: string) => void; busy: boolean }) {
  const current = scenarios.find((scenario) => scenario.id === selected);
  return <section className="card simulator" aria-labelledby="scenario-heading">
    <div className="simulator-head">
      <div><span className="kicker amber">State simulator</span><h2 id="scenario-heading">Every funding state, before real money moves.</h2></div>
      <Pill tone="fixture">{FIXTURE_LABEL}</Pill>
    </div>
    <div className="simulator-groups">
      {(["Progress", "Outcomes", "Problems"] as const).map((group) => <div className="simulator-group" key={group}>
        <span className="kpi-label">{group}</span>
        <div className="seg">{scenarios.filter((scenario) => scenario.group === group).map((scenario) =>
          <button type="button" key={scenario.id} data-scenario={scenario.id} className={`seg-btn group-${group.toLowerCase()} ${selected === scenario.id ? "active" : ""}`} aria-pressed={selected === scenario.id} disabled={busy} onClick={() => onSelect(scenario.id)}>{scenario.label}</button>)}
        </div>
      </div>)}
    </div>
    <p className="simulator-desc">{current ? current.description : "Pick a state to see how the route, transfer status and readiness respond. Fixture records are never shown as verified."}</p>
  </section>;
}

export function JourneyStrip() {
  return <section className="section journey" aria-labelledby="journey-heading">
    <div className="section-head"><div><span className="kicker">How it fits</span><h2 id="journey-heading">Funding comes first. Decisions stay accountable.</h2></div><p>Funding and today’s verified strategy rounds run on different Aurora networks.</p></div>
    <ol className="journey-steps">
      <li className="card current"><span className="journey-index">01</span><span className="journey-ico"><Icon name="fund" /></span><h3>Fund your Safe</h3><p>Stablecoins travel from your wallet through NEAR Intents into the Safe you control on Aurora mainnet.</p><span className="journey-net"><i className="chain-dot mainnet" />Aurora mainnet · NEAR Intents</span><span className="journey-here">You are here</span></li>
      <li className="card"><span className="journey-index">02</span><span className="journey-ico"><Icon name="chart" /></span><h3>Decide in a market</h3><p>AI proposers submit allocations. Forecasters back their views with separate collateral in Uniswap v4 markets.</p><span className="journey-net"><i className="chain-dot testnet" />Aurora testnet · verified rounds</span><Link href="/">Open the decision dashboard <Icon name="arrow" /></Link></li>
      <li className="card"><span className="journey-index">03</span><span className="journey-ico"><Icon name="sliders" /></span><h3>Execute &amp; measure</h3><p>The winning allocation executes through the Safe module on Trisolaris. Supra prices settle the measured return.</p><span className="journey-net"><i className="chain-dot testnet" />Aurora testnet · Trisolaris · Supra</span><Link href="/manager">Owner controls <Icon name="arrow" /></Link></li>
    </ol>
  </section>;
}
