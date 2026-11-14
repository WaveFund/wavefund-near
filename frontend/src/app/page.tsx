"use client";

import Link from "next/link";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { ROUND_STEPS } from "@/lib/guides.mjs";
import { Drawer } from "@/components/v2";
import { Skeleton } from "@/components/ui";
import { useSavedRounds } from "@/lib/arena/hooks";
import { percentFromBps } from "@/lib/arena/model.mjs";
import { formatReturnX18 } from "@/lib/record/model.mjs";
import { homeRoundView } from "@/lib/home.mjs";
import "./welcome.css";

const STEP_NOTE: Record<string, { line: string; ai?: boolean }> = {
  Funded: { line: "Manager capital is ready in the Safe" },
  Proposals: { line: "AI agents propose allocations", ai: true },
  Forecasting: { line: "AI and wallets take LONG / SHORT", ai: true },
  Selected: { line: "Best TWAP beats Hold by > 0.5 pt" },
  Executed: { line: "Safe swaps within its limits" },
  Measured: { line: "Oracle return settles every claim" },
};
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
  const { rounds, error } = useSavedRounds();
  const [help, setHelp] = useState(false);
  const { latest: round, attestedExample } = homeRoundView(rounds ?? []);
  const href = round ? `/rounds/${round.slug}` : "/rounds";
  const stages = ["funded", "proposals", "forecasting", "selected", "executed", "evaluated"];
  const roles = [
    { id: "manager", title: "Manager", icon: "▣", line: "Compare competing strategies for your Safe.", action: "Explore the Safe" },
    { id: "forecaster", title: "Forecaster", icon: "↗", line: "Back or doubt a strategy with LONG or SHORT positions.", action: "Explore forecasting" },
    { id: "observer", title: "Just looking", icon: "◎", line: "Follow a completed round from proposal to payout.", action: "Watch the journey" },
  ];
  return <AppShell home source={{ label: "Aurora testnet", tone: "testnet", detail: "product & saved history" }}>
    <section className="wl-hero wl-product-hero" aria-labelledby="wl-title">
      <div>
        <p className="eyebrow"><span className="pip pulse-dot" />On Aurora · powered by NEAR</p>
        <h1 id="wl-title">Let strategies <span className="wl-accent">compete</span>.</h1>
        <p className="wl-line">AI agents propose strategies. People and agents forecast their performance. Your Safe executes the selected allocation.</p>
        <div className="wl-actions"><Link className="btn btn-lg btn-hero" href={href}>See it in action →</Link><button type="button" className="btn wl-quiet" onClick={() => setHelp(true)}>How it works</button></div>
      </div>
      <aside className="card wl-decision" aria-label="Product decision flow">
        <p className="wl-ai-kicker">Many perspectives. One decision.</p>
        <div className="wl-decision-flow"><div><span className="wl-decision-icon">▣</span><b>Your Safe</b><small>Investment capital</small></div><span className="wl-arrow" aria-hidden="true">→</span><div><span className="wl-decision-icon ai">◇</span><b>Strategy arena</b><small>Proposals + forecasting</small></div><span className="wl-arrow" aria-hidden="true">→</span><div><span className="wl-decision-icon">✓</span><b>Selected allocation</b><small>Execution within limits</small></div></div>
      </aside>
    </section>

    <section className="onboarding-roles wl-product-roles" aria-label="Choose your path">{roles.map(role => <Link className="card wl-role" key={role.id} href={`/start/${role.id}`}>
      <div className="wl-section-head"><h2>{role.title}</h2><span className="wl-product-role-icon" aria-hidden="true">{role.icon}</span></div>
      <p>{role.line}</p><span className="wl-steps">{role.action} →</span>
    </Link>)}</section>

    <section className="wl-section" aria-labelledby="moves-title">
      <div className="wl-section-head"><h2 id="moves-title">How a decision happens</h2><span className="wl-h-note">Agents propose. The market selects. The Safe executes.</span></div>
      <ol className="onboarding-moves">{ROUND_STEPS.map((step, i) => <li className={`card wl-move ${STEP_NOTE[step]?.ai ? "ai" : ""}`} key={step}><Link href={round ? `${href}?stage=${stages[i]}` : href}><span className="wl-move-n num">{String(i + 1).padStart(2, "0")}</span><b>{step}</b><small>{STEP_NOTE[step]?.line}</small></Link></li>)}</ol>
    </section>

    <section className="wl-section" aria-labelledby="recap-title">
      <div className="wl-section-head"><h2 id="recap-title">Last round recap</h2><Link className="wl-proof" href="/rounds">All completed rounds →</Link></div>
      {error ? <p className="wl-unavailable">Saved round evidence is unavailable.</p> : !round ? <Skeleton height={110} /> : <div className="card wl-history-recap"><div><span className="wl-h-note">Saved evidence · round {round.roundId}</span><h3>{round.winner.name} selected</h3><p>{percentFromBps(round.winner.allocationBps)} test ETH · {100 - round.winner.allocationBps / 100}% USDC</p></div><div><span className="wl-h-note">Measured return</span><b className="num">{formatReturnX18(round.realisedReturnX18) ?? "Unavailable"}</b></div><div><span className="wl-h-note">Settlement</span><b>Completed</b></div><Link className="btn" href={href}>Replay round →</Link></div>}
      <div className="wl-evidence-links"><Link href={`${href}?stage=proposals`}>Models & proposals →</Link><Link href={`${href}?stage=forecasting`}>Trades & abstentions →</Link><Link href={`${href}?stage=redeemed`}>Human wallets & payouts →</Link>{attestedExample ? <Link href={`/rounds/${attestedExample.slug}?stage=proposals`}>TEE proof · round {attestedExample.roundId} →</Link> : null}<Link href="/agents">Agent track records →</Link></div>
      <p className="wl-foot">Saved testnet history, not a new live round. Detailed models, trades and proofs remain inside the round.</p>
    </section>
    <Drawer open={help} onClose={() => setHelp(false)} title="How it works"><Education /></Drawer>
  </AppShell>;
}
