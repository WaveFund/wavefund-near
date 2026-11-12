"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { AgentCard, ReputationRules, ReputationSource, RoundCard } from "@/components/record/RecordParts";
import { Icon, useNow } from "@/components/funding/primitives";
import { AURORA_TESTNET } from "@/lib/funding/model.mjs";
import { snapshotStale, type ReputationBoard, type TestnetRound } from "@/lib/record/model.mjs";
import { RecordUnavailable, loadReputation, loadRoundEvidence } from "@/lib/record/loader";

const PROPOSERS = ["Conservative", "Balanced", "Momentum", "HighBeta"];
const POLL_MS = 30_000;

function problem(error: unknown): { title: string; text: string } {
  if (error instanceof RecordUnavailable && error.reason === "offline") return { title: "Local API offline", text: "Start the demo with bash scripts/docker-demo/up.sh, then reload." };
  if (error instanceof RecordUnavailable && error.reason === "not-configured") return { title: "Not enabled on this API", text: error.message };
  return { title: "Unavailable", text: error instanceof Error ? error.message : "The read model is unavailable." };
}

export default function RecordPage() {
  const now = useNow();
  const [board, setBoard] = useState<ReputationBoard | null>(null);
  const [receivedAt, setReceivedAt] = useState<number | null>(null);
  const [boardError, setBoardError] = useState<unknown>(null);
  const [rounds, setRounds] = useState<TestnetRound[] | null>(null);
  const [roundsError, setRoundsError] = useState<unknown>(null);
  const [tick, setTick] = useState(0);

  // Polls the reputation board; a failed refresh keeps the last good snapshot, which then turns stale.
  useEffect(() => {
    let active = true;
    loadReputation().then(
      (next) => { if (active) { setBoard(next); setReceivedAt(Math.floor(Date.now() / 1000)); setBoardError(null); } },
      (error) => { if (active) setBoardError(error); },
    );
    const timer = setTimeout(() => setTick((value) => value + 1), POLL_MS);
    return () => { active = false; clearTimeout(timer); };
  }, [tick]);

  useEffect(() => {
    let active = true;
    loadRoundEvidence().then((next) => { if (active) setRounds(next); }, (error) => { if (active) setRoundsError(error); });
    return () => { active = false; };
  }, []);

  const stale = Boolean(board) && Boolean(boardError) && snapshotStale({ receivedAt, now });
  const live = Boolean(board);
  const status = board && !stale
    ? (board.status === "ok" ? { label: "Reputation live", tone: "ok" as const } : board.status === "partial" ? { label: "Partly available", tone: "warn" as const } : { label: "Reads unavailable", tone: "off" as const })
    : board && stale ? { label: "Stale snapshot", tone: "warn" as const }
    : boardError ? { label: "Unavailable", tone: "off" as const } : { label: "Reading testnet", tone: "pending" as const };
  const boardProblem = !board && boardError ? problem(boardError) : null;

  return <AppShell network={{ label: "Aurora testnet", chainId: AURORA_TESTNET, tone: "testnet" }} status={status}>
    <div className="mode-strip tone-testnet" role="status">
      <span className="mode-label">PUBLIC TESTNET RECORD</span>
      <span className="mode-text">Read-only Aurora testnet reads and published test evidence · test assets, no real profit</span>
    </div>

    <section className="page-head rec-head">
      <div>
        <span className="kicker">Step 04 · Track record</span>
        <h1>Strategies earn a record <span className="grad-text">only when they ship.</span></h1>
        <p className="lede">Proposers gain or lose performance points only when their strategy is selected, executed through the Safe and settled. Below is the live testnet record, and what the last two testnet rounds actually did: one measured loss, and one round where nobody traded.</p>
      </div>
    </section>

    <section className="section" aria-labelledby="reputation-heading">
      <div className="section-head">
        <div><span className="kicker">On-chain · AgentReputation</span><h2 id="reputation-heading">Performance reputation</h2></div>
        <p>Read through the shared reputation reader: pinned contract code, bindings and a fresh block. Zero history and unavailable data are shown differently.</p>
      </div>
      {boardProblem ? <div className="card connect-card"><span className="empty-ico"><Icon name="alert" /></span><div><h3>{boardProblem.title}</h3><p>{boardProblem.text}</p><p className="rec-note">Nothing is shown as zero while reputation cannot be read.</p></div></div> : null}
      <div className="rec-board">
        {(board ? board.agents : PROPOSERS.map(() => null)).map((agent, index) => board
          ? <AgentCard key={agent?.address ?? index} agent={agent} stale={stale} />
          : boardProblem ? null : <AgentCard key={PROPOSERS[index]} agent={null} stale={false} loading={{ name: PROPOSERS[index] }} />)}
      </div>
      <div className="rec-board-foot">
        {board ? <ReputationSource board={board} now={now} live={live} /> : <span />}
        <ReputationRules />
      </div>
    </section>

    <section className="section" aria-labelledby="rounds-heading">
      <div className="section-head">
        <div><span className="kicker">Published evidence · Aurora testnet</span><h2 id="rounds-heading">The latest testnet rounds, as they happened</h2></div>
        <p>From docs/test-evidence, validated by the local API. Every transaction links to the Aurora testnet explorer.</p>
      </div>
      {rounds ? <div className="rec-rounds">{rounds.map((round) => <RoundCard key={round.roundId} round={round} />)}</div>
        : roundsError ? <div className="card connect-card"><span className="empty-ico"><Icon name="alert" /></span><div><h3>{problem(roundsError).title}</h3><p>{problem(roundsError).text}</p></div></div>
        : <div className="card loading-card" aria-busy="true"><span className="spinner" />Loading published round evidence…</div>}
    </section>
  </AppShell>;
}
