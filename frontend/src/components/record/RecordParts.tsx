"use client";

import type { ReactNode } from "react";
import { AURORA_TESTNET, formatAge, formatUnits } from "@/lib/funding/model.mjs";
import {
  STATE_LABELS, formatPoints, formatReturnX18, formatSignedUnits, reputationCodeText, reputationState,
  type ReputationAgent, type ReputationBoard, type ReputationState, type TestnetRound,
} from "@/lib/record/model.mjs";
import { Address, CopyText, ExplorerLink, Icon, Pill, type PillTone } from "@/components/funding/primitives";

const STATE_TONE: Record<ReputationState, PillTone> = { loading: "muted", unavailable: "danger", stale: "warning", "no-history": "neutral", scored: "live" };
const bpsText = (bps: number) => `${Math.floor(bps / 100)}${bps % 100 ? `.${String(bps % 100).padStart(2, "0")}` : ""}%`;
const share = (part: string, whole: string) => (whole === "0" ? 0 : Number((BigInt(part) * 1000n) / BigInt(whole)) / 10);

export function AgentCard({ agent, stale, loading }: { agent: ReputationAgent | null; stale: boolean; loading?: { name: string } }) {
  const state = loading ? "loading" : reputationState(agent, { stale });
  const rep = agent?.reputation ?? null;
  const points = rep ? formatPoints(rep.score) : null;
  const sign = rep ? (rep.score.startsWith("-") ? "neg" : rep.score === "0" ? "flat" : "pos") : "none";
  const name = agent?.name ?? loading?.name ?? "Agent";
  return <article className={`card rec-agent state-${state} sign-${sign}`} aria-label={`${name} performance reputation`}>
    <header className="rec-agent-head">
      <span className="rec-avatar" aria-hidden="true">{name.slice(0, 1)}</span>
      <div className="rec-agent-id"><b>{name}</b>{agent?.address ? <Address value={agent.address} chainId={AURORA_TESTNET} label={`${name} wallet`} live /> : <small>proposer</small>}</div>
    </header>
    <div className="rec-points" aria-live="polite">
      {rep && points !== null
        ? <><span className="rec-points-value">{points}</span><span className="rec-points-unit">performance point{rep.score === "1" || rep.score === "-1" ? "" : "s"}</span></>
        : <><span className="rec-points-value muted">—</span><span className="rec-points-unit">{state === "loading" ? "reading Aurora testnet…" : "no data · not zero"}</span></>}
      <Pill tone={STATE_TONE[state]}>{STATE_LABELS[state]}</Pill>
    </div>
    {rep ? <>
      <div className="rec-outcome-bar" role="img" aria-label={`${rep.positive} positive, ${rep.negative} negative, ${rep.flat} flat of ${rep.samples} evaluated`}>
        {rep.samples === "0" ? <span className="rec-bar-empty" /> : <>
          <span className="rec-bar-pos" style={{ width: `${share(rep.positive, rep.samples)}%` }} />
          <span className="rec-bar-flat" style={{ width: `${share(rep.flat, rep.samples)}%` }} />
          <span className="rec-bar-neg" style={{ width: `${share(rep.negative, rep.samples)}%` }} />
        </>}
      </div>
      <dl className="rec-counts">
        <div><dt>Evaluated</dt><dd>{rep.samples}</dd></div>
        <div className="pos"><dt>Positive</dt><dd>{rep.positive}</dd></div>
        <div className="neg"><dt>Negative</dt><dd>{rep.negative}</dd></div>
        <div><dt>Flat</dt><dd>{rep.flat}</dd></div>
      </dl>
      <p className="rec-note">{rep.hasEvaluatedStrategies
        ? `Block ${rep.blockNumber}${stale ? " · last good snapshot, refresh failing" : ""}`
        : "Never selected, executed and settled: no point and no penalty."}</p>
    </> : <p className="rec-note">{state === "loading" ? "Pinned contract reads through the shared reader." : <>{reputationCodeText(agent?.code)} {agent?.code ? <code>{agent.code}</code> : null}</>}</p>}
  </article>;
}

export function ReputationSource({ board, now, live }: { board: ReputationBoard; now: number; live: boolean }) {
  const blocks = board.agents.flatMap((agent) => (agent.reputation ? [agent.reputation.blockNumber] : []));
  const block = blocks.length ? blocks.reduce((a, b) => (BigInt(a) > BigInt(b) ? a : b)) : null;
  return <dl className="rec-source">
    <div><dt>Network</dt><dd><i className="chain-dot testnet" />Aurora testnet <code>{AURORA_TESTNET}</code></dd></div>
    <div><dt>Reputation contract</dt><dd>{board.contract ? <Address value={board.contract} chainId={AURORA_TESTNET} label="reputation contract" live={live} /> : <span className="unavailable">Unavailable</span>}</dd></div>
    <div><dt>Observation block</dt><dd>{block ? <code>#{block}</code> : <span className="unavailable">Unavailable</span>}</dd></div>
    <div><dt>Observed</dt><dd>{board.observedAt && now ? formatAge(now - board.observedAt) : "—"}</dd></div>
  </dl>;
}

export function ReputationRules() {
  return <aside className="card rec-rules" aria-labelledby="rules-heading">
    <h3 id="rules-heading"><Icon name="trophy" />How performance points work</h3>
    <ul>
      <li><b>Only shipped strategies score.</b> A proposal earns a point only when it is selected, executed through the Safe and settled. Hold never scores.</li>
      <li><b>+1 · −1 · 0.</b> Positive measured return +1, negative −1, exactly flat 0. Tiny and large moves count the same.</li>
      <li><b>Unselected means untested.</b> Losing proposals get no point and no penalty.</li>
      <li><b>Selections are not points.</b> Registry selection wins are a separate metric and are not counted here.</li>
      <li><b>Performance reputation, not credit.</b> This is not a lending credit score, alpha or a Sybil-resistant identity.</li>
    </ul>
  </aside>;
}

function Fact({ label, children, tone }: { label: string; children: ReactNode; tone?: "neg" | "pos" | "muted" }) {
  return <div className={`rec-fact ${tone ?? ""}`}><span>{label}</span><b>{children}</b></div>;
}

export function RoundCard({ round }: { round: TestnetRound }) {
  const returnText = formatReturnX18(round.realisedReturnX18);
  const negative = returnText?.startsWith("−");
  const proposalName = (id: string | null) => round.proposals.find((item) => item.id === id)?.name ?? `proposal ${id ?? "?"}`;
  const abstained = round.forecasters.length > 0 && round.forecasters.every((item) => item.action === "abstain");
  const scripted = round.scriptedForecasters ?? 0;
  return <article className="card rec-round" aria-labelledby={`round-${round.roundId}`}>
    <header className="rec-round-head">
      <div><span className="kicker">Round {round.roundId}{round.date ? ` · ${round.date}` : ""}</span><h3 id={`round-${round.roundId}`}>{round.title}</h3></div>
      <div className="rec-round-tags">
        {round.genuineModelCalls !== null && <Pill tone="violet">{round.genuineModelCalls} genuine AI calls</Pill>}
        {scripted > 0 ? <Pill tone="fixture">{scripted} scripted forecasters</Pill> : null}
        {!round.attestationVerified && <Pill tone="muted">No TEE attestation</Pill>}
      </div>
    </header>

    <div className="rec-facts">
      <Fact label="Selected">{round.winner.isHold ? "Hold · no rebalance" : `${round.winner.name} · ${bpsText(round.winner.allocationBps)} ETH`}</Fact>
      <Fact label="Investment swap" tone={round.swap ? undefined : "muted"}>{round.swap
        ? <span className="tx-inline">Actual swap<ExplorerLink chainId={AURORA_TESTNET} kind="tx" value={round.swap.transactionHash} enabled /></span>
        : "None"}</Fact>
      <Fact label={round.winner.isHold ? "Hold drift · not scored" : "Measured return"} tone={round.winner.isHold ? "muted" : negative ? "neg" : "pos"}>{returnText ?? "Unavailable"}</Fact>
      <Fact label="Performance points" tone={round.reputation ? (round.reputation.score.startsWith("-") ? "neg" : "pos") : "muted"}>{round.reputation
        ? <span className="tx-inline">{round.winner.name} {formatPoints(round.reputation.score)}<ExplorerLink chainId={AURORA_TESTNET} kind="tx" value={round.reputation.transactionHash} enabled /></span>
        : round.winner.isHold ? "None · Hold never scores" : "Not recorded"}</Fact>
    </div>

    <section className="rec-block" aria-label="Proposals">
      <h4>Proposals <small>{round.proposals.length - 1} AI proposers + Hold</small></h4>
      <ul className="rec-proposals">
        {round.proposals.map((item) => <li key={item.id} className={item.id === round.winner.id ? "selected" : undefined}>
          <span className="rec-proposal-name">{item.name}{item.id === round.winner.id ? <Pill tone="live">Selected</Pill> : null}</span>
          <span className="rec-alloc"><span style={{ width: `${item.allocationBps / 100}%` }} /></span>
          <code>{bpsText(item.allocationBps)} ETH</code>
        </li>)}
      </ul>
    </section>

    <section className="rec-block" aria-label="Forecasters">
      <h4>Forecasters <small>{abstained ? "all abstained" : scripted > 0 ? "scripted fixtures, not AI predictions" : "AI forecasters"}</small></h4>
      <ul className="rec-forecasters">
        {round.forecasters.map((item) => <li key={item.name} className={item.action}>
          <b>{item.name}</b>
          {item.action === "abstain" ? <span>Abstained</span>
            : item.action === "buy" ? <span className={`side-${item.side}`}>{item.side === "long" ? "LONG" : "SHORT"} · {proposalName(item.proposalId)}</span>
            : <span>Unknown</span>}
          {item.scripted ? <Pill tone="fixture">scripted</Pill> : item.action === "abstain" ? <Pill tone="neutral">AI</Pill> : null}
        </li>)}
      </ul>
      {abstained && round.forecasters[0]?.reason ? <p className="rec-note">“{round.forecasters[0].reason}”</p> : null}
    </section>

    <section className="rec-block" aria-label="Forecaster payouts">
      <h4>Forecaster collateral <small>test USDC, separate from the Safe</small></h4>
      <table className="rec-table">
        <thead><tr><th>Forecaster</th><th>Deposit</th><th>Redeemed</th><th>Profit / loss</th></tr></thead>
        <tbody>{round.payouts.map((item) => {
          const pl = formatSignedUnits(item.profitLoss, 6);
          return <tr key={item.name}>
            <td>{item.name}</td><td>{formatUnits(item.deposit, 6) ?? "—"}</td><td>{formatUnits(item.payout, 6) ?? "—"}</td>
            <td className={pl?.startsWith("−") ? "neg" : pl && pl !== "0" ? "pos" : undefined}>{pl ?? "Unavailable"}</td>
          </tr>;
        })}</tbody>
      </table>
    </section>

    <ul className="rec-checks" aria-label="Independent checks">
      <li className={round.checks.independentPassed ? "ok" : "no"}><Icon name={round.checks.independentPassed ? "check" : "cross"} />Independent recomputation</li>
      <li className={round.checks.returnRecomputed ? "ok" : "no"}><Icon name={round.checks.returnRecomputed ? "check" : "cross"} />Return matches</li>
      <li className={round.checks.payoutsRecomputed ? "ok" : "no"}><Icon name={round.checks.payoutsRecomputed ? "check" : "cross"} />Payouts match</li>
      {round.checks.swapChecked !== null && <li className={round.checks.swapChecked ? "ok" : "no"}><Icon name={round.checks.swapChecked ? "check" : "cross"} />Swap balance deltas</li>}
    </ul>

    <details className="rec-details">
      <summary><Icon name="alert" />Limitations and scope</summary>
      <ul>{round.limitations.map((item) => <li key={item}>{item}</li>)}</ul>
      {round.scope ? <p><b>Scope:</b> {round.scope}</p> : null}
      {round.correction ? <p><b>Correction:</b> {round.correction}</p> : null}
    </details>
    <details className="rec-details">
      <summary><Icon name="receipt" />{round.transactions.length} confirmed testnet transactions</summary>
      <ol className="rec-txs">{round.transactions.map((item) => <li key={item.transactionHash}>
        <span>{item.label.replace(/^round\d+:/, "").replace(/:/g, " · ")}</span>
        <span className="tx-inline"><CopyText value={item.transactionHash} label="transaction" /><ExplorerLink chainId={AURORA_TESTNET} kind="tx" value={item.transactionHash} enabled /></span>
        <code>#{item.blockNumber}</code>
      </li>)}</ol>
      {round.droppedTransactions > 0 ? <p className="rec-note">{round.droppedTransactions} malformed entries were not shown.</p> : null}
    </details>
  </article>;
}
