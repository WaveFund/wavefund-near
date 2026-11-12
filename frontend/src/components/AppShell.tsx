"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Icon } from "@/components/funding/primitives";
import { ThemeToggle } from "@/components/ThemeToggle";

/** Where the page's data comes from. Always visible, never louder than the content. */
export type ShellSource = { label: string; tone: "mainnet" | "testnet" | "local" | "fixture" | "none"; detail?: string | null; status?: "ok" | "warn" | "off" | "pending" };

const NAV: Array<{ href: string; label: string; match: (path: string) => boolean }> = [
  { href: "/", label: "Home", match: (path) => path === "/" },
  { href: "/safe", label: "My Safe", match: (path) => path.startsWith("/safe") },
  { href: "/arena", label: "Arena", match: (path) => path.startsWith("/arena") || path.startsWith("/rounds") },
  { href: "/agents", label: "Agents", match: (path) => path.startsWith("/agents") },
  { href: "/demo", label: "Demo", match: (path) => path.startsWith("/demo") },
];

export function WaveMark() {
  return <svg aria-hidden="true" viewBox="0 0 28 28" fill="none"><rect x="1" y="1" width="26" height="26" rx="7" stroke="currentColor" strokeOpacity=".4" strokeWidth="1.5" /><path d="M6 16c2.4 0 2.4-4.6 4.8-4.6s2.4 5.6 4.8 5.6 2.4-4.6 6.4-4.6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function AppShell({ source, children }: { source?: ShellSource; children: ReactNode }) {
  const path = usePathname() ?? "/";
  const dot = source ? (source.status ?? (source.tone === "fixture" ? "local" : source.tone === "none" ? "off" : source.tone)) : null;
  return <div className="app">
    <header className="header">
      <div className="header-inner">
        <Link className="brand" href="/" aria-label="Wavefund home"><WaveMark />Wavefund</Link>
        <nav className="nav" aria-label="Sections">
          {NAV.map((item) => {
            const active = item.match(path);
            return <Link key={item.href} href={item.href} className={active ? "active" : undefined} aria-current={active ? "page" : undefined}>{item.label}</Link>;
          })}
        </nav>
        <div className="header-right">
          {source ? <span className="source-chip" role="status" title={source.detail ?? undefined}><i className={`dot ${dot}`} />{source.label}{source.detail ? <small>{source.detail}</small> : null}</span> : null}
          <div className="header-tools">
            <ThemeToggle />
            <Link href="/advanced" className={`icon-link ${path.startsWith("/advanced") ? "active" : ""}`} aria-label="Advanced owner tools" title="Advanced owner tools"><Icon name="sliders" /></Link>
          </div>
        </div>
      </div>
    </header>
    <main className="main">{children}</main>
    <footer className="footer">
      <div className="footer-field" aria-hidden="true"><span className="dither" /><span className="dither dense" /></div>
      <div className="footer-inner">
        <Link className="brand" href="/" aria-label="Wavefund home"><WaveMark />Wavefund</Link>
        <span>Manager-owned Safes, AI-proposed strategies, market-selected execution on Aurora.</span>
        <span className="footer-meta"><span>Test assets only</span><span>Sending and signing disabled</span></span>
      </div>
    </footer>
  </div>;
}
