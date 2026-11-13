"use client";

import type { CSSProperties, ReactNode } from "react";
import { percentFromBps, returnOnScale, shortReturnX18, type JourneyStage, type SelectionSignals, type StageId, type PositionGroups } from "@/lib/arena/model.mjs";
import { formatUnits } from "@/lib/funding/model.mjs";
import { formatReturnX18 } from "@/lib/record/model.mjs";
import { CopyText, ExplorerLink, Icon, type IconName } from "@/components/funding/primitives";
import { Tip } from "@/components/v2";

// ---------------------------------------------------------------- identity

const AGENT_VARS: Record<string, string> = {
  hold: "--a-hold", conservative: "--a-conservative", balanced: "--a-balanced", momentum: "--a-momentum", highbeta: "--a-highbeta",
  quant: "--a-quant", guardian: "--a-guardian", feeanalyst: "--a-fee", stressanalyst: "--a-stress",
};
/** Each agent keeps one colour everywhere; unknown names get a stable fallback. */
export function agentVar(name: string): string {
  const key = name.toLowerCase().replace(/[^a-z]/g, "");
  if (AGENT_VARS[key]) return AGENT_VARS[key];
  let sum = 0; for (const char of key) sum = (sum + char.charCodeAt(0)) % 4;
  return `--a-x${sum + 1}`;
}

/** Proposer agents are tiles, forecasters are round, and Hold is a dashed "keep" mark. */
export function AgentAvatar({ name, kind = "proposer", size }: { name: string; kind?: "proposer" | "forecaster" | "hold"; size?: "sm" | "lg" }) {
  if (kind === "hold" || name === "Hold") {
    return <span className={`av hold ${size ?? ""}`} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 9.5h12M6 14.5h12" /></svg></span>;
  }
  return <span className={`av ${kind === "forecaster" ? "round" : ""} ${size ?? ""}`} style={{ "--av": `var(${agentVar(name)})` } as CSSProperties} aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>;
}

/** Share of the risk asset (test ETH) in a target allocation; the rest is the stable asset. */
export function AllocationRing({ bps, size, label }: { bps: number; size?: "lg"; label?: string }) {
  const pct = Number.isSafeInteger(bps) ? Math.max(0, Math.min(10_000, bps)) / 100 : 0;
  const text = percentFromBps(bps) ?? "—";
  return <span className={`ring ${size ?? ""}`} role="img" aria-label={label ?? `${text} test ETH, the rest USDC`}>
    <svg viewBox="0 0 36 36"><circle className="cash" cx="18" cy="18" r="15.9155" fill="none" strokeWidth="4" />
      <circle className="risk" cx="18" cy="18" r="15.9155" fill="none" strokeWidth="4" strokeDasharray={`${pct} ${100 - pct}`} strokeLinecap={pct > 0 && pct < 100 ? "round" : "butt"} /></svg>
    <span>{text.replace(/\.\d+%$/, "%")}</span>
  </span>;
}

export function Chip({ tone = "saved", icon, children, title }: { tone?: "saved" | "live" | "local" | "fixture" | "ok" | "ai" | "plain"; icon?: IconName; children: ReactNode; title?: string }) {
  return <span className={`chip ${tone === "plain" ? "" : `chip-${tone}`}`} title={title}>{icon ? <Icon name={icon} /> : null}{children}</span>;
}

// ---------------------------------------------------------------- journey

const STAGE_ICON: Record<StageId, IconName> = { funded: "safe", proposals: "layers", forecasting: "users", selected: "spark", executed: "bolt", evaluated: "pulse", redeemed: "refund" };

function nodeContent(stage: JourneyStage, index: number): ReactNode {
  if (stage.status === "done") return <Icon name="check" />;
  if (stage.status === "halted") return <Icon name="alert" />;
  if (stage.status === "current") return <Icon name={STAGE_ICON[stage.id]} />;
  return <span style={{ fontSize: 12, fontWeight: 700 }}>{index + 1}</span>;
}
const STATUS_WORD: Record<JourneyStage["status"], string> = { done: "done", current: "in progress", upcoming: "not reached", halted: "halted" };

/** The round's seven steps. Each links to its section further down the page. */
export function JourneyTrack({ stages, label = "Round journey" }: { stages: JourneyStage[]; label?: string }) {
  return <ol className="track" aria-label={label}>
    {stages.map((stage, index) => <li key={stage.id} className={`track-step ${stage.status}`} aria-current={stage.status === "current" ? "step" : undefined}>
      <a href={`#stage-${stage.id}`} className="track-link" aria-label={`${stage.label}: ${STATUS_WORD[stage.status]}${stage.summary ? `, ${stage.summary}` : ""}`}>
        <span className="track-node" aria-hidden="true">{nodeContent(stage, index)}</span>
        <span className="track-text" aria-hidden="true"><b>{stage.label}</b><span>{stage.summary ?? (stage.status === "current" ? "In progress…" : stage.status === "halted" ? "Halted" : "—")}</span></span>
      </a>
    </li>)}
  </ol>;
}

/** Compact progress bar for round cards. */
export function MiniTrack({ stages }: { stages: JourneyStage[] }) {
  return <div className="mini-track" role="img" aria-label={`${stages.filter((stage) => stage.status === "done").length} of ${stages.length} steps complete`}>
    {stages.map((stage) => <i key={stage.id} className={stage.status} />)}
  </div>;
}

// ---------------------------------------------------------------- strategies and positions

export type StrategyView = { id: string; name: string; allocationBps: number; rationale: string; source: "ai" | "tee" | "fixture" | "baseline"; model?: string | null };

export function StrategyCard({ strategy, selected = false, dim = false, compact = false, onSelect }: { strategy: StrategyView; selected?: boolean; dim?: boolean; compact?: boolean; onSelect?: () => void }) {
  const hold = strategy.id === "0";
  const thesis = strategy.rationale.replace(/^SIMULATED AGENT:\s*/i, "");
  return <article className={`strategy ${hold ? "is-hold" : ""} ${selected ? "is-selected" : ""} ${dim ? "is-dim" : ""} ${onSelect ? "is-pickable" : ""}`} onClick={onSelect} aria-label={`${hold ? "Keep current allocation" : strategy.name}${selected ? ", selected" : ""}`}>
    {selected ? <span className="selected-flag"><Icon name="check" />Selected</span> : null}
    <div className="strategy-top">
      <AgentAvatar name={strategy.name} kind={hold ? "hold" : "proposer"} />
      <div className="strategy-name"><b>{hold ? "Keep allocation" : strategy.name}</b><span>{hold ? "Baseline · Hold" : `Proposal #${strategy.id}`}</span>{!hold && strategy.model ? <span className="num" style={{ fontSize: 11 }} title="AI model that proposed this strategy">{strategy.model}</span> : null}</div>
    </div>
    <div className="strategy-alloc">
      <AllocationRing bps={strategy.allocationBps} />
      <div><b>{percentFromBps(strategy.allocationBps)} test ETH</b><span>{hold ? "what the Safe holds now" : `${percentFromBps(10_000 - strategy.allocationBps)} USDC`}</span></div>
    </div>
    {!compact ? (hold ? <p className="strategy-thesis">Keeps the Safe&apos;s current token quantities. A challenger must beat it to trade.</p>
      : thesis ? (thesis.length > 150 ? <details><summary>Read the thesis</summary><p>{thesis}</p></details> : <p className="strategy-thesis">{thesis}</p>) : null) : null}
    <div className="strategy-foot">
      {strategy.source === "baseline" ? <Chip tone="plain">Baseline</Chip>
        : strategy.source === "tee" ? <Chip tone="ai" icon="shield" title="The NEAR AI answer was checked inside a verified enclave (Intel TDX + NVIDIA GPU attestation, signed response) before it was submitted; its hash is in the on-chain proposal.">TEE-verified AI</Chip>
        : strategy.source === "ai" ? <Chip tone="ai" icon="spark">AI-generated</Chip> : <Chip tone="fixture">Simulated agent</Chip>}
      {onSelect ? <button type="button" className="btn btn-sm btn-ghost strategy-open" onClick={(event) => { event.stopPropagation(); onSelect(); }}>Rationale<Icon name="arrow" /></button> : null}
    </div>
  </article>;
}

const credits = (raw: string | null) => (raw ? `${formatUnits(raw, 6) ?? "—"} credits` : null);

/** LONG and SHORT positions per strategy, drawn as opposing sides. Credits belong to that strategy's world only. */
export function PositionBoard({ strategies, positions }: { strategies: StrategyView[]; positions: PositionGroups }) {
  return <div className="positions" role="table" aria-label="Positions by strategy">
    <div className="positions-head" role="row"><span role="columnheader">Strategy</span><span role="columnheader" className="long">LONG · backs it</span><span role="columnheader" className="short">SHORT · doubts it</span></div>
    {strategies.map((strategy) => {
      const group = positions.groups.find((item) => item.proposalId === strategy.id);
      const empty = !group || (group.long.length === 0 && group.short.length === 0);
      const side = (list: PositionGroups["groups"][number]["long"], kind: "long" | "short") => <div className={`pos-side ${kind}`} data-side={kind.toUpperCase()} role="cell">
        {list.length ? list.map((item) => <span key={`${kind}-${item.name}`} className={`pos-chip ${kind}`} title={item.scripted ? "Scripted test actor, not an AI forecast" : undefined}>
          <AgentAvatar name={item.name} kind="forecaster" size="sm" />{item.name}{item.credits ? <small>{credits(item.credits)}</small> : null}</span>)
          : <span className="pos-none">—</span>}
      </div>;
      return <div key={strategy.id} className={`pos-row ${empty ? "is-empty" : ""}`} role="row">
        <div className="who" role="cell"><AgentAvatar name={strategy.name} kind={strategy.id === "0" ? "hold" : "proposer"} size="sm" /><span>{strategy.id === "0" ? "Keep allocation" : strategy.name}</span></div>
        {side(group?.long ?? [], "long")}{side(group?.short ?? [], "short")}
      </div>;
    })}
  </div>;
}

/** Final-window market averages against Hold, with the qualifying line the best challenger had to clear. */
export function SignalBoard({ signals, strategies }: { signals: SelectionSignals; strategies: StrategyView[] }) {
  return <div className="signals">
    {signals.rows.map((row) => {
      const strategy = strategies.find((item) => item.id === row.id);
      return <div key={row.id} className={`signal ${row.qualifies ? "qualifies" : ""} ${row.isHold ? "is-hold" : ""}`}>
        <span className="signal-name"><AgentAvatar name={strategy?.name ?? row.id} kind={row.isHold ? "hold" : "proposer"} size="sm" /><span>{row.isHold ? "Keep allocation" : strategy?.name ?? `#${row.id}`}</span></span>
        <span className="signal-bar" aria-hidden="true"><i style={{ width: `${row.percent ?? 0}%` }} />{!row.isHold ? <span className="threshold" style={{ left: `${signals.thresholdPercent}%` }} /> : null}</span>
        <span className="signal-value">{row.percent === null ? "—" : `${row.percent.toFixed(1)}%`}</span>
      </div>;
    })}
    <p className="signal-legend"><i aria-hidden="true" />Line: Hold&apos;s average plus 0.5 points ({signals.thresholdPercent.toFixed(1)}%). Only a strategy past it can be selected.</p>
  </div>;
}

// ---------------------------------------------------------------- execution and outcome

export function SwapVisual({ spent, received, note }: { spent: { amount: string; symbol: string; label: string }; received: { amount: string; symbol: string; label: string }; note?: ReactNode }) {
  return <div className="stack">
    <div className="swap">
      <div className="token-box"><span>{spent.label}</span><b>{spent.amount}</b><small>{spent.symbol}</small></div>
      <span className="swap-arrow" aria-hidden="true"><Icon name="arrow" /></span>
      <div className="token-box risk"><span>{received.label}</span><b>{received.amount}</b><small>{received.symbol}</small></div>
    </div>
    {note}
  </div>;
}

/** The measured return, neutral in colour, placed on the round's own payout bounds when they are recorded. */
export function ResultPanel({ returnX18, bounds, caption, children }: { returnX18: string | null; bounds: { minX18: string; maxX18: string } | null; caption: ReactNode; children?: ReactNode }) {
  const exact = formatReturnX18(returnX18);
  const at = returnOnScale(returnX18, bounds);
  const negative = exact?.startsWith("−");
  return <div className="result">
    <div>
      <div className="result-label">Measured strategy return</div>
      <div className="result-num">{exact && exact !== "0.0000%" ? <Icon name="down" className={negative ? undefined : "flip"} /> : null}{exact ?? "—"}</div>
      <p className="result-sub">{caption}</p>
    </div>
    <div className="stack">
      {bounds && at !== null ? <div className="scale">
        <div className="scale-bar" role="img" aria-label={`Return ${exact} within payout bounds ${shortReturnX18(bounds.minX18)} to ${shortReturnX18(bounds.maxX18)}`}><span className="mid" /><span className="scale-marker" style={{ left: `${at}%` }} /></div>
        <div className="scale-ends"><span>{shortReturnX18(bounds.minX18)}</span><span>0%</span><span>{shortReturnX18(bounds.maxX18)}</span></div>
        <p className="scale-caption">Payout range <Tip label="About the payout range">These bounds map the measured return to what each claim is worth: LONG settles higher as the return rises, SHORT as it falls. They are not the selection margin.</Tip></p>
      </div> : null}
      {children}
    </div>
  </div>;
}

// ---------------------------------------------------------------- evidence lists

export type TxItem = { key: string; text: string; hash: string; chainId: number | null; href?: string | null };
export function TxList({ items, empty = "No transactions recorded for this step." }: { items: TxItem[]; empty?: string }) {
  if (!items.length) return <p className="subtle" style={{ fontSize: 12.5 }}>{empty}</p>;
  return <ul className="tx-list">{items.map((item) => <li key={item.key}><span>{item.text}</span>
    <span className="tx-inline"><CopyText value={item.hash} label="transaction" />{item.href
      ? <a className="explorer-link" href={item.href} target="_blank" rel="noopener noreferrer" title="Open in block explorer"><Icon name="external" /><span className="sr-only">Open in block explorer</span></a>
      : <ExplorerLink chainId={item.chainId} kind="tx" value={item.hash} enabled={item.chainId !== null} />}</span></li>)}</ul>;
}
