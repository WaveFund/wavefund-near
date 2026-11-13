"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { roleGuides, ROUND_STEPS } from "@/lib/guides.mjs";
import { Drawer } from "@/components/v2";
import { Skeleton } from "@/components/ui";
import { useSavedRounds, useTidepoolDemo } from "@/lib/arena/hooks";
import { percentFromBps } from "@/lib/arena/model.mjs";
import { formatUnits } from "@/lib/funding/model.mjs";
import { formatReturnX18 } from "@/lib/record/model.mjs";
import { loadReputation } from "@/lib/record/loader";
import "./welcome.css";

const ROLE_ICON: Record<string, string> = { manager: "🏦", forecaster: "🎯", observer: "👀" };
const STEP_NOTE: Record<string, { line: string; ai?: boolean }> = {
  Funded: { line: "Capital reaches the Safe via NEAR Intents" },
  Proposals: { line: "4 AI agents propose allocations", ai: true },
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
  const v2 = [...(rounds?.filter((item) => item.stack.id === "tidepool") ?? [])].sort((a, b) => Number(a.roundId) - Number(b.roundId));
  const round = v2.at(-1) ?? null;
  const showcase = [...v2].reverse().find((item) => item.attestationVerified) ?? null;
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

      <aside className="card wl-card" aria-label="Testnet Safe v2, live from chain">
        <p className="eyebrow"><span className="pip pulse-dot" />Testnet Safe v2 · live from chain</p>
        {liveFailed ? <p className="wl-unavailable">Live chain read unavailable right now.</p> : !live ? <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 12 }} aria-busy="true"><Skeleton width={160} height={40} /><Skeleton height={14} /><Skeleton height={14} /></div> : <>
          <div className="wl-big"><span className="num">{v2.length || "–"}</span><small>rounds settled on Aurora testnet</small></div>
          <p className="wl-sub">Agent reputation, read now{live.block ? <> at block <span className="num">{live.block}</span></> : null}</p>
          <dl className="wl-rows">{live.agents.map((a) => <div key={a.name}><dt>{a.name}</dt><dd><span className={`num wl-score ${Number(a.score) > 0 ? "up" : Number(a.score) < 0 ? "down" : ""}`}>{a.score === null ? "–" : Number(a.score) > 0 ? `+${a.score}` : a.score}</span></dd></div>)}</dl></>}
        <dl className="wl-rows wl-saved">
          <div><dt>Latest · round {round?.roundId ?? "–"}</dt><dd className="wl-nowrap">{failed ? na : loading ? "…" : round ? <><b>{round.winner.name}</b><span className="num">{percentFromBps(round.winner.allocationBps) ?? "–"} ETH · {result ?? "–"}</span></> : na}</dd></div>
          <div><dt>Funding delivered</dt><dd>{delivered ? <span className="num">{delivered} USDC</span> : na}</dd></div>
          <div><dt>Swap</dt><dd>{swapIn && eth ? <span className="num">{swapIn} USDC → {eth} ETH</span> : na}</dd></div>
        </dl>
        <p className="wl-foot">Scores: live <code>eth_call</code> · rows below the line: saved receipts</p>
      </aside>
    </section>

    <section aria-labelledby="roles-title" className="wl-section">
      <h2 id="roles-title">I am a…</h2>
      <div className="onboarding-roles">{roleGuides().map((role) => <Link className="card wl-role" key={role.id} href={`/start/${role.id}`}>
        <span className="wl-emoji" aria-hidden="true">{ROLE_ICON[role.id] ?? "•"}</span>
        <h3>{role.title}</h3><p>{role.line}</p>
        <span className="wl-steps">{role.steps.length} steps <span aria-hidden="true">→</span></span>
      </Link>)}</div>
    </section>

    <section aria-labelledby="moves-title" className="wl-section">
      <h2 id="moves-title">How a round moves</h2>
      <ol className="onboarding-moves">{ROUND_STEPS.map((step, i) => { const note = STEP_NOTE[step]; return <li className={`card wl-move ${note?.ai ? "ai" : ""}`} key={step}>
        <span className="wl-move-n num">{String(i + 1).padStart(2, "0")}{note?.ai ? <em>AI</em> : null}</span>
        <b>{step}</b><small>{note?.line}</small>
      </li>; })}</ol>
    </section>

    <section aria-labelledby="ai-title" className="wl-section">
      <h2 id="ai-title">Where AI works {showcase ? <small className="wl-h-note">Round {showcase.roundId} · every model named</small> : null}</h2>
      {failed ? <p className="wl-unavailable">Saved round data is unavailable.</p> : !showcase ? <Skeleton height={120} /> : <div className="wl-ai-grid">
        <article className="card wl-ai">
          <p className="wl-ai-kicker">◆ Proposers · strategy authors</p>
          <h3>{showcase.proposals.filter((p) => p.id !== "0").length} models, each in a NEAR AI TEE</h3>
          <ul>{showcase.proposals.filter((p) => p.id !== "0").map((p) => <li key={p.id}><span>{p.name}</span><code>{short(p.model)}</code></li>)}</ul>
          <Link className="wl-proof" href={`/rounds/${showcase.slug}?stage=proposals`}>◆ TEE verified · Proof ›</Link>
        </article>
        <article className="card wl-ai">
          <p className="wl-ai-kicker">◆ Forecasters · bet on strategies</p>
          <h3>{showcase.forecasters.length} models, each a different lab</h3>
          <ul>{showcase.forecasters.map((f) => <li key={f.name}><span>{f.name}</span><code>{short(f.model)}</code><i className={f.action === "buy" ? "bet" : ""}>{f.action === "buy" ? `${f.side?.toUpperCase()} #${f.proposalId}` : "abstain"}</i></li>)}</ul>
          <Link className="wl-proof muted" href={`/rounds/${showcase.slug}?stage=forecasting`}>Proxied via NEAR AI · not TEE-attested · Decisions ›</Link>
        </article>
        <article className="card wl-ai rule">
          <p className="wl-ai-kicker">Not AI · on-chain rules</p>
          <h3>AI suggests. Contracts decide.</h3>
          <ul className="plain"><li>Selection: market TWAP must beat Hold by &gt; 0.5 pt</li><li>Safe module caps what the swap can do</li><li>Every proposal hash is bound on-chain</li><li>12/12 attacks revert with named errors</li></ul>
          <Link className="wl-proof muted" href="/agents">Agent scores ›</Link>
        </article>
      </div>}
    </section>
    <Drawer open={help} onClose={() => setHelp(false)} title="How it works"><Education /></Drawer>
  </AppShell>;
}
