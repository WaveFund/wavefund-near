"use client";

import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Chip, MiniTrack } from "@/components/arena/parts";
import { Icon } from "@/components/funding/primitives";
import { Button, EmptyState, Skeleton } from "@/components/ui";
import { useLocalState, useSavedRounds } from "@/lib/arena/hooks";
import { localJourney, positionGroups, savedJourney, shortReturnX18 } from "@/lib/arena/model.mjs";
import type { TestnetRound } from "@/lib/record/model.mjs";

/** Schematic only: direction of a claim's settlement value across the round's recorded payout range. No prices or previews. */
function Payoff({ side, low, high }: { side: "long" | "short"; low: string; high: string }) {
  const path = side === "long" ? "M8 62 H36 L116 14 H144" : "M8 14 H36 L116 62 H144";
  return <svg className="payoff" viewBox="0 0 152 84" role="img" aria-label={`${side === "long" ? "Rises" : "Falls"} as the measured return goes from ${low} to ${high}, flat outside that range`}>
    <line className="axis" x1="8" y1="70" x2="144" y2="70" /><line className="axis" x1="76" y1="66" x2="76" y2="74" />
    <path className="line" d={path} />
    <text x="36" y="82" textAnchor="middle">{low}</text><text x="76" y="82" textAnchor="middle">0%</text><text x="116" y="82" textAnchor="middle">{high}</text>
  </svg>;
}

function SavedRoundCard({ round }: { round: TestnetRound }) {
  const journey = savedJourney(round);
  const positions = positionGroups(round.proposals, round.forecasters).positions;
  return <Link className="round-card" href={`/rounds/${round.slug}`}>
    <div className="round-card-top"><div><h3>Round {round.roundId} · {round.stack.label}</h3><p className="ident">Aurora testnet · engine {round.stack.engine.slice(0, 6)}…{round.stack.engine.slice(-4)}</p></div><Chip tone="ok">Settled</Chip></div>
    <p>{round.title}</p>
    <div className="round-stats">
      <div><span>Strategies</span><b>{round.proposals.length - 1} + Hold</b></div>
      <div><span>Positions</span><b>{positions || "None"}</b></div>
      <div><span>Result</span><b>{shortReturnX18(round.realisedReturnX18) ?? "—"}</b></div>
    </div>
    <MiniTrack stages={journey.stages} />
    <div className="round-card-foot"><span className="muted" style={{ fontSize: 13 }}>{round.winner.isHold ? "Hold kept · no swap" : `${round.winner.name} selected`}</span><span className="path-cta">Open round<Icon name="arrow" /></span></div>
  </Link>;
}

export default function ArenaPage() {
  const { rounds, error } = useSavedRounds();
  const local = useLocalState(4000);
  const journey = localJourney(local.data);
  const bounds = rounds?.map((item) => item.market?.returnBounds).filter(Boolean) ?? [];
  const same = bounds.length > 0 && bounds.every((item) => item!.minX18 === bounds[0]!.minX18 && item!.maxX18 === bounds[0]!.maxX18);
  const low = same ? shortReturnX18(bounds[0]!.minX18) ?? "low" : "low";
  const high = same ? shortReturnX18(bounds[0]!.maxX18) ?? "high" : "high";

  return <AppShell source={{ label: "Aurora testnet", tone: "testnet", detail: "saved rounds" }}>
    <header className="round-hero">
      <h1>Forecast arena</h1>
      <p className="lede">Back or doubt each strategy with your own collateral. Your deposit funds forecasting positions. It does not buy a share of anyone&apos;s Safe.</p>
    </header>

    <div className="lock-banner">
      <p><b>Taking positions from this screen is not available yet.</b> The contracts support forecasting, but this dashboard is read-only. In the completed rounds, scripted forecaster wallets placed real testnet trades.</p>
      <Button variant="locked" icon="lock" disabled>Take a position</Button>
    </div>

    <section className="block" aria-labelledby="rounds-title" style={{ marginTop: 32 }}>
      <div className="section-head"><div><h2 id="rounds-title">Rounds</h2><p>Each round is identified by network, engine and round id, because round numbers repeat across engines.</p></div></div>
      {!rounds && !error ? <div className="round-grid">{[0, 1, 2].map((i) => <Skeleton key={i} height={250} />)}</div>
        : <div className="round-grid">
          {local.data && local.data.mode === "local-simulation" ? <Link className="round-card" href="/demo">
            <div className="round-card-top"><div><h3>Round 1 · Local simulation</h3><p className="ident">Anvil 31337 · disposable local engine</p></div>
              <Chip tone={journey.complete ? "ok" : journey.running ? "live" : "plain"}>{journey.complete ? "Settled" : journey.running ? "Running" : journey.halted ? "Halted" : "Not started"}</Chip></div>
            <p>A rehearsal you can run now: simulated prices and scripted agents on real contracts.</p>
            <div className="round-stats">
              <div><span>Strategies</span><b>{journey.proposals.length ? `${journey.proposals.length - 1} + Hold` : "—"}</b></div>
              <div><span>Forecasters</span><b>{(local.data.forecast.participants ?? []).filter((item) => item.deposit !== "0").length || "—"}</b></div>
              <div><span>Result</span><b>{journey.evaluated ? shortReturnX18(journey.returnX18) : "—"}</b></div>
            </div>
            <MiniTrack stages={journey.stages} />
            <div className="round-card-foot"><Chip tone="local">Local simulation</Chip><span className="path-cta">{journey.complete ? "See result" : "Open demo"}<Icon name="arrow" /></span></div>
          </Link> : null}
          {[...(rounds ?? [])].reverse().map((round) => <SavedRoundCard key={round.slug} round={round} />)}
          {error ? <EmptyState icon="alert" title="Saved rounds are unavailable">{error}</EmptyState> : null}
        </div>}
    </section>

    <section className="block" aria-labelledby="how-forecast">
      <div className="section-head"><div><h2 id="how-forecast">How forecasting works</h2><p>Five steps from deposit to redemption.</p></div></div>
      <ol className="steps5">
        <li><b>Deposit collateral</b><p>It funds your forecasting positions. It never buys ownership in the Safe.</p></li>
        <li><b>Get credits in every world</b><p>One deposit gives credits in each strategy&apos;s world independently. It is not split between them, and credits are not cash.</p></li>
        <li><b>Go LONG or SHORT</b><p>Trade credits for a view on the strategies you care about. Your entry is your own executed trade.</p></li>
        <li><b>One world is selected</b><p>When trading closes, one strategy (or Hold) is selected. Claims in the other worlds pay nothing.</p></li>
        <li><b>Settle and redeem</b><p>The measured return sets what each claim is worth. You redeem winning-world claims and unused credits.</p></li>
      </ol>
    </section>

    <section className="block" aria-labelledby="lvs">
      <div className="section-head"><div><h2 id="lvs">LONG and SHORT</h2><p>{same ? `In the completed rounds, settlement maps measured returns from ${low} to ${high} onto claim values.` : "Settlement maps the measured return onto claim values within each round's recorded bounds."} These are not fixed-price yes/no tickets or leveraged ETH positions.</p></div></div>
      <div className="lvs">
        <article className="lvs-card long"><div><h3><span className="side-tag long">LONG</span>Backs the strategy</h3><p>Its settlement value rises as the selected strategy&apos;s measured return rises, up to the top of the range.</p></div><Payoff side="long" low={low} high={high} /></article>
        <article className="lvs-card short"><div><h3><span className="side-tag short">SHORT</span>Doubts the strategy</h3><p>Its settlement value rises as the measured return falls, down to the bottom of the range.</p></div><Payoff side="short" low={low} high={high} /></article>
      </div>
    </section>

    <section className="block" aria-labelledby="selection">
      <div className="section-head"><div><h2 id="selection">How the winner is chosen</h2></div></div>
      <div className="rules">
        <div className="rule"><b><Icon name="clock" />A market average, not a vote</b><p>The signal is each strategy&apos;s average market price over the final window of trading. It is not a count of voters or the last trade.</p></div>
        <div className="rule"><b><Icon name="shield" />Hold is the bar to beat</b><p>The best challenger is selected only if its average beats Hold&apos;s by more than 0.5 points. Otherwise the Safe keeps its allocation.</p></div>
        <div className="rule"><b><Icon name="layers" />Margin and bounds are different</b><p>The 0.5-point margin decides selection. The payout range decides what claims are worth after the return is measured.</p></div>
      </div>
    </section>
  </AppShell>;
}
