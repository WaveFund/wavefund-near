"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { flowSteps, type FlowState } from "@/components/funding/RouteFlow";
import { StatusTracker } from "@/components/funding/StatusTracker";
import { Tip } from "@/components/v2";
import Link from "next/link";
import { DepositForm, ReadinessCard, ScenarioPicker, TreasurySummary, amountValidation } from "@/components/funding/FundingPanels";
import { FreshCheckRow, TidepoolEvidence, TidepoolFundingSteps } from "@/components/tidepool/TidepoolParts";
import { Chip } from "@/components/arena/parts";
import { PageHead } from "@/components/v2";
import { Address, Icon, useNow } from "@/components/funding/primitives";
import { loadTidepoolDemo, runTidepoolFreshCheck } from "@/lib/record/loader";
import type { FreshCheck, TidepoolDemo } from "@/lib/tidepool/model.mjs";
import { Badge, Button, Card, CardHeader, DescriptionList, EmptyState, EvidenceBadge, Notice, SegmentedControl, Skeleton } from "@/components/ui";
import {
  AURORA_TESTNET, LANE_ORDER, classifyFunding, deliverySummary, formatUnits, laneFromSearch, networkName, shortHex, strategyReadiness,
  type FundingConfig, type FundingPreview, type LaneId,
} from "@/lib/funding/model.mjs";
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
  const [tidepool, setTidepool] = useState<TidepoolDemo | null>(null);
  const [tidepoolError, setTidepoolError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<FreshCheck | null>(null);
  const [freshing, setFreshing] = useState(false);
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

  // The Tidepool demonstration is loaded only for its own source and never mixed into the 1Click funding state.
  useEffect(() => {
    if (lane !== "tidepool" || tidepool) return;
    let active = true;
    loadTidepoolDemo().then((next) => { if (active) { setTidepool(next); setTidepoolError(null); } }, (error) => { if (active) setTidepoolError(error instanceof Error ? error.message : "Tidepool evidence is unavailable."); });
    return () => { active = false; };
  }, [lane, tidepool]);
  async function tidepoolFreshCheck() { setFreshing(true); try { setFresh(await runTidepoolFreshCheck()); } finally { setFreshing(false); } }

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
  const steps = flowSteps(flow, route ? `${networkName(route.source.chainId)} · ${route.source.symbol ?? "token"}` : "Supported source chain", config ? `Aurora · ${shortHex(config.destination.safe)}` : "Aurora");

  const usdc = (raw: string | null | undefined) => formatUnits(raw, 6) ?? "—";
  const source = lane === "tidepool" ? { label: "Aurora testnet", tone: "testnet" as const, detail: tidepool ? "saved evidence" : tidepoolError ? "unavailable" : "loading", status: tidepool ? "ok" as const : tidepoolError ? "off" as const : "pending" as const }
    : lane === "fixtures" ? { label: "Example data", tone: "fixture" as const, detail: "fake values" }
    : { label: "Aurora mainnet", tone: "mainnet" as const, detail: phase === "ready" ? (liveConfig ? "preview quotes" : "fixture config") : phase === "connecting" ? "connecting" : "API offline",
      status: phase === "ready" ? (liveConfig ? "ok" as const : "warn" as const) : phase === "connecting" ? "pending" as const : "off" as const };
  const laneOptions = LANE_ORDER.map((id) => ({ id, label: id === "official" ? "NEAR Intents · mainnet preview" : id === "tidepool" ? "Tidepool · completed testnet" : "Example states" }));
  const laneLine = lane === "official" ? "Official NEAR Intents 1Click deposits into the funding Safe on Aurora mainnet. Real assets, so quotes are previews and nothing can be sent."
    : lane === "tidepool" ? "A community testnet transfer that really happened: Arbitrum Sepolia test USDC into the Tidepool testnet Safe, later used by a strategy round. Not official NEAR Intents."
    : "Synthetic records with fake values, to see every transfer state (pending, delivered, refunded, needs review) without moving money.";

  const depositBody = phase === "connecting" ? <div className="stack">{[0, 1, 2].map((i) => <Skeleton key={i} height={44} />)}</div>
    : phase !== "ready" || !config ? <EmptyState icon={phase === "rejected" ? "alert" : "route"} title={phase === "rejected" ? "The funding configuration was rejected" : "The funding API is not connected"}
        action={<div className="page-actions"><Button variant="primary" icon="layers" onClick={() => selectLane("fixtures")}>Explore example states</Button><Button icon="refund" onClick={() => void connect(createApiFundingLoader())}>Retry local API</Button></div>}>
        {notice} Funding previews need the Wavefund API. <Tip label="For developers">Run bash scripts/docker-demo/up.sh for dry quotes.</Tip> Nothing is signed, funded or sent.
      </EmptyState>
    : <div className="stack-lg">
      {isFixture ? <ScenarioPicker scenarios={scenarios} selected={scenarioId} onSelect={(id) => void loadRecord(id, true)} busy={tracking} /> : null}
      {route ? <DepositForm config={config} live={liveConfig} route={route} onRoute={changeRoute} amountText={amountText} onAmountChange={changeAmount}
        onPreview={(raw) => void requestPreview(raw)} previewing={previewing} previewError={previewError} preview={shownPreview} now={now}
        canPreview={config.capabilities.preview && route.previewAvailable} steps={steps} />
        : <EmptyState icon="route" title="No supported source">The configuration lists no source that can be previewed.</EmptyState>}
    </div>;

  const tidepoolBody = tidepool ? <div className="stack">
      <TidepoolFundingSteps demo={tidepool} />
      <div className="facts-row">
        <div className="fact"><span>Sent</span><b>{usdc(tidepool.funding.sourceAmount)} test USDC</b><small>from Arbitrum Sepolia</small></div>
        <div className="fact"><span>Delivered to the Safe</span><b>{usdc(tidepool.funding.deliveredAmount)} test USDC</b><small>on Aurora testnet</small></div>
        <div className="fact"><span>Bridge cost</span><b>{usdc(tidepool.funding.bridgeCost)} test USDC</b><small>not strategy performance</small></div>
      </div>
      <FreshCheckRow fresh={fresh} freshing={freshing} onFresh={() => void tidepoolFreshCheck()} now={now} />
      <Button variant="locked" size="lg" block icon="lock" disabled>No live Tidepool route · history only</Button>
      <details className="tech bleed"><summary><Icon name="chevron" />Technical details: quote, recipient, settlement and receipts</summary><div className="tech-body"><TidepoolEvidence demo={tidepool} /></div></details>
    </div>
    : tidepoolError ? <Notice tone="warning" title="Tidepool evidence unavailable"><p>{tidepoolError}</p></Notice> : <div className="stack">{[0, 1, 2].map((i) => <Skeleton key={i} height={44} />)}</div>;

  const trackForm = !isFixture && config?.capabilities.records && lane !== "tidepool"
    ? <form className="track-form" onSubmit={(event) => { event.preventDefault(); void loadRecord(trackInput.trim(), false); }}>
      <label htmlFor="track-id" className="sr-only">Funding record id</label>
      <input id="track-id" className="input" value={trackInput} onChange={(event) => setTrackInput(event.target.value)} placeholder="Track a funding record by id" maxLength={128} autoComplete="off" spellCheck={false} />
      <Button type="submit" disabled={!trackInput.trim() || tracking}>Track</Button>
    </form> : null;

  return <AppShell source={source}>
    <Link className="breadcrumb" href="/portfolio?tab=funding"><Icon name="chevron" />Portfolio</Link>
    <PageHead eyebrow="Funding preview" title="Funding" line={laneLine} />
    <div className="section-head">
      <SegmentedControl label="Funding source" options={laneOptions} value={lane} onChange={selectLane} />
    </div>

    {config && phase === "ready" && lane !== "tidepool" ? <Card className="summary-card"><TreasurySummary config={config} live={liveConfig} />
      <div className="card-footer"><i className="dot mainnet" />NEAR Intents 1Click has no testnet, so mainnet deposits never enter testnet rounds. Testnet funding is a separate community source.</div></Card> : null}

    <div className="treasury-layout">
      <section className="card">
        <header className="card-header"><h2><Icon name="fund" />{lane === "tidepool" ? "Completed transfer" : "Deposit"}</h2>
          {lane === "fixtures" ? <Chip tone="fixture">Example data</Chip> : lane === "tidepool" ? <Chip tone="saved">Saved evidence</Chip> : liveConfig ? <Chip tone="live">Live preview quotes</Chip> : null}</header>
        <div className="card-body">{lane === "tidepool" ? tidepoolBody : depositBody}</div>
      </section>
      <div className="detail-side">
        {lane !== "tidepool" && config && phase === "ready" ? <StatusTracker record={tracked?.record ?? null} display={display} config={config} now={now} loading={tracking}
          scenarioLabel={isFixture ? scenarios.find((scenario) => scenario.id === scenarioId)?.label ?? null : null}>
          {trackError ? <div className="card-body"><p className="field-error" role="alert">{trackError}</p></div> : null}
          {trackForm ? <div className="card-footer">{trackForm}</div> : !isFixture ? <div className="card-footer">Funding records are not connected to this API yet. Preview quotes never create a record.</div> : null}
        </StatusTracker> : null}
        {lane === "tidepool"
          ? (tidepool ? <Card><CardHeader title="Funding to strategy" icon="route" actions={<EvidenceBadge kind="saved" />} sub="The delivered capital is the capital the strategy round used." />
              <div className="card-body"><DescriptionList items={[
                { label: "Same Safe and capital", value: <Badge tone="success" dot>Yes</Badge> },
                { label: "Prepared for the round", value: `${usdc(tidepool.funding.deliveredAmount)} test USDC` },
                { label: "Round", value: <>Round {tidepool.strategy.roundId ?? "—"} · engine <Address value={tidepool.contracts.engine} chainId={AURORA_TESTNET} label="engine" live /></> },
                { label: "Investment pool", value: <Address value={tidepool.contracts.investmentPair} chainId={AURORA_TESTNET} label="investment pool" live /> },
              ]} /><Link className="link" href={`/rounds/${tidepool.strategy.roundSlug}`} style={{ marginTop: 14 }}>Follow the round this funded<Icon name="arrow" /></Link>
              <p className="panel-foot">Mainnet readiness is unaffected: this testnet history never feeds the production funding records.</p></div></Card> : null)
          : config && phase === "ready" ? <ReadinessCard config={config} live={liveConfig} delivery={delivery} readiness={readiness} /> : null}
      </div>
    </div>
  </AppShell>;
}
