"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import {
  AURORA_MAINNET, compareRaw, formatDuration, formatUnits, networkName, parseUnits, roundEligibility,
  type FundingConfig, type FundingPreview, type FundingRoute,
} from "@/lib/funding/model.mjs";
import { FIXTURE_LABEL, type FixtureScenario } from "@/lib/funding/fixtures.mjs";
import { Address, Amount, CountdownRing, Icon, Pill, identiconStyle } from "./primitives";

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
    <p>NEAR Intents has no testnet. Mainnet funds never enter a testnet round.</p>
  </div>;
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

export function EligibilityCard({ config }: { config: FundingConfig }) {
  const result = roundEligibility(config);
  return <section className={`card eligibility ${result.eligible ? "eligible" : ""}`} aria-labelledby="eligibility-heading">
    <div className="card-head"><h2 id="eligibility-heading" className="card-title"><Icon name="shield" />Round readiness</h2><Pill tone={result.eligible ? "success" : "danger"}>{result.eligible ? "Eligible" : "Not eligible"}</Pill></div>
    <div className="card-pad">
      <div className="network-compare">
        <div className="net mainnet"><span>Funding lands on</span><b>Aurora mainnet</b><code>{AURORA_MAINNET}</code></div>
        <div className="neq" aria-label={result.sameNetwork ? "same network" : "different networks"}>{result.sameNetwork ? "=" : "≠"}</div>
        <div className="net testnet"><span>Rounds run on</span><b>{networkName(config.eligibility.roundChainId)}</b><code>{config.eligibility.roundChainId}</code></div>
      </div>
      <ul className="checklist">
        {result.checks.map((check) => <li key={check.id} className={check.ok ? "ok" : "no"}><Icon name={check.ok ? "check" : "cross"} /><div><b>{check.label}</b><p>{check.detail}</p></div></li>)}
      </ul>
      <p className="fine-print">The funding service consumes readiness once, after verified delivery, and only for a reviewed deployment on the same network.</p>
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
