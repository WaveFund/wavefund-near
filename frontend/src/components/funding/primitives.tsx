"use client";

import { useEffect, useState, type ReactNode } from "react";
import { explorerUrl, formatDuration, formatUnits, isAddress, shortHex } from "@/lib/funding/model.mjs";

export type IconName = "wallet" | "intents" | "aurora" | "safe" | "check" | "cross" | "lock" | "alert" | "arrow" | "copy" | "external" | "refund" | "clock" | "shield" | "spark" | "eye"
  | "fund" | "chart" | "sliders" | "down" | "bolt" | "receipt" | "users" | "trophy" | "pulse" | "route" | "play" | "chevron" | "download" | "layers" | "sun" | "moon" | "search" | "book" | "grid";

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const PATHS: Record<IconName, ReactNode> = {
  wallet: <><rect x="3" y="6" width="18" height="13" rx="2.5" {...stroke} /><path d="M15.5 12.5h3M3 9.5h15V7a2 2 0 0 0-2-2H6" {...stroke} /></>,
  intents: <><circle cx="9" cy="12" r="5" {...stroke} /><circle cx="15" cy="12" r="5" {...stroke} /></>,
  aurora: <path d="M3 18.5 9.5 6.5l3.6 6.6L15.4 9l5.6 9.5H3Z" {...stroke} />,
  safe: <><rect x="3.5" y="4" width="17" height="14.5" rx="2.5" {...stroke} /><circle cx="12" cy="11.2" r="3.2" {...stroke} /><path d="M12 8V6.8M12 15.6v-1.2M7 18.5V20M17 18.5V20" {...stroke} /></>,
  check: <path d="m5 12.5 4.2 4L19 7" {...stroke} />,
  cross: <path d="m7 7 10 10M17 7 7 17" {...stroke} />,
  lock: <><rect x="5" y="10.5" width="14" height="9.5" rx="2" {...stroke} /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" {...stroke} /></>,
  alert: <><path d="M12 4 2.8 19.5h18.4L12 4Z" {...stroke} /><path d="M12 10v4.5M12 17.2v.1" {...stroke} /></>,
  arrow: <path d="M4 12h15m-5-5 5 5-5 5" {...stroke} />,
  copy: <><rect x="8" y="8" width="11" height="11" rx="2" {...stroke} /><path d="M16 8V6.5A1.5 1.5 0 0 0 14.5 5h-8A1.5 1.5 0 0 0 5 6.5v8A1.5 1.5 0 0 0 6.5 16H8" {...stroke} /></>,
  external: <path d="M14 5h5v5M19 5l-8 8M17 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4" {...stroke} />,
  refund: <path d="M10 8 6 12l4 4M6 12h8.5a4 4 0 0 0 0-8H13" {...stroke} />,
  clock: <><circle cx="12" cy="12" r="8.5" {...stroke} /><path d="M12 7.5V12l3 2" {...stroke} /></>,
  shield: <path d="M12 3.5 5 6.5v5c0 4.3 3 7.6 7 9 4-1.4 7-4.7 7-9v-5l-7-3Z" {...stroke} />,
  spark: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" {...stroke} />,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" {...stroke} /><circle cx="12" cy="12" r="2.8" {...stroke} /></>,
  fund: <><path d="M12 3.5v10m-4-4 4 4 4-4" {...stroke} /><path d="M4 14.5v3A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5v-3" {...stroke} /></>,
  chart: <><path d="M4 19.5h16" {...stroke} /><path d="M7 16V11M12 16V6M17 16v-7" {...stroke} /></>,
  sliders: <><path d="M5 6.5h8M17 6.5h2M5 12h2M11 12h8M5 17.5h10M19 17.5h0" {...stroke} /><circle cx="15" cy="6.5" r="2" {...stroke} /><circle cx="9" cy="12" r="2" {...stroke} /><circle cx="17" cy="17.5" r="2" {...stroke} /></>,
  down: <path d="M12 5v14m-6-6 6 6 6-6" {...stroke} />,
  bolt: <path d="M13 3 5 13.5h6L10 21l8-10.5h-6L13 3Z" {...stroke} />,
  receipt: <><path d="M6 3.5h12v17l-3-2-3 2-3-2-3 2v-17Z" {...stroke} /><path d="M9 8.5h6M9 12h6" {...stroke} /></>,
  users: <><circle cx="9" cy="8.5" r="3.2" {...stroke} /><path d="M3.5 19c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5M15.5 5.6a3.2 3.2 0 0 1 0 5.8M17.5 14.8c1.6.6 2.6 2 3 4.2" {...stroke} /></>,
  trophy: <><path d="M8 4h8v5a4 4 0 0 1-8 0V4ZM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v3.5M8.5 20h7M10 16.5h4V20h-4z" {...stroke} /></>,
  pulse: <path d="M3 12h4l2.5-6 4 12 2.5-6H21" {...stroke} />,
  route: <><circle cx="6" cy="18" r="2.2" {...stroke} /><circle cx="18" cy="6" r="2.2" {...stroke} /><path d="M8 18h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7" {...stroke} /></>,
  play: <path d="M8 5.5v13l10.5-6.5L8 5.5Z" {...stroke} />,
  chevron: <path d="m9 6 6 6-6 6" {...stroke} />,
  download: <><path d="M12 4v11m-4.5-4.5L12 15l4.5-4.5" {...stroke} /><path d="M5 19.5h14" {...stroke} /></>,
  layers: <><path d="m12 4 8.5 4.5L12 13 3.5 8.5 12 4Z" {...stroke} /><path d="m3.5 13 8.5 4.5 8.5-4.5" {...stroke} /></>,
  sun: <><circle cx="12" cy="12" r="4" {...stroke} /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" {...stroke} /></>,
  moon: <path d="M20 14.6A8.2 8.2 0 0 1 9.4 4a8.2 8.2 0 1 0 10.6 10.6Z" {...stroke} />,
  search: <><circle cx="11" cy="11" r="6.5" {...stroke} /><path d="m16 16 4.5 4.5" {...stroke} /></>,
  book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5v-15Z" {...stroke} /><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5" {...stroke} /></>,
  grid: <><rect x="4" y="4" width="6.5" height="6.5" rx="1.5" {...stroke} /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" {...stroke} /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" {...stroke} /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" {...stroke} /></>,
};

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" className={className}>{PATHS[name]}</svg>;
}

export type PillTone = "neutral" | "live" | "fixture" | "warning" | "danger" | "success" | "muted" | "violet";
export function Pill({ tone = "neutral", children, title }: { tone?: PillTone; children: ReactNode; title?: string }) {
  return <span className={`pill pill-${tone}`} title={title}>{children}</span>;
}

export function CopyText({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { setCopied(false); }
  }
  return <button type="button" className="copy-text" onClick={() => void copy()} title={value} aria-label={`Copy ${label ?? "value"} ${value}`}>
    <code>{/^0x[0-9a-fA-F]+$/.test(value) ? shortHex(value) : /^[a-z0-9]+:.{9,}$/.test(value) ? `${value.split(":")[0]}:${value.split(":")[1].slice(0, 4)}\u2026${value.slice(-4)}` : value.length > 14 ? `${value.slice(0, 6)}\u2026${value.slice(-4)}` : value}</code><Icon name={copied ? "check" : "copy"} />
  </button>;
}

// Links only to allowlisted network explorers, and only when the evidence is live.
export function ExplorerLink({ chainId, kind, value, enabled }: { chainId: number | null | undefined; kind: "tx" | "address"; value: string | null | undefined; enabled: boolean }) {
  const href = enabled ? explorerUrl(chainId, kind, value) : null;
  if (!href) return null;
  return <a className="explorer-link" href={href} target="_blank" rel="noopener noreferrer" title="Open in the network's block explorer"><Icon name="external" /><span className="sr-only">Open in block explorer</span></a>;
}

export function Address({ value, chainId, label, live }: { value: string | null | undefined; chainId?: number | null; label?: string; live: boolean }) {
  if (!isAddress(value)) return <span className="unavailable">Unavailable</span>;
  return <span className="address-inline"><CopyText value={value.toLowerCase()} label={label} /><ExplorerLink chainId={chainId} kind="address" value={value} enabled={live} /></span>;
}

export function Amount({ raw, decimals, symbol, maxFraction }: { raw: string | null | undefined; decimals: number | null | undefined; symbol?: string | null; maxFraction?: number }) {
  const text = formatUnits(raw, decimals, maxFraction === undefined ? undefined : { maxFraction });
  if (text === null) return <span className="amount unavailable">Unavailable</span>;
  return <span className="amount">{text}{symbol ? <small>{symbol}</small> : null}</span>;
}

/** Whole-second clock that starts after hydration (0 until then) so server and client markup match. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Math.floor(Date.now() / 1000));
    tick();
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function CountdownRing({ expiresAt, total, now }: { expiresAt: number; total: number; now: number }) {
  const remaining = now ? Math.max(0, expiresAt - now) : total;
  const fraction = total > 0 ? Math.min(1, remaining / total) : 0;
  const radius = 18; const circumference = 2 * Math.PI * radius;
  const label = now ? formatDuration(remaining) : "—";
  return <div className={`countdown ${now && remaining === 0 ? "expired" : remaining < 60 ? "low" : ""}`} role="timer" aria-label={`Quote expires in ${label}`}>
    <svg viewBox="0 0 44 44"><circle cx="22" cy="22" r={radius} className="track" /><circle cx="22" cy="22" r={radius} className="value" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - fraction)} /></svg>
    <span>{label}</span>
  </div>;
}

export function identiconStyle(address: string): { background: string } {
  const hex = address.replace(/^0x/i, "").padEnd(12, "0");
  const first = parseInt(hex.slice(0, 4), 16) % 360; const second = parseInt(hex.slice(4, 8), 16) % 360; const angle = parseInt(hex.slice(8, 10), 16) % 180;
  return { background: `linear-gradient(${angle}deg, hsl(${first} 55% 58%), hsl(${second} 50% 32%))` };
}
