"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/funding/primitives";
import { ThemeToggle } from "@/components/ThemeToggle";

/** Where the page's data comes from. Always visible, never louder than the content. */
export type ShellSource = { label: string; tone: "mainnet" | "testnet" | "local" | "fixture" | "none"; detail?: string | null; status?: "ok" | "warn" | "off" | "pending" };

const NAV: Array<{ href: string; label: string; icon: IconName; match: (path: string) => boolean }> = [
  { href: "/", label: "Home", icon: "spark", match: (path) => path === "/" },
  { href: "/safe", label: "My Safe", icon: "safe", match: (path) => path.startsWith("/safe") },
  { href: "/arena", label: "Arena", icon: "chart", match: (path) => path.startsWith("/arena") || path.startsWith("/rounds") },
  { href: "/agents", label: "Agents", icon: "users", match: (path) => path.startsWith("/agents") },
  { href: "/demo", label: "Demo", icon: "play", match: (path) => path.startsWith("/demo") },
];

export function WaveMark() {
  return <svg aria-hidden="true" viewBox="0 0 28 28" fill="none"><rect width="28" height="28" rx="7" fill="currentColor" /><path d="M5.5 16.5c2.6 0 2.6-5 5.2-5s2.6 6 5.2 6 2.6-5 6.6-5" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" /></svg>;
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
            return <Link key={item.href} href={item.href} className={active ? "active" : undefined} aria-current={active ? "page" : undefined}><Icon name={item.icon} />{item.label}</Link>;
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
      <div className="footer-inner">
        <span>Wavefund · manager-owned Safes, AI-proposed strategies, market-selected execution on Aurora.</span>
        <span>Test assets only · sending and signing are disabled in this dashboard</span>
      </div>
    </footer>
  </div>;
}
