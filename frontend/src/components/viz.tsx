"use client";

// Small, dependency-free visualisations. Every number they draw comes from saved evidence or from an
// explicitly labelled illustration; nothing here fetches, signs or invents a result.
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { SelectionSignals } from "@/lib/arena/model.mjs";
import { agentVar, AgentAvatar } from "@/components/arena/identity";

/** Animates a number from 0 once it scrolls into view. Renders the final value without motion preferences or JS. */
export function CountUp({ value, decimals = 0, prefix = "", suffix = "", duration = 900 }: { value: number; decimals?: number; prefix?: string; suffix?: string; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(value);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { setShown(value); return; }
    let frame = 0; let started = false;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting || started) return;
      started = true; const t0 = performance.now();
      const tick = (t: number) => { const k = Math.min(1, (t - t0) / duration); setShown(value * (1 - Math.pow(1 - k, 3))); if (k < 1) frame = requestAnimationFrame(tick); };
      setShown(0); frame = requestAnimationFrame(tick);
    }, { threshold: 0.4 });
    observer.observe(node);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [value, duration]);
  return <span ref={ref} className="num">{prefix}{shown.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}{suffix}</span>;
}

/** ETH / USDC split of a target allocation as one bar. */
export function AllocationBar({ bps, compact = false }: { bps: number; compact?: boolean }) {
  const pct = Number.isSafeInteger(bps) ? Math.max(0, Math.min(10_000, bps)) / 100 : 0;
  return <span className={`alloc ${compact ? "compact" : ""}`} role="img" aria-label={`${pct}% test ETH, ${100 - pct}% test USDC`}>
    <span className="alloc-track"><i style={{ width: `${pct}%` }} /></span>
    {!compact ? <span className="alloc-legend"><span><b className="num">{pct}%</b> ETH</span><span><b className="num">{100 - pct}%</b> USDC</span></span> : null}
  </span>;
}

export type RaceStrategy = { id: string; name: string; allocationBps: number };

/**
 * Final-window market averages per strategy against Hold and the qualifying line, on a zoomed axis so
 * fractions of a point stay visible. The axis is labelled; the selection rule is the contract's, restated.
 */
export function RaceChart({ signals, strategies, animate = true, compact = false, onHover }: { signals: SelectionSignals; strategies: RaceStrategy[]; animate?: boolean; compact?: boolean; onHover?: (id: string | null) => void }) {
  const values = signals.rows.flatMap((row) => (row.percent === null ? [] : [row.percent]));
  const lo = Math.floor(Math.min(...values, signals.holdPercent) - 0.5);
  const hi = Math.ceil(Math.max(...values, signals.thresholdPercent) + 0.5);
  const span = Math.max(1, hi - lo);
  const frac = (value: number) => Math.max(0, Math.min(1, (value - lo) / span));
  const at = (value: number) => `${frac(value) * 100}%`;
  const [ready, setReady] = useState(!animate);
  useEffect(() => { if (!animate) return; const id = requestAnimationFrame(() => setReady(true)); return () => cancelAnimationFrame(id); }, [animate]);
  // "Nice" tick steps (1, 2, 5, 10, …) so the axis never shows more than about six labels.
  const step = [1, 2, 5, 10, 20, 25, 50].find((candidate) => span / candidate <= 6) ?? 100;
  const first = Math.ceil(lo / step) * step;
  const ticks = Array.from({ length: Math.floor((hi - first) / step) + 1 }, (_, i) => first + i * step);
  const order = [...signals.rows].sort((a, b) => (a.isHold ? -1 : b.isHold ? 1 : 0));
  return <div className={`race ${compact ? "compact" : ""}`} role="table" aria-label="Final-window market average by strategy">
    <div className="race-plot">
      <span className="race-line hold" style={{ "--x": frac(signals.holdPercent) } as CSSProperties} aria-hidden="true"><em>Hold {signals.holdPercent.toFixed(2)}%</em></span>
      <span className="race-line bar" style={{ "--x": frac(signals.thresholdPercent) } as CSSProperties} aria-hidden="true"><em>To beat {signals.thresholdPercent.toFixed(2)}%</em></span>
      {order.map((row, index) => {
        const strategy = strategies.find((item) => item.id === row.id);
        const name = row.isHold ? "Hold" : strategy?.name ?? `#${row.id}`;
        const won = row.id === signals.winnerId;
        const width = row.percent === null ? "0%" : at(row.percent);
        return <div key={row.id} role="row" className={`race-row ${won ? "won" : ""} ${row.isHold ? "is-hold" : ""}`} style={{ "--c": `var(${agentVar(name)})`, "--d": `${index * 70}ms` } as CSSProperties}
          onMouseEnter={() => onHover?.(row.id)} onMouseLeave={() => onHover?.(null)}>
          <span role="cell" className="race-name"><AgentAvatar name={name} kind={row.isHold ? "hold" : "proposer"} size="sm" /><span><b>{name}</b>{!compact && strategy ? <small className="num">{strategy.allocationBps / 100}% ETH</small> : null}</span></span>
          <span role="cell" className="race-track"><i style={{ width: ready ? width : "0%" }} /></span>
          <span role="cell" className="race-val num">{row.percent === null ? "—" : `${row.percent.toFixed(3)}%`}{won ? <span className="race-flag">{row.isHold ? "Kept" : "Selected"}</span> : null}</span>
        </div>;
      })}
    </div>
    <div className="race-axis" aria-hidden="true"><span />{<span className="race-ticks">{ticks.map((tick) => <i key={tick} style={{ left: at(tick) }}>{tick}%</i>)}</span>}<span /></div>
  </div>;
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/**
 * Interactive illustration of how a measured return maps to LONG and SHORT settlement inside the round's payout
 * bounds: LONG settles at (factor − min) / (max − min), clamped to 0–100%, and SHORT at the rest.
 */
export function PayoutExplorer({ minFactor = 0.95, maxFactor = 1.05, measured, measuredLabel, title = "What a LONG is worth" }: { minFactor?: number; maxFactor?: number; measured?: number | null; measuredLabel?: string; title?: ReactNode }) {
  const id = useId();
  const pad = (maxFactor - minFactor) * 0.35;
  const lo = (minFactor - 1 - pad) * 100; const hi = (maxFactor - 1 + pad) * 100;
  const [ret, setRet] = useState(() => (typeof measured === "number" ? Math.max(lo, Math.min(hi, measured)) : 2));
  const pi = clamp01((1 + ret / 100 - minFactor) / (maxFactor - minFactor));
  const W = 520; const H = 200; const P = { l: 36, r: 12, t: 14, b: 26 };
  const x = (r: number) => P.l + ((r - lo) / (hi - lo)) * (W - P.l - P.r);
  const y = (v: number) => P.t + (1 - v) * (H - P.t - P.b);
  const xMin = x((minFactor - 1) * 100); const xMax = x((maxFactor - 1) * 100);
  const longPath = `M${x(lo)},${y(0)} L${xMin},${y(0)} L${xMax},${y(1)} L${x(hi)},${y(1)}`;
  const shortPath = `M${x(lo)},${y(1)} L${xMin},${y(1)} L${xMax},${y(0)} L${x(hi)},${y(0)}`;
  const credits = 100;
  const ticks = useMemo(() => { const out: number[] = []; for (let t = Math.ceil(lo); t <= Math.floor(hi); t += 1) if (t % 2 === 0 || hi - lo < 10) out.push(t); return out; }, [lo, hi]);
  return <div className="payout">
    <div className="payout-head">
      <div><h3>{title}</h3><p>Drag the measured return. LONG and SHORT always add up to 100% of a claim.</p></div>
      <div className="payout-read" aria-live="polite">
        <div className="long"><span>LONG settles at</span><b className="num">{(pi * 100).toFixed(1)}%</b></div>
        <div className="short"><span>SHORT settles at</span><b className="num">{((1 - pi) * 100).toFixed(1)}%</b></div>
      </div>
    </div>
    <svg className="payout-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={`${id}-cap`}>
      <rect x={xMin} y={P.t} width={xMax - xMin} height={H - P.t - P.b} className="payout-band" />
      {[0, 0.5, 1].map((v) => <g key={v}><line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} className="payout-grid" /><text x={P.l - 8} y={y(v) + 4} textAnchor="end" className="payout-tick">{v * 100}%</text></g>)}
      {ticks.map((t) => <text key={t} x={x(t)} y={H - 6} textAnchor="middle" className="payout-tick">{t > 0 ? "+" : ""}{t}%</text>)}
      <path d={shortPath} className="payout-short" />
      <path d={longPath} className="payout-long" />
      {typeof measured === "number" ? <g className="payout-measured"><line x1={x(measured)} x2={x(measured)} y1={P.t} y2={H - P.b} /><text x={x(measured) + 5} y={P.t + 10}>{measuredLabel ?? "Measured"}</text></g> : null}
      <line x1={x(ret)} x2={x(ret)} y1={P.t} y2={H - P.b} className="payout-cursor" />
      <circle cx={x(ret)} cy={y(pi)} r="5.5" className="payout-dot long" />
      <circle cx={x(ret)} cy={y(1 - pi)} r="5.5" className="payout-dot short" />
    </svg>
    <p id={`${id}-cap`} className="sr-only">Payout chart: LONG settles at 0% below a {((minFactor - 1) * 100).toFixed(0)}% return, rises linearly, and reaches 100% at +{((maxFactor - 1) * 100).toFixed(0)}%. SHORT is the mirror image.</p>
    <label className="payout-slider" htmlFor={`${id}-r`}>
      <span>Measured return <b className={`num ${ret > 0 ? "pos" : ret < 0 ? "neg" : ""}`}>{ret > 0 ? "+" : ret < 0 ? "−" : ""}{Math.abs(ret).toFixed(2)}%</b></span>
      <input id={`${id}-r`} type="range" min={lo} max={hi} step={0.05} value={ret} onChange={(event) => setRet(Number(event.target.value))}
        style={{ "--p": `${((ret - lo) / (hi - lo)) * 100}%` } as CSSProperties} />
    </label>
    <div className="payout-example">
      <span><b className="num">{credits}</b> LONG claims are worth <b className="num pos">{(credits * pi).toFixed(2)}</b> at settlement</span>
      <span><b className="num">{credits}</b> SHORT claims are worth <b className="num neg">{(credits * (1 - pi)).toFixed(2)}</b></span>
    </div>
  </div>;
}
