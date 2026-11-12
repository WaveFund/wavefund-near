"use client";

import { AURORA_TESTNET, formatAge } from "@/lib/funding/model.mjs";
import { formatPoints, reputationCodeText, reputationState, type ReputationAgent, type ReputationBoard, type ReputationState } from "@/lib/record/model.mjs";
import { Address, Icon } from "@/components/funding/primitives";
import { Avatar, Badge, Skeleton, type Tone } from "@/components/ui";

const STATE_TONE: Record<ReputationState, Tone> = { loading: "neutral", unavailable: "danger", stale: "warning", "no-history": "neutral", scored: "success" };
// Short table labels; "no history" means the agent has never had a strategy selected, executed and settled.
const STATE_SHORT: Record<ReputationState, string> = { loading: "Loading", unavailable: "Unavailable", stale: "Stale", "no-history": "No history", scored: "Scored" };

function AgentRow({ agent, stale }: { agent: ReputationAgent; stale: boolean }) {
  const state = reputationState(agent, { stale });
  const rep = agent.reputation;
  const points = rep ? formatPoints(rep.score) : null;
  const sign = rep ? (rep.score.startsWith("-") ? "neg" : rep.score === "0" ? "" : "pos") : "";
  return <tr data-state={state}>
    <td><div className="agent-cell"><Avatar name={agent.name} /><div><b>{agent.name}</b>{agent.address ? <Address value={agent.address} chainId={AURORA_TESTNET} label={`${agent.name} wallet`} live /> : null}</div></div></td>
    <td className="num">{rep && points !== null ? <span className={`points ${sign}`}>{points}</span> : <span className="unavailable" title={reputationCodeText(agent.code)}>No data</span>}</td>
    <td className="num">{rep ? rep.samples : "—"}</td>
    <td className="num col-outcomes">{rep ? <span className="outcomes"><span className="pos">{rep.positive}</span><span className="neg">{rep.negative}</span><span className="subtle">{rep.flat}</span></span> : "—"}</td>
    <td><Badge tone={STATE_TONE[state]} dot title={state === "no-history" ? "No evaluated strategies: no point and no penalty" : undefined}>{STATE_SHORT[state]}</Badge>{state === "unavailable" || (state === "stale" && !rep) ? <small className="cell-note">{agent.code}</small> : null}</td>
  </tr>;
}

export function Leaderboard({ board, stale, names }: { board: ReputationBoard | null; stale: boolean; names: string[] }) {
  return <div className="table-wrap"><table className="table leaderboard">
    <thead><tr><th>Agent</th><th className="num">Performance points</th><th className="num">Evaluated</th><th className="num col-outcomes" title="Positive · negative · flat">Outcomes <small>+ · − · 0</small></th><th>Status</th></tr></thead>
    <tbody>{board ? board.agents.map((agent) => <AgentRow key={agent.address ?? agent.name} agent={agent} stale={stale} />)
      : names.map((name) => <tr key={name}><td><div className="agent-cell"><Avatar name={name} /><div><b>{name}</b><Skeleton width={110} height={12} /></div></div></td><td className="num"><Skeleton width={28} height={18} /></td><td className="num"><Skeleton width={16} /></td><td className="num col-outcomes"><Skeleton width={60} /></td><td><Badge>Loading</Badge></td></tr>)}</tbody>
  </table></div>;
}

export function ReputationSource({ board, now }: { board: ReputationBoard; now: number }) {
  const blocks = board.agents.flatMap((agent) => (agent.reputation ? [agent.reputation.blockNumber] : []));
  const block = blocks.length ? blocks.reduce((a, b) => (BigInt(a) > BigInt(b) ? a : b)) : null;
  return <>
    <span><i className="dot testnet" /> Aurora testnet · {AURORA_TESTNET}</span>
    <span>Contract {board.contract ? <Address value={board.contract} chainId={AURORA_TESTNET} label="reputation contract" live /> : <span className="unavailable">unavailable</span>}</span>
    <span>Block {block ? <code>#{block}</code> : <span className="unavailable">unavailable</span>}</span>
    <span>{board.observedAt && now ? `Read ${formatAge(now - board.observedAt)}` : ""}</span>
  </>;
}

export function ReputationRules() {
  const rules: Array<[string, string]> = [
    ["Only shipped strategies score", "A proposal earns a point only when it is selected, executed through the Safe and settled. Hold never scores."],
    ["+1, −1 or 0", "Positive measured return +1, negative −1, exactly flat 0. Small and large moves count the same."],
    ["Unselected means untested", "Losing proposals get no point and no penalty."],
    ["Selections are separate", "Registry selection wins are a different metric and are not counted here."],
    ["Not a credit score", "Performance reputation only. Not a lending score, alpha or a Sybil-resistant identity."],
  ];
  return <ul className="check-list">{rules.map(([title, text]) => <li key={title} className="wait"><Icon name="check" /><div><b>{title}</b><p>{text}</p></div></li>)}</ul>;
}
