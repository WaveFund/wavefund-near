"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { AgentAvatar, Chip } from "@/components/arena/parts";
import { Address, useNow } from "@/components/funding/primitives";
import { EmptyState, SegmentedControl, Skeleton } from "@/components/ui";
import { Drawer, PageHead, Tip } from "@/components/v2";
import { useSavedRounds } from "@/lib/arena/hooks";
import { percentFromBps } from "@/lib/arena/model.mjs";
import { AURORA_TESTNET, formatAge } from "@/lib/funding/model.mjs";
import { attributableRounds, rankAgents, type AgentRow } from "@/lib/record/agents-view.mjs";
import { formatPoints, formatReturnX18, snapshotStale, type ReputationBoard } from "@/lib/record/model.mjs";
import { RecordUnavailable, loadReputation, type ReputationStackId } from "@/lib/record/loader";
import "./agents.css";

const STACKS: Array<{ id: ReputationStackId; label: string }> = [{ id: "tidepool", label: "Tidepool stack" }, { id: "original", label: "Original stack" }];
type BoardState = { board: ReputationBoard | null; receivedAt: number | null; error: unknown };
const EMPTY: BoardState = { board: null, receivedAt: null, error: null };

function problem(error: unknown): string {
  if (error instanceof RecordUnavailable && error.reason === "offline") return "Agent records are unavailable because the Wavefund API is not responding.";
  if (error instanceof RecordUnavailable && error.reason === "not-configured") return error.message;
  return error instanceof Error ? error.message : "The reputation read model is unavailable.";
}
const tone = (points: string | null) => (points === null ? "" : points.startsWith("+") ? "ag-pos" : points.startsWith("−") ? "ag-neg" : "");

function Rules() {
  return <ul className="ag-rules">
    <li>Only selected, executed and settled non-Hold rounds score.</li>
    <li>+1 for a positive measured return, −1 for a negative one, 0 for flat.</li>
    <li>Stacks are never summed: the same agent can be −1 on two stacks from two different rounds, which is not −2.</li>
    <li>Not a credit score: an outcome record over a few test rounds.</li>
  </ul>;
}

function AgentDetail({ row, stack, stackLabel, rounds, roundsFailed }: { row: AgentRow; stack: ReputationStackId; stackLabel: string; rounds: ReturnType<typeof attributableRounds> | null; roundsFailed: boolean }) {
  const points = row.score !== null ? formatPoints(row.score) : null;
  return <>
    <div className="ag-block"><h3>Wallet</h3>{row.address ? <Address value={row.address} chainId={AURORA_TESTNET} label={`${row.name} wallet`} live /> : <span className="ag-na">unavailable</span>}</div>
    <div className="ag-block"><h3>Cumulative on {stackLabel}</h3>
      {row.available ? <><span className={`num ag-big ${tone(points)}`}>{points}</span>
        <span className="num" style={{ fontSize: 13, color: "var(--muted)" }}>{row.samples} scored {row.samples === "1" ? "round" : "rounds"} · {row.positive} up · {row.negative} down · {row.flat} flat</span></>
        : <span className="ag-na">unavailable</span>}
    </div>
    <div><p className="eyebrow" style={{ marginBottom: 10 }}>Attributable executed rounds</p>
      {roundsFailed ? <p className="ag-na">Saved rounds are unavailable.</p> : !rounds ? <Skeleton height={64} />
        : rounds.length === 0 ? <p className="ag-na">No saved round on this stack where this agent&apos;s strategy was selected and executed.</p>
        : <div className="ag-rounds">{rounds.map((item) => {
          const delta = item.delta !== null ? formatPoints(item.delta) : null;
          return <div key={item.slug} className="ag-round">
            <Link href={`/rounds/${item.slug}`}>Round {item.roundId}</Link><span className="num" style={{ textAlign: "right" }}>{percentFromBps(item.allocationBps) ?? "unavailable"} ETH</span>
            <span className="k">Measured return</span><span className="num" style={{ textAlign: "right" }}>{formatReturnX18(item.returnX18) ?? "unavailable"}</span>
            <span className="k">Reputation this round</span><span className={`num ${tone(delta)}`} style={{ textAlign: "right" }}>{delta ?? "unavailable"}</span>
          </div>;
        })}</div>}
      <p className="ag-na" style={{ marginTop: 10 }}>The per-round change is separate from the cumulative total above. Stacks are never added together.</p>
    </div>
  </>;
}

export default function AgentsPage() {
  const now = useNow();
  const [stack, setStack] = useState<ReputationStackId>("tidepool");
  const [states, setStates] = useState<Record<ReputationStackId, BoardState>>({ original: EMPTY, tidepool: EMPTY });
  const [selected, setSelected] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const { rounds, error: roundsError } = useSavedRounds();

  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("stack");
    if (wanted === "original" || wanted === "tidepool") setStack(wanted);
  }, []);
  function choose(next: ReputationStackId) {
    setStack(next); setSelected(null);
    const url = new URL(window.location.href); url.searchParams.set("stack", next); window.history.replaceState(null, "", url);
  }

  // One read per stack. A failed refresh keeps the last good snapshot, which then turns stale.
  const load = useCallback(async () => {
    setRefreshing(true);
    await Promise.all(STACKS.map((item) => loadReputation(item.id).then(
      (board) => setStates((prev) => ({ ...prev, [item.id]: { board, receivedAt: Math.floor(Date.now() / 1000), error: null } })),
      (error) => setStates((prev) => ({ ...prev, [item.id]: { ...prev[item.id], error } })),
    )));
    setRefreshing(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const current = states[stack];
  const info = STACKS.find((item) => item.id === stack)!;
  const stale = Boolean(current.board) && Boolean(current.error) && snapshotStale({ receivedAt: current.receivedAt, now });
  const rows = rankAgents(current.board);
  const blocks = rows.flatMap((row) => (row.blockNumber ? [row.blockNumber] : []));
  const block = blocks.length ? blocks.reduce((a, b) => (BigInt(a) > BigInt(b) ? a : b)) : null;
  const row = rows.find((item) => item.name === selected) ?? null;
  const attributable = row && rounds ? attributableRounds(rounds, stack, row.name) : null;

  return <AppShell source={{ label: "Aurora testnet", tone: "testnet", detail: current.board ? (stale ? "stale read" : "read once") : "reading", status: current.board ? (stale ? "warn" : "ok") : current.error ? "off" : "pending" }}>
    <PageHead ai eyebrow="Proposer agents · outcome reputation" title="Agents" line="A proposer earns a point only when its strategy is selected, executed and settled." />

    <div className="ag-bar">
      <SegmentedControl label="Reputation contract" value={stack} onChange={choose} options={STACKS.map((item) => ({ id: item.id, label: item.label }))} />
      <span className="ag-tools"><Tip label="How outcome points work"><Rules /></Tip>
        <button type="button" className="btn btn-sm" onClick={() => void load()} disabled={refreshing} aria-busy={refreshing}>{refreshing ? "Refreshing…" : "Refresh"}</button></span>
    </div>

    {!current.board && current.error ? <EmptyState icon="alert" title="Reputation unavailable">{problem(current.error)} Nothing is shown as zero while reputation cannot be read. <Tip label="For developers">Start the Wavefund API or run bash scripts/docker-demo/up.sh.</Tip></EmptyState>
      : <div className="card ag-card"><div className="table-wrap"><table className="table ag-table">
        <caption className="sr-only" style={{ position: "absolute", left: -9999 }}>Proposer agents on the {info.label}, ranked by cumulative outcome score</caption>
        <thead><tr><th>Agent</th><th className="r">Outcome score</th><th className="r">Scored rounds</th><th className="r">+ / − / flat</th></tr></thead>
        <tbody>{!current.board ? [0, 1, 2, 3].map((i) => <tr key={i}><td><Skeleton width={110} height={20} /></td><td><Skeleton width={30} /></td><td><Skeleton width={30} /></td><td><Skeleton width={60} /></td></tr>)
          : rows.map((item) => {
            const points = item.score !== null ? formatPoints(item.score) : null;
            return <tr key={item.name} onClick={() => setSelected(item.name)}>
              <td><button type="button" className="ag-name" onClick={(event) => { event.stopPropagation(); setSelected(item.name); }}><AgentAvatar name={item.name} size="sm" />{item.name}</button></td>
              {item.available ? <>
                <td className={`r num ${tone(points)}`}>{points}</td><td className="r num">{item.samples}</td>
                <td className="r"><span className="ag-split num"><span className="ag-pos">+{item.positive}</span><span className="ag-neg">−{item.negative}</span><span style={{ color: "var(--muted)" }}>{item.flat}</span></span></td></>
                : <td className="r ag-na" colSpan={3}>unavailable</td>}
            </tr>;
          })}</tbody></table></div></div>}

    {current.board ? <div className="ag-meta">
      <span>{info.label}</span>
      <span>Contract {current.board.contract ? <Address value={current.board.contract} chainId={AURORA_TESTNET} label="reputation contract" live /> : "unavailable"}</span>
      <span>Block {block ? <code>#{block}</code> : "unavailable"}</span>
      {current.board.observedAt && now ? <span>Read {formatAge(now - current.board.observedAt)}</span> : null}
      {stale ? <Chip tone="local">Stale snapshot</Chip> : null}
    </div> : null}

    <Drawer open={row !== null} onClose={() => setSelected(null)} title={row ? <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}><AgentAvatar name={row.name} size="sm" />{row.name}</span> : "Agent"}>
      {row ? <AgentDetail row={row} stack={stack} stackLabel={info.label} rounds={attributable} roundsFailed={Boolean(roundsError)} /> : null}
    </Drawer>
  </AppShell>;
}
