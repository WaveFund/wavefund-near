"use client";

import { AURORA_TESTNET, formatUnits } from "@/lib/funding/model.mjs";
import { formatPoints, formatReturnX18, formatSignedUnits, type TestnetRound } from "@/lib/record/model.mjs";
import { CopyText, ExplorerLink, Icon } from "@/components/funding/primitives";
import { Avatar, Badge, DescriptionList, EmptyState, Timeline, type TimelineItem } from "@/components/ui";

const bpsPercent = (bps: number) => `${Math.floor(bps / 100)}${bps % 100 ? `.${String(bps % 100).padStart(2, "0")}` : ""}%`;
const MINUS = "−";
const Tx = ({ hash }: { hash: string }) => <span className="tx-inline"><CopyText value={hash} label="transaction" /><ExplorerLink chainId={AURORA_TESTNET} kind="tx" value={hash} enabled /></span>;

export function EvidenceProposals({ round }: { round: TestnetRound }) {
  return <ul className="proposal-list">
    {round.proposals.map((proposal) => {
      const hold = proposal.id === "0"; const selected = proposal.id === round.winner.id;
      return <li key={proposal.id} className={`proposal-row compact ${selected ? "selected" : ""}`}>
        <div className="proposal-main">
          <div className="proposal-title">
            <span className="proposal-id">#{proposal.id}</span><b>{proposal.name}</b>
            {hold ? <Badge>Baseline</Badge> : <Badge tone="info">AI proposal</Badge>}
            {selected ? <Badge tone="success"><Icon name="check" />Selected</Badge> : null}
          </div>
          <div className="alloc-split" aria-label={`${bpsPercent(proposal.allocationBps)} test ETH`}><span style={{ width: `${proposal.allocationBps / 100}%` }} /></div>
          <p className="alloc-legend"><i className="key eth" />{bpsPercent(proposal.allocationBps)} test ETH <i className="key usdc" />{bpsPercent(10_000 - proposal.allocationBps)} USDC{hold ? " · current holdings" : ""}</p>
        </div>
        {proposal.rationale && !hold ? <details className="proposal-rationale"><summary>Rationale</summary><p>{proposal.rationale}</p></details> : null}
      </li>;
    })}
  </ul>;
}

export function EvidenceForecasters({ round }: { round: TestnetRound }) {
  const payouts = new Map(round.payouts.map((item) => [item.name, item]));
  const nameOf = (id: string | null) => round.proposals.find((item) => item.id === id)?.name ?? `#${id ?? "?"}`;
  const abstained = round.forecasters.length > 0 && round.forecasters.every((item) => item.action === "abstain");
  return <>
    <div className="table-wrap"><table className="table">
      <thead><tr><th>Forecaster</th><th>Decision</th><th>Source</th><th className="num">Deposit</th><th className="num">Redeemed</th><th className="num">Profit / loss</th></tr></thead>
      <tbody>{round.forecasters.map((item) => {
        const payout = payouts.get(item.name); const pl = formatSignedUnits(payout?.profitLoss ?? null, 6);
        return <tr key={item.name}>
          <td><span className="who"><Avatar name={item.name} small />{item.name}</span></td>
          <td>{item.action === "abstain" ? <span className="muted">Abstained</span>
            : item.action === "buy" ? <span><b className={item.side === "long" ? "pos" : "neg"}>{item.side === "long" ? "Long" : "Short"}</b> {nameOf(item.proposalId)}</span> : "—"}</td>
          <td>{item.scripted ? <Badge tone="warning">Scripted</Badge> : <Badge tone="info">AI</Badge>}</td>
          <td className="num">{formatUnits(payout?.deposit, 6) ?? "—"}</td>
          <td className="num">{formatUnits(payout?.payout, 6) ?? "—"}</td>
          <td className={`num ${pl?.startsWith(MINUS) ? "neg" : pl && pl !== "0" ? "pos" : "subtle"}`}>{pl ?? "—"}</td>
        </tr>;
      })}</tbody>
    </table></div>
    {abstained && round.forecasters[0]?.reason ? <p className="panel-foot">Reason given by each forecaster: “{round.forecasters[0].reason}”</p> : null}
  </>;
}

export function EvidenceOutcome({ round }: { round: TestnetRound }) {
  const ret = formatReturnX18(round.realisedReturnX18);
  const checks: Array<[string, boolean | null]> = [
    ["Independent recomputation passed", round.checks.independentPassed], ["Recorded return matches the recomputation", round.checks.returnRecomputed],
    ["Payouts match the recomputation", round.checks.payoutsRecomputed], ["Safe balance deltas match the swap", round.checks.swapChecked],
  ];
  return <div className="card-body stack-lg">
    <DescriptionList items={[
      { label: "Selected", value: round.winner.isHold ? "Hold · keep current holdings" : `${round.winner.name} · ${bpsPercent(round.winner.allocationBps)} test ETH` },
      { label: "Investment swap", value: round.swap ? <Tx hash={round.swap.transactionHash} /> : <span className="muted">None, Hold was selected</span> },
      { label: round.winner.isHold ? "Hold drift" : "Measured return", hint: round.winner.isHold ? "Not scored" : undefined,
        value: <b className={round.winner.isHold ? "subtle" : ret?.startsWith(MINUS) ? "neg" : "pos"}>{ret ?? "Unavailable"}</b> },
      { label: "Performance points", value: round.reputation ? <span className="tx-inline"><b className={round.reputation.score.startsWith("-") ? "neg" : "pos"}>{round.winner.name} {formatPoints(round.reputation.score)}</b><ExplorerLink chainId={AURORA_TESTNET} kind="tx" value={round.reputation.transactionHash} enabled /></span> : <span className="muted">None · Hold rounds never score</span> },
    ]} />
    <div>
      <h4 className="mini-title">Independent checks</h4>
      <ul className="check-list">{checks.filter(([, value]) => value !== null).map(([label, value]) => <li key={label} className={value ? "ok" : "no"}><Icon name={value ? "check" : "cross"} /><div><b>{label}</b></div></li>)}</ul>
    </div>
  </div>;
}

export function EvidenceTransactions({ round }: { round: TestnetRound }) {
  if (!round.transactions.length) return <EmptyState icon="receipt" title="No transactions" />;
  return <div className="table-wrap"><table className="table">
    <thead><tr><th>Step</th><th>Transaction</th><th className="num">Block</th></tr></thead>
    <tbody>{round.transactions.map((item) => <tr key={item.transactionHash}>
      <td>{stepLabel(item.label)}</td><td><Tx hash={item.transactionHash} /></td><td className="num mono">{item.blockNumber}</td>
    </tr>)}</tbody>
  </table>{round.droppedTransactions > 0 ? <p className="panel-foot">{round.droppedTransactions} malformed entries were not shown.</p> : null}</div>;
}

// "round7:propose:Momentum" -> "Propose · Momentum"
function stepLabel(label: string): string {
  const parts = label.replace(/^round\d+:/, "").split(":");
  return parts.map((part, index) => (index === 0 ? part.charAt(0).toUpperCase() + part.slice(1) : part)).join(" · ");
}

const MILESTONES: Array<{ key: string; title: string; test: (step: string) => boolean; last?: boolean }> = [
  { key: "open", title: "Round opened", test: (step) => step === "open" },
  { key: "propose", title: "Proposals submitted", test: (step) => step.startsWith("propose:") },
  { key: "forecast", title: "Forecasters committed", test: (step) => step.startsWith("trade:") || step.startsWith("deposit:"), last: true },
  { key: "collapse", title: "Market closed, winner selected", test: (step) => step === "collapse" },
  { key: "execute", title: "Strategy executed", test: (step) => step === "execute" },
  { key: "settle", title: "Return measured and settled", test: (step) => step === "settle" },
  { key: "redeem", title: "Collateral redeemed", test: (step) => step.startsWith("redeem:"), last: true },
];
export function EvidenceTimeline({ round }: { round: TestnetRound }) {
  const steps = round.transactions.map((item) => ({ ...item, step: item.label.replace(/^round\d+:/, "") }));
  const items: TimelineItem[] = MILESTONES.map((milestone) => {
    const matches = steps.filter((item) => milestone.test(item.step));
    const hit = milestone.last ? matches[matches.length - 1] : matches[0];
    return { key: milestone.key, title: milestone.key === "execute" && round.winner.isHold ? "Hold kept, nothing traded" : milestone.title, state: hit ? "done" : "upcoming",
      detail: hit ? <span className="tx-inline">Block {hit.blockNumber}<ExplorerLink chainId={AURORA_TESTNET} kind="tx" value={hit.transactionHash} enabled /></span> : "Not recorded" };
  });
  return <Timeline items={items} label={`Round ${round.roundId} milestones`} />;
}
