"use client";

import type { ButtonHTMLAttributes, KeyboardEvent, ReactNode } from "react";
import { useRef } from "react";
import { Icon, type IconName } from "@/components/funding/primitives";

export type Tone = "success" | "info" | "warning" | "danger" | "neutral" | "brand";

export function Badge({ tone = "neutral", dot = false, children, title }: { tone?: Tone; dot?: boolean; children: ReactNode; title?: string }) {
  return <span className={`badge badge-${tone}`} title={title}>{dot ? <i className="badge-dot" aria-hidden="true" /> : null}{children}</span>;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "locked"; size?: "sm" | "md" | "lg"; block?: boolean; icon?: IconName; loading?: boolean;
};
export function Button({ variant = "secondary", size = "md", block = false, icon, loading = false, children, className, type = "button", ...rest }: ButtonProps) {
  const classes = ["btn", variant !== "secondary" ? `btn-${variant}` : "", size !== "md" ? `btn-${size}` : "", block ? "btn-block" : "", className ?? ""].filter(Boolean).join(" ");
  return <button type={type} className={classes} aria-busy={loading || undefined} {...rest}>
    {loading ? <span className="spinner" aria-hidden="true" /> : icon ? <Icon name={icon} /> : null}
    {children}
  </button>;
}

export function Card({ children, className, id, label }: { children: ReactNode; className?: string; id?: string; label?: string }) {
  return <section className={`card ${className ?? ""}`} id={id} aria-label={label}>{children}</section>;
}
export function CardHeader({ title, icon, actions, sub, id }: { title: ReactNode; icon?: IconName; actions?: ReactNode; sub?: ReactNode; id?: string }) {
  return <header className="card-header">
    <div><h2 id={id}>{icon ? <Icon name={icon} /> : null}{title}</h2>{sub ? <p>{sub}</p> : null}</div>
    {actions ? <div className="page-actions">{actions}</div> : null}
  </header>;
}

export type TabItem<T extends string> = { id: T; label: string; count?: number | string | null };
/** Underline tabs with roving focus (arrow keys, Home, End). Panels use id `${idBase}-panel-${tab}`. */
export function Tabs<T extends string>({ tabs, value, onChange, label, idBase }: { tabs: TabItem<T>[]; value: T; onChange: (id: T) => void; label: string; idBase: string }) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  function onKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = tabs.length - 1;
    const next = event.key === "ArrowRight" ? (index === last ? 0 : index + 1) : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1)
      : event.key === "Home" ? 0 : event.key === "End" ? last : null;
    if (next === null) return;
    event.preventDefault(); onChange(tabs[next].id); refs.current[next]?.focus();
  }
  return <div className="tabs" role="tablist" aria-label={label}>
    {tabs.map((tab, index) => {
      const selected = tab.id === value;
      return <button key={tab.id} ref={(node) => { refs.current[index] = node; }} type="button" role="tab" id={`${idBase}-tab-${tab.id}`} aria-selected={selected}
        aria-controls={`${idBase}-panel-${tab.id}`} tabIndex={selected ? 0 : -1} className="tab" onClick={() => onChange(tab.id)} onKeyDown={(event) => onKey(event, index)}>
        {tab.label}{tab.count !== undefined && tab.count !== null ? <span className="tab-count">{tab.count}</span> : null}
      </button>;
    })}
  </div>;
}
export function TabPanel({ idBase, tab, children }: { idBase: string; tab: string; children: ReactNode }) {
  return <div role="tabpanel" id={`${idBase}-panel-${tab}`} aria-labelledby={`${idBase}-tab-${tab}`}>{children}</div>;
}

export function Stat({ label, value, unit, sub, tone }: { label: ReactNode; value: ReactNode; unit?: string; sub?: ReactNode; tone?: "pos" | "neg" }) {
  return <div className="stat">
    <div className="stat-label">{label}</div>
    <div className={`stat-value ${tone ?? ""}`}>{value}{unit ? <small>{unit}</small> : null}</div>
    {sub ? <div className="stat-sub">{sub}</div> : null}
  </div>;
}

export function ProgressBar({ percent, tone, thin = false, label }: { percent: number; tone?: "success" | "danger" | "neutral"; thin?: boolean; label: string }) {
  const value = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0;
  return <div className={`progress ${tone ?? ""} ${thin ? "thin" : ""}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)}>
    <span style={{ width: `${value}%` }} />
  </div>;
}

export type TimelineState = "done" | "current" | "upcoming" | "halted";
export type TimelineItem = { key: string; title: ReactNode; detail?: ReactNode; time?: ReactNode; state: TimelineState };
export function Timeline({ items, label }: { items: TimelineItem[]; label: string }) {
  return <ol className="timeline" aria-label={label}>
    {items.map((item) => <li key={item.key} className={`tl-item ${item.state}`} aria-current={item.state === "current" ? "step" : undefined}>
      <span className="tl-dot" aria-hidden="true">{item.state === "done" ? <Icon name="check" /> : item.state === "halted" ? <Icon name="alert" /> : null}</span>
      <div>
        <div className="tl-title"><span>{item.title}</span>{item.time ? <time>{item.time}</time> : null}</div>
        {item.detail ? <div className="tl-detail">{item.detail}</div> : null}
      </div>
    </li>)}
  </ol>;
}

export function DescriptionList({ items }: { items: Array<{ label: ReactNode; value: ReactNode; hint?: ReactNode; key?: string }> }) {
  return <dl className="dl">{items.map((item, index) => <div key={item.key ?? index}><dt>{item.label}{item.hint ? <small>{item.hint}</small> : null}</dt><dd>{item.value}</dd></div>)}</dl>;
}

export function Notice({ tone = "info", icon, title, children }: { tone?: "info" | "warning" | "danger" | "success" | "neutral"; icon?: IconName; title?: ReactNode; children?: ReactNode }) {
  const fallback: IconName = tone === "success" ? "check" : tone === "info" || tone === "neutral" ? "eye" : "alert";
  return <div className={`notice ${tone === "info" ? "" : tone}`} role={tone === "danger" || tone === "warning" ? "alert" : "note"}>
    <Icon name={icon ?? fallback} />
    <div>{title ? <p><b>{title}</b></p> : null}{children}</div>
  </div>;
}

export function EmptyState({ icon = "eye", title, children, action }: { icon?: IconName; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return <div className="empty"><span className="empty-icon"><Icon name={icon} /></span><h3>{title}</h3>{children ? <p>{children}</p> : null}{action}</div>;
}

export function Skeleton({ width = "100%", height = 14 }: { width?: number | string; height?: number }) {
  return <span className="skeleton" style={{ width, height }} aria-hidden="true" />;
}

export function SegmentedControl<T extends string>({ options, value, onChange, label }: { options: Array<{ id: T; label: string; badge?: ReactNode }>; value: T; onChange: (id: T) => void; label: string }) {
  return <div className="segmented" role="radiogroup" aria-label={label}>
    {options.map((option) => <button key={option.id} type="button" role="radio" aria-checked={option.id === value} data-lane={option.id} onClick={() => onChange(option.id)}>
      {option.label}{option.badge}
    </button>)}
  </div>;
}

export function PageHeader({ title, description, actions, meta, breadcrumb }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; meta?: ReactNode; breadcrumb?: ReactNode }) {
  return <header className="page-header">
    <div>
      {breadcrumb}
      <h1>{title}</h1>
      {description ? <p>{description}</p> : null}
      {meta ? <div className="page-meta">{meta}</div> : null}
    </div>
    {actions ? <div className="page-actions">{actions}</div> : null}
  </header>;
}

/** Deterministic avatar colour for a name, so each agent keeps its colour everywhere. */
export function avatarClass(name: string): string {
  let sum = 0; for (const char of name) sum = (sum + char.charCodeAt(0)) % 5;
  return sum === 0 ? "" : `c${sum}`;
}
export function Avatar({ name, small = false }: { name: string; small?: boolean }) {
  return <span className={`avatar ${small ? "sm" : ""} ${avatarClass(name)}`} aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>;
}

export type EvidenceKind = "saved" | "fresh" | "provider" | "fixture" | "live";
const EVIDENCE: Record<EvidenceKind, { tone: Tone; label: string; title: string }> = {
  saved: { tone: "neutral", label: "Saved evidence", title: "Recorded and independently verified at the time; not re-read now" },
  fresh: { tone: "info", label: "Fresh read", title: "Read from public RPCs just now" },
  provider: { tone: "warning", label: "Provider-reported", title: "Reported by the relayer or provider; not proof on its own" },
  fixture: { tone: "warning", label: "Fixture", title: "Synthetic data for demonstration" },
  live: { tone: "info", label: "Live read", title: "Read from a public RPC when the page loaded" },
};
/** Labels where a value comes from, so saved proofs never look like fresh verification. */
export function EvidenceBadge({ kind, detail }: { kind: EvidenceKind; detail?: string }) {
  const item = EVIDENCE[kind];
  return <Badge tone={item.tone} title={item.title}>{item.label}{detail ? ` · ${detail}` : ""}</Badge>;
}
