"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/funding/primitives";
import { ThemeToggle } from "@/components/ThemeToggle";

export type ShellNetwork = { label: string; chainId: number | null; tone: "mainnet" | "testnet" | "local" };
export type ShellStatus = { label: string; tone: "ok" | "warn" | "off" | "pending" };

const NAV: Array<{ href: string; label: string; icon: IconName; match: (path: string) => boolean }> = [
  { href: "/", label: "Rounds", icon: "chart", match: (path) => path === "/" || path.startsWith("/rounds") },
  { href: "/record", label: "Agents", icon: "users", match: (path) => path.startsWith("/record") },
  { href: "/fund", label: "Treasury", icon: "safe", match: (path) => path.startsWith("/fund") },
  { href: "/manager", label: "Admin", icon: "sliders", match: (path) => path.startsWith("/manager") },
];

export function WaveMark() {
  return <svg aria-hidden="true" viewBox="0 0 28 28" fill="none"><rect width="28" height="28" rx="7" fill="currentColor" /><path d="M5.5 16.5c2.6 0 2.6-5 5.2-5s2.6 6 5.2 6 2.6-5 6.6-5" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" /></svg>;
}

/** App frame shared by every page: section navigation, the network in use and the connection state. */
export function AppShell({ network, status, children }: { network: ShellNetwork; status?: ShellStatus; children: ReactNode }) {
  const path = usePathname() ?? "/";
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
          {status ? <span className="conn-status" role="status"><i className={`dot ${status.tone}`} />{status.label}</span> : null}
          <span className="network-chip" title={network.chainId === null ? "No network" : `Chain ID ${network.chainId}`}><i className={`dot ${network.tone}`} />{network.label}{network.chainId === null ? null : <code>{network.chainId}</code>}</span>
          <ThemeToggle />
        </div>
      </div>
    </header>
    <main className="main">{children}</main>
    <footer className="footer">
      <div className="footer-inner">
        <span>Wavefund · manager-owned Trading Safes with market-selected AI strategies on Aurora.</span>
        <span>Test assets on testnet and local chains · deposits disabled pending review</span>
      </div>
    </footer>
  </div>;
}
