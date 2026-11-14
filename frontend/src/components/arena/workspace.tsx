"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/funding/primitives";
import { Button, SegmentedControl } from "@/components/ui";
import { Cap, DrawerButton, Tip } from "@/components/v2";
import { STAGES, defaultStage, resolveStage, stageOrder, stepStage, type ParticipantView, type StageId, type StageSelection } from "@/lib/arena/model.mjs";
import { formatSignedUnits } from "@/lib/record/model.mjs";
import { formatUnits } from "@/lib/funding/model.mjs";
import { AgentAvatar, TxList } from "./parts";
import { STAGE_TITLES, StageBody, type StageCtx } from "./stages";

const LABEL = (id: StageSelection) => (id === "result" ? "Overview" : STAGE_TITLES[id as StageId]);
const usdc = (raw: string | null | undefined) => formatUnits(raw, 6) ?? "—";
export const STAGE_ICON: Record<StageSelection, IconName> = { result: "grid", funded: "safe", proposals: "spark", forecasting: "users", selected: "trophy", executed: "bolt", evaluated: "pulse", redeemed: "refund" };
const QUESTION: Record<string, string> = Object.fromEntries(STAGES.map((stage) => [stage.id, stage.question]));

export type Dot = "done" | "current" | "upcoming" | "halted";
export type StepItem = { id: string; label: string; status: Dot; summary?: string | null };

/** The round's steps as a connected rail of tabs (roving focus with arrow keys, Home and End). */
export function Stepper({ items, selected, onSelect, idBase = "rw", label = "Round stages" }: { items: StepItem[]; selected: string; onSelect: (id: string) => void; idBase?: string; label?: string }) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const wrap = useRef<HTMLDivElement>(null);
  function onKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = items.length - 1;
    const next = event.key === "ArrowRight" ? Math.min(last, index + 1) : event.key === "ArrowLeft" ? Math.max(0, index - 1) : event.key === "Home" ? 0 : event.key === "End" ? last : null;
    if (next === null) return;
    event.preventDefault(); onSelect(items[next].id); refs.current[next]?.focus();
  }
  // Keep the selected step in view on narrow screens.
  useEffect(() => { const index = items.findIndex((item) => item.id === selected); refs.current[index]?.scrollIntoView?.({ block: "nearest", inline: "center", behavior: "smooth" }); }, [selected, items]);
  const reached = items.filter((item) => item.status === "done").length;
  return <div className="stepper-wrap" ref={wrap}><div className="stepper" role="tablist" aria-label={label} style={{ "--fill": `${items.length > 1 ? Math.min(1, reached / (items.length - 1)) * 100 : 0}%` } as CSSProperties}>
    {items.map((item, index) => {
      const on = item.id === selected;
      return <button key={item.id} ref={(node) => { refs.current[index] = node; }} type="button" role="tab" id={`${idBase}-tab-${item.id}`} aria-selected={on} aria-controls={`${idBase}-panel`} tabIndex={on ? 0 : -1}
        className={`step ${item.status} ${on ? "on" : ""} ${item.id === "result" ? "is-result" : ""}`} title={item.summary ?? undefined} onClick={() => onSelect(item.id)} onKeyDown={(event) => onKey(event, index)}>
        <span className="step-node" aria-hidden="true">{item.status === "done" ? <Icon name="check" /> : item.status === "halted" ? <Icon name="alert" /> : <Icon name={STAGE_ICON[item.id as StageSelection] ?? "chevron"} />}</span>
        <span className="step-label">{item.label}</span>
        <span className="sr-only">{item.id === "result" ? "" : `, ${item.status === "done" ? "done" : item.status === "current" ? "in progress" : item.status === "halted" ? "halted" : "not reached"}`}</span>
      </button>;
    })}
  </div></div>;
}

export type Metric = { label: string; value: ReactNode; sub?: ReactNode; tone?: "pos" | "neg" | null; avatar?: { name: string; hold?: boolean } };
export function MetricStrip({ metrics }: { metrics: Metric[] }) {
  return <div className="rw-metrics">{metrics.map((metric) => <div key={metric.label} className="rw-metric">
    <span className="rw-metric-label">{metric.label}</span>
    <span className={`rw-metric-value ${metric.tone ?? ""}`}>{metric.avatar ? <AgentAvatar name={metric.avatar.name} kind={metric.avatar.hold ? "hold" : "proposer"} size="sm" /> : null}<b className="num">{metric.value}</b></span>
    {metric.sub ? <span className="rw-metric-sub">{metric.sub}</span> : null}
  </div>)}</div>;
}

function ParticipantCard({ people }: { people: ParticipantView[] }) {
  const [name, setName] = useState(people[0]?.name ?? "");
  const person = people.find((item) => item.name === name) ?? people[0];
  if (!person) return <p className="muted">No recorded participants.</p>;
  const net = formatSignedUnits(person.net, 6);
  return <div className="rw-person">
    <label className="field"><span>Participant</span>
      <select className="rw-select" value={person.name} onChange={(event) => setName(event.target.value)}>{people.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</select></label>
    <div className="rw-row"><AgentAvatar name={person.name} kind="forecaster" size="sm" /><b>{person.name}</b>{person.scripted ? <Cap>Recorded test actor</Cap> : null}</div>
    <dl className="rw-kv">
      <div><dt>Deposit</dt><dd className="num">{usdc(person.deposit)} <small>test USDC</small></dd></div>
      {person.position ? <div><dt>Position</dt><dd><span className={`side-tag ${person.position.side}`}>{person.position.side.toUpperCase()}</span> {person.position.strategy}</dd></div>
        : person.abstained ? <div><dt>Position</dt><dd>Abstained {person.reason ? <Tip label="Why abstained">{person.reason}</Tip> : null}</dd></div> : null}
      <div><dt>Redeemed</dt><dd className="num">{usdc(person.redeemed)}</dd></div>
      <div><dt>Net</dt><dd className={`num ${net?.startsWith("−") ? "neg" : net?.startsWith("+") ? "pos" : ""}`}>{net ?? "—"}</dd></div>
    </dl>
  </div>;
}

export type WorkspaceProps = {
  ctx: StageCtx; eyebrow: ReactNode; title: ReactNode; caps: ReactNode; metrics: Metric[]; summaryRows: Array<[string, ReactNode]>;
  participants: ParticipantView[]; facts?: ReactNode; activityExtra?: ReactNode; actions?: ReactNode;
};

/** The round workspace: outcome strip, step rail, exactly one stage body, and the summary column. Selection is view state only. */
export function RoundWorkspace({ ctx, eyebrow, title, caps, metrics, summaryRows, participants, facts, activityExtra, actions }: WorkspaceProps) {
  const journey = ctx.journey;
  const [picked, setPicked] = useState<StageSelection | null>(() => (typeof window === "undefined" ? null : resolveStage(new URLSearchParams(window.location.search).get("stage"), journey)));
  const [view, setView] = useState<"observer" | "participant">("observer");
  const selected: StageSelection = picked && resolveStage(picked, journey) ? picked : (defaultStage(journey) as StageSelection);
  const order = stageOrder(journey) as StageSelection[];

  function select(id: StageSelection) {
    setPicked(id);
    try { const url = new URL(window.location.href); url.searchParams.set("stage", id); window.history.replaceState(null, "", url); } catch { /* the URL is a convenience */ }
  }
  const status = Object.fromEntries(journey.stages.map((stage) => [stage.id, stage.status as Dot])) as Record<string, Dot>;
  status.result = journey.complete ? "done" : "upcoming";
  const summaries: Record<string, string | null> = Object.fromEntries(journey.stages.map((stage) => [stage.id, stage.summary]));
  const items: StepItem[] = order.map((id) => ({ id, label: LABEL(id), status: status[id], summary: summaries[id] ?? null }));
  const previous = selected === "result" ? null : stepStage(selected, -1);
  const next = selected === "result" ? null : stepStage(selected, 1);
  const stageInfo = selected === "result" ? null : journey.stages.find((stage) => stage.id === selected) ?? null;
  const position = selected === "result" ? null : STAGES.findIndex((stage) => stage.id === selected) + 1;
  const groups = (["setup", ...STAGES.map((stage) => stage.id)] as const).filter((key) => ctx.tx[key].length);
  const txCount = groups.reduce((sum, key) => sum + ctx.tx[key].length, 0);

  return <>
    <header className="rw-head">
      <div className="rw-head-main">
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <div className="rw-caps">{caps}</div>
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
    <MetricStrip metrics={metrics} />
    <Stepper items={items} selected={selected} onSelect={(id) => select(id as StageSelection)} />
    <div className="rw-grid">
      <section className="card rw-panel" role="tabpanel" id="rw-panel" aria-labelledby={`rw-tab-${selected}`} tabIndex={-1}>
        <header className="rw-panel-head">
          <span className="rw-panel-ico"><Icon name={STAGE_ICON[selected]} /></span>
          <div className="rw-panel-title"><span className="eyebrow">{position ? `Step ${position} of ${STAGES.length}` : "Round overview"}</span><h2>{LABEL(selected)}</h2>{position ? <p>{QUESTION[selected]}</p> : null}</div>
          {stageInfo ? (stageInfo.status === "done" ? <Cap tone="ok" icon="check">{ctx.mode === "saved" ? "Recorded" : "Done"}</Cap> : stageInfo.status === "current" ? <Cap tone="warn" icon="clock">In progress</Cap>
            : stageInfo.status === "halted" ? <Cap tone="bad" icon="alert">Halted</Cap> : <Cap>Not reached</Cap>) : <Cap tone="ok" icon="check">Settled</Cap>}
        </header>
        <div className="rw-body" key={selected}><StageBody stage={selected} ctx={ctx} onReplay={() => select("funded")} onPick={(id) => select(id)} /></div>
        {selected !== "result" ? <nav className="rw-step" aria-label="Step through stages">
          <Button size="sm" variant="ghost" disabled={previous === null} onClick={() => previous && select(previous)}><Icon name="chevron" className="rw-flip" />{previous ? STAGE_TITLES[previous] : "Previous"}</Button>
          {next ? <Button size="sm" onClick={() => select(next)}>{STAGE_TITLES[next]}<Icon name="arrow" /></Button>
            : journey.complete ? <Button size="sm" variant="primary" onClick={() => select("result")}>Overview<Icon name="arrow" /></Button> : <Button size="sm" disabled>Next<Icon name="arrow" /></Button>}
        </nav> : null}
      </section>

      <aside className="rw-side" aria-label="Round summary">
        <section className="card rw-card"><h2>Round summary</h2>
          <dl className="rw-kv">{summaryRows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section>
        <section className="card rw-card"><h2>Evidence</h2>
          <div className="rw-evidence">
            <DrawerButton label={<>Activity &amp; receipts{txCount ? <span className="tab-count">{txCount}</span> : null}</>} title="Activity & receipts" icon="receipt" className="rw-evidence-btn">
              {groups.length ? groups.map((key) => <section key={key} className="stack"><h3 className="rw-h3">{key === "setup" ? "Setup" : STAGE_TITLES[key]}</h3><TxList items={ctx.tx[key]} /></section>) : <p className="muted">No transactions recorded.</p>}
              {activityExtra}
            </DrawerButton>
            {facts ? <DrawerButton label="Identity, checks and limitations" title="Identity, checks and limitations" icon="shield" className="rw-evidence-btn">{facts}</DrawerButton> : null}
          </div></section>
        <section className="card rw-card"><div className="rw-row between"><h2>Viewing as</h2>
          <SegmentedControl label="View" value={view} onChange={setView} options={[{ id: "observer", label: "Observer" }, { id: "participant", label: "Participant" }]} /></div>
          {view === "participant" ? <ParticipantCard people={participants} /> : <p className="muted rw-small">Switch to see one recorded forecaster&apos;s deposit, position and payout.</p>}
          <div className="rw-trade"><Link className="btn btn-primary btn-block" href="/rounds/live#wallet"><Icon name="wallet" />Trade on the live round</Link>
            <Tip label="When you can trade">Forecasting from your wallet works while a round’s forecasting window is open. These positions are recorded history.</Tip></div>
        </section>
      </aside>
    </div>
  </>;
}
