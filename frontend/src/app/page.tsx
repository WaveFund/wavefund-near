"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { AgentAvatar, AllocationRing, Chip } from "@/components/arena/parts";
import { Icon } from "@/components/funding/primitives";
import { Button } from "@/components/ui";
import { useLocalState, useSavedRounds, useTidepoolDemo } from "@/lib/arena/hooks";
import { percentFromBps, positionGroups } from "@/lib/arena/model.mjs";
import { formatUnits } from "@/lib/funding/model.mjs";
import { formatPoints, formatReturnX18, type TestnetRound } from "@/lib/record/model.mjs";
import type { TidepoolDemo } from "@/lib/tidepool/model.mjs";

const usdc = (raw: string | null | undefined) => formatUnits(raw, 6) ?? "—";

/** A product-like picture of a round, drawn from the completed testnet round when it is available. */
function ArenaArt({ round, demo }: { round: TestnetRound | null; demo: TidepoolDemo | null }) {
  const challengers = round ? round.proposals.filter((item) => item.id !== "0") : [];
  const winnerIndex = round ? challengers.findIndex((item) => item.id === round.winner.id) : -1;
  const start = Math.max(0, Math.min(challengers.length - 3, winnerIndex - 1));
  const shown = challengers.slice(start, start + 3);
  const positions = round ? positionGroups(round.proposals, round.forecasters) : null;
  return <div className="arena-art" aria-label="How a round looks">
    <div className="arena-art-head"><span>{round ? `Round ${round.roundId} · ${round.stack.label}` : "A strategy round"}</span>{round ? <Chip tone="saved">Saved testnet evidence</Chip> : null}</div>
    <div className="arena-cards">
      {(shown.length ? shown : [null, null, null]).map((item, index) => {
        const group = item && positions ? positions.groups.find((g) => g.proposalId === item.id) : null;
        const long = group?.long.length ?? 0; const short = group?.short.length ?? 0;
        const selected = Boolean(item && round && item.id === round.winner.id);
        return <div key={item?.id ?? index} className={`mini-card ${selected ? "is-selected" : ""}`}>
          {selected ? <span className="selected-flag"><Icon name="check" />Selected</span> : null}
          {item ? <AgentAvatar name={item.name} size="sm" /> : <span className="av sm" style={{ background: "var(--surface-3)" }} />}
          <b>{item?.name ?? "Strategy"}</b>
          <AllocationRing bps={item?.allocationBps ?? 5000} label={item ? undefined : "Example allocation"} />
          <span className="mini-bar" aria-label={`${long} LONG, ${short} SHORT`}>{long ? <span className="l" style={{ flex: long }} /> : null}{short ? <span className="s" style={{ flex: short }} /> : null}</span>
        </div>;
      })}
    </div>
    <div className="legend"><span><i className="k-risk" />Test ETH weight</span><span><i style={{ background: "var(--long)" }} />LONG</span><span><i style={{ background: "var(--short)" }} />SHORT</span></div>
    <div className="arena-flow"><Icon name="safe" /><span>{demo && round ? <>The winner executes in the manager&apos;s Safe: <b>{usdc(demo.swap.stableIn)} USDC → {formatUnits(demo.swap.assetOut, 18, { maxFraction: 6 })} ETH</b></> : <>The winning strategy executes inside the manager&apos;s Safe, within its limits.</>}</span></div>
  </div>;
}

export default function HomePage() {
  const router = useRouter();
  const local = useLocalState(5000);
  const { rounds } = useSavedRounds();
  const { demo } = useTidepoolDemo();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tidepoolRound = rounds?.find((item) => item.stack.id === "tidepool") ?? null;
  const stage = local.data?.stage ?? null;
  const done = stage === "completed" || stage === "complete";
  const running = Boolean(local.data?.running) || (stage !== null && !["idle", "completed", "complete", "failed", "interrupted"].includes(stage));
  const label = starting ? "Starting…" : done ? "See the local demo result" : running ? "Watch the local demo" : "Run local demo";

  async function runDemo() {
    setError(null);
    if (local.data && stage === "idle" && !local.data.running) {
      setStarting(true);
      const failure = await local.start();
      setStarting(false);
      if (failure) { setError(failure); return; }
    }
    router.push("/demo");
  }

  const ret = tidepoolRound ? formatReturnX18(tidepoolRound.realisedReturnX18) : null;
  return <AppShell source={{ label: "Test assets only", tone: "testnet", detail: "no real money" }}>
    <section className="hero" aria-labelledby="hero-title">
      <div>
        <h1 id="hero-title">Your money stays in your Safe.</h1>
        <p className="lede">Agents propose strategies, forecasters back their views, and the selected strategy executes within your limits.</p>
        <div className="hero-actions">
          <Button variant="primary" size="lg" icon="play" loading={starting} onClick={() => void runDemo()}>{label}</Button>
          <Link className="btn btn-lg" href={tidepoolRound ? `/rounds/${tidepoolRound.slug}` : "/arena"}>Explore completed testnet run</Link>
          <a className="text-link" href="#roles">Choose my role<Icon name="down" /></a>
        </div>
        {error ? <p className="field-error" role="alert" style={{ marginTop: 12 }}>{error}</p> : null}
        <p className="hero-note"><Icon name="shield" />No wallet needed to look around. Sending and signing are switched off.</p>
      </div>
      <ArenaArt round={tidepoolRound} demo={demo} />
    </section>

    <section className="block" aria-labelledby="how-title">
      <div className="section-head"><div><h2 id="how-title">How a round works</h2><p>Three moves, every round. The manager&apos;s money never leaves the Safe.</p></div></div>
      <div className="how">
        <article className="how-step">
          <div className="how-art" aria-hidden="true"><AllocationRing bps={0} /><AllocationRing bps={4000} /><AllocationRing bps={7500} /></div>
          <span className="how-n">1</span><h3>Agents propose</h3>
          <p>AI agents each suggest a target allocation for the Safe, with their reasoning. &ldquo;Keep the current allocation&rdquo; is always one of the options.</p>
        </article>
        <article className="how-step">
          <div className="how-art" aria-hidden="true"><span className="pos-chip long"><AgentAvatar name="Quant" kind="forecaster" size="sm" />LONG</span><span className="pos-chip short"><AgentAvatar name="Guardian" kind="forecaster" size="sm" />SHORT</span></div>
          <span className="how-n">2</span><h3>Forecasters take positions</h3>
          <p>Forecasters back (LONG) or doubt (SHORT) each strategy with their own, separate collateral. Their trades form a market signal.</p>
        </article>
        <article className="how-step">
          <div className="how-art" aria-hidden="true"><AllocationRing bps={7500} /><Icon name="arrow" /><span className="path-icon"><Icon name="safe" /></span></div>
          <span className="how-n">3</span><h3>The winner executes in your Safe</h3>
          <p>If a strategy clearly beats &ldquo;keep&rdquo;, it trades inside your Safe&apos;s limits. Its measured result settles the forecasts and the agent&apos;s record.</p>
        </article>
      </div>
    </section>

    <section className="block" aria-labelledby="money-title">
      <div className="section-head"><div><h2 id="money-title">Where is my money?</h2><p>Three separate pots. They are never pooled or netted against each other.</p></div></div>
      <div className="buckets">
        <div className="bucket primary"><span className="bucket-label"><Icon name="safe" />Investment capital</span><span className="bucket-note" style={{ fontSize: 14, color: "var(--text-2)" }}>Stays in the manager&apos;s Safe. Only the selected strategy can trade it, and only within the limits the owner approved.</span></div>
        <div className="bucket"><span className="bucket-label"><Icon name="users" />Forecast collateral</span><span className="bucket-note" style={{ fontSize: 14, color: "var(--text-2)" }}>Forecasters&apos; own deposits, held by the market. It is never added to the Safe&apos;s budget.</span></div>
        <div className="bucket"><span className="bucket-label"><Icon name="layers" />Market seed</span><span className="bucket-note" style={{ fontSize: 14, color: "var(--text-2)" }}>Liquidity that makes the markets tradable. Credits and LONG/SHORT claims are not shares in anyone&apos;s Safe.</span></div>
      </div>
    </section>

    <section className="block" id="roles" aria-labelledby="roles-title" style={{ scrollMarginTop: 90 }}>
      <div className="section-head"><div><h2 id="roles-title">Choose your path</h2><p>One person can be a manager and a forecaster. Their balances and permissions stay separate.</p></div></div>
      <div className="paths">
        <Link className="path" href="/safe">
          <span className="path-icon"><Icon name="safe" /></span><h3>Manage my Safe</h3>
          <p>Fund and follow a portfolio you control, from deposit to measured outcome.</p>
          <ul><li><Icon name="check" />Inspect the configured demo Safes</li><li><Icon name="check" />Follow funding, limits and rounds</li><li className="no"><Icon name="lock" />Connecting your own Safe is not available yet</li></ul>
          <span className="path-cta">Open my Safe<Icon name="arrow" /></span>
        </Link>
        <Link className="path" href="/arena">
          <span className="path-icon"><Icon name="chart" /></span><h3>Explore &amp; forecast</h3>
          <p>See competing strategies, who backed them, what won and what forecasters redeemed.</p>
          <ul><li><Icon name="check" />Browse rounds and strategy cards</li><li><Icon name="check" />Learn LONG, SHORT and credits</li><li className="no"><Icon name="lock" />Taking positions here is not available yet</li></ul>
          <span className="path-cta">Enter the arena<Icon name="arrow" /></span>
        </Link>
        <Link className="path" href="/demo">
          <span className="path-icon"><Icon name="play" /></span><h3>Watch the demo</h3>
          <p>Run a full round on a local chain, or walk through the completed public testnet run.</p>
          <ul><li><Icon name="check" />Local simulation in about a minute</li><li><Icon name="check" />Completed Tidepool testnet journey</li><li><Icon name="check" />Every step backed by transactions</li></ul>
          <span className="path-cta">Open the demo<Icon name="arrow" /></span>
        </Link>
      </div>
    </section>

    {tidepoolRound ? <section className="block" aria-labelledby="latest-title">
      <div className="section-head"><div><h2 id="latest-title">The completed testnet run</h2><p>Funded, decided, executed and settled on public testnets. Saved evidence with on-demand re-checks.</p></div>
        <Link className="link" href={`/rounds/${tidepoolRound.slug}`}>Walk through it<Icon name="arrow" /></Link></div>
      <div className="recap">
        <div><span>Funded</span><b>{demo ? `${usdc(demo.funding.deliveredAmount)} USDC` : "—"}</b><small>Arbitrum Sepolia → Aurora testnet via Tidepool</small></div>
        <div><span>Strategies</span><b>{tidepoolRound.proposals.length - 1} + Hold</b><small>{tidepoolRound.genuineModelCalls ?? 0} genuine NEAR AI proposals</small></div>
        <div><span>Selected</span><b>{tidepoolRound.winner.name} · {percentFromBps(tidepoolRound.winner.allocationBps)}</b><small>{tidepoolRound.scriptedForecasters ?? 0} scripted forecasters traded</small></div>
        <div><span>Executed</span><b>{demo ? `${usdc(demo.swap.stableIn)} USDC` : "—"}</b><small>{demo ? `→ ${formatUnits(demo.swap.assetOut, 18, { maxFraction: 6 })} test ETH` : "swap recorded"}</small></div>
        <div><span>Measured result</span><b>{ret ?? "—"}</b><small>{tidepoolRound.reputation ? `${tidepoolRound.winner.name} ${formatPoints(tidepoolRound.reputation.score)} outcome point` : "Settled"}</small></div>
      </div>
    </section> : null}
  </AppShell>;
}
