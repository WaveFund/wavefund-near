"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { AgentAvatar, ResultPanel, SignalBoard, StrategyCard, SwapVisual, type StrategyView } from "@/components/arena/parts";
import { CopyText, Icon } from "@/components/funding/primitives";
import { EmptyState, Notice, Skeleton } from "@/components/ui";
import { Cap, PageHead, Tip } from "@/components/v2";
import { useLocalState } from "@/lib/arena/hooks";
import { formatCountdown, defaultLiveStage, liveRound, liveSignals, type LiveRound } from "@/lib/arena/live.mjs";
import { percentFromBps, settlementShares, shortReturnX18, type StageId } from "@/lib/arena/model.mjs";
import { formatUnits } from "@/lib/funding/model.mjs";
import type { DemoState } from "@/lib/state";
import "../round.css";
import "./live.css";
import { WalletForecast } from "./wallet";

const usdc = (raw: string | null | undefined) => formatUnits(raw, 6) ?? "unavailable";
const eth = (raw: string | null | undefined) => formatUnits(raw, 18, { maxFraction: 6 }) ?? "unavailable";
const NOT_YET = "Not reached yet.";
const hhmmss = (ms: number) => new Date(ms).toLocaleTimeString("en-GB", { hour12: false });

type Dot = "done" | "current" | "upcoming" | "halted";

function Tabs({ view, selected, onSelect }: { view: LiveRound; selected: StageId; onSelect: (id: StageId) => void }) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  function onKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = view.stages.length - 1;
    const next = event.key === "ArrowRight" ? Math.min(last, index + 1) : event.key === "ArrowLeft" ? Math.max(0, index - 1) : event.key === "Home" ? 0 : event.key === "End" ? last : null;
    if (next === null) return;
    event.preventDefault(); onSelect(view.stages[next].id); refs.current[next]?.focus();
  }
  return <div className="rw-tabs-wrap"><div className="rw-tabs" role="tablist" aria-label="Round stages">
    {view.stages.map((stage, index) => {
      const on = stage.id === selected; const dot = stage.status as Dot;
      return <button key={stage.id} ref={(node) => { refs.current[index] = node; }} type="button" role="tab" id={`lv-tab-${stage.id}`} aria-selected={on} aria-controls="lv-panel" tabIndex={on ? 0 : -1}
        className="rw-tab" onClick={() => onSelect(stage.id)} onKeyDown={(event) => onKey(event, index)}>
        <span className={`rw-dot ${dot}`} aria-hidden="true">{dot === "done" ? <Icon name="check" /> : null}</span>
        <span>{stage.label}</span>
        <span className="sr-only">{`, ${dot === "done" ? "done" : dot === "current" ? "in progress" : dot === "halted" ? "halted" : "not reached"}`}</span>
      </button>;
    })}
  </div></div>;
}

function Fact({ label, value, unit, tip }: { label: string; value: ReactNode; unit?: string; tip?: ReactNode }) {
  return <div className="rw-fact"><span>{label}{tip ? <> <Tip label={`About ${label.toLowerCase()}`}>{tip}</Tip></> : null}</span><b className="num">{value}</b>{unit ? <small>{unit}</small> : null}</div>;
}

function toStrategies(view: LiveRound): StrategyView[] {
  return view.proposals.map((item) => ({ id: item.id, name: item.name, allocationBps: item.allocationBps, rationale: item.rationale, source: item.id === "0" ? "baseline" : /^NEAR AI \(TEE verified\) sha256:[a-f0-9]{64}/.test(item.rationale) ? "tee" : /^NEAR AI/i.test(item.rationale) ? "ai" : "fixture" }));
}

function Forecasting({ view }: { view: LiveRound }) {
  const sig = liveSignals(view); const strategies = toStrategies(view);
  if (!sig) return <p className="muted">Market prices are unavailable right now.</p>;
  const hold = sig.signals.holdPercent; const line = sig.signals.thresholdPercent;
  return <div className="rw-stack">
    <div>
      <div className="lv-basis"><h3>{sig.final ? "Final-window average" : "Live market price"}</h3>
        <Cap tone={sig.final ? "ok" : "warn"}>{sig.final ? "Final · decided selection" : "Indicative until trading closes"}</Cap>
        <Tip label="How selection works">Selection uses each strategy&apos;s average price over the final window (TWAP), not the instant price. A challenger is selected only if its average is strictly above Hold&apos;s average plus 0.5 probability points. Otherwise Hold stays.</Tip></div>
      <SignalBoard signals={sig.signals} strategies={strategies} />
      <p className="muted">Hold is the bar to beat: <b className="num">{hold.toFixed(1)}%</b> + 0.5 points = <b className="num">{line.toFixed(1)}%</b>.
        {sig.final ? "" : " The instant price is shown; the final-window average is only recorded when trading closes."}</p>
    </div>
  </div>;
}

function Selected({ view }: { view: LiveRound }) {
  const strategies = toStrategies(view); const winner = strategies.find((item) => item.id === view.winnerId);
  if (!winner) return <p className="muted">{view.status === 1 ? "Selection happens after trading closes." : "Selection is unavailable."}</p>;
  const sig = liveSignals(view);
  return <div className="rw-stack">
    <div className="rw-selected"><StrategyCard strategy={winner} selected compact />
      <div className="rw-row"><Cap>Margin over Hold: 0.5 points</Cap>{view.isHold ? <span className="muted">No challenger cleared the line, so Hold stays.</span> : null}</div></div>
    {sig?.final ? <SignalBoard signals={sig.signals} strategies={strategies} /> : null}
  </div>;
}

function Executed({ view, state }: { view: LiveRound; state: DemoState }) {
  const winner = toStrategies(view).find((item) => item.id === view.winnerId);
  if (view.cancelled) return <Notice tone="warning" title="Round cancelled"><p>The round did not finish normally, so no return was measured.</p></Notice>;
  return <div className="rw-stack">
    {view.isHold ? <div className="rw-hold"><AgentAvatar name="Hold" kind="hold" size="lg" /><div><b>Hold selected</b><div className="muted">The Safe keeps its current token quantities; no swap is needed.</div></div></div>
      : <SwapVisual spent={{ label: "Target set by the winner", amount: winner ? percentFromBps(winner.allocationBps) ?? "unavailable" : "unavailable", symbol: "test ETH weight" }}
          received={{ label: "The Safe holds now", amount: `${eth(state.safe.assetBalance)} ETH`, symbol: `and ${usdc(state.safe.stableBalance)} test USDC` }} />}
    <p className="muted">The round reports execution status. These are the Safe’s current balances, not a historical swap receipt.</p>
  </div>;
}

function Evaluated({ view }: { view: LiveRound }) {
  if (!view.settled) return <div className="rw-row"><Cap tone="warn" icon="clock">{view.phase}</Cap><span className="muted">The return is measured and recorded when the round settles.</span></div>;
  const shares = settlementShares(view.piX18);
  return <ResultPanel returnX18={view.realisedReturnX18} bounds={null} caption={<>Measured after trading closed · test assets</>}>
    <div className="facts-row">
      {shares ? <div className="fact"><span>LONG settles at</span><b className="num">{shares.long}</b><small>SHORT {shares.short}</small></div> : null}
    </div>
  </ResultPanel>;
}

function Body({ stage, view, state }: { stage: StageId; view: LiveRound; state: DemoState }) {
  const info = view.stages.find((item) => item.id === stage);
  if (!info || info.status === "upcoming") return <p className="muted">{NOT_YET}</p>;
  switch (stage) {
    case "funded": return <div className="rw-stack"><div className="rw-facts">
      <Fact label="Safe test USDC" value={usdc(state.safe.stableBalance)} unit="live" />
      <Fact label="Safe test ETH" value={eth(state.safe.assetBalance)} unit="live" />
      <Fact label="Forecast collateral" value={usdc(state.forecast.deposits)} unit="test USDC" tip="Forecasters' own deposits this round, held by the market. Separate from the Safe's budget." /></div>
      <div className="rw-row"><span className="muted">Safe</span><span className="lv-addr"><CopyText value={state.safe.address} label="Safe" /></span></div></div>;
    case "proposals": return view.challengers < 1 ? <p className="muted">Waiting for the first strategy proposals…</p>
      : <div className="strategy-grid rw-cards">{toStrategies(view).map((item) => <StrategyCard key={item.id} strategy={item} compact />)}</div>;
    case "forecasting": return <Forecasting view={view} />;
    case "selected": return <Selected view={view} />;
    case "executed": return <Executed view={view} state={state} />;
    case "evaluated": return <Evaluated view={view} />;
    case "redeemed": return <div className="rw-stack"><div className="rw-row"><Cap tone="ok" icon="check">Redemption open</Cap></div><p className="muted">Forecasters can now redeem. The read-only API does not report individual redemptions.</p></div>;
  }
}

export default function LiveRoundPage() {
  const local = useLocalState(5000);
  const [now, setNow] = useState(() => Date.now());
  const [picked, setPicked] = useState<StageId | null>(null);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const state = local.data;
  const aurora = state?.mode === "aurora-testnet-readonly";
  const view = aurora ? liveRound(state, now) : null;
  const source = { label: "Aurora testnet", tone: "testnet" as const, detail: aurora ? "live, read-only" : "unavailable" };

  if (local.loading && !state) return <AppShell source={source}><div className="stack">{[0, 1, 2].map((i) => <Skeleton key={i} height={64} />)}</div></AppShell>;

  if (!state || !view) {
    return <AppShell source={source}>
      <Link className="breadcrumb" href="/rounds"><Icon name="chevron" />Rounds</Link>
      <EmptyState icon="alert" title={state && aurora ? "No round is open on the testnet" : "Live view unavailable"}
        action={<Link className="btn btn-primary" href="/rounds">Back to rounds<Icon name="arrow" /></Link>}>
        {local.error && !state ? `${local.error} ` : null}
        {state && !aurora ? "The connected backend is not the read-only Aurora testnet monitor." : state ? "The testnet has no round yet. This page updates itself when one opens." : "Start the read-only monitor and reload."}
      </EmptyState>
      <WalletForecast view={null} />
    </AppShell>;
  }

  const selected: StageId = picked ?? (defaultLiveStage(view) as StageId);
  const index = view.stages.findIndex((item) => item.id === selected);
  const info = view.stages[index];
  const winnerName = view.winnerId === null ? null : view.isHold ? "Hold" : view.proposals.find((item) => item.id === view.winnerId)?.name ?? null;
  const headline = view.settled ? "Settled" : view.cancelled ? "Cancelled" : view.countdown && view.countdown.seconds ? formatCountdown(view.countdown.seconds) : view.phase;
  const checked = local.updatedAt ? hhmmss(local.updatedAt) : "never";

  return <AppShell source={source}>
    <Link className="breadcrumb" href="/rounds"><Icon name="chevron" />Rounds</Link>
    {local.error ? <div className="page-notice"><Notice tone="warning" title="Connection problem"><p>{local.error} Showing the last snapshot from {checked}.</p></Notice></div> : null}
    {view.note ? <div className="page-notice lv-note"><Notice tone="info" title="Price data unavailable"><p>{view.note} Values that depend on prices are not shown.</p></Notice></div> : null}
    <PageHead eyebrow="Aurora testnet · live monitor" title={<>Round {view.roundId} · Testnet Safe v2<span className={`lv-live ${view.live ? "" : "is-over"}`}>{view.live ? <i className="pulse-dot" aria-hidden="true" /> : null}{view.live ? "LIVE" : view.settled ? "SETTLED" : "CANCELLED"}</span></>}
      line={<span className="rw-caps"><Cap tone={view.settled ? "ok" : view.cancelled ? "bad" : "warn"}>{view.phase}</Cap><Cap>Test assets</Cap></span>} />
    <div className="rw-metrics">
      <div className="rw-metric"><b className="num">{headline}</b><span>{view.countdown && view.countdown.seconds ? `${view.countdown.target.toLowerCase()} · approx.` : "status"}</span></div>
      <div className="rw-metric"><b className="num">{winnerName ?? "—"}</b><span>{winnerName ? "selected" : "not selected yet"}</span></div>
      <div className="rw-metric"><b className="num">{view.settled ? shortReturnX18(view.realisedReturnX18) ?? "—" : "—"}</b><span>{view.settled ? "measured" : "not measured yet"}</span></div>
    </div>
    <Tabs view={view} selected={selected} onSelect={setPicked} />
    <section className="card rw-panel" role="tabpanel" id="lv-panel" aria-labelledby={`lv-tab-${selected}`} tabIndex={-1}>
      <header className="rw-panel-head"><h2>{info.label}</h2>
        {info.status === "done" ? <Cap tone="ok" icon="check">Recorded</Cap> : info.status === "current" ? <Cap tone="warn" icon="clock">In progress</Cap> : info.status === "halted" ? <Cap tone="bad" icon="alert">Halted</Cap> : <Cap>Not reached</Cap>}</header>
      <div className="rw-body"><Body key={selected} stage={selected} view={view} state={state} /></div>
    </section>
    <WalletForecast view={view} />
    <p className="lv-meta"><span>updated {checked}</span><span>polling every 5 s</span><span>chain times vs this device clock: approximate</span></p>
  </AppShell>;
}
