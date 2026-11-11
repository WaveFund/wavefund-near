"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/fund", index: "01", label: "Fund", hint: "Fund the Safe via NEAR Intents" },
  { href: "/", index: "02", label: "Decide", hint: "Proposals, forecasts and execution" },
  { href: "/manager", index: "03", label: "Manage", hint: "Owner-reviewed Safe actions" },
] as const;

export function WaveMark() {
  return <svg aria-hidden="true" viewBox="0 0 32 32" fill="none"><path d="M3 19c4 0 4-8 8-8s4 12 8 12 4-10 10-10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" /></svg>;
}

export function Brand() {
  return <Link className="brand" href="/" aria-label="Wavefund home"><span className="brand-mark"><WaveMark /></span><span>wavefund<span className="brand-period">.</span></span></Link>;
}

/** The product journey: funding comes before decisions; owner controls sit alongside. */
export function JourneyNav() {
  const path = usePathname() ?? "/";
  return <nav className="journey-nav" aria-label="Wavefund journey">
    {ITEMS.map((item) => {
      const active = item.href === "/" ? path === "/" : path.startsWith(item.href);
      return <Link key={item.href} href={item.href} title={item.hint} className={active ? "active" : undefined} aria-current={active ? "page" : undefined}>
        <span>{item.index}</span>{item.label}
      </Link>;
    })}
  </nav>;
}
