"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Leaderboard, ReputationRules, ReputationSource } from "@/components/record/RecordParts";
import { Address, Icon, useNow } from "@/components/funding/primitives";
import { Badge, Card, CardHeader, EmptyState, EvidenceBadge, Notice, PageHeader } from "@/components/ui";
import { AURORA_TESTNET } from "@/lib/funding/model.mjs";
import { snapshotStale, type ReputationBoard } from "@/lib/record/model.mjs";
import { RecordUnavailable, loadReputation, type ReputationStackId } from "@/lib/record/loader";

const PROPOSERS = ["Conservative", "Balanced", "Momentum", "HighBeta"];
const STACKS: Array<{ id: ReputationStackId; title: string; note: string }> = [
  { id: "original", title: "Original testnet stack", note: "Recorded from round 7 of the original engine." },
  { id: "tidepool", title: "Tidepool testnet stack", note: "Recorded from round 1 of the Tidepool-funded engine." },
];
const POLL_MS = 30_000;
type BoardState = { board: ReputationBoard | null; receivedAt: number | null; error: unknown };

function problem(error: unknown): { title: string; text: string } {
  if (error instanceof RecordUnavailable && error.reason === "offline") return { title: "Local API offline", text: "Start the demo with bash scripts/docker-demo/up.sh, then reload." };
  if (error instanceof RecordUnavailable && error.reason === "not-configured") return { title: "Reputation is not enabled on this API", text: error.message };
  return { title: "Reputation unavailable", text: error instanceof Error ? error.message : "The reputation read model is unavailable." };
}

function StackBoard({ title, note, state, now }: { title: string; note: string; state: BoardState; now: number }) {
  const { board, error, receivedAt } = state;
  const stale = Boolean(board) && Boolean(error) && snapshotStale({ receivedAt, now });
  const failure = !board && error ? problem(error) : null;
  return <Card>
    <CardHeader title={title} icon="trophy" sub={<>{note}{board?.stack?.engine ? <> Engine <Address value={board.stack.engine} chainId={AURORA_TESTNET} label="engine" live /></> : null}</>}
      actions={board ? <>{stale ? <Badge tone="warning" dot>Stale snapshot</Badge> : <EvidenceBadge kind="live" />}<Badge tone={board.status === "ok" ? "success" : board.status === "partial" ? "warning" : "danger"} dot>{board.status === "ok" ? "All agents read" : board.status === "partial" ? "Some reads failed" : "Reads failed"}</Badge></> : null} />
    {failure ? <EmptyState icon="alert" title={failure.title}>{failure.text} Nothing is shown as zero while reputation cannot be read.</EmptyState>
      : <Leaderboard board={board} stale={stale} names={PROPOSERS} />}
    {board ? <div className="card-footer source-line"><ReputationSource board={board} now={now} /></div> : null}
  </Card>;
}

export default function AgentsPage() {
  const now = useNow();
  const [states, setStates] = useState<Record<ReputationStackId, BoardState>>({ original: { board: null, receivedAt: null, error: null }, tidepool: { board: null, receivedAt: null, error: null } });
  const [tick, setTick] = useState(0);

  // Each stack is polled on its own; a failed refresh keeps that stack's last good snapshot, which turns stale.
  useEffect(() => {
    let active = true;
    for (const stack of STACKS) {
      loadReputation(stack.id).then(
        (board) => { if (active) setStates((prev) => ({ ...prev, [stack.id]: { board, receivedAt: Math.floor(Date.now() / 1000), error: null } })); },
        (error) => { if (active) setStates((prev) => ({ ...prev, [stack.id]: { ...prev[stack.id], error } })); },
      );
    }
    const timer = setTimeout(() => setTick((value) => value + 1), POLL_MS);
    return () => { active = false; clearTimeout(timer); };
  }, [tick]);

  const boards = STACKS.map((stack) => states[stack.id].board);
  const anyLive = boards.some(Boolean);
  const status = anyLive ? { label: "Reputation live", tone: "ok" as const } : STACKS.every((stack) => states[stack.id].error) ? { label: "Unavailable", tone: "off" as const } : { label: "Reading testnet", tone: "pending" as const };

  return <AppShell network={{ label: "Aurora testnet", chainId: AURORA_TESTNET, tone: "testnet" }} status={status}>
    <PageHeader title="Agents"
      description="Outcome reputation of the four AI proposers. A proposer gains or loses a point only when its strategy is selected, executed and settled. It is not a lending credit score or proof of investment skill."
      meta={<><Badge tone="info">Aurora testnet</Badge><span>Read live through the shared reputation reader, with pinned contract code and a fresh block.</span></>} />
    <div className="page-notice"><Notice tone="neutral" icon="layers"><p><b>Two separate contract histories.</b> The same Momentum wallet has −1 on each stack, from two different rounds. Scores are shown per stack and are never added into one global score.</p></Notice></div>
    <div className="detail-layout">
      <div className="stack-lg">
        {STACKS.map((stack) => <StackBoard key={stack.id} title={stack.title} note={stack.note} state={states[stack.id]} now={now} />)}
      </div>
      <aside className="detail-side">
        <Card><CardHeader title="How outcome points work" icon="eye" /><div className="card-body"><ReputationRules /></div></Card>
        <Card><div className="card-body side-link"><p>See what each testnet round actually did, including the Tidepool-funded round and a round where nobody traded.</p><Link className="link" href="/">View past rounds<Icon name="arrow" /></Link></div></Card>
      </aside>
    </div>
  </AppShell>;
}
