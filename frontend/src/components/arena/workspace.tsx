"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Icon } from "@/components/funding/primitives";
import { SegmentedControl } from "@/components/ui";
import { Button } from "@/components/ui";
import { Cap, DrawerButton, PageHead, Tip } from "@/components/v2";
import { STAGES, defaultStage, resolveStage, stageOrder, stepStage, type ParticipantView, type StageId, type StageSelection } from "@/lib/arena/model.mjs";
import { formatSignedUnits } from "@/lib/record/model.mjs";
import { formatUnits } from "@/lib/funding/model.mjs";
import { AgentAvatar, TxList } from "./parts";
import { STAGE_TITLES, StageBody, type StageCtx } from "./stages";

const LABEL = (id: StageSelection) => (id === "result" ? "Result" : STAGE_TITLES[id as StageId]);
const usdc = (raw: string | null | undefined) => formatUnits(raw, 6) ?? "—";

type Dot = "done" | "current" | "upcoming" | "halted";

function StageTabs({ order, selected, dots, onSelect, summaries }: { order: StageSelection[]; selected: StageSelection; dots: Record<string, Dot>; onSelect: (id: StageSelection) => void; summaries: Record<string, string | null> }) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  function onKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = order.length - 1;
    const next = event.key === "ArrowRight" ? Math.min(last, index + 1) : event.key === "ArrowLeft" ? Math.max(0, index - 1) : event.key === "Home" ? 0 : event.key === "End" ? last : null;
    if (next === null) return;
    event.preventDefault(); onSelect(order[next]); refs.current[next]?.focus();
  }
  return <div className="rw-tabs-wrap"><div className="rw-tabs" role="tablist" aria-label="Round stages">
    {order.map((id, index) => {
      const isSelected = id === selected; const dot = dots[id];
      return <button key={id} ref={(node) => { refs.current[index] = node; }} type="button" role="tab" id={`rw-tab-${id}`} aria-selected={isSelected} aria-controls="rw-panel" tabIndex={isSelected ? 0 : -1}
        className={`rw-tab ${id === "result" ? "is-result" : ""}`} title={summaries[id] ?? undefined} onClick={() => onSelect(id)} onKeyDown={(event) => onKey(event, index)}>
        <span className={`rw-dot ${dot}`} aria-hidden="true">{dot === "done" ? <Icon name="check" /> : null}</span>
        <span>{LABEL(id)}</span>
        <span className="sr-only">{id === "result" ? "" : `, ${dot === "done" ? "done" : dot === "current" ? "in progress" : dot === "halted" ? "halted" : "not reached"}`}</span>
      </button>;
    })}
  </div></div>;
}

function Metric({ text }: { text: string }) {
  const at = /^([+−-]?\d|Hold )/.test(text) ? text.indexOf(" ") : -1;
  const head = at === -1 ? text : text.slice(0, at); const rest = at === -1 ? "" : text.slice(at + 1);
  return <div className="rw-metric"><b className="num">{head}</b>{rest ? <span>{rest}</span> : null}</div>;
}

function ParticipantCard({ people }: { people: ParticipantView[] }) {
  const [name, setName] = useState(people[0]?.name ?? "");
  const person = people.find((item) => item.name === name) ?? people[0];
  if (!person) return <p className="muted">No recorded participants.</p>;
  const net = formatSignedUnits(person.net, 6);
  return <div className="rw-person">
    <label className="rw-select-label"><span className="eyebrow">Participant</span>
      <select className="rw-select" value={person.name} onChange={(event) => setName(event.target.value)}>{people.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</select></label>
    <div className="rw-row"><AgentAvatar name={person.name} kind="forecaster" size="sm" /><b>{person.name}</b>{person.scripted ? <Cap>Recorded test actor</Cap> : null}</div>
    <dl className="rw-kv">
      <div><dt>Deposit</dt><dd className="num">{usdc(person.deposit)} <small>test USDC</small></dd></div>
      {person.position ? <div><dt>Position</dt><dd><span className={`side-tag ${person.position.side}`}>{person.position.side.toUpperCase()}</span> {person.position.strategy}</dd></div>
        : person.abstained ? <div><dt>Position</dt><dd>Abstained {person.reason ? <Tip label="Why abstained">{person.reason}</Tip> : null}</dd></div> : null}
      <div><dt>Redeemed</dt><dd className="num">{usdc(person.redeemed)}</dd></div>
      <div><dt>Net</dt><dd className={`num ${net?.startsWith("−") ? "neg-quiet" : net?.startsWith("+") ? "pos-quiet" : ""}`}>{net ?? "—"}</dd></div>
    </dl>
  </div>;
}

export type WorkspaceProps = {
  ctx: StageCtx; eyebrow: ReactNode; title: ReactNode; caps: ReactNode; metrics: string[]; summaryRows: Array<[string, ReactNode]>;
  participants: ParticipantView[]; facts?: ReactNode; activityExtra?: ReactNode; actions?: ReactNode;
};

/** The round workspace: stage selector, exactly one stage body, and the summary column. Selection is view state only. */
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
  const dots: Record<string, Dot> = Object.fromEntries(journey.stages.map((stage) => [stage.id, stage.status as Dot]));
  dots.result = journey.complete ? "done" : "upcoming";
  const summaries: Record<string, string | null> = Object.fromEntries(journey.stages.map((stage) => [stage.id, stage.summary]));
  const previous = selected === "result" ? null : stepStage(selected, -1);
  const next = selected === "result" ? null : stepStage(selected, 1);
  const stageInfo = selected === "result" ? null : journey.stages.find((stage) => stage.id === selected) ?? null;
  const groups = (["setup", ...STAGES.map((stage) => stage.id)] as const).filter((key) => ctx.tx[key].length);

  return <>
    <PageHead eyebrow={eyebrow} title={title} line={<span className="rw-caps">{caps}</span>} actions={actions} />
    <div className="rw-metrics">{metrics.map((text) => <Metric key={text} text={text} />)}</div>
    <StageTabs order={order} selected={selected} dots={dots} summaries={summaries} onSelect={select} />
    <div className="rw-grid">
      <section className="card rw-panel" role="tabpanel" id="rw-panel" aria-labelledby={`rw-tab-${selected}`} tabIndex={-1}>
        <header className="rw-panel-head"><h2>{LABEL(selected)}</h2>
          {stageInfo ? (stageInfo.status === "done" ? <Cap tone="ok" icon="check">{ctx.mode === "saved" ? "Recorded" : "Done"}</Cap> : stageInfo.status === "current" ? <Cap tone="warn" icon="clock">In progress</Cap>
            : stageInfo.status === "halted" ? <Cap tone="bad" icon="alert">Halted</Cap> : <Cap>Not reached</Cap>) : <Cap tone="ok" icon="check">Settled</Cap>}
        </header>
        <div className="rw-body"><StageBody key={selected} stage={selected} ctx={ctx} onReplay={() => select("funded")} onPick={(id) => select(id)} /></div>
        {selected !== "result" ? <nav className="rw-step" aria-label="Step through stages">
          <Button size="sm" variant="ghost" disabled={previous === null} onClick={() => previous && select(previous)}><Icon name="chevron" className="rw-flip" />Previous</Button>
          {next ? <Button size="sm" onClick={() => select(next)}>Next<Icon name="arrow" /></Button>
            : journey.complete ? <Button size="sm" onClick={() => select("result")}>Back to result<Icon name="arrow" /></Button> : <Button size="sm" disabled>Next<Icon name="arrow" /></Button>}
        </nav> : null}
      </section>

      <aside className="rw-side" aria-label="Round summary">
        <section className="card rw-card"><h2>Round summary</h2>
          <dl className="rw-kv">{summaryRows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section>
        <section className="card rw-card"><div className="rw-row"><h2>View</h2>
          <SegmentedControl label="View" value={view} onChange={setView} options={[{ id: "observer", label: "Observer" }, { id: "participant", label: "Recorded participant" }]} /></div>
          {view === "participant" ? <ParticipantCard people={participants} /> : null}
          <div className="rw-row rw-locked"><Link className="btn btn-primary" href="/rounds/live#wallet">Trade on the live round →</Link>
            <Tip label="When you can trade">Forecasting from your wallet works while a round’s forecasting window is open. These positions are recorded history.</Tip></div>
        </section>
      </aside>
    </div>
    <div className="rw-bottom">
      <DrawerButton label="Activity & receipts" title="Activity & receipts" icon="receipt">
        {groups.length ? groups.map((key) => <section key={key}><h3 className="rw-h3">{key === "setup" ? "Setup" : STAGE_TITLES[key]}</h3><TxList items={ctx.tx[key]} /></section>) : <p className="muted">No transactions recorded.</p>}
        {activityExtra}
      </DrawerButton>
      {facts ? <DrawerButton label="About this evidence" title="Identity, checks and limitations" icon="shield">{facts}</DrawerButton> : null}
    </div>
  </>;
}
