"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { AppShell } from "@/components/AppShell";
import { AgentAvatar, Chip, agentVar } from "@/components/arena/parts";
import { AiProvenance } from "@/components/arena/AiProvenance";
import { Address, Icon, useNow } from "@/components/funding/primitives";
import { EmptyState, SegmentedControl, Skeleton } from "@/components/ui";
import { Drawer, PageHead, Tip } from "@/components/v2";
import { useSavedRounds } from "@/lib/arena/hooks";
import { percentFromBps } from "@/lib/arena/model.mjs";
import { AURORA_TESTNET, formatAge } from "@/lib/funding/model.mjs";
import { agentProposals, attributableRounds, rankAgents, type AgentProposal, type AgentRow } from "@/lib/record/agents-view.mjs";
import { formatPoints, formatReturnX18, snapshotStale, type ReputationBoard } from "@/lib/record/model.mjs";
import { RecordUnavailable, loadReputation, type ReputationStackId } from "@/lib/record/loader";

const STACKS: Array<{ id: ReputationStackId; label: string }> = [{ id: "tidepool", label: "Testnet Safe v2" }, { id: "original", label: "Testnet Safe v1" }];
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

function AgentDetail({ row, stackLabel, rounds, proposals, roundsFailed }: { row: AgentRow; stackLabel: string; rounds: ReturnType<typeof attributableRounds> | null; proposals: AgentProposal[] | null; roundsFailed: boolean }) {
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
    <div><p className="eyebrow" style={{ marginBottom: 10 }}>Model behind each saved proposal</p>
      {roundsFailed ? <p className="ag-na">Saved rounds are unavailable.</p> : !proposals ? <Skeleton height={64} />
        : proposals.length === 0 ? <p className="ag-na">No saved proposal by this agent on this stack.</p>
        : <div className="ag-rounds">{proposals.map((item) => <div key={item.slug} className="ag-round ag-prov">
          <Link href={`/rounds/${item.slug}`}>Round {item.roundId}</Link><span className="num" style={{ textAlign: "right" }}>{percentFromBps(item.proposal.allocationBps) ?? "unavailable"} ETH</span>
          <AiProvenance round={item.round} agent={item.proposal} role="proposer" />
        </div>)}</div>}
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
    <PageHead ai eyebrow="Proposer agents · on-chain outcome reputation" title="Agents" line="Four AI proposers compete round after round. An agent earns or loses a point only when its strategy is selected, executed and settled." />

    <div className="list-toolbar">
      <SegmentedControl label="Reputation contract" value={stack} onChange={choose} options={STACKS.map((item) => ({ id: item.id, label: item.label }))} />
      <button type="button" className="btn btn-sm" onClick={() => void load()} disabled={refreshing} aria-busy={refreshing}>{refreshing ? <span className="spinner" aria-hidden="true" /> : <Icon name="refund" />}{refreshing ? "Reading…" : "Re-read chain"}</button>
    </div>

    {!current.board && current.error ? <div className="card"><EmptyState icon="alert" title="Reputation unavailable">{problem(current.error)} Nothing is shown as zero while reputation cannot be read. <Tip label="For developers">Start the Wavefund API or run bash scripts/docker-demo/up.sh.</Tip></EmptyState></div>
      : <div className="ag-layout">
        <ol className="ag-board" aria-label={`Proposer agents on the ${info.label}, ranked by cumulative outcome score`}>
          {!current.board ? [0, 1, 2, 3].map((i) => <li key={i} className="card ag-agent"><Skeleton height={40} width={160} /><Skeleton height={34} width={70} /><Skeleton height={8} /></li>)
            : rows.map((item, index) => {
              const points = item.score !== null ? formatPoints(item.score) : null;
              const latest = rounds ? agentProposals(rounds, stack, item.name)[0] : null;
              const total = item.available ? Number(item.positive ?? 0) + Number(item.negative ?? 0) + Number(item.flat ?? 0) : 0;
              const share = (value: string | null) => (total ? `${(Number(value ?? 0) / total) * 100}%` : "0%");
              return <li key={item.name} className="card ag-agent" style={{ "--c": `var(${agentVar(item.name)})` } as CSSProperties}>
                <button type="button" className="ag-hit" onClick={() => setSelected(item.name)} aria-label={`${item.name}: open record`} />
                <div className="ag-top">
                  <span className="ag-rank num">#{index + 1}</span>
                  <AgentAvatar name={item.name} size="lg" />
                  <div className="ag-id"><b>{item.name}</b>{latest ? <span className="num">Last proposed {percentFromBps(latest.proposal.allocationBps) ?? "—"} ETH · round {latest.roundId}</span> : <span>No saved proposal on this Safe</span>}</div>
                  {item.available ? <span className={`ag-score num ${tone(points)}`}>{points}<small>points</small></span> : <span className="ag-score ag-na">unavailable</span>}
                </div>
                {item.available ? <div className="ag-record">
                  <div className="ag-bar-track" role="img" aria-label={`${item.positive} positive, ${item.negative} negative, ${item.flat} flat of ${item.samples} scored rounds`}>
                    <i className="up" style={{ width: share(item.positive) }} /><i className="down" style={{ width: share(item.negative) }} /><i className="flat" style={{ width: share(item.flat) }} />
                  </div>
                  <div className="ag-record-legend num"><span><i className="up" />{item.positive} up</span><span><i className="down" />{item.negative} down</span><span><i className="flat" />{item.flat} flat</span><span className="ag-samples">{item.samples} scored {item.samples === "1" ? "round" : "rounds"}</span></div>
                </div> : <p className="ag-na">Reputation could not be read for this agent{item.code ? ` (${item.code})` : ""}.</p>}
                {latest ? <div className="ag-latest"><span className="sr-only">Latest saved proposal, round {latest.roundId}: </span><AiProvenance round={latest.round} agent={latest.proposal} role="proposer" /></div> : null}
              </li>;
            })}
        </ol>
        <aside className="card ag-rules-card"><h2><Icon name="book" />How points work</h2><Rules /><p className="muted">Click an agent to see the rounds behind its score and the model behind each proposal.</p></aside>
      </div>}

    {current.board ? <div className="ag-meta">
      <span>{info.label}</span>
      <span>Contract {current.board.contract ? <Address value={current.board.contract} chainId={AURORA_TESTNET} label="reputation contract" live /> : "unavailable"}</span>
      <span>Block {block ? <code>#{block}</code> : "unavailable"}</span>
      {current.board.observedAt && now ? <span>Read {formatAge(now - current.board.observedAt)}</span> : null}
      {stale ? <Chip tone="local">Stale snapshot</Chip> : null}
    </div> : null}

    <Drawer open={row !== null} onClose={() => setSelected(null)} title={row ? <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}><AgentAvatar name={row.name} size="sm" />{row.name}</span> : "Agent"}>
      {row ? <AgentDetail row={row} stackLabel={info.label} rounds={attributable} proposals={row && rounds ? agentProposals(rounds, stack, row.name) : null} roundsFailed={Boolean(roundsError)} /> : null}
    </Drawer>
  </AppShell>;
}
