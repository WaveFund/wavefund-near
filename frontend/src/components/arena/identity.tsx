"use client";

import type { CSSProperties } from "react";

const AGENT_VARS: Record<string, string> = {
  hold: "--a-hold", conservative: "--a-conservative", balanced: "--a-balanced", momentum: "--a-momentum", highbeta: "--a-highbeta",
  quant: "--a-quant", guardian: "--a-guardian", feeanalyst: "--a-fee", stressanalyst: "--a-stress",
};
/** Each agent keeps one colour everywhere; unknown names get a stable fallback. */
export function agentVar(name: string): string {
  const key = name.toLowerCase().replace(/[^a-z]/g, "");
  if (AGENT_VARS[key]) return AGENT_VARS[key];
  let sum = 0; for (const char of key) sum = (sum + char.charCodeAt(0)) % 4;
  return `--a-x${sum + 1}`;
}

/** Proposer agents are tiles, forecasters are round, and Hold is a dashed "keep" mark. */
export function AgentAvatar({ name, kind = "proposer", size }: { name: string; kind?: "proposer" | "forecaster" | "hold"; size?: "sm" | "lg" }) {
  if (kind === "hold" || name === "Hold") {
    return <span className={`av hold ${size ?? ""}`} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 9.5h12M6 14.5h12" /></svg></span>;
  }
  return <span className={`av ${kind === "forecaster" ? "round" : ""} ${size ?? ""}`} style={{ "--av": `var(${agentVar(name)})` } as CSSProperties} aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>;
}

