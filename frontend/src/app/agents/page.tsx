"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { AgentAvatar, Chip } from "@/components/arena/parts";
import { Address, Icon, useNow } from "@/components/funding/primitives";
import { EmptyState, SegmentedControl, Skeleton } from "@/components/ui";
import { AURORA_TESTNET, formatAge } from "@/lib/funding/model.mjs";
import { formatPoints, reputationCodeText, reputationState, snapshotStale, type ReputationAgent, type ReputationBoard, type ReputationState } from "@/lib/record/model.mjs";
import { RecordUnavailable, loadReputation, type ReputationStackId } from "@/lib/record/loader";

const PROPOSERS = ["Conservative", "Balanced", "Momentum", "HighBeta"];
const STACKS: Array<{ id: ReputationStackId; label: string; note: string }> = [
  { id: "tidepool", label: "Tidepool stack", note: "Recorded by the Tidepool-funded engine (round 1)." },
  { id: "original", label: "Original stack", note: "Recorded by the original engine (round 7)." },
];
const POLL_MS = 30_000;
type BoardState = { board: ReputationBoard | null; receivedAt: number | null; error: unknown };
const STATE_TEXT: Record<ReputationState, string> = { loading: "Loading", unavailable: "Unavailable", stale: "Stale", "no-history": "No scored rounds", scored: "Scored" };

function problem(error: unknown): string {
  if (error instanceof RecordUnavailable && error.reason === "offline") return "The local API is offline. Start the demo with bash scripts/docker-demo/up.sh, then reload.";
  if (error instanceof RecordUnavailable && error.reason === "not-configured") return error.message;
  return error instanceof Error ? error.message : "The reputation read model is unavailable.";
}

function AgentCard({ name, agent, stale }: { name: string; agent: ReputationAgent | null; stale: boolean }) {
  const state = reputationState(agent, { stale });
  const rep = agent?.reputation ?? null;
  const points = rep ? formatPoints(rep.score) : null;
  return <article className={`agent-card ${state === "scored" ? "scored" : ""}`} data-state={state}>
    <div className="agent-card-top"><AgentAvatar name={name} size="lg" /><div><b>{name}</b><small>Proposer agent</small></div></div>
    <div className="agent-score">{!agent ? <Skeleton width={60} height={34} /> : rep && points !== null ? <><b>{points}</b><span>outcome {points === "+1" || points === "−1" ? "point" : "points"}</span></>
      : <span className="unavailable" title={reputationCodeText(agent.code)}>No data · {agent.code ?? "unavailable"}</span>}</div>
    {rep ? <div className="outcome-dots" aria-label={`${rep.positive} positive, ${rep.negative} negative, ${rep.flat} flat out of ${rep.samples} scored rounds`}>
      <span><i className="p" />{rep.positive} up</span><span><i className="n" />{rep.negative} down</span><span><i className="f" />{rep.flat} flat</span></div> : null}
    <div className="agent-card-foot">
      <Chip tone={state === "scored" ? "ok" : state === "unavailable" ? "fixture" : state === "stale" ? "local" : "plain"}>{STATE_TEXT[state]}{rep && state === "scored" ? ` · ${rep.samples} ${rep.samples === "1" ? "round" : "rounds"}` : ""}</Chip>
      {agent?.address ? <Address value={agent.address} chainId={AURORA_TESTNET} label={`${name} wallet`} live /> : null}
    </div>
  </article>;
}

export default function AgentsPage() {
  const now = useNow();
  const [stack, setStack] = useState<ReputationStackId>("tidepool");
  const [states, setStates] = useState<Record<ReputationStackId, BoardState>>({ original: { board: null, receivedAt: null, error: null }, tidepool: { board: null, receivedAt: null, error: null } });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("stack");
    if (wanted === "original" || wanted === "tidepool") setStack(wanted);
  }, []);
  function choose(next: ReputationStackId) {
    setStack(next);
    const url = new URL(window.location.href); url.searchParams.set("stack", next); window.history.replaceState(null, "", url);
  }

  // Each stack is read and polled on its own; a failed refresh keeps the last good snapshot, which then turns stale.
  useEffect(() => {
    let active = true;
    for (const item of STACKS) {
      loadReputation(item.id).then(
        (board) => { if (active) setStates((prev) => ({ ...prev, [item.id]: { board, receivedAt: Math.floor(Date.now() / 1000), error: null } })); },
        (error) => { if (active) setStates((prev) => ({ ...prev, [item.id]: { ...prev[item.id], error } })); },
      );
    }
    const timer = setTimeout(() => setTick((value) => value + 1), POLL_MS);
    return () => { active = false; clearTimeout(timer); };
  }, [tick]);

  const current = states[stack];
  const info = STACKS.find((item) => item.id === stack)!;
  const stale = Boolean(current.board) && Boolean(current.error) && snapshotStale({ receivedAt: current.receivedAt, now });
  const blocks = current.board?.agents.flatMap((agent) => (agent.reputation ? [agent.reputation.blockNumber] : [])) ?? [];
  const block = blocks.length ? blocks.reduce((a, b) => (BigInt(a) > BigInt(b) ? a : b)) : null;
  const byName = new Map((current.board?.agents ?? []).map((agent) => [agent.name, agent]));
  const names = current.board ? current.board.agents.map((agent) => agent.name) : PROPOSERS;

  return <AppShell source={{ label: "Aurora testnet", tone: "testnet", detail: current.board ? (stale ? "stale read" : "live read") : "reading", status: current.board ? (stale ? "warn" : "ok") : current.error ? "off" : "pending" }}>
    <header className="round-hero">
      <h1>Agents</h1>
      <p className="lede">Each proposer agent builds a record from real outcomes. A strategy earns a point only when it is selected, executed and settled, so being selected alone earns nothing.</p>
    </header>

    <div className="section-head">
      <div><SegmentedControl label="Reputation contract" value={stack} onChange={choose} options={STACKS.map((item) => ({ id: item.id, label: item.label }))} />
        <p style={{ marginTop: 10 }}>{info.note} Each stack has its own contract, and the two histories are never added together.</p></div>
      <Link className="link" href="/arena">See the rounds behind these records<Icon name="arrow" /></Link>
    </div>

    {!current.board && current.error ? <EmptyState icon="alert" title="Reputation unavailable">{problem(current.error)} Nothing is shown as zero while reputation cannot be read.</EmptyState>
      : <div className="agent-grid">{names.map((name) => <AgentCard key={name} name={name} agent={current.board ? byName.get(name) ?? null : null} stale={stale} />)}</div>}

    {current.board ? <div className="board-meta">
      <span><i className="dot testnet" /> Aurora testnet · {AURORA_TESTNET}</span>
      <span>Contract {current.board.contract ? <Address value={current.board.contract} chainId={AURORA_TESTNET} label="reputation contract" live /> : "unavailable"}</span>
      <span>Block {block ? <code>#{block}</code> : "unavailable"}</span>
      {current.board.observedAt && now ? <span>Read {formatAge(now - current.board.observedAt)}</span> : null}
      {stale ? <Chip tone="local">Stale snapshot</Chip> : <Chip tone="live">Live read</Chip>}
    </div> : null}

    <section className="block" aria-labelledby="rules-title">
      <div className="section-head"><div><h2 id="rules-title">How outcome points work</h2></div></div>
      <div className="rules">
        <div className="rule"><b><Icon name="check" />Only executed strategies score</b><p>A point needs a strategy that was selected, executed through the Safe and settled. Hold rounds and unselected proposals are not scored.</p></div>
        <div className="rule"><b><Icon name="pulse" />+1, −1 or 0</b><p>A positive measured return earns +1, a negative one −1, an exactly flat one 0. Small and large moves count the same.</p></div>
        <div className="rule"><b><Icon name="layers" />Separate per stack</b><p>Each engine records to its own contract. The same agent can have −1 on two stacks from two different rounds; that is not −2.</p></div>
        <div className="rule"><b><Icon name="eye" />Selection is a separate fact</b><p>Being chosen by the market is not counted here. Only the measured outcome of an executed strategy is.</p></div>
        <div className="rule"><b><Icon name="shield" />Not a credit score</b><p>An outcome record over a few test rounds. Not proof of investment skill, alpha or a lending score.</p></div>
        <div className="rule"><b><Icon name="users" />Forecasters are separate</b><p>Forecasters settle through their own collateral. They do not have outcome points here.</p></div>
      </div>
    </section>
  </AppShell>;
}
