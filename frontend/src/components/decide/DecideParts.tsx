"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { PHASES, probability, returnPercent, signedUnits, units, type DemoState, type Receipt } from "@/lib/state";
import { formatReturnX18 } from "@/lib/record/model.mjs";
import type { TestnetRound } from "@/lib/record/model.mjs";
import { CopyText, Icon } from "@/components/funding/primitives";
import { Avatar, Badge, EmptyState, ProgressBar, Timeline, type TimelineItem, type Tone } from "@/components/ui";

const ONE = 10n ** 18n;
const isRaw = (value: string | null | undefined): value is string => typeof value === "string" && /^\d+$/.test(value);
/** Percentage (0–100) for a 1e18-scaled probability, computed with integers. */
export function probabilityPercent(raw: string | null | undefined): number {
  if (!isRaw(raw)) return 0;
  const value = BigInt(raw);
  return value > ONE ? 100 : Number(value / 10n ** 14n) / 100;
}
/** SHORT probability = 1 − LONG, kept as an integer string. */
export function complement(raw: string | null | undefined): string | null {
  if (!isRaw(raw)) return null;
  const value = BigInt(raw);
  return value > ONE ? null : (ONE - value).toString();
}
const bpsPercent = (bps: number) => `${Math.floor(bps / 100)}${bps % 100 ? `.${String(bps % 100).padStart(2, "0")}` : ""}%`;

export type RoundStage = { label: string; tone: Tone };
export function roundStage(data: DemoState | null, { connected, loading }: { connected: boolean; loading: boolean }): RoundStage {
  if (!data) return loading ? { label: "Connecting", tone: "neutral" } : { label: "Offline", tone: "neutral" };
  if (data.mode === "aurora-testnet-readonly") return { label: "Read-only monitor", tone: "neutral" };
  const stage = data.stage;
  if (["completed", "complete", "redeemed"].includes(stage)) return { label: "Settled", tone: "success" };
  if (["failed", "interrupted"].includes(stage)) return { label: "Needs attention", tone: "warning" };
  if (!connected) return { label: "Connection lost", tone: "warning" };
  if (["opening", "proposing", "forecasting"].includes(stage)) return { label: "Active", tone: "info" };
  if (stage === "selecting") return { label: "Selecting", tone: "info" };
  if (stage === "executing") return { label: "Executing", tone: "info" };
  if (["evaluating", "settling", "redeeming"].includes(stage)) return { label: "Settling", tone: "info" };
  return { label: "Not started", tone: "neutral" };
}

type Proposal = DemoState["proposals"][number];
export function ProposalList({ proposals, winner }: { proposals: Proposal[]; winner: string | null }) {
  return <ul className="proposal-list">
    {proposals.map((proposal) => {
      const hold = String(proposal.id) === "0";
      const selected = winner === String(proposal.id);
      const bps = Number.isInteger(Number(proposal.allocationBps)) ? Math.max(0, Math.min(10_000, Number(proposal.allocationBps))) : null;
      const support = probabilityPercent(proposal.probabilityX18);
      return <li key={proposal.id} className={`proposal-row ${selected ? "selected" : ""}`}>
        <div className="proposal-main">
          <div className="proposal-title">
            <span className="proposal-id">#{proposal.id}</span>
            <b>{proposal.label || (hold ? "Hold current holdings" : `Allocation ${proposal.id}`)}</b>
            {hold ? <Badge>Baseline</Badge> : null}
            {selected ? <Badge tone="success"><Icon name="check" />Selected</Badge> : null}
          </div>
          {hold ? <p className="alloc-legend">Keeps current token quantities · no rebalance</p>
            : bps === null ? <p className="alloc-legend">Allocation unavailable</p>
            : <>
              <div className="alloc-split" aria-label={`${bpsPercent(bps)} test ETH, ${bpsPercent(10_000 - bps)} USDC`}><span style={{ width: `${bps / 100}%` }} /></div>
              <p className="alloc-legend"><i className="key eth" />{bpsPercent(bps)} test ETH <i className="key usdc" />{bpsPercent(10_000 - bps)} USDC</p>
            </>}
        </div>
        <div className="proposal-support">
          <div className="support-head"><span>Market support</span><b className="tnum">{probability(proposal.probabilityX18)}</b></div>
          <ProgressBar percent={support} tone={selected ? "success" : undefined} label={`Market support for proposal ${proposal.id}`} />
          <div className="support-foot"><span>Final-window avg <b className="tnum">{probability(proposal.twapX18)}</b></span><span>Short {probability(complement(proposal.probabilityX18))}</span></div>
        </div>
        {proposal.rationale ? <details className="proposal-rationale"><summary>Rationale</summary><p>{proposal.rationale}</p></details> : null}
      </li>;
    })}
  </ul>;
}

type Agent = DemoState["agents"][number];
export function ForecasterTable({ data, settled }: { data: DemoState; settled: boolean }) {
  const decisions = new Map(data.agents.filter((agent) => agent.role.toLowerCase().includes("forecast")).map((agent) => [agent.name, agent]));
  const people = data.forecast.participants ?? [];
  if (!people.length) return <EmptyState icon="users" title="No forecasters yet">Forecasters deposit collateral and take positions once the round opens.</EmptyState>;
  return <div className="table-wrap"><table className="table">
    <thead><tr><th>Forecaster</th><th>Position</th><th className="num">Deposit</th><th className="num">Redeemed</th><th className="num">Profit / loss</th></tr></thead>
    <tbody>{people.map((person) => {
      const pnl = settled ? signedUnits(person.profitLoss, 6) : "—";
      return <tr key={person.address}>
        <td><span className="who"><Avatar name={person.name} small />{person.name}</span></td>
        <td className="muted">{decisions.get(person.name)?.action ?? "—"}</td>
        <td className="num">{units(person.deposit, 6)}</td>
        <td className="num">{settled ? units(person.payout, 6) : "—"}</td>
        <td className={`num ${pnl.startsWith("−") ? "neg" : pnl.startsWith("+") && pnl !== "+0.00" ? "pos" : ""}`}>{pnl}</td>
      </tr>;
    })}</tbody>
  </table></div>;
}

export function AgentFeed({ agents, emptyText }: { agents: Agent[]; emptyText: string }) {
  if (!agents.length) return <EmptyState icon="users" title="No agent decisions yet">{emptyText}</EmptyState>;
  return <ul className="feed">
    {agents.map((agent, index) => <li key={`${agent.name}-${index}`}>
      <Avatar name={agent.name} />
      <div className="feed-body">
        <div className="feed-head"><b>{agent.name}</b><Badge tone={agent.role.toLowerCase().includes("forecast") ? "info" : "neutral"}>{agent.role}</Badge>{agent.action ? <code>{agent.action}</code> : null}</div>
        <p>{agent.rationale || agent.action || "Waiting for a recorded decision."}</p>
        {(agent.forecasts?.length || agent.risks?.length) ? <details className="feed-more"><summary>Forecasts and risks</summary>
          {agent.forecasts?.map((forecast) => <div key={forecast.proposalId} className="feed-forecast">
            <b>Proposal #{forecast.proposalId} · {forecast.expectedReturnBps >= 0 ? "+" : "−"}{(Math.abs(forecast.expectedReturnBps) / 100).toFixed(2)}% expected · confidence {(forecast.confidenceBps / 100).toFixed(0)}%</b>
            <p>{forecast.rationale}</p>
            {forecast.risks.length ? <small>Risks: {forecast.risks.join("; ")}</small> : null}
          </div>)}
          {agent.risks?.map((risk) => <p key={risk}>{risk}</p>)}
          {agent.evidenceIds?.length ? <small>Evidence: {agent.evidenceIds.join(", ")}</small> : null}
        </details> : null}
      </div>
    </li>)}
  </ul>;
}

export function ActivityTable({ receipts }: { receipts: Receipt[] }) {
  if (!receipts.length) return <EmptyState icon="receipt" title="No transactions yet">Transactions appear here as the local contracts are called. None are generated for display.</EmptyState>;
  return <div className="table-wrap"><table className="table">
    <thead><tr><th>Action</th><th>Transaction</th><th className="num">Block</th><th>Status</th></tr></thead>
    <tbody>{[...receipts].reverse().map((receipt, index) => {
      const tone: Tone = ["success", "confirmed"].includes(receipt.status) ? "success" : ["failed", "reverted"].includes(receipt.status) ? "danger" : "info";
      return <tr key={`${receipt.hash}-${index}`}>
        <td>{receipt.label}</td>
        <td><CopyText value={receipt.hash} label="transaction hash" /></td>
        <td className="num mono">{receipt.blockNumber ?? "—"}</td>
        <td><Badge tone={tone} dot>{receipt.status}</Badge></td>
      </tr>;
    })}</tbody>
  </table></div>;
}

export function RoundTimeline({ current, running, halted }: { current: number; running: boolean; halted: boolean }) {
  const total = PHASES.length;
  const items: TimelineItem[] = PHASES.map((phase, index) => ({
    key: phase.id, title: phase.label, detail: phase.detail,
    state: current >= total || index < current ? "done" : index === current ? (halted ? "halted" : running ? "current" : "upcoming") : "upcoming",
  }));
  return <Timeline items={items} label="Round lifecycle" />;
}

export function OutcomeSummary({ data, settled, winner }: { data: DemoState | null; settled: boolean; winner: string | null }) {
  const value = settled ? returnPercent(data?.round?.realisedReturnX18) : "—";
  const winnerProposal = data?.proposals.find((proposal) => String(proposal.id) === winner);
  return <div className="outcome">
    <span className="stat-label">Measured strategy return</span>
    <div className={`outcome-value ${value.startsWith("+") ? "pos" : value.startsWith("−") ? "neg" : ""}`}>{value}</div>
    <p className="subtle">{settled ? "Post-trade holdings valued against entry value, after execution costs." : "Available after the round settles."}</p>
    <dl className="dl outcome-dl">
      <div><dt>Selected proposal</dt><dd>{winner === null ? <span className="unavailable">Not selected yet</span> : `#${winner}${winnerProposal?.label ? ` · ${winnerProposal.label}` : ""}`}</dd></div>
      <div><dt>LONG payout ratio</dt><dd>{settled ? probability(data?.round?.piX18) : <span className="unavailable">Not settled</span>}</dd></div>
    </dl>
  </div>;
}

export function PastRounds({ rounds }: { rounds: TestnetRound[] }) {
  const router = useRouter();
  return <div className="table-wrap"><table className="table">
    <thead><tr><th>Round</th><th>Outcome</th><th className="num">Return</th><th className="num">AI calls</th><th>Date</th><th>Status</th></tr></thead>
    <tbody>{[...rounds].reverse().map((round) => {
      const ret = formatReturnX18(round.realisedReturnX18);
      return <tr key={round.slug} className="row-link" onClick={() => router.push(`/rounds/${round.slug}`)}>
        <td><Link href={`/rounds/${round.slug}`} className="round-link" onClick={(event) => event.stopPropagation()}><b>Round {round.roundId} · {round.stack.label}</b><span>{round.title}</span><small className="cell-note mono" title={`Engine ${round.stack.engine}`}>engine {round.stack.engine.slice(0, 6)}…{round.stack.engine.slice(-4)}</small></Link></td>
        <td>{round.winner.isHold ? <Badge>Hold kept · no swap</Badge> : <Badge tone="brand">{round.winner.name} · {bpsPercent(round.winner.allocationBps)} ETH</Badge>}</td>
        <td className={`num ${round.winner.isHold ? "subtle" : ret?.startsWith("−") ? "neg" : "pos"}`}>{ret ?? "—"}{round.winner.isHold ? <small className="cell-note">not scored</small> : null}</td>
        <td className="num">{round.genuineModelCalls ?? "—"}{(round.scriptedForecasters ?? 0) > 0 ? <small className="cell-note">+{round.scriptedForecasters} scripted</small> : null}</td>
        <td className="muted">{round.date ?? "—"}</td>
        <td><Badge tone="success" dot>Settled</Badge></td>
      </tr>;
    })}</tbody>
  </table></div>;
}
