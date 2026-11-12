"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { RouteFlow, type FlowState } from "@/components/funding/RouteFlow";
import { StatusTracker } from "@/components/funding/StatusTracker";
import { BridgeCard, JourneyStrip, LaneSelector, NetworkTruth, ReadinessCard, ScenarioExplorer, TidepoolLaneCard, amountValidation } from "@/components/funding/FundingPanels";
import { Icon, useNow } from "@/components/funding/primitives";
import {
  AURORA_MAINNET, AURORA_TESTNET, LANE_ORDER, classifyFunding, deliverySummary, laneFromSearch, laneStatus, networkName, shortHex, strategyReadiness,
  type FundingConfig, type FundingPreview, type LaneId, type LaneStatus,
} from "@/lib/funding/model.mjs";
import { FIXTURE_LABEL } from "@/lib/funding/fixtures.mjs";
import { FundingApiUnavailable, createApiFundingLoader, createFixtureFundingLoader, type FundingLoader, type FundingSource, type LoadedRecord } from "@/lib/funding/loader";

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
  const [lane, setLane] = useState<LaneId>("official");
  // The data source most recently requested; the loader state lags behind it while a connection is in flight.
  const wanted = useRef<FundingSource | null>(null);
  // Request counters: a response is applied only if no newer connect/preview/record request has started since.
  const serial = useRef(0);
  const previewSerial = useRef(0);
  const recordSerial = useRef(0);

  const connect = useCallback(async (next: FundingLoader) => {
    const id = ++serial.current;
    wanted.current = next.source;
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
    const initial = laneFromSearch(window.location.search);
    setLane(initial);
    void connect(initial === "fixtures" ? createFixtureFundingLoader() : createApiFundingLoader());
  }, [connect]);

  // Fixtures use the in-browser loader; the official and Tidepool lanes read the local API (Tidepool: identities only).
  function selectLane(next: LaneId) {
    setLane(next);
    const source: FundingSource = next === "fixtures" ? "fixture" : "api";
    if (wanted.current !== source) void connect(source === "fixture" ? createFixtureFundingLoader() : createApiFundingLoader());
    const url = new URL(window.location.href);
    url.searchParams.delete("fixtures"); url.searchParams.delete("lane");
    if (next === "fixtures") url.searchParams.set("fixtures", "1");
    if (next === "tidepool") url.searchParams.set("lane", "tidepool");
    window.history.replaceState(null, "", url);
  }

  const route = config?.routes.find((item) => item.routeId === routeId) ?? null;
  const isFixture = loader?.source === "fixture";
  // Live styling, explorer links and "trusted config" labels only when the API itself reports live configuration.
  const liveConfig = !isFixture && config?.evidence === "live";
  const scenarios = loader?.scenarios() ?? [];
  // Fixture records are never polled, so their fetch time cannot indicate a lost connection.
  const display = useMemo(() => (tracked && config && now
    ? classifyFunding(tracked.record, { config, now, receivedAt: isFixture ? now : tracked.receivedAt }) : null), [tracked, config, now, isFixture]);
  const bucket = display?.bucket ?? null;
  // Delivery comes from receipts; strategy readiness only from the funding service's readiness record.
  const delivery = deliverySummary(display);
  const readiness = strategyReadiness(tracked?.record ?? null, display, config);
  const laneStatuses = Object.fromEntries(LANE_ORDER.map((id) => [id, laneStatus(id, { source: loader?.source ?? null, phase, config })])) as Record<LaneId, LaneStatus>;
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

  const banner = lane === "tidepool" ? { tone: "warning", label: "PENDING INTEGRATION", text: "Tidepool community testnet lane · identities only, no route, quote or live status" }
    : phase === "connecting" ? { tone: "neutral", label: "CONNECTING", text: "Checking the local funding API…" }
    : isFixture ? { tone: "fixture", label: "FIXTURE MODE", text: `${FIXTURE_LABEL}. Safe, wallet and transaction values are fake.` }
    : phase === "ready" && !liveConfig ? { tone: "fixture", label: "API FIXTURE DATA", text: "The local API reports fixture-quality configuration. Nothing here is live evidence." }
    : phase === "ready" ? (config?.mode === "live-preview"
      ? { tone: "live", label: "LIVE DRY QUOTES", text: "NEAR Intents 1Click dry quotes for the trusted Safe · signing disabled" }
      : { tone: "live", label: "FUNDING SERVICE", text: "Shared funding service records · signing disabled" })
    : phase === "unavailable" ? { tone: "warning", label: "API NOT CONNECTED", text: notice ?? "The local funding API is not available." }
    : { tone: "danger", label: "CONFIGURATION REJECTED", text: notice ?? "The funding configuration was rejected." };
  const status = lane === "tidepool" ? { label: "Integration pending", tone: "warn" as const }
    : phase === "ready" ? (liveConfig ? { label: "Live dry quotes", tone: "ok" as const } : { label: "Fixture mode", tone: "warn" as const })
    : phase === "connecting" ? { label: "Connecting", tone: "pending" as const } : { label: "API offline", tone: "off" as const };

  const shellNetwork = lane === "tidepool" ? { label: "Aurora testnet", chainId: AURORA_TESTNET, tone: "testnet" as const }
    : lane === "fixtures" ? { label: "Fixture data", chainId: null, tone: "local" as const }
    : { label: "Aurora mainnet", chainId: AURORA_MAINNET, tone: "mainnet" as const };

  return <AppShell network={shellNetwork} status={status}>
    <div className={`mode-strip tone-${banner.tone}`} role="status">
      <span className="mode-label">{banner.label}</span>
      <span className="mode-text">{banner.text}</span>
    </div>

    <section className="page-head">
      <div>
        <span className="kicker">Step 01 · Funding before a round</span>
        <h1>Fund your <span className="grad-text">Trading Safe</span></h1>
        <p className="lede">Bridge stablecoins from your wallet through NEAR Intents into the Safe you control on Aurora, before any round begins. Progress is proven by receipts, never by a status message alone.</p>
      </div>
      <NetworkTruth roundChainId={config?.eligibility.roundChainId ?? AURORA_TESTNET} />
    </section>

    <LaneSelector lane={lane} statuses={laneStatuses} onSelect={selectLane} />

    {phase === "connecting" && <div className="card loading-card" aria-busy="true"><span className="spinner" />Loading funding configuration…</div>}

    {lane !== "tidepool" && (phase === "unavailable" || phase === "rejected") && <section className="card connect-card">
      <span className="empty-ico">{phase === "rejected" ? <Icon name="alert" /> : <Icon name="route" />}</span>
      <div>
        <h3>{phase === "rejected" ? "The funding configuration was rejected" : "The funding API is not connected"}</h3>
        <p>{notice}</p>
        {phase === "unavailable" && <p>Run the full local demo with live dry quotes: <code>bash scripts/docker-demo/up.sh</code> (Docker), or <code>WAVEFUND_FUNDING=live-preview npm run demo:local</code> in a prepared environment. Previews ask NEAR Intents 1Click for a dry quote only. Nothing is signed, funded or sent.</p>}
        <div className="connect-actions">
          <button type="button" className="btn btn-primary" onClick={() => selectLane("fixtures")}><Icon name="layers" /><span>Explore labelled fixtures</span></button>
          <button type="button" className="btn btn-ghost" onClick={() => void connect(createApiFundingLoader())}><Icon name="refund" />Retry local API</button>
        </div>
      </div>
    </section>}

    {lane === "tidepool" && phase !== "connecting" && <div className="fund-layout">
      <div className="fund-main"><TidepoolLaneCard strategy={phase === "ready" ? config?.strategy ?? null : null} live={liveConfig} notice={phase === "ready" ? null : notice} /></div>
      <div className="fund-side">
        {phase === "ready" && config
          // Lanes never share evidence: a record tracked on the official lane is not shown here.
          ? <ReadinessCard config={config} delivery={deliverySummary(null)} readiness={strategyReadiness(null, null, config)} live={liveConfig} />
          : <p className="side-note"><Icon name="eye" />Strategy identities load from the local funding API, which is not connected. Nothing on this lane is simulated.</p>}
      </div>
    </div>}

    {lane !== "tidepool" && phase === "ready" && config && <>
      {isFixture && <ScenarioExplorer scenarios={scenarios} selected={scenarioId} onSelect={(id) => void loadRecord(id, true)} busy={tracking} />}
      <div className="fund-layout">
        <div className="fund-main">
          {route ? <BridgeCard config={config} live={liveConfig} route={route} onRoute={changeRoute} amountText={amountText} onAmountChange={changeAmount}
            onPreview={(raw) => void requestPreview(raw)} previewing={previewing} previewError={previewError} preview={shownPreview} now={now}
            canPreview={config.capabilities.preview && route.previewAvailable} />
            : <div className="card empty"><span className="empty-ico"><Icon name="route" /></span><div><h3>No supported route</h3><p>The configuration lists no route that can be previewed.</p></div></div>}
        </div>
        <div className="fund-side">
          <RouteFlow state={flow}
            sourceLabel={route ? `${networkName(route.source.chainId)} · ${route.source.symbol ?? "token"}` : "Supported source chain"}
            safeLabel={`Aurora · ${shortHex(config.destination.safe)}`} />
          <StatusTracker record={tracked?.record ?? null} display={display} config={config} now={now} loading={tracking}
            scenarioLabel={isFixture ? scenarios.find((scenario) => scenario.id === scenarioId)?.label ?? null : null} />
          {trackError && <p className="inline-error" role="alert"><Icon name="alert" />{trackError}</p>}
          {!isFixture && config.capabilities.records && <form className="card track-form" onSubmit={(event) => { event.preventDefault(); void loadRecord(trackInput.trim(), false); }}>
            <label htmlFor="track-id">Track a funding record</label>
            <div><input id="track-id" value={trackInput} onChange={(event) => setTrackInput(event.target.value)} placeholder="fundingId" maxLength={128} autoComplete="off" spellCheck={false} />
              <button type="submit" className="btn btn-ghost" disabled={!trackInput.trim() || tracking}>Track</button></div>
          </form>}
          {!isFixture && !config.capabilities.records && <p className="side-note"><Icon name="eye" />Funding records are not connected to this API yet. Dry-quote previews never create a record.</p>}
          <ReadinessCard config={config} delivery={delivery} readiness={readiness} live={liveConfig} />
        </div>
      </div>
    </>}

    <JourneyStrip />
  </AppShell>;
}
