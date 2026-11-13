"use client";
import { DrawerButton, Cap, Tip } from "@/components/v2";
import { teeDisplay, type TeeProof } from "@/lib/tee.mjs";
export function TeeStatus({ proof }: { proof?: TeeProof }) {
  const view = teeDisplay(proof);
  return view.verified ? <DrawerButton label={<Cap tone="ai">TEE verified</Cap>} title="What was verified" icon="shield">
    <ul className="stack">{view.checks.map(c => <li key={c.key}><b>{c.ok ? "✓" : "✗"} {c.label}</b><p>{c.detail}</p></li>)}</ul>
    <p className="muted">Model: {view.model}. Verification does not prove investment quality, a specific serving instance, TLS binding or independently audited source provenance.</p>
  </DrawerButton> : <span className="muted">Not verified <Tip label="About hardware attestation">Attestation must be captured before the model call; old rounds cannot be verified retroactively.</Tip></span>;
}
