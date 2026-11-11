"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import {
  AURORA_MAINNET, compareRaw, formatDuration, formatUnits, networkName, parseUnits, roundEligibility,
  type FundingConfig, type FundingPreview, type FundingRoute,
} from "@/lib/funding/model.mjs";
import { FIXTURE_LABEL, type FixtureScenario } from "@/lib/funding/fixtures.mjs";
import { Address, Amount, CountdownRing, Icon, Pill, identiconStyle } from "./primitives";

const MONOGRAMS: Record<number, string> = { 42161: "ARB", 1: "ETH" };
const symbolOf = (route: FundingRoute) => route.source.symbol ?? "token";

export function StepCard({ index, title, kicker, state, children }: { index: number; title: string; kicker?: ReactNode; state: "done" | "active" | "locked" | "idle"; children: ReactNode }) {
  return <section className={`step-card step-${state}`} aria-labelledby={`fund-step-${index}`}>
    <header>
      <span className="step-index">{state === "done" ? <Icon name="check" /> : state === "locked" ? <Icon name="lock" /> : String(index).padStart(2, "0")}</span>
      <h3 id={`fund-step-${index}`}>{title}</h3>
      {kicker ? <span className="step-kicker">{kicker}</span> : null}
    </header>
    <div className="step-body">{children}</div>
  </section>;
}

export function NetworkTruth({ roundChainId }: { roundChainId: number }) {
  return <div className="network-truth" role="note" aria-label="Network separation">
    <span className="truth-item"><i className="dot mainnet" /><b>Aurora mainnet</b><code>{AURORA_MAINNET}</code><small>Funding destination · NEAR Intents</small></span>
    <span className="truth-divider" aria-hidden="true">≠</span>
    <span className="truth-item"><i className="dot testnet" /><b>{networkName(roundChainId)}</b><code>{roundChainId}</code><small>Strategy rounds · verified deployment</small></span>
    <span className="truth-note">Separate networks. NEAR Intents has no testnet, and mainnet funds never enter a testnet round.</span>
  </div>;
}

export function DestinationCard({ config, live }: { config: FundingConfig; live: boolean }) {
  const destination = config.destination;
  return <div className="destination">
    <div className="safe-card">
      <span className="safe-avatar" style={identiconStyle(destination.safe)} aria-hidden="true"><Icon name="safe" /></span>
      <div className="safe-meta">
        <span className="section-label">TRADING SAFE{destination.safeVersion ? ` · SAFE ${destination.safeVersion}` : ""}</span>
        <Address value={destination.safe} chainId={AURORA_MAINNET} label="Safe address" live={live} />
        <span className="safe-network"><i className="dot mainnet" />Aurora mainnet · {AURORA_MAINNET}</span>
      </div>
      <Pill tone={live ? "live" : "fixture"}>{live ? "Trusted config" : "Example Safe"}</Pill>
    </div>
    <dl className="facts">
      <div><dt>Accepted asset</dt><dd>{destination.symbol} on Aurora <Address value={destination.token} chainId={AURORA_MAINNET} label="accepted token" live={live} /><small>{destination.decimals} decimals</small></dd></div>
      <div><dt>Refunds return to</dt><dd>Manager wallet <Address value={config.refundRecipient} label="refund wallet" live={false} /><small>on the source chain</small></dd></div>
      <div><dt>Wavefund module</dt><dd>{destination.wavefundModuleEnabled ? "Enabled" : "Not enabled · funding-proof Safe"}</dd></div>
    </dl>
    <p className="trusted-note"><Icon name="shield" />The Safe, asset and refund wallet come from trusted repository configuration. They cannot be edited here or supplied by the browser.</p>
  </div>;
}

export function RouteOptions({ config, selected, onSelect, live }: { config: FundingConfig; selected: string | null; onSelect: (routeId: string) => void; live: boolean }) {
  return <div className="route-options" role="radiogroup" aria-label="Source route">
    {config.routes.map((route) => {
      const id = route.routeId; const active = id !== null && id === selected;
      return <button type="button" role="radio" aria-checked={active} disabled={!id || !route.previewAvailable} key={id ?? route.label}
        className={`route-option ${active ? "active" : ""}`} onClick={() => { if (id) onSelect(id); }}>
        <span className="chain-badge">{MONOGRAMS[route.source.chainId] ?? "EVM"}</span>
        <span className="route-option-main">
          <b>{route.label}</b>
          <small>{symbolOf(route)} on {networkName(route.source.chainId)} → {route.destination.symbol ?? "token"} in your Aurora Safe · minimum {formatUnits(route.minimumAmountIn, route.source.decimals) ?? "unavailable"}</small>
          <span className="route-option-pills">
            <Pill tone={!route.previewAvailable ? "muted" : live ? "live" : "fixture"}>{!route.previewAvailable ? "Preview offline" : live ? "Dry quotes" : "Fixture dry quotes"}</Pill>
            <Pill tone={route.deliveryProven ? "success" : "warning"}>{route.deliveryProven ? "Delivery observed" : "Delivery not yet observed"}</Pill>
            <Pill tone={route.approvedForFunding ? "success" : "muted"}>{route.approvedForFunding ? "Approved for sending" : "Not approved for sending"}</Pill>
          </span>
        </span>
        <span className="radio-dot" aria-hidden="true" />
      </button>;
    })}
    {config.unsupported.map((route) => <div className="route-option unsupported" key={route.id} role="radio" aria-checked={false} aria-disabled="true">
      <span className="chain-badge muted">{route.label.slice(0, 3).toUpperCase()}</span>
      <span className="route-option-main"><b>{route.label}</b><small>{route.reason}</small></span>
      <Pill tone="muted">Unavailable</Pill>
    </div>)}
  </div>;
}

const CHIPS: Array<{ label: string; value: string }> = [{ label: "1", value: "1" }, { label: "25", value: "25" }, { label: "100", value: "100" }, { label: "1,000", value: "1000" }];

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

export function AmountStep({ route, config, amountText, onAmountChange, onPreview, previewing, previewError, preview, now, canPreview }: {
  route: FundingRoute; config: FundingConfig; amountText: string; onAmountChange: (value: string) => void; onPreview: (raw: string) => void;
  previewing: boolean; previewError: string | null; preview: FundingPreview | null; now: number; canPreview: boolean;
}) {
  const unit = symbolOf(route);
  const { raw, error } = amountValidation(route, amountText);
  const ready = raw !== null && canPreview && !previewing;
  return <div className="amount-step">
    <label className="amount-field">
      <span className="section-label">YOU SEND · {networkName(route.source.chainId).toUpperCase()}</span>
      <span className={`amount-input ${error ? "invalid" : ""}`}>
        <input value={amountText} onChange={(event) => onAmountChange(event.target.value)} inputMode="decimal" autoComplete="off" spellCheck={false} aria-invalid={Boolean(error)} aria-describedby="amount-help" placeholder="0.00" />
        <span className="amount-unit"><i className="token-dot" />{unit}</span>
      </span>
    </label>
    <div className="amount-chips" role="group" aria-label="Quick amounts">
      {CHIPS.map((chip) => <button type="button" key={chip.value} className={amountText === chip.value ? "active" : ""} onClick={() => onAmountChange(chip.value)}>{chip.label} {unit}</button>)}
    </div>
    <p id="amount-help" className={`amount-help ${error ? "error" : ""}`}>{error ?? `Exact base units ${raw ?? "—"} · min ${formatUnits(route.minimumAmountIn, route.source.decimals)} · max ${formatUnits(route.maximumAmountIn, route.source.decimals)} ${unit}`}</p>
    <button type="button" className="primary-button" disabled={!ready} onClick={() => { if (raw) onPreview(raw); }}>
      <span>{previewing ? "Requesting dry quote…" : preview ? "Refresh dry quote" : "Preview dry quote"}</span>{previewing ? <span className="spinner" /> : <Icon name="arrow" />}
    </button>
    {!canPreview && <p className="amount-help error">Dry-quote preview is not connected for this source.</p>}
    {previewError && <p className="inline-error" role="alert"><Icon name="alert" />{previewError}</p>}
    {preview && <QuoteCard preview={preview} route={route} config={config} now={now} />}
  </div>;
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <div><dt>{label}{hint ? <small>{hint}</small> : null}</dt><dd>{children}</dd></div>;
}
const bpsText = (bps: number) => `${Math.floor(bps / 100)}.${String(bps % 100).padStart(2, "0")}% · ${bps} bp`;

export function QuoteCard({ preview, route, config, now }: { preview: FundingPreview; route: FundingRoute; config: FundingConfig; now: number }) {
  const unit = symbolOf(route); const target = route.destination.symbol ?? "token";
  const expired = now > 0 && now >= preview.expiresAt;
  const total = preview.quotedAt ? Math.max(1, preview.expiresAt - preview.quotedAt) : 300;
  const evidence = preview.evidence === "live-provider-signed" && preview.signatureVerified
    ? <Pill tone="live"><Icon name="check" />Provider-signed · verified</Pill>
    : preview.evidence === "live-provider-signed" ? <Pill tone="warning">Provider quote · signature unverified</Pill>
    : preview.evidence === "mocked" ? <Pill tone="warning">Mocked provider</Pill> : <Pill tone="fixture">Fixture quote</Pill>;
  return <article className={`quote-card ${expired ? "expired" : ""}`} aria-live="polite">
    <header><span className="quote-tags"><Pill tone="violet">Dry quote</Pill>{evidence}</span><CountdownRing expiresAt={preview.expiresAt} total={total} now={now} /></header>
    <div className="quote-swap">
      <div><span className="section-label">YOU SEND</span><strong><Amount raw={preview.amounts.amountIn} decimals={route.source.decimals} /></strong><small>{unit} · {networkName(route.source.chainId)}</small></div>
      <span className="quote-arrow" aria-hidden="true"><Icon name="arrow" /></span>
      <div><span className="section-label">ESTIMATED IN SAFE</span><strong><Amount raw={preview.amounts.amountOut} decimals={route.destination.decimals} /></strong><small>{target} · Aurora mainnet</small></div>
    </div>
    <dl className="quote-rows">
      <Row label="Minimum received" hint={preview.signatureVerified ? "signed by 1Click" : "not signature-verified"}><Amount raw={preview.amounts.minAmountOut} decimals={route.destination.decimals} symbol={target} /></Row>
      <Row label="Requested floor" hint="server-set, 98% of input"><Amount raw={preview.requestMinAmountOut} decimals={route.destination.decimals} symbol={target} /></Row>
      <Row label="Refund fee" hint={preview.fees.feesSigned ? "signed · deducted if refunded" : "unsigned in dry quotes · deducted if refunded"}><Amount raw={preview.fees.refundFee} decimals={route.source.decimals} symbol={unit} /></Row>
      <Row label="Withdraw fee" hint={preview.fees.feesSigned ? "signed" : "unsigned in dry quotes"}><Amount raw={preview.fees.withdrawFee} decimals={route.destination.decimals} symbol={target} /></Row>
      <Row label="App fee" hint={preview.fees.appFeesSigned ? "signed" : "never signed by the provider"}>{preview.fees.appFeeBps === null ? <span className="unavailable">Unavailable</span> : bpsText(preview.fees.appFeeBps)}</Row>
      <Row label="Estimated time">{preview.timeEstimateSeconds === null ? <span className="unavailable">Unavailable</span> : `~${preview.timeEstimateSeconds}s`}</Row>
      <Row label="Refund destination">Manager wallet <Address value={config.refundRecipient} label="refund wallet" live={false} /></Row>
      <Row label="Quote expiry">{expired ? "Expired · refresh the quote" : now ? `in ${formatDuration(preview.expiresAt - now)}` : "—"}</Row>
    </dl>
    <footer><Icon name="lock" /><span>Preview only. Not funded, not executable, and no deposit address exists.</span>{preview.correlationId ? <code title="Provider correlation id">{preview.correlationId}</code> : null}</footer>
  </article>;
}

export function SendStep({ preview, route }: { preview: FundingPreview | null; route: FundingRoute }) {
  const amount = preview ? formatUnits(preview.amounts.amountIn, route.source.decimals) : null;
  return <div className="send-locked">
    <div className="send-locked-head">
      <span className="lock-badge"><Icon name="lock" /></span>
      <div><b>Wallet signing is disabled for review</b><p>The send path stays off until the shared funding service and wallet flow are reviewed. This dashboard never holds keys and has no send, retry or cancel action.</p></div>
    </div>
    <ol className="send-requirements">
      <li className={preview ? "ok" : ""}><Icon name={preview ? "check" : "lock"} />Dry-quote preview for the trusted Safe</li>
      <li><Icon name="lock" />Executable quote approved by the funding service</li>
      <li><Icon name="lock" />Submission reserved durably before any wallet prompt</li>
      <li><Icon name="lock" />Manager wallet sends exactly the quoted amount on {networkName(route.source.chainId)}</li>
    </ol>
    <button type="button" className="primary-button locked" disabled><span>{amount ? `Send ${amount} ${symbolOf(route)}` : "Send from wallet"} · disabled</span><Icon name="lock" /></button>
  </div>;
}

export function EligibilityCard({ config }: { config: FundingConfig }) {
  const result = roundEligibility(config);
  return <section className={`panel eligibility ${result.eligible ? "eligible" : ""}`} aria-labelledby="eligibility-heading">
    <p className="eyebrow quiet"><span />ROUND READINESS</p>
    <h3 id="eligibility-heading">{result.eligible ? "Eligible for the next round" : "Not eligible for a round yet"}</h3>
    <div className="network-compare">
      <div className="net mainnet"><span>Funding lands on</span><b>Aurora mainnet</b><code>{AURORA_MAINNET}</code></div>
      <div className="neq" aria-label={result.sameNetwork ? "same network" : "different networks"}>{result.sameNetwork ? "=" : "≠"}</div>
      <div className="net testnet"><span>Rounds run on</span><b>{networkName(config.eligibility.roundChainId)}</b><code>{config.eligibility.roundChainId}</code></div>
    </div>
    <ul className="checklist">
      {result.checks.map((check) => <li key={check.id} className={check.ok ? "ok" : "no"}><Icon name={check.ok ? "check" : "cross"} /><div><b>{check.label}</b><p>{check.detail}</p></div></li>)}
    </ul>
    <p className="fine">The funding service consumes readiness once, after verified delivery, and only for a reviewed deployment on the same network.</p>
  </section>;
}

export function ScenarioExplorer({ scenarios, selected, onSelect, busy }: { scenarios: FixtureScenario[]; selected: string | null; onSelect: (id: string) => void; busy: boolean }) {
  const current = scenarios.find((scenario) => scenario.id === selected);
  return <section className="scenario-explorer" aria-labelledby="scenario-heading">
    <div className="scenario-head">
      <div><p className="eyebrow quiet"><span />FIXTURE EXPLORER</p><h2 id="scenario-heading">Every funding state, before real money moves.</h2></div>
      <Pill tone="fixture">{FIXTURE_LABEL}</Pill>
    </div>
    <div className="scenario-groups">
      {(["Progress", "Outcomes", "Problems"] as const).map((group) => <div className="scenario-group" key={group}>
        <span className="section-label">{group.toUpperCase()}</span>
        <div className="scenario-chips">{scenarios.filter((scenario) => scenario.group === group).map((scenario) =>
          <button type="button" key={scenario.id} data-scenario={scenario.id} className={`scenario-chip group-${group.toLowerCase()} ${selected === scenario.id ? "active" : ""}`} aria-pressed={selected === scenario.id} disabled={busy} onClick={() => onSelect(scenario.id)}>{scenario.label}</button>)}
        </div>
      </div>)}
    </div>
    <p className="scenario-desc">{current ? current.description : "Pick a state to see how the route, tracker and readiness respond. Fixture records are never shown as verified."}</p>
  </section>;
}

export function JourneyStrip() {
  return <section className="journey" aria-labelledby="journey-heading">
    <div className="section-heading"><div><p className="eyebrow quiet">HOW IT FITS</p><h2 id="journey-heading">Funding comes first. Decisions stay accountable.</h2></div><p className="heading-note">Funding and today’s verified strategy rounds run on different Aurora networks.</p></div>
    <ol className="journey-steps">
      <li className="current"><span className="journey-index">01</span><h3>Fund your Safe</h3><p>Stablecoins travel from your wallet through NEAR Intents into the Safe you control on Aurora mainnet.</p><span className="journey-net"><i className="dot mainnet" />Aurora mainnet · NEAR Intents</span><span className="journey-here">You are here</span></li>
      <li><span className="journey-index">02</span><h3>Decide in a market</h3><p>AI proposers submit allocations. Forecasters back their views with separate collateral in Uniswap v4 markets.</p><span className="journey-net"><i className="dot testnet" />Aurora testnet · verified rounds</span><Link href="/">Open the decision dashboard <Icon name="arrow" /></Link></li>
      <li><span className="journey-index">03</span><h3>Execute &amp; measure</h3><p>The winning allocation executes through the Safe module on Trisolaris. Supra prices settle the measured return.</p><span className="journey-net"><i className="dot testnet" />Aurora testnet · Trisolaris · Supra</span><Link href="/manager">Owner controls <Icon name="arrow" /></Link></li>
    </ol>
  </section>;
}
