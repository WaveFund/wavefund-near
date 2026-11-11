"use client";

import { useState, type ReactNode } from "react";
import { PHASES, probability, returnPercent, shortAddress, signedUnits, type DemoState, type Receipt } from "@/lib/state";
import { Icon, Pill, type IconName } from "@/components/funding/primitives";

const ONE = 10n ** 18n;
const isRaw = (value: string | null | undefined): value is string => typeof value === "string" && /^\d+$/.test(value);
/** Width percentage for a 1e18-scaled probability, computed with integers. */
export function probabilityWidth(raw: string | null | undefined): string {
  if (!isRaw(raw)) return "0%";
  const value = BigInt(raw);
  if (value > ONE) return "100%";
  return `${Number(value / 10n ** 14n) / 100}%`;
}
/** SHORT probability = 1 − LONG, kept as an integer string. */
export function complement(raw: string | null | undefined): string | null {
  if (!isRaw(raw)) return null;
  const value = BigInt(raw);
  return value > ONE ? null : (ONE - value).toString();
}

export function KpiTile({ icon, label, value, unit, sub, tone = "default" }: { icon: IconName; label: string; value: ReactNode; unit?: string; sub?: ReactNode; tone?: "default" | "mint" | "violet" | "amber" | "up" | "down" }) {
  return <article className={`card kpi tone-${tone}`}>
    <span className="kpi-label"><Icon name={icon} />{label}</span>
    <span className="kpi-value">{value}{unit ? <small>{unit}</small> : null}</span>
    {sub ? <span className="kpi-sub">{sub}</span> : null}
  </article>;
}

export function Lifecycle({ current, aurora, status }: { current: number; aurora: boolean; status: string }) {
  if (aurora) return <p className="muted-note">Onchain round status: <b>{status}</b>. Monitoring does not infer execution or redemption steps that are not recorded.</p>;
  const total = PHASES.length;
  const done = Math.max(0, Math.min(total, current));
  const fill = done >= total ? 100 : (done / (total - 1)) * 100;
  return <div className="lifecycle">
    <div className="lifecycle-track" aria-hidden="true"><span style={{ width: `${fill}%` }} /></div>
    <ol>
      {PHASES.map((phase, index) => {
        const state = done > index ? "done" : current === index ? "active" : "todo";
        return <li key={phase.id} className={`phase phase-${state}`}>
          <span className="phase-dot">{state === "done" ? <Icon name="check" /> : String(index + 1).padStart(2, "0")}</span>
          <span className="phase-name">{phase.label}</span>
          <span className="phase-detail">{phase.detail}</span>
        </li>;
      })}
    </ol>
  </div>;
}

type Proposal = DemoState["proposals"][number];
export function MarketCard({ proposal, selected }: { proposal: Proposal; selected: boolean }) {
  const hold = String(proposal.id) === "0";
  const bps = Number.isInteger(Number(proposal.allocationBps)) ? Math.max(0, Math.min(10_000, Number(proposal.allocationBps))) : null;
  const assetPct = bps === null ? null : bps / 100;
  const shortRaw = complement(proposal.probabilityX18);
  return <article className={`card market ${selected ? "selected" : ""}`}>
    <header className="market-head">
      <span className="market-id">#{proposal.id}</span>
      {hold ? <Pill tone="muted">Baseline · Hold</Pill> : <Pill tone="violet">Proposal</Pill>}
      {selected && <span className="market-winner"><Icon name="trophy" />Market selected</span>}
    </header>
    <h3>{proposal.label || (hold ? "Hold current investments" : `Allocation ${proposal.id}`)}</h3>
    <div className="alloc">
      <div className="alloc-bar" aria-label={hold ? "Keeps existing quantities" : `${assetPct ?? "unknown"}% test ETH`}>
        {hold ? <span className="alloc-hold" /> : <span className="alloc-asset" style={{ width: `${assetPct ?? 0}%` }} />}
      </div>
      <div className="alloc-legend">{hold ? <span>Keeps existing token quantities · no forced rebalance</span>
        : assetPct === null ? <span>Allocation unavailable</span>
        : <><span><i className="dot asset" />{assetPct.toFixed(0)}% test ETH</span><span><i className="dot usdc" />{(100 - assetPct).toFixed(0)}% USDC</span></>}</div>
    </div>
    <div className="odds">
      <div className="odds-side long"><span>LONG</span><b>{probability(proposal.probabilityX18)}</b></div>
      <div className="odds-side short"><span>SHORT</span><b>{probability(shortRaw)}</b></div>
    </div>
    <div className="prob-track" aria-hidden="true"><span style={{ width: probabilityWidth(proposal.probabilityX18) }} /></div>
    <div className="market-foot"><span>Final-window average</span><b>{probability(proposal.twapX18)}</b></div>
    <p className="rationale">{proposal.rationale || "No rationale has been recorded for this proposal."}</p>
  </article>;
}

type Agent = DemoState["agents"][number];
const AVATAR_TONES = ["mint", "violet", "cyan", "amber"] as const;
export function AgentFeed({ agents, emptyText }: { agents: Agent[]; emptyText: string }) {
  if (!agents.length) return <p className="muted-note">{emptyText}</p>;
  return <ul className="agent-feed">
    {agents.map((agent, index) => <li key={`${agent.name}-${index}`}>
      <span className={`avatar tone-${AVATAR_TONES[index % AVATAR_TONES.length]}`}>{agent.name.slice(0, 1).toUpperCase()}</span>
      <div className="agent-body">
        <div className="agent-head"><b>{agent.name}</b><Pill tone={agent.role.toLowerCase().includes("forecast") ? "violet" : "neutral"}>{agent.role}</Pill></div>
        <p>{agent.rationale || agent.action || "Waiting for a recorded decision."}</p>
        {agent.action && agent.rationale && <code className="agent-action">{agent.action}</code>}
        {(agent.forecasts?.length || agent.risks?.length) ? <details className="agent-more"><summary>Forecasts and risks</summary>
          {agent.forecasts?.map((forecast) => <div key={forecast.proposalId} className="agent-forecast">
            <b>#{forecast.proposalId} · {forecast.expectedReturnBps >= 0 ? "+" : ""}{(forecast.expectedReturnBps / 100).toFixed(2)}% expected</b>
            <p>{forecast.rationale}</p>
            <small>Self-reported confidence {(forecast.confidenceBps / 100).toFixed(0)}% · {forecast.risks.join("; ")}</small>
          </div>)}
          {agent.risks?.map((risk) => <p key={risk}>{risk}</p>)}
          {agent.evidenceIds?.length ? <small>Evidence: {agent.evidenceIds.join(", ")}</small> : null}
        </details> : null}
      </div>
    </li>)}
  </ul>;
}

export function OutcomeCard({ settled, data, winner }: { settled: boolean; data: DemoState | null; winner: string | null }) {
  const value = settled ? returnPercent(data?.round?.realisedReturnX18) : "—";
  const direction = value.startsWith("+") ? "up" : value.startsWith("−") ? "down" : "flat";
  return <section className="card outcome" aria-labelledby="outcome-heading">
    <div className="card-head"><h2 id="outcome-heading" className="card-title"><Icon name="pulse" />Measured outcome</h2><Pill tone={settled ? "success" : "muted"}>{settled ? "Settled" : "Pending"}</Pill></div>
    <div className="card-pad">
      <span className="kpi-label">Recorded strategy return</span>
      <div className={`outcome-value ${direction}`}>{value}</div>
      <p className="kpi-sub">{settled ? "Posttrade holdings valued against entry value, including execution costs." : "Available after performance settlement."}</p>
      <dl className="outcome-rows">
        <div><dt>Selected proposal</dt><dd>{winner === null ? "Not selected" : `#${winner}`}</dd></div>
        <div><dt>LONG payout ratio</dt><dd>{settled ? probability(data?.round?.piX18) : "Not settled"}</dd></div>
      </dl>
      {settled && data?.forecast.participants?.length ? <div className="pnl">
        <span className="kpi-label">Forecasters · separate collateral</span>
        {data.forecast.participants.map((person) => {
          const pnl = signedUnits(person.profitLoss, 6);
          return <div className="pnl-row" key={person.address}><span><i className="avatar tiny">{person.name.slice(0, 1)}</i>{person.name}</span><b className={pnl.startsWith("−") ? "down" : "up"}>{pnl} <small>USDC</small></b></div>;
        })}
      </div> : null}
      <p className="fine-print">Payout bounds shape forecaster rewards. They are not a stop loss on the manager’s investments.</p>
    </div>
  </section>;
}

function CopyHash({ hash }: { hash: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(hash); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { setCopied(false); }
  }
  return <button type="button" className="hash" onClick={() => void copy()} title={`Copy ${hash}`} aria-label={`Copy transaction hash ${hash}`}>
    <code>{copied ? "Copied" : shortAddress(hash)}</code><Icon name={copied ? "check" : "copy"} />
  </button>;
}

export function ReceiptsTable({ receipts }: { receipts: Receipt[] }) {
  if (!receipts.length) return <p className="muted-note">No transactions recorded yet. Receipts appear after actual local contract calls; none are generated for display.</p>;
  return <div className="table-wrap">
    <table className="table">
      <thead><tr><th>Action</th><th>Transaction</th><th className="num">Block</th><th>Status</th></tr></thead>
      <tbody>{[...receipts].reverse().map((receipt, index) => {
        const tone = ["success", "confirmed"].includes(receipt.status) ? "ok" : ["failed", "reverted"].includes(receipt.status) ? "bad" : "pending";
        return <tr key={`${receipt.hash}-${index}`}>
          <td className="action-cell">{receipt.label}</td>
          <td><CopyHash hash={receipt.hash} /></td>
          <td className="num mono">{receipt.blockNumber ?? "—"}</td>
          <td><span className={`status-dot tone-${tone}`}><i />{receipt.status}</span></td>
        </tr>;
      })}</tbody>
    </table>
  </div>;
}
