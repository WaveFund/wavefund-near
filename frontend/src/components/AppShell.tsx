"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Icon } from "@/components/funding/primitives";
import { ThemeToggle } from "@/components/ThemeToggle";
import { CommandPalette, useCommandPalette } from "@/components/CommandPalette";
import { localAvailability } from "@/lib/arena/capabilities.mjs";
import { apiUrl, decodeState, type DemoState } from "@/lib/state";
import { STATIC_DATA } from "@/lib/record/static-data";

/** Where the page's data comes from. Shown once, in the header's context selector. */
export type ShellSource = { label: string; tone: "mainnet" | "testnet" | "local" | "fixture" | "none"; detail?: string | null; status?: "ok" | "warn" | "off" | "pending" };

const NAV: Array<{ href: string; label: string; match: (path: string) => boolean }> = [
  { href: "/rounds", label: "Rounds", match: (path) => path.startsWith("/rounds") },
  { href: "/agents", label: "Agents", match: (path) => path.startsWith("/agents") },
  { href: "/portfolio", label: "Portfolio", match: (path) => path.startsWith("/portfolio") },
];

/** Corner brackets around three rising bars: two in the brand colour (capital), the tallest violet (AI). */
export function WaveMark() {
  return <svg aria-hidden="true" viewBox="0 0 28 28" fill="none">
    <path d="M2 8V4a2 2 0 0 1 2-2h4M20 2h4a2 2 0 0 1 2 2v4M26 20v4a2 2 0 0 1-2 2h-4M8 26H4a2 2 0 0 1-2-2v-4" stroke="currentColor" strokeOpacity=".4" strokeWidth="1.6" strokeLinecap="round" />
    <rect x="7.5" y="14" width="3.4" height="7" rx="1.7" fill="var(--brand)" /><rect x="12.3" y="10.5" width="3.4" height="10.5" rx="1.7" fill="var(--brand)" /><rect x="17.1" y="7" width="3.4" height="14" rx="1.7" fill="var(--ai)" />
  </svg>;
}

/** Which data the screens show. Reads the backend once, only when opened, and never polls. */
function ContextSelector({ source }: { source?: ShellSource }) {
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<{ state: DemoState | null; loading: boolean; error: string | null }>({ state: null, loading: true, error: null });
  useEffect(() => {
    if (STATIC_DATA || !open || !snapshot.loading) return;
    let active = true;
    fetch(apiUrl("/api/state"), { cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(5000) })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error("unavailable"); return decodeState(body); })
      .then((state) => { if (active) setSnapshot({ state, loading: false, error: null }); }, () => { if (active) setSnapshot({ state: null, loading: false, error: "unavailable" }); });
    return () => { active = false; };
  }, [open, snapshot.loading]);
  // Close on outside click or Escape, like any menu.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => { if (!(event.target as HTMLElement).closest?.(".context")) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const local = localAvailability(snapshot.state, snapshot);
  const dot = source ? (source.status ?? (source.tone === "fixture" ? "local" : source.tone === "none" ? "off" : source.tone)) : "testnet";
  return <details className="context" open={open} onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)}>
    <summary aria-label={`Data source: ${source?.label ?? "Aurora testnet"}${source?.detail ? `, ${source.detail}` : ""}`}><i className={`dot ${dot}`} /><span className="context-label">{source?.label ?? "Aurora testnet"}{source?.detail ? <span className="subtle"> · {source.detail}</span> : null}</span><Icon name="chevron" /></summary>
    <div className="context-menu" role="menu">
      <Link role="menuitem" href="/rounds" onClick={() => setOpen(false)}><i className="dot testnet" /><span><b>Completed testnet rounds</b><small>Saved Aurora testnet rounds with real receipts</small></span></Link>
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
  const { open: paletteOpen, setOpen: setPaletteOpen } = useCommandPalette();
  const close = useCallback(() => setPaletteOpen(false), [setPaletteOpen]);
  const links = NAV.map((item) => {
    const active = item.match(path);
    return <Link key={item.href} href={item.href} className={active ? "active" : undefined} aria-current={active ? "page" : undefined}>{item.label}</Link>;
  });
  return <div className="app">
    <div className={`ambient ${home ? "home" : ""}`} aria-hidden="true"><div className="aurora" /><div className="halftone" /></div>
    <header className="header">
      <div className="header-inner">
        <Link className="brand" href="/" aria-label="Wavefund home"><WaveMark /><span className="brand-word">Wavefund<small>on NEAR · Aurora</small></span></Link>
        <nav className="nav" aria-label="Sections">{links}</nav>
        <div className="header-right">
          <button type="button" className="search-trigger" onClick={() => setPaletteOpen(true)} aria-label="Search pages and rounds (Ctrl K)"><Icon name="search" /><span>Search…</span><kbd>⌘K</kbd></button>
          <ContextSelector source={source} />
          <div className="header-tools">
            <ThemeToggle />
            {!STATIC_DATA && <Link href="/advanced" className={`icon-link ${path.startsWith("/advanced") ? "active" : ""}`} aria-label="Advanced owner tools" title="Advanced owner tools"><Icon name="sliders" /></Link>}
          </div>
          <Link className="btn btn-sm btn-primary wallet-cta" href={STATIC_DATA ? "/rounds" : "/rounds/live#wallet"}><Icon name="wallet" /><span className="wallet-word">{STATIC_DATA ? "Explore rounds" : "Connect wallet"}</span><span className="sr-only">{STATIC_DATA ? "" : " (opens the live round's wallet panel)"}</span></Link>
        </div>
      </div>
      <nav className="nav-row" aria-label="Sections">{links}</nav>
    </header>
    <main className="main" id="main">{children}</main>
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <Link className="brand" href="/" aria-label="Wavefund home"><WaveMark /><span>Wavefund</span></Link>
          <p>AI agents propose strategies, forecasters back or doubt them, and a manager-controlled Safe executes the winner within its limits.</p>
        </div>
        <nav className="footer-col" aria-label="Product"><h4>Product</h4>
          <Link href="/rounds">Rounds</Link>{!STATIC_DATA ? <Link href="/rounds/live">Live round</Link> : null}<Link href="/agents">Agents</Link><Link href="/portfolio">Portfolio</Link><Link href="/portfolio/fund">Funding preview</Link></nav>
        <nav className="footer-col" aria-label="Get started"><h4>Get started</h4>
          <Link href="/start/manager">As a manager</Link><Link href="/start/forecaster">As a forecaster</Link><Link href="/start/observer">Just looking</Link></nav>
        <nav className="footer-col" aria-label="Verify"><h4>Verify</h4>
          <a href="https://explorer.testnet.aurora.dev/address/0xba96A117f4dE33C38df72002651F11024ED14a14" target="_blank" rel="noreferrer">Round engine<Icon name="external" /></a>
          <a href="https://github.com/WaveFund/wavefund-near" target="_blank" rel="noreferrer">Source code<Icon name="external" /></a>
          <a href="https://github.com/WaveFund/wavefund-near#judge-path-live-testnet-evidence" target="_blank" rel="noreferrer">Judge check<Icon name="external" /></a></nav>
        <div className="footer-meta"><span><i className="dot testnet" />Aurora testnet · chain 1313161555 · test assets only, not financial advice</span><span><ThemeToggle /><span>Press <kbd>⌘K</kbd> to search</span></span></div>
      </div>
    </footer>
    <CommandPalette open={paletteOpen} onClose={close} />
  </div>;
}
