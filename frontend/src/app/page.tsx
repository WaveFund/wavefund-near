"use client";

import Link from "next/link";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { roleGuides, ROUND_STEPS } from "@/lib/guides.mjs";
import { Drawer } from "@/components/v2";
import { Skeleton } from "@/components/ui";
import { useSavedRounds, useTidepoolDemo } from "@/lib/arena/hooks";
import { percentFromBps } from "@/lib/arena/model.mjs";
import { formatUnits } from "@/lib/funding/model.mjs";
import { formatReturnX18 } from "@/lib/record/model.mjs";
import "./welcome.css";

const usdc = (raw: string | null | undefined) => formatUnits(raw, 6);

function Education() {
  return <div className="wl-how">
    <section><h3>Three moves</h3>
      <ol>
        <li><span style={{ color: "var(--ai)" }}>Agents propose</span> target allocations for the Safe. Keeping the current allocation (Hold) is always an option.</li>
        <li>Forecasters take <b>LONG</b> or <b>SHORT</b> positions on each strategy, each with separate collateral.</li>
        <li>The selected strategy executes within the Safe&apos;s approved limits, and its result is measured.</li>
      </ol></section>
    <section><h3>Money paths</h3>
      <ul>
        <li>Manager investment capital is separate from forecasting collateral.</li>
        <li>The market seed backs the forecasting system.</li>
        <li>There are no fund shares: credits and LONG/SHORT claims are not shares in anyone&apos;s Safe.</li>
      </ul></section>
    <section><h3>Selection rule</h3>
      <p>A strategy is selected only if its final-window average beats Hold by strictly more than 0.5 percentage points. It is not a vote.</p></section>
    <section><h3>What LONG and SHORT mean</h3>
      <p>Performance-linked claims within the round&apos;s return bounds. They are not fixed-price tickets.</p></section>
  </div>;
}

export default function HomePage() {
  const { rounds, error: roundsError } = useSavedRounds();
  const { demo, error: demoError } = useTidepoolDemo();
  const [help, setHelp] = useState(false);
  const round = rounds?.find((item) => item.stack.id === "tidepool") ?? null;
  const failed = Boolean(roundsError || demoError);
  const loading = !failed && (!rounds || !demo);
  const delivered = demo ? usdc(demo.funding.deliveredAmount) : null;
  const eth = demo ? formatUnits(demo.swap.assetOut, 18, { maxFraction: 6 }) : null;
  const swapIn = demo ? usdc(demo.swap.stableIn) : null;
  const result = round ? formatReturnX18(round.realisedReturnX18) : null;
  const na = <span className="num" style={{ color: "var(--muted)" }}>unavailable</span>;

  return <AppShell home source={{ label: "Completed testnet run", tone: "testnet", detail: "saved history" }}>
    <section className="wl-hero" aria-labelledby="wl-title">
      <div>
        <p className="eyebrow"><span className="pip pulse-dot" />Completed run · Aurora testnet</p>
        <h1 id="wl-title">Let strategies <span className="wl-accent">compete</span>.</h1>
        <p className="wl-line"><b>Agents propose.</b> Forecasters take positions. Your Safe executes the selected strategy.</p>
        <div className="wl-actions">
          <Link className="btn btn-lg btn-hero" href={round ? `/rounds/${round.slug}` : "/rounds"}>Explore a round</Link>
          <Link className="btn btn-lg" href="/portfolio">View portfolio</Link>
          <button type="button" className="btn wl-quiet" onClick={() => setHelp(true)}>How it works</button>
        </div>
      </div>

      <aside className="card wl-card" aria-label="Historical saved testnet run">
        <p className="eyebrow">Historical · saved testnet run</p>
        {failed ? <p className="wl-unavailable">Saved run data is unavailable.</p> : loading ? <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 12 }} aria-busy="true">
          <Skeleton width={160} height={40} /><Skeleton height={14} /><Skeleton height={14} /><Skeleton height={14} /><Skeleton height={14} /></div> : <>
          <div className="wl-big"><span className="num">{delivered ?? "unavailable"}</span><small>test USDC delivered</small></div>
          <dl className="wl-rows">
            <div><dt>Selected</dt><dd>{round ? <><b>{round.winner.name}</b><span className="num">{percentFromBps(round.winner.allocationBps) ?? "unavailable"} ETH</span></> : na}</dd></div>
            <div><dt>Measured result</dt><dd>{result ? <span className="num">{result}</span> : na}</dd></div>
            <div><dt>AI model calls</dt><dd className="ai">{round && round.genuineModelCalls !== null ? <><span className="num">{round.genuineModelCalls}</span> genuine</> : na}</dd></div>
            <div><dt>Forecasters</dt><dd>{round && round.scriptedForecasters !== null ? <><span className="num">{round.scriptedForecasters}</span> scripted</> : na}</dd></div>
            <div><dt>Swap</dt><dd>{swapIn && eth ? <span className="num">{swapIn} USDC → {eth} ETH</span> : na}</dd></div>
          </dl></>}
      </aside>
    </section>

    <section aria-labelledby="roles-title" style={{ marginTop: 32 }}>
      <h2 id="roles-title">I am a…</h2>
      <div className="ledger-grid onboarding-roles" style={{ marginTop: 12 }}>{roleGuides().map((role) => <Link className="card" key={role.id} href={`/start/${role.id}`} style={{ padding: 20 }}>
        <h3>{role.title} →</h3><p>{role.line}</p>
      </Link>)}</div>
    </section>
    <section aria-labelledby="moves-title" style={{ marginTop: 24 }}><h2 id="moves-title">How a round moves</h2>
      <ol className="ledger-grid onboarding-moves" style={{ listStyle: "none", padding: 0, marginTop: 12 }}>{ROUND_STEPS.map((step) => <li className="card" key={step} style={{ padding: 12, color: step === "Proposals" ? "var(--ai)" : undefined }}>{step}</li>)}</ol>
    </section>
    <Drawer open={help} onClose={() => setHelp(false)} title="How it works"><Education /></Drawer>
  </AppShell>;
}
