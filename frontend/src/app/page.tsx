"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { ROUND_STEPS } from "@/lib/guides.mjs";
import { Drawer } from "@/components/v2";
import { Skeleton } from "@/components/ui";
import { useSavedRounds, useTidepoolDemo } from "@/lib/arena/hooks";
import { percentFromBps } from "@/lib/arena/model.mjs";
import { formatUnits } from "@/lib/funding/model.mjs";
import { formatReturnX18 } from "@/lib/record/model.mjs";
import { homeRoundView } from "@/lib/home.mjs";
import { loadReputation } from "@/lib/record/loader";
import "./welcome.css";

const STEP_NOTE: Record<string, { line: string; ai?: boolean }> = {
  Funded: { line: "Manager capital is ready in the Safe" },
  Proposals: { line: "AI agents propose allocations", ai: true },
  Forecasting: { line: "AI and wallets take LONG / SHORT", ai: true },
  Selected: { line: "Best TWAP beats Hold by > 0.5 pt" },
  Executed: { line: "Safe swaps within its limits" },
  Measured: { line: "Oracle return settles every claim" },
};
const short = (model: string | null | undefined) => (model ? model.split("/").pop() : "unknown model");
type Rep = { name: string; score: string | null };
function useLiveReputation() {
  const [state, setState] = useState<{ agents: Rep[]; block: string | null } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    loadReputation("tidepool").then((board) => {
      if (!active) return;
      const agents = (board.agents as Array<{ name: string; reputation?: { score?: string; blockNumber?: string } | null }>);
      setState({ agents: agents.map((a) => ({ name: a.name, score: a.reputation?.score ?? null })), block: agents.map((a) => a.reputation?.blockNumber).find(Boolean) ?? null });
    }, () => { if (active) setFailed(true); });
    return () => { active = false; };
  }, []);
  return { live: state, liveFailed: failed };
}

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
  const { live, liveFailed } = useLiveReputation();
  const { latest: round, completed, attestedExample, trades, abstentions, humans } = homeRoundView(rounds ?? []);
  const href = round ? `/rounds/${round.slug}` : "/rounds";
  const stageKeys = ["funded", "proposals", "forecasting", "selected", "executed", "evaluated"];
  const result = round ? formatReturnX18(round.realisedReturnX18) : null;
  const strategyName = (id: string | null) => round?.proposals.find(p => p.id === id)?.name ?? "Unknown strategy";

  return <AppShell home source={{ label: "Completed testnet run", tone: "testnet", detail: "saved history" }}>
    <section className="wl-hero" aria-labelledby="wl-title">
      <div>
        <p className="eyebrow"><span className="pip pulse-dot" />Strategies, tested in public</p>
        <h1 id="wl-title">Let strategies <span className="wl-accent">compete</span>.</h1>
        <p className="wl-line"><b>Agents propose.</b> Forecasters take positions. Your Safe executes the selected strategy.</p>
        <div className="wl-actions">
          <Link className="btn btn-lg btn-hero" href={href}>Explore last round</Link>
          <Link className="btn btn-lg" href="/portfolio">View portfolio</Link>
          <button type="button" className="btn wl-quiet" onClick={() => setHelp(true)}>How it works</button>
        </div>
      </div>
      <aside className="card wl-card wl-recap" aria-label="Last round recap">
        <div className="wl-section-head"><p className="eyebrow">Last round recap</p><span className="wl-h-note">{round ? `Round ${round.roundId} · settled` : "Saved testnet history"}</span></div>
        {roundsError ? <p className="wl-unavailable">Saved rounds unavailable.</p> : !round ? <Skeleton height={150} /> : <>
          <h2>{round.winner.name}<small>{percentFromBps(round.winner.allocationBps)} test ETH · {100 - round.winner.allocationBps / 100}% USDC</small></h2>
          <div className="wl-recap-metrics"><div><span>Measured return</span><b className="num">{result ?? "Unavailable"}</b></div><div><span>Agent positions</span><b className="num">{trades.length}</b></div><div><span>Human wallets</span><b className="num">{humans.length}</b></div></div>
          <Link className="wl-proof" href={href}>Replay the full round →</Link>
          <p className="wl-foot">Saved on-chain evidence · {completed} completed rounds · test assets only</p>
        </>}
      </aside>
    </section>

    <section aria-labelledby="moves-title" className="wl-section">
      <div className="wl-section-head"><h2 id="moves-title">Follow the decision</h2><span className="wl-h-note">{round ? `Last round · #${round.roundId}` : "Round journey"}</span></div>
      <ol className="onboarding-moves">{ROUND_STEPS.map((step, i) => { const note = STEP_NOTE[step]; return <li className={`card wl-move ${note?.ai ? "ai" : ""}`} key={step}>
        <Link href={round ? `${href}?stage=${stageKeys[i]}` : href}>
          <span className="wl-move-n num">{String(i + 1).padStart(2, "0")}{note?.ai ? <em>AI</em> : null}</span>
          <b>{step}</b><small>{note?.line}</small>
        </Link>
      </li>; })}</ol>
    </section>

    <section aria-labelledby="strategies-title" className="wl-section">
      <div className="wl-section-head"><h2 id="strategies-title">The strategies</h2><Link className="wl-proof" href={`${href}?stage=proposals`}>All proposals & proof →</Link></div>
      {roundsError ? <p className="wl-unavailable">Saved proposals unavailable.</p> : !round ? <Skeleton height={150} /> : <>
        <p className="wl-sub">Last round&apos;s competing allocations. Hold was the baseline.</p>
        <div className="wl-strategies">{round.proposals.filter(p => p.id !== "0").map(p => <article key={p.id} className={`card wl-strategy ${p.id === round.winner.id ? "is-selected" : ""}`}>
          <div className="wl-section-head"><h3>{p.name}</h3>{p.id === round.winner.id ? <span className="wl-tag">Selected</span> : null}</div>
          <p className="wl-allocation"><b className="num">{percentFromBps(p.allocationBps)}</b> test ETH</p>
          <div className="wl-allocation-track" role="img" aria-label={`${p.allocationBps / 100}% test ETH, ${100 - p.allocationBps / 100}% USDC`}><span style={{width: `${p.allocationBps / 100}%`}} /></div>
          <span className="wl-h-note">{100 - p.allocationBps / 100}% held in USDC</span>
          <details className="wl-detail wl-thesis"><summary>Strategy thesis</summary><p>{p.rationale}</p></details>
          <details className="wl-detail"><summary>Model & provenance</summary><code>{p.model ?? "Model unavailable"}</code><p>{p.provenance?.tee === "verified" ? "TEE-verified proposal" : "No verified TEE claim for this proposal"}</p></details>
          <Link className="wl-proof" href={`${href}?stage=proposals`}>Inspect proposal →</Link>
        </article>)}</div>
        {round.winner.isHold ? <p className="wl-sub">Hold won: preserve the current token quantities; no rebalance swap.</p> : null}
      </>}
    </section>

    <section aria-labelledby="forecast-title" className="wl-section">
      <div className="wl-section-head"><h2 id="forecast-title">People and agents take positions</h2><Link className="wl-proof" href={`${href}?stage=forecasting`}>Forecasting details →</Link></div>
      {!round ? <p className="wl-unavailable">{roundsError ? "Forecast evidence unavailable." : "Loading forecast evidence…"}</p> : <div className="wl-forecast-grid">
        <article className="card wl-panel"><p className="wl-ai-kicker">Recorded agent positions · {trades.length}</p>
          {trades.length ? <ul className="wl-trades">{trades.map(f => <li key={f.name}><span className={`wl-side ${f.side}`}>{f.side?.toUpperCase()}</span><div><b>{strategyName(f.proposalId)}</b><small>{f.name} · {f.scripted ? "scripted test actor" : short(f.model)}</small></div><span className="num">{usdc(f.credits)} credits</span></li>)}</ul> : <p className="wl-sub">No agent positions recorded in this round.</p>}
          <details className="wl-detail"><summary>Abstentions · {abstentions.length}</summary><ul className="wl-abstentions">{abstentions.map(f => <li key={f.name}><b>{f.name}</b><small>{short(f.model)}</small><p>{f.reason}</p></li>)}</ul></details>
          <p className="wl-foot">AI calls and scripted actors are labelled individually. Forecaster calls are not TEE-attested.</p>
        </article>
        <article className="card wl-panel"><p className="wl-ai-kicker">Human browser wallets · {humans.length}</p>
          {humans.length ? humans.map((p, i) => <div className="wl-human" key={p.name}><h3>Browser wallet {i + 1}</h3><dl className="wl-rows"><div><dt>Forecast deposit</dt><dd className="num">{usdc(p.deposit)} test USDC</dd></div><div><dt>Redeemed</dt><dd className="num">{usdc(p.payout)} test USDC</dd></div></dl><Link className="wl-proof" href={`${href}?stage=redeemed`}>View payout evidence →</Link></div>) : <p className="wl-sub">No outside browser wallets recorded in this round.</p>}
          <p className="wl-sub">Your wallet can forecast during an open testnet round. Investment capital stays separate.</p><Link className="wl-proof" href="/rounds/live#wallet">Check the live round →</Link>
        </article>
      </div>}
    </section>

    <section className="wl-section" aria-label="Funding and agent outcomes"><div className="wl-bottom-grid">
      <article className="card wl-panel"><div className="wl-section-head"><h2>Agent track record</h2><Link className="wl-proof" href="/agents">All outcomes →</Link></div>
        <p className="wl-sub">Testnet Safe v2 · live reputation{live?.block ? ` at block ${live.block}` : ""}</p>
        {liveFailed ? <p className="wl-unavailable">Live chain read unavailable.</p> : !live ? <Skeleton height={140} /> : <dl className="wl-rows">{live.agents.map(a => <div key={a.name}><dt>{a.name}</dt><dd className={`num wl-score ${Number(a.score) > 0 ? "up" : Number(a.score) < 0 ? "down" : ""}`}>{a.score === null ? "Unavailable" : Number(a.score) > 0 ? `+${a.score}` : a.score}</dd></div>)}</dl>}
        <p className="wl-foot">Outcome points for selected, executed strategies. Not a credit rating or proof of skill.</p>
      </article>
      <article className="card wl-panel"><div className="wl-section-head"><h2>How capital arrived</h2><Link className="wl-proof" href="/portfolio?tab=funding">Funding evidence →</Link></div>
        <p className="wl-sub">Round 1 history · Tidepool community testnet</p>
        {demoError ? <p className="wl-unavailable">Funding history unavailable.</p> : !demo ? <Skeleton height={100} /> : <><div className="wl-funding-path"><span>Arbitrum Sepolia</span><b>→</b><span>NEAR settlement</span><b>→</b><span>Aurora Safe</span></div><dl className="wl-rows"><div><dt>Delivered to Safe</dt><dd className="num">{usdc(demo.funding.deliveredAmount)} test USDC</dd></div><div><dt>Round 1 swap</dt><dd className="num">{usdc(demo.swap.stableIn)} USDC → {formatUnits(demo.swap.assetOut, 18, { maxFraction: 6 })} ETH</dd></div></dl></>}
        <p className="wl-foot">Historical funding, not a new transfer in the last round. Separate from forecast deposits.</p>
      </article>
    </div></section>

    <section className="wl-section card wl-assurance" aria-label="Rules and verification"><div><h2>AI suggests. Contracts enforce.</h2><p className="wl-sub">Strict margin over Hold · Safe execution limits · oracle settlement · 12 tested attack reverts</p></div><div className="wl-assurance-links"><Link href={`${href}?stage=selected`}>Selection evidence →</Link>{attestedExample ? <Link href={`/rounds/${attestedExample.slug}?stage=proposals`}>TEE proof · round {attestedExample.roundId} →</Link> : null}</div></section>
    <Drawer open={help} onClose={() => setHelp(false)} title="How it works"><Education /></Drawer>
  </AppShell>;
}
