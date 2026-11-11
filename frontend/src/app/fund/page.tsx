"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Brand, JourneyNav } from "@/components/JourneyNav";
import { RouteFlow, type FlowState } from "@/components/funding/RouteFlow";
import { StatusTracker } from "@/components/funding/StatusTracker";
import { AmountStep, DestinationCard, EligibilityCard, JourneyStrip, NetworkTruth, RouteOptions, ScenarioExplorer, SendStep, StepCard, amountValidation } from "@/components/funding/FundingPanels";
import { Icon, Pill, useNow } from "@/components/funding/primitives";
import { AURORA_MAINNET, AURORA_TESTNET, classifyFunding, networkName, shortHex, type FundingConfig, type FundingPreview } from "@/lib/funding/model.mjs";
import { FIXTURE_LABEL } from "@/lib/funding/fixtures.mjs";
import { FundingApiUnavailable, createApiFundingLoader, createFixtureFundingLoader, type FundingLoader, type LoadedRecord } from "@/lib/funding/loader";

type Phase = "connecting" | "ready" | "unavailable" | "rejected";
const TERMINAL = new Set(["delivered", "refunded"]);

function recordId(record: unknown): string | null {
  if (!record || typeof record !== "object") return null;
  const value = (record as { fundingId?: unknown }).fundingId;
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value) ? value : null;
}

export default function FundPage() {
  const now = useNow();
  const [loader, setLoader] = useState<FundingLoader | null>(null);
  const [phase, setPhase] = useState<Phase>("connecting");
  const [notice, setNotice] = useState<string | null>(null);
  const [config, setConfig] = useState<FundingConfig | null>(null);
  const [routeId, setRouteId] = useState<string | null>(null);
  const [amountText, setAmountText] = useState("25");
  const [preview, setPreview] = useState<FundingPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [scenarioId, setScenarioId] = useState<string | null>(null);
  const [tracked, setTracked] = useState<LoadedRecord | null>(null);
  const [trackInput, setTrackInput] = useState("");
  const [trackError, setTrackError] = useState<string | null>(null);
  const [tracking, setTracking] = useState(false);
  const [pollTick, setPollTick] = useState(0);
  // Request counters: a response is applied only if no newer connect/preview/record request has started since.
  const serial = useRef(0);
  const previewSerial = useRef(0);
  const recordSerial = useRef(0);

  const connect = useCallback(async (next: FundingLoader) => {
    const id = ++serial.current;
    previewSerial.current++; recordSerial.current++;
    setPhase("connecting"); setNotice(null); setPreview(null); setPreviewError(null); setPreviewing(false); setTracked(null); setScenarioId(null); setTrackError(null); setTracking(false);
    try {
      const loaded = await next.config();
      if (id !== serial.current) return;
      setLoader(next); setConfig(loaded);
      setRouteId(loaded.routes.find((route) => route.previewAvailable)?.routeId ?? loaded.routes[0]?.routeId ?? null);
      setPhase("ready");
    } catch (error) {
      if (id !== serial.current) return;
      setLoader(next); setConfig(null);
      setPhase(error instanceof FundingApiUnavailable ? "unavailable" : "rejected");
      setNotice(error instanceof Error ? error.message : "The funding configuration could not be loaded.");
    }
  }, []);

  useEffect(() => {
    const fixtures = new URLSearchParams(window.location.search).get("fixtures") === "1";
    void connect(fixtures ? createFixtureFundingLoader() : createApiFundingLoader());
  }, [connect]);

  const route = config?.routes.find((item) => item.routeId === routeId) ?? null;
  const isFixture = loader?.source === "fixture";
  // Live styling, explorer links and "trusted config" labels only when the API itself reports live configuration.
  const liveConfig = !isFixture && config?.evidence === "live";
  const scenarios = loader?.scenarios() ?? [];
  // Fixture records are never polled, so their fetch time cannot indicate a lost connection.
  const display = useMemo(() => (tracked && config && now
    ? classifyFunding(tracked.record, { config, now, receivedAt: isFixture ? now : tracked.receivedAt }) : null), [tracked, config, now, isFixture]);
  const bucket = display?.bucket ?? null;
  // A quote is shown only for the route and exact amount currently selected.
  const currentRaw = route ? amountValidation(route, amountText).raw : null;
  const shownPreview = preview && route && preview.routeId === route.routeId && preview.amounts.amountIn === currentRaw ? preview : null;

  // Live records refresh while unresolved. A failed refresh keeps the last snapshot (the tracker then warns it is stale)
  // and re-arms the timer through pollTick, so one transient error does not stop updates.
  useEffect(() => {
    if (!loader || loader.source !== "api" || !tracked || !bucket || TERMINAL.has(bucket)) return;
    const id = recordId(tracked.record);
    if (!id) return;
    const started = recordSerial.current;
    const timer = setTimeout(() => {
      loader.record(id).then(
        (next) => { if (started === recordSerial.current) setTracked(next); },
        () => { if (started === recordSerial.current) setPollTick((tick) => tick + 1); },
      );
    }, 5000);
    return () => clearTimeout(timer);
  }, [loader, tracked, bucket, pollTick]);

  function changeAmount(value: string) { previewSerial.current++; setAmountText(value); setPreview(null); setPreviewError(null); setPreviewing(false); }
  function changeRoute(id: string) { previewSerial.current++; setRouteId(id); setPreview(null); setPreviewError(null); setPreviewing(false); }

  async function requestPreview(raw: string) {
    if (!loader || !config || !route?.routeId) return;
    const id = ++previewSerial.current;
    setPreviewing(true); setPreviewError(null);
    try {
      const result = await loader.preview(route.routeId, raw, config);
      if (id === previewSerial.current) setPreview(result);
    } catch (error) {
      if (id === previewSerial.current) { setPreview(null); setPreviewError(error instanceof Error ? error.message : "The dry quote could not be previewed."); }
    } finally {
      if (id === previewSerial.current) setPreviewing(false);
    }
  }

  async function loadRecord(fundingId: string, scenario: boolean) {
    if (!loader || !fundingId) return;
    const id = ++recordSerial.current;
    setTracking(true); setTrackError(null);
    try {
      const result = await loader.record(fundingId);
      // The scenario label switches together with its record, never ahead of it.
      if (id === recordSerial.current) { setTracked(result); setScenarioId(scenario ? fundingId : null); }
    } catch (error) {
      if (id === recordSerial.current) { setTracked(null); setScenarioId(null); setTrackError(error instanceof Error ? error.message : "The funding record could not be loaded."); }
    } finally {
      if (id === recordSerial.current) setTracking(false);
    }
  }

  const flow: FlowState = display
    ? { step: display.step, halted: display.halted, bucket: display.bucket, preview: false, verified: display.verified, evidence: display.evidence }
    : { step: 0, halted: false, bucket: null, preview: Boolean(shownPreview), verified: false, evidence: liveConfig ? "none" : "fixture" };

  const banner = phase === "connecting" ? { tone: "neutral", label: "CONNECTING", text: "Checking the local funding API…" }
    : isFixture ? { tone: "fixture", label: "FIXTURE EXPLORER", text: `${FIXTURE_LABEL}. Safe, wallet and transaction values are fake.` }
    : phase === "ready" && !liveConfig ? { tone: "fixture", label: "API FIXTURE DATA", text: "The local API reports fixture-quality configuration. Nothing here is live evidence." }
    : phase === "ready" ? (config?.mode === "live-preview"
      ? { tone: "live", label: "LIVE DRY QUOTES", text: "Local API · NEAR Intents 1Click dry quotes for the trusted Safe · signing disabled" }
      : { tone: "live", label: "FUNDING SERVICE", text: "Local API · shared funding service records · signing disabled" })
    : phase === "unavailable" ? { tone: "warning", label: "API NOT CONNECTED", text: notice ?? "The local funding API is not available." }
    : { tone: "danger", label: "CONFIGURATION REJECTED", text: notice ?? "The funding configuration was rejected." };

  return <main className="shell fund-shell">
    <header className="masthead">
      <Brand />
      <div className="header-right"><JourneyNav /><span className="network-tag">AURORA MAINNET <span>{AURORA_MAINNET}</span></span></div>
    </header>

    <div className={`mode-banner tone-${banner.tone}`} role="status">
      <span className="notice-label">{banner.label}</span>
      <span className="mode-text">{banner.text}</span>
      {phase !== "connecting" && (isFixture
        ? <button type="button" className="mode-action" onClick={() => void connect(createApiFundingLoader())}>Use local API</button>
        : <button type="button" className="mode-action" onClick={() => void connect(createFixtureFundingLoader())}>Explore fixture states</button>)}
    </div>

    <NetworkTruth roundChainId={config?.eligibility.roundChainId ?? AURORA_TESTNET} />

    <section className="fund-hero">
      <div className="fund-hero-copy">
        <p className="eyebrow"><span />STEP 01 · FUNDING BEFORE A ROUND</p>
        <h1>Fund your Trading Safe.<br /><em>From another chain, straight into your custody.</em></h1>
        <p className="hero-description">Move stablecoins from your wallet through NEAR Intents into the Safe you control on Aurora mainnet, before any round begins. Progress is proven by receipts, never by a status message alone.</p>
        <ul className="hero-facts">
          <li><Icon name="safe" /><span><b>Your Safe</b>receives the funds</span></li>
          <li><Icon name="intents" /><span><b>NEAR Intents</b>routes them</span></li>
          <li><Icon name="shield" /><span><b>Receipts</b>prove delivery</span></li>
        </ul>
      </div>
      <RouteFlow state={flow}
        sourceLabel={route ? `${networkName(route.source.chainId)} · ${route.source.symbol ?? "token"}` : "Supported source chain"}
        safeLabel={config ? `Aurora mainnet · ${shortHex(config.destination.safe)}` : "Aurora mainnet"} />
    </section>

    {phase === "connecting" && <div className="fund-loading" aria-busy="true"><span className="spinner" />Loading funding configuration…</div>}

    {(phase === "unavailable" || phase === "rejected") && <section className="connect-panel">
      <span className="empty-icon">{phase === "rejected" ? "!" : "↗"}</span>
      <div>
        <h3>{phase === "rejected" ? "The funding configuration was rejected" : "The funding API is not connected"}</h3>
        <p>{notice}</p>
        {phase === "unavailable" && <p>Start the local API with dry-quote preview: <code>WAVEFUND_FUNDING=live-preview npm run dev:api</code>. Previews ask NEAR Intents 1Click for a dry quote only. Nothing is signed, funded or sent.</p>}
        <div className="connect-actions">
          <button type="button" className="primary-button" onClick={() => void connect(createFixtureFundingLoader())}><span>Explore labelled fixtures</span><Icon name="arrow" /></button>
          <button type="button" className="secondary-button" onClick={() => void connect(createApiFundingLoader())}>Retry local API</button>
        </div>
      </div>
    </section>}

    {phase === "ready" && config && <>
      {isFixture && <ScenarioExplorer scenarios={scenarios} selected={scenarioId} onSelect={(id) => void loadRecord(id, true)} busy={tracking} />}
      <div className="fund-grid">
        <div className="fund-steps">
          <StepCard index={1} title="Destination" state="done" kicker={<Pill tone="muted">Not editable</Pill>}>
            <DestinationCard config={config} live={liveConfig} />
          </StepCard>
          <StepCard index={2} title="Source route" state={route ? "done" : "active"} kicker={<span>{config.routes.length} supported · {config.unsupported.length} unavailable</span>}>
            <RouteOptions config={config} selected={routeId} onSelect={changeRoute} live={liveConfig} />
          </StepCard>
          <StepCard index={3} title="Amount & dry quote" state={shownPreview ? "done" : "active"} kicker={<Pill tone="violet">Preview only</Pill>}>
            {route ? <AmountStep route={route} config={config} amountText={amountText} onAmountChange={changeAmount} onPreview={(raw) => void requestPreview(raw)}
              previewing={previewing} previewError={previewError} preview={shownPreview} now={now} canPreview={config.capabilities.preview && route.previewAvailable} />
              : <p className="panel-empty">Choose a supported route first.</p>}
          </StepCard>
          <StepCard index={4} title="Send from wallet" state="locked" kicker={<Pill tone="warning">Disabled for review</Pill>}>
            {route ? <SendStep preview={shownPreview} route={route} /> : <p className="panel-empty">Choose a supported route first.</p>}
          </StepCard>
        </div>
        <aside className="fund-side">
          <StatusTracker record={tracked?.record ?? null} display={display} config={config} now={now} loading={tracking}
            scenarioLabel={isFixture ? scenarios.find((scenario) => scenario.id === scenarioId)?.label ?? null : null} />
          {trackError && <p className="inline-error" role="alert"><Icon name="alert" />{trackError}</p>}
          {!isFixture && config.capabilities.records && <form className="panel track-form" onSubmit={(event) => { event.preventDefault(); void loadRecord(trackInput.trim(), false); }}>
            <label htmlFor="track-id">Track a funding record</label>
            <div><input id="track-id" value={trackInput} onChange={(event) => setTrackInput(event.target.value)} placeholder="fundingId" maxLength={128} autoComplete="off" spellCheck={false} />
              <button type="submit" className="secondary-button" disabled={!trackInput.trim() || tracking}>Track</button></div>
          </form>}
          {!isFixture && !config.capabilities.records && <p className="panel side-note"><Icon name="eye" />Funding records are not connected to this API yet. Dry-quote previews never create a record.</p>}
          <EligibilityCard config={config} />
        </aside>
      </div>
    </>}

    <JourneyStrip />

    <footer>
      <a className="footer-brand" href="/">wavefund.</a>
      <p>Funding preview for a manager-owned Aurora mainnet Safe. Dry quotes only: executable quotes, signing and fund movement are disabled in this build. Verified strategy rounds remain on Aurora testnet.</p>
      <span>YOUR SAFE.<br />VERIFIED FUNDING.</span>
    </footer>
  </main>;
}
