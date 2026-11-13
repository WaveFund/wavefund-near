"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "@/components/funding/primitives";
import { ThemeToggle } from "@/components/ThemeToggle";
import { localAvailability } from "@/lib/arena/capabilities.mjs";
import { apiUrl, decodeState, type DemoState } from "@/lib/state";

/** Where the page's data comes from. Shown once, in the header's context selector. */
export type ShellSource = { label: string; tone: "mainnet" | "testnet" | "local" | "fixture" | "none"; detail?: string | null; status?: "ok" | "warn" | "off" | "pending" };

const NAV: Array<{ href: string; label: string; match: (path: string) => boolean }> = [
  { href: "/rounds", label: "Rounds", match: (path) => path.startsWith("/rounds") },
  { href: "/portfolio", label: "Portfolio", match: (path) => path.startsWith("/portfolio") },
  { href: "/agents", label: "Agents", match: (path) => path.startsWith("/agents") },
];

/** Corner brackets around three rising bars: two mint (money), the tallest violet (AI). */
export function WaveMark() {
  return <svg aria-hidden="true" viewBox="0 0 28 28" fill="none">
    <path d="M2 8V4a2 2 0 0 1 2-2h4M20 2h4a2 2 0 0 1 2 2v4M26 20v4a2 2 0 0 1-2 2h-4M8 26H4a2 2 0 0 1-2-2v-4" stroke="currentColor" strokeOpacity=".45" strokeWidth="1.5" strokeLinecap="round" />
    <rect x="7.5" y="14" width="3.4" height="7" rx="1.7" fill="var(--accent)" /><rect x="12.3" y="10.5" width="3.4" height="10.5" rx="1.7" fill="var(--accent)" /><rect x="17.1" y="7" width="3.4" height="14" rx="1.7" fill="var(--ai)" />
  </svg>;
}

/** Which data the screens show. Reads the backend once, only when opened, and never polls. */
function ContextSelector({ source }: { source?: ShellSource }) {
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<{ state: DemoState | null; loading: boolean; error: string | null }>({ state: null, loading: true, error: null });
  useEffect(() => {
    if (!open || !snapshot.loading) return;
    let active = true;
    fetch(apiUrl("/api/state"), { cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(5000) })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error("unavailable"); return decodeState(body); })
      .then((state) => { if (active) setSnapshot({ state, loading: false, error: null }); }, () => { if (active) setSnapshot({ state: null, loading: false, error: "unavailable" }); });
    return () => { active = false; };
  }, [open, snapshot.loading]);
  const local = localAvailability(snapshot.state, snapshot);
  const dot = source ? (source.status ?? (source.tone === "fixture" ? "local" : source.tone === "none" ? "off" : source.tone)) : "testnet";
  return <details className="context" open={open} onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)}>
    <summary aria-label="Data context"><i className={`dot ${dot}`} /><span className="context-label">{source?.label ?? "Testnet history"}{source?.detail ? <span className="subtle"> · {source.detail}</span> : null}</span><Icon name="chevron" /></summary>
    <div className="context-menu" role="menu">
      <Link role="menuitem" href="/rounds" onClick={() => setOpen(false)}><i className="dot testnet" /><span><b>Completed testnet run</b><small>Saved Aurora testnet rounds with real receipts</small></span></Link>
      {local.available
        ? <Link role="menuitem" href="/rounds/local" onClick={() => setOpen(false)}><i className="dot local" /><span><b>Local simulation</b><small>{local.reason}</small></span></Link>
        : <span className="off" role="menuitem" aria-disabled="true"><i className="dot off" /><span><b>Local simulation · unavailable</b><small>{local.reason}</small></span></span>}
      <hr />
      <Link role="menuitem" href="/portfolio/fund" onClick={() => setOpen(false)}><i className="dot mainnet" /><span><b>Funding preview</b><small>Official mainnet dry quotes only. Sending is disabled</small></span></Link>
    </div>
  </details>;
}

export function AppShell({ source, children, home = false }: { source?: ShellSource; children: ReactNode; home?: boolean }) {
  const path = usePathname() ?? "/";
  return <div className="app">
    <div className={`ambient ${home ? "home" : ""}`} aria-hidden="true"><div className="aurora" /><div className="halftone" /></div>
    <header className="header">
      <div className="header-inner">
        <Link className="brand" href="/" aria-label="Wavefund home"><WaveMark /><span className="brand-word">Wavefund<small>on Aurora · NEAR</small></span></Link>
        <nav className="nav" aria-label="Sections">
          {NAV.map((item) => {
            const active = item.match(path);
            return <Link key={item.href} href={item.href} className={active ? "active" : undefined} aria-current={active ? "page" : undefined}>{item.label}</Link>;
          })}
        </nav>
        <div className="header-right">
          <Link className="btn btn-sm btn-primary wallet-cta" href="/rounds/live#wallet"><Icon name="wallet" />Connect wallet</Link>
          <ContextSelector source={source} />
          <div className="header-tools">
            <ThemeToggle />
            <Link href="/advanced" className={`icon-link ${path.startsWith("/advanced") ? "active" : ""}`} aria-label="Advanced owner tools" title="Advanced owner tools"><Icon name="sliders" /></Link>
          </div>
        </div>
      </div>
    </header>
    <main className="main">{children}</main>
    <footer className="footer">
      <div className="footer-inner">
        <span className="footer-meta"><span>Test assets only</span><span>The app holds no keys · your wallet signs</span></span>
        <span className="footer-meta"><ThemeToggle /><span><i className="dot testnet" /> Aurora testnet · 1313161555</span></span>
      </div>
    </footer>
  </div>;
}
