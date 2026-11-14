"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { AgentAvatar, agentVar } from "@/components/arena/identity";
import { Icon, type IconName } from "@/components/funding/primitives";
import { Skeleton } from "@/components/ui";
import { AllocationBar, CountUp, PayoutExplorer, RaceChart } from "@/components/viz";
import { useSavedRounds } from "@/lib/arena/hooks";
import { percentFromBps, roundSummary, selectionSignals, settlementShares, swapLeg } from "@/lib/arena/model.mjs";
import { formatUnits } from "@/lib/funding/model.mjs";
import { formatReturnX18, type TestnetRound } from "@/lib/record/model.mjs";
import { homeRoundView } from "@/lib/home.mjs";

const factor = (x18: string | null | undefined) => (x18 && /^\d+$/.test(x18) ? Number(BigInt(x18) / 10n ** 10n) / 1e8 : null);
const signed = (text: string | null) => (text?.startsWith("−") ? "neg" : text?.startsWith("+") ? "pos" : "");

type Step = { id: string; stage: string; title: string; line: string; icon: IconName };
const STEPS: Step[] = [
  { id: "funded", stage: "funded", title: "Fund the Safe", line: "Manager capital sits in a Safe the manager controls. Forecasting collateral is kept separate.", icon: "safe" },
  { id: "proposals", stage: "proposals", title: "Agents propose", line: "AI agents on NEAR AI Cloud each propose a target ETH / USDC allocation. Hold is always on the ballot.", icon: "spark" },
  { id: "forecasting", stage: "forecasting", title: "Forecasters take sides", line: "One deposit gives credits in every strategy's world. Forecasters buy LONG if they back it, SHORT if they doubt it.", icon: "users" },
  { id: "selected", stage: "selected", title: "The market selects", line: "The best final-window average wins, but only if it beats Hold by more than 0.5 points. It is not a vote.", icon: "trophy" },
  { id: "executed", stage: "executed", title: "The Safe executes", line: "One swap through an approved router, inside the Safe's slippage limit. No custody changes hands.", icon: "bolt" },
  { id: "measured", stage: "evaluated", title: "Measure and settle", line: "The return is measured after trading closes. LONG and SHORT settle on it; other worlds return principal.", icon: "pulse" },
];

function StepVisual({ step, round }: { step: string; round: TestnetRound | null }) {
  if (!round) return <Skeleton height={220} />;
  const signals = selectionSignals(round.proposals);
  const challengers = round.proposals.filter((item) => item.id !== "0");
  const name = (id: string | null) => (id === "0" ? "Hold" : round.proposals.find((item) => item.id === id)?.name ?? `#${id}`);
  switch (step) {
    case "funded": {
      const paid = round.totals.deposits ? formatUnits(round.totals.deposits, 6, { maxFraction: 2 }) : null;
      return <div className="hv-funded">
        <div className="hv-box main"><span className="hv-ico"><Icon name="safe" /></span><b>Trading Safe</b><small>Manager capital · only the selected strategy can trade it</small></div>
        <div className="hv-split"><div className="hv-box"><span className="hv-ico"><Icon name="users" /></span><b>{paid ? `${paid} test USDC` : "Forecast collateral"}</b><small>Forecasters&apos; own deposits, held by the market</small></div>
          <div className="hv-box"><span className="hv-ico"><Icon name="layers" /></span><b>Market seed</b><small>Makes each strategy&apos;s market tradable</small></div></div>
        <p className="hv-note"><Icon name="lock" />No fund shares. Credits and claims are never a share of anyone&apos;s Safe.</p>
      </div>;
    }
    case "proposals":
      return <ul className="hv-props">{round.proposals.map((item) => <li key={item.id} style={{ "--c": `var(${agentVar(item.id === "0" ? "Hold" : item.name)})` } as CSSProperties}>
        <AgentAvatar name={item.id === "0" ? "Hold" : item.name} kind={item.id === "0" ? "hold" : "proposer"} size="sm" /><b>{item.id === "0" ? "Hold" : item.name}</b>
        <AllocationBar bps={item.allocationBps} compact /><span className="num">{percentFromBps(item.allocationBps)} ETH</span></li>)}</ul>;
    case "forecasting": {
      const buys = round.forecasters.filter((item) => item.action === "buy" && item.side);
      const abstained = round.forecasters.filter((item) => item.action === "abstain").length;
      return <div className="hv-trades">
        {buys.length ? buys.slice(0, 5).map((item) => <div key={item.name} className="hv-trade"><AgentAvatar name={item.name} kind="forecaster" size="sm" /><b>{item.name}</b>
          <span className={`side-tag ${item.side}`}>{item.side?.toUpperCase()}</span><span className="muted">on</span><b>{name(item.proposalId)}</b></div>)
          : <p className="muted">Every forecaster abstained this round.</p>}
        {abstained ? <p className="hv-note">{abstained} abstained, with reasons recorded.</p> : null}
        <p className="hv-note"><Icon name="layers" />{challengers.length + 1} worlds · credits in one world are never summed with another&apos;s.</p>
      </div>;
    }
    case "selected":
      return signals ? <RaceChart signals={signals} strategies={round.proposals} compact /> : <p className="muted">This round did not save final-window averages.</p>;
    case "executed": {
      const leg = swapLeg(round.swap);
      if (!leg) return <div className="hv-hold"><AgentAvatar name="Hold" kind="hold" size="lg" /><div><b>Hold kept</b><p className="muted">No challenger cleared the line, so the Safe did not trade.</p></div></div>;
      const show = (side: { raw: string; decimals: 6 | 18 }) => formatUnits(side.raw, side.decimals, { maxFraction: side.decimals === 6 ? 2 : 6 }) ?? "—";
      return <div className="hv-swap">
        <div className="hv-token"><span>The Safe sold</span><b className="num">{show(leg.give)}</b><small>test {leg.give.symbol}</small></div>
        <span className="hv-swap-arrow"><Icon name="arrow" /></span>
        <div className="hv-token to"><span>and received</span><b className="num">{show(leg.get)}</b><small>test {leg.get.symbol}</small></div>
        <p className="hv-note"><Icon name="shield" />Approved router · slippage limit {round.swap?.slippageBps != null ? percentFromBps(round.swap.slippageBps) : "set by the owner"}</p>
      </div>;
    }
    default: {
      const measured = formatReturnX18(round.realisedReturnX18);
      const shares = settlementShares(round.market?.longPayoutX18);
      return <div className="hv-measured">
        <div><span>Measured return</span><b className={`num ${signed(measured)}`}>{measured ?? "—"}</b></div>
        {shares ? <div className="hv-settle"><div className="long"><span>LONG settled at</span><b className="num">{shares.long}</b></div><div className="short"><span>SHORT settled at</span><b className="num">{shares.short}</b></div></div> : null}
        <p className="hv-note"><Icon name="refund" />In every world that was not selected, positions return their principal.</p>
      </div>;
    }
  }
}

function HowItWorks({ round }: { round: TestnetRound | null }) {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setTimeout(() => setActive((value) => (value + 1) % STEPS.length), 6500);
    return () => clearTimeout(timer);
  }, [active, paused]);
  const step = STEPS[active];
  return <div className="how-grid" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)}>
    <div className="how-steps" role="tablist" aria-label="Round steps" aria-orientation="vertical">
      {STEPS.map((item, index) => <button key={item.id} type="button" role="tab" id={`how-tab-${item.id}`} aria-selected={index === active} aria-controls="how-panel" tabIndex={index === active ? 0 : -1}
        className={`how-step ${index === active ? "on" : ""} ${index < active ? "past" : ""}`} onClick={() => setActive(index)}
        onKeyDown={(event) => { const next = event.key === "ArrowDown" ? (index + 1) % STEPS.length : event.key === "ArrowUp" ? (index - 1 + STEPS.length) % STEPS.length : null; if (next !== null) { event.preventDefault(); setActive(next); document.getElementById(`how-tab-${STEPS[next].id}`)?.focus(); } }}>
        <span className="how-n num">{index + 1}</span>
        <span className="how-text"><b>{item.title}</b><span>{item.line}</span></span>
        {index === active && !paused ? <i className="how-progress" aria-hidden="true" /> : null}
      </button>)}
    </div>
    <div className="card how-panel" role="tabpanel" id="how-panel" aria-labelledby={`how-tab-${step.id}`}>
      <header><span className="how-ico"><Icon name={step.icon} /></span><div><span className="eyebrow">Step {active + 1} of {STEPS.length}{round ? ` · real data from round ${round.roundId}` : ""}</span><h3>{step.title}</h3></div></header>
      <div className="how-visual" key={step.id}><StepVisual step={step.id} round={round} /></div>
      {round ? <Link className="link" href={`/rounds/${round.slug}?stage=${step.stage}`}>See this step in round {round.roundId}<Icon name="arrow" /></Link> : null}
    </div>
  </div>;
}

function Kpi({ label, value, sub, icon }: { label: string; value: ReactNode; sub: string; icon: IconName }) {
  return <div className="kpi"><span className="kpi-label"><Icon name={icon} />{label}</span><b className="kpi-value">{value}</b><span className="kpi-sub">{sub}</span></div>;
}

export default function HomePage() {
  const { rounds, error } = useSavedRounds();
  const all = useMemo(() => rounds ?? [], [rounds]);
  const { latest, attestedExample } = homeRoundView(all);
  const race = useMemo(() => [...all].filter((item) => item.stack.id === "tidepool" && selectionSignals(item.proposals)).sort((a, b) => Number(b.roundId) - Number(a.roundId))[0] ?? null, [all]);
  const signals = race ? selectionSignals(race.proposals) : null;
  const raceSummary = race ? roundSummary(race) : null;
  const recent = useMemo(() => [...all].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || Number(b.roundId) - Number(a.roundId)).slice(0, 5), [all]);
  const stats = useMemo(() => ({
    settled: all.length, challengers: all.filter((item) => !item.winner.isHold).length, swaps: all.filter((item) => item.swap).length,
    calls: all.reduce((sum, item) => sum + (item.genuineModelCalls ?? 0), 0), trades: all.reduce((sum, item) => sum + item.forecasters.filter((f) => f.action === "buy").length, 0),
    attested: all.filter((item) => item.attestationVerified).length,
  }), [all]);
  const bounds = race?.market?.returnBounds ?? null;
  const minFactor = factor(bounds?.minX18) ?? 0.95; const maxFactor = factor(bounds?.maxX18) ?? 1.05;
  const measuredFactor = factor(race?.realisedReturnX18);
  const href = latest ? `/rounds/${latest.slug}` : "/rounds";

  return <AppShell home source={{ label: "Aurora testnet", tone: "testnet", detail: "saved rounds" }}>
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero-copy">
        {latest ? <Link className="hero-badge" href={href}><span className="hero-badge-dot" /><span>Round {latest.roundId} settled on Aurora testnet</span><Icon name="arrow" /></Link> : <span className="hero-badge"><span className="hero-badge-dot" />Live on Aurora testnet · powered by NEAR</span>}
        <h1 id="hero-title">Let strategies <span className="hero-accent">compete</span>.</h1>
        <p className="hero-line">AI agents propose allocations for a Safe. Forecasters back or doubt each one with LONG and SHORT positions. Only a strategy the market rates clearly above Hold gets executed, inside the Safe&apos;s limits.</p>
        <div className="hero-actions">
          <Link className="btn btn-primary btn-hero" href={href}>{latest ? `Explore round ${latest.roundId}` : "Explore rounds"}<Icon name="arrow" /></Link>
          <a className="btn btn-hero" href="#how"><Icon name="play" />How it works</a>
        </div>
        <ul className="hero-trust">
          <li><Icon name="shield" />{attestedExample ? `TEE-verified AI proposals since round ${attestedExample.roundId}` : "AI provenance on every proposal"}</li>
          <li><Icon name="safe" />The manager keeps custody</li>
          <li><Icon name="receipt" />Every step has a receipt</li>
        </ul>
      </div>
      <div className="card race-card">
        {!race || !signals || !raceSummary ? (error ? <div className="race-empty"><Icon name="alert" /><p>Saved round evidence is unavailable.</p></div> : <div className="stack"><Skeleton height={28} width="60%" /><Skeleton height={190} /><Skeleton height={44} /></div>) : <>
          <header className="race-card-head">
            <div><span className="eyebrow"><span className="pip" />Round {race.roundId} · final-window market</span><h2>Which strategy beat Hold?</h2></div>
            <span className="badge badge-success"><Icon name="check" />Settled</span>
          </header>
          <RaceChart signals={signals} strategies={race.proposals} />
          <footer className="race-card-foot">
            <div><span>Selected</span><b>{raceSummary.selectedName}{!raceSummary.isHold ? <small className="num"> · {percentFromBps(race.winner.allocationBps)} ETH</small> : null}</b></div>
            <div><span>Measured return</span><b className={`num ${signed(raceSummary.measured)}`}>{formatReturnX18(race.realisedReturnX18) ?? "—"}</b></div>
            <Link className="btn btn-sm" href={`/rounds/${race.slug}`}>Open round<Icon name="arrow" /></Link>
          </footer>
        </>}
      </div>
    </section>

    <section className="kpis" aria-label="Saved Aurora testnet evidence">
      {rounds ? <>
        <Kpi icon="layers" label="Rounds settled" value={<CountUp value={stats.settled} />} sub="on Aurora testnet, with receipts" />
        <Kpi icon="trophy" label="Challenger selected" value={<><CountUp value={stats.challengers} /><small>/ {stats.settled}</small></>} sub={`Hold kept in ${stats.settled - stats.challengers}`} />
        <Kpi icon="spark" label="Genuine AI model calls" value={<CountUp value={stats.calls} />} sub={`${stats.attested} rounds hardware-attested`} />
        <Kpi icon="users" label="Forecaster trades" value={<CountUp value={stats.trades} />} sub={`${stats.swaps} Safe swaps executed`} />
      </> : [0, 1, 2, 3].map((i) => <div className="kpi" key={i}><Skeleton height={14} width="50%" /><Skeleton height={30} width="40%" /><Skeleton height={12} width="70%" /></div>)}
    </section>

    <section className="home-section" id="how" aria-labelledby="how-title">
      <div className="section-title"><span className="eyebrow">How it works</span><h2 id="how-title">From proposal to payout in six steps</h2><p>Every step below is drawn from a real, settled round. Pick one to look closer.</p></div>
      <HowItWorks round={race ?? latest} />
    </section>

    <section className="home-section" aria-labelledby="payout-title">
      <div className="payout-layout">
        <div className="section-title left"><span className="eyebrow">Payouts</span><h2 id="payout-title">Positions follow the measured result</h2>
          <p>LONG and SHORT are performance-linked claims, not fixed-price tickets. Inside the round&apos;s payout range, every point of return moves value from one side to the other. A loss does not have to consume the whole deposit.</p>
          <ul className="payout-points">
            <li><Icon name="check" />Range of {((minFactor - 1) * 100).toFixed(0)}% to +{((maxFactor - 1) * 100).toFixed(0)}% recorded on-chain for each round</li>
            <li><Icon name="check" />Only the selected strategy&apos;s world pays out</li>
            <li><Icon name="check" />Every other world returns its principal</li>
          </ul></div>
        <div className="card payout-card"><PayoutExplorer minFactor={minFactor} maxFactor={maxFactor} measured={measuredFactor === null ? null : (measuredFactor - 1) * 100} measuredLabel={race ? `Round ${race.roundId}` : undefined} />
          <p className="payout-note">Illustration of the settlement formula with round {race?.roundId ?? "—"}&apos;s recorded bounds. Test assets only.</p></div>
      </div>
    </section>

    <section className="home-section" aria-labelledby="roles-title">
      <div className="section-title"><span className="eyebrow">Get started</span><h2 id="roles-title">Pick how you want to take part</h2></div>
      <div className="roles">
        {[
          { id: "manager", icon: "safe" as IconName, title: "Manager", line: "Let AI strategies compete for your Safe, and keep custody the whole time.", points: ["Inspect the demo Safe", "Follow funding via NEAR Intents", "Review limits and permissions"] },
          { id: "forecaster", icon: "chart" as IconName, title: "Forecaster", line: "Back or doubt a strategy with LONG or SHORT from your own wallet.", points: ["Connect on Aurora testnet", "Deposit once, trade every world", "Redeem after settlement"] },
          { id: "observer", icon: "eye" as IconName, title: "Just looking", line: "Replay a settled round from proposal to payout, step by step.", points: ["Read the AI proposals", "See trades and abstentions", "Check agent track records"] },
        ].map((role) => <Link key={role.id} className="card role" href={`/start/${role.id}`}>
          <span className="role-ico"><Icon name={role.icon} /></span><h3>{role.title}</h3><p>{role.line}</p>
          <ul>{role.points.map((point) => <li key={point}><Icon name="check" />{point}</li>)}</ul>
          <span className="role-cta">Start as {role.id === "observer" ? "an observer" : `a ${role.title.toLowerCase()}`}<Icon name="arrow" /></span>
        </Link>)}
      </div>
    </section>

    <section className="home-section" aria-labelledby="recent-title">
      <div className="section-head"><div><h2 id="recent-title">Recent rounds</h2><p className="muted">Saved Aurora testnet evidence, independently re-checked.</p></div><Link className="link" href="/rounds">All rounds<Icon name="arrow" /></Link></div>
      <div className="card round-table">
        {error ? <p className="muted" style={{ padding: 20 }}>Saved round evidence is unavailable.</p> : !rounds ? <div className="stack" style={{ padding: 16 }}>{[0, 1, 2].map((i) => <Skeleton key={i} height={44} />)}</div>
          : recent.map((round) => {
            const summary = roundSummary(round); const measured = formatReturnX18(round.realisedReturnX18);
            return <Link key={round.slug} className="rt-row" href={`/rounds/${round.slug}`}>
              <span className="rt-round"><b>Round {round.roundId}</b><small>{round.stack.label} · {round.date ?? "—"}</small></span>
              <span className="rt-sel"><AgentAvatar name={summary.selectedName} kind={summary.isHold ? "hold" : "proposer"} size="sm" /><span><b>{summary.selectedName}</b><small>{summary.isHold ? "kept allocation" : `${percentFromBps(round.winner.allocationBps)} ETH`}</small></span></span>
              <span className={`rt-ret num ${signed(measured)}`}>{measured ?? "—"}</span>
              <span className="rt-go"><Icon name="chevron" /></span>
            </Link>;
          })}
      </div>
    </section>
  </AppShell>;
}
