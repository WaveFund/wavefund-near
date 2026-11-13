"use client";
import { useState } from "react";
import { Drawer, Cap, Tip } from "@/components/v2";
import { Icon } from "@/components/funding/primitives";
import { proofView } from "@/lib/tee-proof-view.mjs";
import type { TeeProof } from "@/lib/tee.mjs";

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return <button type="button" className="btn btn-sm" onClick={() => { navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }).catch(() => {}); }}>{done ? "Copied" : label}</button>;
}

export function TeeStatus({ proof, round }: { proof?: TeeProof; round?: string }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string[]>([]);
  const view = proofView(proof, round);
  if (!view.verified) return <span className="muted">Not verified <Tip label="About hardware attestation">Attestation must be captured before the model call; old rounds cannot be verified retroactively.</Tip></span>;
  const mark = (keys: string[]) => ({ onMouseEnter: () => setActive(keys), onFocus: () => setActive(keys), onMouseLeave: () => setActive([]), onBlur: () => setActive([]) });
  return <>
    <span className="tee-row"><Cap tone="ai" icon="shield">TEE verified</Cap><button type="button" className="btn btn-sm" onClick={() => setOpen(true)}>Proof ›</button></span>
    <Drawer open={open} onClose={() => { setOpen(false); setActive([]); }} title={<span className="tee-title"><span className="eyebrow ai"><span className="pip" />PROOF</span><span>{view.title}</span>{view.verifiedAt ? <small className="muted">{view.verifiedAt}</small> : null}</span>}>
      <div className="tee-proof">
        <section className="tee-left" aria-label="What this proves">
          <h3>What this proves</h3>
          <ul className="tee-claims">{view.claims.map(c => <li key={c.id} tabIndex={0} className={`tone-${c.tone}`} {...mark(c.keys)}><span className="tee-mark">{c.tone === "ai" ? "◆" : "✓"}</span>{c.text}</li>)}</ul>
          <details className="tee-checks-all"><summary>All {view.checks.length} checks ({view.headline.toLowerCase()})</summary>
            <ul className="stack tee-checks">{view.checks.map(c => <li key={c.key} tabIndex={0} {...mark([c.key])}><b><span className={c.ok ? "tee-ok" : "tee-bad"}>{c.ok ? "✓" : "✗"}</span> {c.key === "proposalBound" ? "Bound to the on-chain proposal" : c.label}</b><p>{c.detail}</p></li>)}</ul>
          </details>
          <h3>Not verified</h3>
          <ul className="tee-not">{view.notVerified.map(t => <li key={t}>{t}</li>)}</ul>
          {view.trustBasis ? <p className="muted">Trust basis: <span className="mono">{view.trustBasis}</span></p> : null}
          <ul className="stack tee-links">
            {view.evidenceUrl ? <li><a href={view.evidenceUrl} target="_blank" rel="noreferrer">Evidence file on GitHub <Icon name="external" /></a></li> : null}
            {view.txUrl ? <li><a href={view.txUrl} target="_blank" rel="noreferrer">Proposal transaction on Aurora testnet <Icon name="external" /></a></li> : null}
          </ul>
          {view.command ? <div className="stack"><p className="muted">Recheck offline, no key or network:</p><code className="tee-cmd">{view.command}</code><div className="tee-actions"><CopyButton text={view.command} label="Copy command" /></div></div> : null}
        </section>
        <section className="tee-right" aria-label="Raw record">
          <div className="tee-rawhead"><h3>Raw record · JSON</h3><CopyButton text={view.json} label="Copy" /></div>
          <pre className="tee-json" tabIndex={0}>{view.rows.map(r => <span key={r.n} className={`tee-line${r.key && active.includes(r.key) ? " hl" : ""}`}><i>{r.n}</i>{r.text}{"\n"}</span>)}</pre>
          {view.truncated ? <p className="muted tee-foot">Long values are shortened here; Copy and the GitHub file have them in full.</p> : null}
        </section>
      </div>
    </Drawer>
  </>;
}
