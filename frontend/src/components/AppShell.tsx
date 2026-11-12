"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/funding/primitives";

export type ShellNetwork = { label: string; chainId: number | null; tone: "mainnet" | "testnet" | "local" };
export type ShellStatus = { label: string; tone: "ok" | "warn" | "off" | "pending" };

const NAV: Array<{ href: string; label: string; step: string; icon: IconName; hint: string }> = [
  { href: "/fund", label: "Fund", step: "01", icon: "fund", hint: "Fund your Trading Safe through NEAR Intents" },
  { href: "/", label: "Decide", step: "02", icon: "chart", hint: "Proposals, forecasts, execution and settlement" },
  { href: "/manager", label: "Manage", step: "03", icon: "sliders", hint: "Owner-reviewed Safe actions" },
  { href: "/record", label: "Record", step: "04", icon: "trophy", hint: "Performance reputation and published testnet rounds" },
];

export function WaveMark() {
  return <svg aria-hidden="true" viewBox="0 0 32 32" fill="none"><path d="M3 19c4 0 4-8 8-8s4 12 8 12 4-10 10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>;
}

/** App frame shared by every page: journey tabs, network truth and connection state are always visible. */
export function AppShell({ network, status, children }: { network: ShellNetwork; status?: ShellStatus; children: ReactNode }) {
  const path = usePathname() ?? "/";
  const isActive = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  const links = (className: string) => NAV.map((item) => {
    const active = isActive(item.href);
    return <Link key={item.href} href={item.href} title={item.hint} className={active ? `${className} active` : className} aria-current={active ? "page" : undefined}>
      <Icon name={item.icon} /><span>{item.label}</span><span className="tab-step">{item.step}</span>
    </Link>;
  });
  return <div className="app">
    <div className="bg-ambient" aria-hidden="true" />
    <header className="topbar">
      <div className="topbar-inner">
        <Link className="brand" href="/" aria-label="Wavefund home"><span className="brand-mark"><WaveMark /></span><span className="brand-name">wavefund</span><small>on Aurora</small></Link>
        <nav className="tabs" aria-label="Wavefund journey">{links("tab")}</nav>
        <div className="topbar-right">
          <span className="chip-network" title={network.chainId === null ? "No network" : `Chain ID ${network.chainId}`}><i className={`chain-dot ${network.tone}`} />{network.label}{network.chainId === null ? null : <code>{network.chainId}</code>}</span>
          {status && <span className={`chip-status tone-${status.tone}`} role="status"><i />{status.label}</span>}
        </div>
      </div>
    </header>
    <main className="page">{children}</main>
    <footer className="site-footer">
      <div className="footer-inner">
        <span className="brand footer-brand"><span className="brand-mark small"><WaveMark /></span>wavefund</span>
        <p>Manager-owned Trading Safes, AI strategy proposals and forecasting markets on Aurora, funded through NEAR Intents. Test assets on testnet and local chains; funding sends are disabled pending review.</p>
        <span className="footer-tag">OWNER CONTROL · MARKET CONVICTION</span>
      </div>
    </footer>
    <nav className="bottom-tabs" aria-label="Wavefund journey, mobile">{links("bottom-tab")}</nav>
  </div>;
}
