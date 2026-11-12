"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Leaderboard, ReputationRules, ReputationSource } from "@/components/record/RecordParts";
import { Icon, useNow } from "@/components/funding/primitives";
import { Badge, Card, CardHeader, EmptyState, Notice, PageHeader } from "@/components/ui";
import { AURORA_TESTNET } from "@/lib/funding/model.mjs";
import { snapshotStale, type ReputationBoard } from "@/lib/record/model.mjs";
import { RecordUnavailable, loadReputation } from "@/lib/record/loader";

const PROPOSERS = ["Conservative", "Balanced", "Momentum", "HighBeta"];
const POLL_MS = 30_000;

function problem(error: unknown): { title: string; text: string } {
  if (error instanceof RecordUnavailable && error.reason === "offline") return { title: "Local API offline", text: "Start the demo with bash scripts/docker-demo/up.sh, then reload." };
  if (error instanceof RecordUnavailable && error.reason === "not-configured") return { title: "Reputation is not enabled on this API", text: error.message };
  return { title: "Reputation unavailable", text: error instanceof Error ? error.message : "The reputation read model is unavailable." };
}

export default function AgentsPage() {
  const now = useNow();
  const [board, setBoard] = useState<ReputationBoard | null>(null);
  const [receivedAt, setReceivedAt] = useState<number | null>(null);
  const [boardError, setBoardError] = useState<unknown>(null);
  const [tick, setTick] = useState(0);

  // Polls the board; a failed refresh keeps the last good snapshot, which turns stale after 90 seconds.
  useEffect(() => {
    let active = true;
    loadReputation().then(
      (next) => { if (active) { setBoard(next); setReceivedAt(Math.floor(Date.now() / 1000)); setBoardError(null); } },
      (error) => { if (active) setBoardError(error); },
    );
    const timer = setTimeout(() => setTick((value) => value + 1), POLL_MS);
    return () => { active = false; clearTimeout(timer); };
  }, [tick]);

  const stale = Boolean(board) && Boolean(boardError) && snapshotStale({ receivedAt, now });
  const failure = !board && boardError ? problem(boardError) : null;
  const status = board && !stale
    ? (board.status === "ok" ? { label: "Reputation live", tone: "ok" as const } : board.status === "partial" ? { label: "Partly available", tone: "warn" as const } : { label: "Reads unavailable", tone: "off" as const })
    : board && stale ? { label: "Stale snapshot", tone: "warn" as const } : failure ? { label: "Unavailable", tone: "off" as const } : { label: "Reading testnet", tone: "pending" as const };

  return <AppShell network={{ label: "Aurora testnet", chainId: AURORA_TESTNET, tone: "testnet" }} status={status}>
    <PageHeader title="Agents"
      description="The four AI proposers and their on-chain performance reputation. Points change only when a proposer's strategy is selected, executed and settled."
      meta={<><Badge tone="info">Aurora testnet</Badge><span>Read live through the shared reputation reader, with pinned contract code and a fresh block.</span></>} />

    {stale ? <div className="page-notice"><Notice tone="warning" title="Showing the last good snapshot"><p>Refreshing from Aurora testnet keeps failing. The numbers below may be out of date.</p></Notice></div> : null}

    <div className="detail-layout">
      <Card>
        <CardHeader title="Performance reputation" icon="trophy" actions={board ? <Badge tone={board.status === "ok" ? "success" : board.status === "partial" ? "warning" : "danger"} dot>{board.status === "ok" ? "All agents read" : board.status === "partial" ? "Some reads failed" : "Reads failed"}</Badge> : null} />
        {failure ? <EmptyState icon="alert" title={failure.title}>{failure.text} Nothing is shown as zero while reputation cannot be read.</EmptyState>
          : <Leaderboard board={board} stale={stale} names={PROPOSERS} />}
        {board ? <div className="card-footer source-line"><ReputationSource board={board} now={now} /></div> : null}
      </Card>
      <aside className="detail-side">
        <Card><CardHeader title="How points work" icon="eye" /><div className="card-body"><ReputationRules /></div></Card>
        <Card><div className="card-body side-link"><p>See what each testnet round actually did, including a measured loss and a round where nobody traded.</p><Link className="link" href="/">View past rounds<Icon name="arrow" /></Link></div></Card>
      </aside>
    </div>
  </AppShell>;
}
