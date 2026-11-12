"use client";

import type { ReactNode } from "react";
import {
  AURORA_MAINNET, AURORA_TESTNET, READINESS_FAILURES, compareRaw, formatDuration, formatUnits, networkName, parseUnits, roundEligibility, tidepoolLadder,
  type DeliverySummary, type FundingConfig, type FundingPreview, type FundingRoute, type FundingStrategy, type StrategyReadiness, type SummaryTone,
} from "@/lib/funding/model.mjs";
import { FIXTURE_LABEL, type FixtureScenario } from "@/lib/funding/fixtures.mjs";
import { Address, Amount, CountdownRing, Icon, identiconStyle } from "./primitives";
import { Badge, Button, DescriptionList, Notice, type Tone } from "@/components/ui";

const symbolOf = (route: FundingRoute) => route.source.symbol ?? "token";
const SUMMARY_TONE: Record<SummaryTone, Tone> = { success: "success", fixture: "warning", progress: "info", neutral: "neutral", warning: "warning", danger: "danger", muted: "neutral" };

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

export function TreasurySummary({ config, live }: { config: FundingConfig; live: boolean }) {
  return <div className="summary-grid">
    <div><span>Trading Safe</span><b className="summary-safe"><span className="safe-avatar" style={identiconStyle(config.destination.safe)} aria-hidden="true" /><Address value={config.destination.safe} chainId={AURORA_MAINNET} label="Safe address" live={live} /></b></div>
    <div><span>Network</span><b><i className="dot mainnet" />Aurora mainnet <code>{AURORA_MAINNET}</code></b></div>
    <div><span>Accepted asset</span><b>{config.destination.symbol} <Address value={config.destination.token} chainId={AURORA_MAINNET} label="accepted token" live={live} /></b></div>
    <div><span>Refunds go to</span><b>Manager <Address value={config.refundRecipient} label="refund wallet" live={false} /></b></div>
    <div><span>Wavefund module</span><b>{config.destination.wavefundModuleEnabled ? <Badge tone="success">Enabled</Badge> : <Badge>Not enabled · funding-proof Safe</Badge>}</b></div>
  </div>;
}

export type FlowStep = { title: string; sub: string; state: "idle" | "active" | "done" | "halted" | "preview" };
export function RouteSteps({ steps }: { steps: FlowStep[] }) {
  return <ol className="route-steps" aria-label="Deposit route">
    {steps.map((step, index) => <li key={step.title} className={`route-step ${step.state}`}>
      <span className="route-step-index" aria-hidden="true">{step.state === "done" ? <Icon name="check" /> : step.state === "halted" ? <Icon name="alert" /> : index + 1}</span>
      <span className="route-step-text"><b>{step.title}</b><small>{step.sub}</small></span>
    </li>)}
  </ol>;
}

const CHIPS = ["10", "25", "100", "1000"];

export function DepositForm({ config, live, route, onRoute, amountText, onAmountChange, onPreview, previewing, previewError, preview, now, canPreview, steps }: {
  config: FundingConfig; live: boolean; route: FundingRoute; onRoute: (routeId: string) => void; amountText: string; onAmountChange: (value: string) => void;
  onPreview: (raw: string) => void; previewing: boolean; previewError: string | null; preview: FundingPreview | null; now: number; canPreview: boolean; steps: FlowStep[];
}) {
  const unit = symbolOf(route);
  const { raw, error } = amountValidation(route, amountText);
  const ready = raw !== null && canPreview && !previewing;
  const sending = preview ? formatUnits(preview.amounts.amountIn, route.source.decimals) : null;
  return <div className="deposit">
    <label className="field" htmlFor="deposit-route">From
      <select id="deposit-route" className="input" value={route.routeId ?? ""} onChange={(event) => onRoute(event.target.value)}>
        {config.routes.map((item) => <option key={item.routeId ?? item.label} value={item.routeId ?? ""} disabled={!item.routeId || !item.previewAvailable}>{networkName(item.source.chainId)} · {item.source.symbol ?? "token"}</option>)}
      </select>
    </label>
    <div className={`amount-box ${error ? "invalid" : ""}`}>
      <label htmlFor="deposit-amount">Amount</label>
      <div className="amount-input">
        <input id="deposit-amount" value={amountText} onChange={(event) => onAmountChange(event.target.value)} inputMode="decimal" autoComplete="off" spellCheck={false} aria-invalid={Boolean(error)} aria-describedby="deposit-help" placeholder="0.00" />
        <span className="token-tag">{unit}</span>
      </div>
      <div className="amount-foot">
        <span id="deposit-help" className={error ? "field-error" : undefined}>{error ?? `Min ${formatUnits(route.minimumAmountIn, route.source.decimals)} · max ${formatUnits(route.maximumAmountIn, route.source.decimals)} ${unit}`}</span>
        <span className="chips" role="group" aria-label="Quick amounts">{CHIPS.map((chip) => <button type="button" key={chip} className={amountText === chip ? "active" : undefined} onClick={() => onAmountChange(chip)}>{Number(chip).toLocaleString("en-US")}</button>)}</span>
      </div>
    </div>
    <div className="receive-box">
      <div><span>Your Trading Safe receives</span><b className="tnum">{preview ? <Amount raw={preview.amounts.amountOut} decimals={route.destination.decimals} symbol={route.destination.symbol ?? "token"} /> : <span className="subtle">Get a quote to see the amount</span>}</b></div>
      <span className="receive-meta"><i className="dot mainnet" />Aurora mainnet · via NEAR Intents 1Click</span>
    </div>

    {preview ? <QuoteSummary preview={preview} route={route} config={config} now={now} /> : null}
    {previewError ? <p className="field-error" role="alert">{previewError}</p> : null}
    {!canPreview ? <Notice tone="warning"><p>Quotes are not connected for this source.</p></Notice> : null}

    <div className="deposit-actions">
      {!preview
        ? <Button variant="primary" size="lg" block icon="bolt" loading={previewing} disabled={!ready} onClick={() => { if (raw) onPreview(raw); }}>{previewing ? "Getting quote…" : "Get quote"}</Button>
        : <>
          <Button variant="locked" size="lg" block icon="lock" disabled>Deposit {sending} {unit} · disabled during review</Button>
          <Button block icon="refund" loading={previewing} disabled={!ready} onClick={() => { if (raw) onPreview(raw); }}>Refresh quote</Button>
        </>}
    </div>
    <RouteSteps steps={steps} />
    <details className="disclosure flush">
      <summary>Why are deposits disabled?</summary>
      <div className="disclosure-body">
        <ul className="check-list">
          <li className={preview ? "ok" : "wait"}><Icon name="check" /><div><b>Preview quote for the trusted Safe</b></div></li>
          <li className="wait"><Icon name="lock" /><div><b>Executable quote approved by the funding service</b></div></li>
          <li className="wait"><Icon name="lock" /><div><b>Deposit reserved before any wallet prompt</b></div></li>
          <li className="wait"><Icon name="lock" /><div><b>Manager wallet sends exactly the quoted amount</b></div></li>
        </ul>
        <p>This dashboard holds no keys and has no send, retry or cancel action.</p>
      </div>
    </details>
    {config.unsupported.length ? <details className="disclosure flush">
      <summary>Other sources ({config.unsupported.length} unavailable)</summary>
      <div className="disclosure-body"><DescriptionList items={config.unsupported.map((item) => ({ key: item.id, label: item.label, value: <span className="muted wrap">{item.reason}</span> }))} /></div>
    </details> : null}
    {!live ? <p className="panel-foot">{FIXTURE_LABEL}. The Safe shown is an example.</p> : null}
  </div>;
}

const bpsText = (bps: number) => `${Math.floor(bps / 100)}.${String(bps % 100).padStart(2, "0")}%`;
export function QuoteSummary({ preview, route, config, now }: { preview: FundingPreview; route: FundingRoute; config: FundingConfig; now: number }) {
  const unit = symbolOf(route); const target = route.destination.symbol ?? "token";
  const expired = now > 0 && now >= preview.expiresAt;
  const total = preview.quotedAt ? Math.max(1, preview.expiresAt - preview.quotedAt) : 300;
  // Integer rate: destination base units per whole source unit. Never divides by zero.
  const rate = preview.amounts.amountIn === "0" ? null : (BigInt(preview.amounts.amountOut) * 10n ** BigInt(route.source.decimals) / BigInt(preview.amounts.amountIn)).toString();
  const evidence = preview.evidence === "live-provider-signed" && preview.signatureVerified ? <Badge tone="success"><Icon name="check" />Signed by 1Click</Badge>
    : preview.evidence === "live-provider-signed" ? <Badge tone="warning">Signature unverified</Badge>
    : preview.evidence === "mocked" ? <Badge tone="warning">Mocked provider</Badge> : <Badge tone="warning">Fixture quote</Badge>;
  return <div className={`quote ${expired ? "expired" : ""}`} aria-live="polite">
    <div className="quote-head"><span>1 {unit} ≈ <Amount raw={rate} decimals={route.destination.decimals} maxFraction={6} /> {target}</span><span className="quote-badges">{evidence}<CountdownRing expiresAt={preview.expiresAt} total={total} now={now} /></span></div>
    <DescriptionList items={[
      { label: "Minimum received", value: <Amount raw={preview.amounts.minAmountOut} decimals={route.destination.decimals} symbol={target} /> },
      { label: "Requested floor", hint: "98% of input", value: <Amount raw={preview.requestMinAmountOut} decimals={route.destination.decimals} symbol={target} /> },
      { label: "Refund fee", hint: preview.fees.feesSigned ? "signed" : "not signed in previews", value: <Amount raw={preview.fees.refundFee} decimals={route.source.decimals} symbol={unit} /> },
      { label: "Withdraw fee", value: <Amount raw={preview.fees.withdrawFee} decimals={route.destination.decimals} symbol={target} /> },
      { label: "App fee", value: preview.fees.appFeeBps === null ? <span className="unavailable">Unavailable</span> : bpsText(preview.fees.appFeeBps) },
      { label: "Refunds to", value: <Address value={config.refundRecipient} label="refund wallet" live={false} /> },
      { label: "Expires", value: expired ? <span className="neg">Expired · refresh the quote</span> : now ? `in ${formatDuration(preview.expiresAt - now)}` : "—" },
    ]} />
    <p className="quote-foot"><Icon name="lock" />Preview only: not funded, not executable, no deposit address exists.</p>
  </div>;
}

export function TidepoolPanel({ strategy, live, notice }: { strategy: FundingStrategy | null; live: boolean; notice: string | null }) {
  const pending = <span className="unavailable">Not configured</span>;
  return <div className="tidepool">
    <p className="muted">A community relayer from a testnet source chain into Aurora testnet, including Safe payouts. Test assets only; this is not official NEAR Intents settlement.</p>
    <ol className="ladder" aria-label="Minted is not delivered, delivered is not ready">
      {tidepoolLadder().map((step, index) => <li key={step.id} className="ladder-step">
        <span className="ladder-index">{index + 1}</span>
        <div><b>{step.title}</b><p>{step.detail}</p><small>{step.owner}</small></div>
        <Badge>{step.label}</Badge>
      </li>)}
    </ol>
    <div className="identity-cols">
      <div>
        <h4 className="mini-title">Current strategy stack</h4>
        <DescriptionList items={[
          { label: "Network", value: <>Aurora testnet <code>{AURORA_TESTNET}</code></> },
          { label: "Strategy Safe", value: strategy ? <Address value={strategy.safe} chainId={strategy.chainId} label="strategy Safe" live={live} /> : <span className="unavailable">Unavailable</span> },
          { label: "Stable token", value: strategy ? <>{strategy.symbol ?? "token"} <Address value={strategy.token} chainId={strategy.chainId} label="strategy token" live={live} /></> : <span className="unavailable">Unavailable</span> },
        ]} />
        <p className="panel-foot">{strategy ? `${live ? `${strategy.source ?? "Trusted configuration"} · not independently verified` : "Fixture identity"}. Original testnet deployment, not the Tidepool destination.` : notice ?? "Loads from the local funding API."}</p>
      </div>
      <div>
        <h4 className="mini-title">Tidepool would deliver</h4>
        <DescriptionList items={[
          { label: "Source network", hint: "announced: Arbitrum Sepolia", value: pending },
          { label: "Recipient Safe", hint: "chosen by A/B", value: pending },
          { label: "Delivered token", hint: "differs from the strategy token", value: pending },
          { label: "Status feed", value: <span className="unavailable">Not connected</span> },
        ]} />
      </div>
    </div>
    <Notice tone="warning" title="Tidepool's test USDC is not the current strategy token"><p>Test-only pool usage is permitted for A/B's compatible stack, which is theirs to deliver. A delivery of another token never makes a strategy ready.</p></Notice>
    <Button variant="locked" size="lg" block icon="lock" disabled>No Tidepool quote · integration pending</Button>
    <details className="disclosure flush">
      <summary>What unlocks this source?</summary>
      <div className="disclosure-body"><ul className="check-list">
        <li className="wait"><Icon name="lock" /><div><b>A/B: Tidepool adapter, signature verification, compatible contracts and pool, bridge execution</b></div></li>
        <li className="wait"><Icon name="lock" /><div><b>A/B: a read-only route, status and receipt interface for the local API</b></div></li>
        <li className="wait"><Icon name="lock" /><div><b>A: a verified testnet route and funding-record support for Aurora testnet</b></div></li>
        <li className="wait"><Icon name="lock" /><div><b>Team: the destination Safe and the token that strategy accepts</b></div></li>
      </ul><p>Until then this source shows identities only. It invents no route, quote or live status.</p></div>
    </details>
  </div>;
}

export function ScenarioPicker({ scenarios, selected, onSelect, busy }: { scenarios: FixtureScenario[]; selected: string | null; onSelect: (id: string) => void; busy: boolean }) {
  const current = scenarios.find((scenario) => scenario.id === selected);
  return <div className="scenarios" aria-labelledby="scenario-heading">
    <div className="scenarios-head"><h4 id="scenario-heading" className="mini-title">Every funding state, before real money moves</h4><Badge tone="warning">Fixture data</Badge></div>
    {(["Progress", "Outcomes", "Problems"] as const).map((group) => <div className="scenario-group" key={group}>
      <span className="scenario-group-label">{group}</span>
      <div className="scenario-buttons">{scenarios.filter((scenario) => scenario.group === group).map((scenario) =>
        <button type="button" key={scenario.id} data-scenario={scenario.id} className={selected === scenario.id ? "active" : undefined} aria-pressed={selected === scenario.id} disabled={busy} onClick={() => onSelect(scenario.id)}>{scenario.label}</button>)}
      </div>
    </div>)}
    <p className="panel-foot">{current ? current.description : "Pick a state to see how the transfer status and readiness respond. Fixture records are never shown as verified."}</p>
  </div>;
}

// Funding delivered and strategy ready are separate facts from separate sources, shown side by side.
export function ReadinessCard({ config, delivery, readiness, live }: { config: FundingConfig; delivery: DeliverySummary; readiness: StrategyReadiness; live: boolean }) {
  const prerequisites = roundEligibility(config);
  const strategy = config.strategy;
  const box = (label: string, value: ReactNode, detail: string, source: string, tone: Tone, attr: Record<string, string>) =>
    <div className={`fact-box tone-${tone}`} {...attr}><span>{label}</span><b>{value}</b><p>{detail}</p><small>{source}</small></div>;
  return <section className="card" aria-labelledby="readiness-heading">
    <header className="card-header"><div><h2 id="readiness-heading"><Icon name="shield" />Readiness</h2><p>Delivered funds are not automatically ready to trade.</p></div>
      <Badge tone={readiness.ready ? "success" : "neutral"} dot>{readiness.ready ? "Ready to run strategy" : "Strategy not ready"}</Badge></header>
    <div className="card-body stack">
      <div className="fact-pair">
        {box("Funding delivered", delivery.label, delivery.detail, "From verified receipts", SUMMARY_TONE[delivery.tone], { "data-delivery": delivery.state })}
        {box("Strategy ready", readiness.label, readiness.detail, "Only from the funding service", SUMMARY_TONE[readiness.tone], { "data-readiness": readiness.state })}
      </div>
      {readiness.failures.length ? <ul className="reasons" aria-label="Why the strategy is not ready">{readiness.failures.map((code) => <li key={code}><code>{code}</code><span>{READINESS_FAILURES[code] ?? "Unknown reason."}</span></li>)}</ul> : null}
      <DescriptionList items={[
        { label: "1Click deposits land on", value: <><i className="dot mainnet" />Aurora mainnet</> },
        { label: "Strategy rounds run on", value: <><i className="dot testnet" />{networkName(config.eligibility.roundChainId)}</> },
        ...(strategy ? [
          { label: "Strategy Safe", value: <Address value={strategy.safe} chainId={strategy.chainId} label="strategy Safe" live={live} /> },
          { label: "Strategy token", value: <>{strategy.symbol ?? "token"} · {strategy.decimals} dp <Address value={strategy.token} chainId={strategy.chainId} label="strategy token" live={live} /></> },
        ] : [{ label: "Strategy identity", value: <span className="unavailable">Not configured</span> }]),
      ]} />
      <div>
        <h4 className="mini-title">Round prerequisites</h4>
        <ul className="check-list">{prerequisites.checks.map((check) => <li key={check.id} className={check.ok ? "ok" : "no"}><Icon name={check.ok ? "check" : "cross"} /><div><b>{check.label}</b><p>{check.detail}</p></div></li>)}</ul>
      </div>
      <p className="panel-foot">The funding service grants readiness once (prepareRound), after verified delivery, for the same network, Safe and stable token. This page never marks a Safe ready on its own.</p>
    </div>
  </section>;
}
