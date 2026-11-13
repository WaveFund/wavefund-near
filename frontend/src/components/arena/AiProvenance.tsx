"use client";
import { useState, type MouseEvent } from "react";
import { Drawer } from "@/components/v2";
import { Icon } from "@/components/funding/primitives";
import type { RoundForecaster, RoundProposal, TestnetRound } from "@/lib/record/model.mjs";
import { provenanceLine, recordProofView, TEE_TIPS } from "@/lib/record/provenance.mjs";
import { CopyButton, ProofColumns, ProofTitle, TeeProofDrawer, useHighlight } from "./TeeStatus";

type Agent = RoundProposal | RoundForecaster;
const stop = (event: MouseEvent) => event.stopPropagation();

/**
 * Which model made this output and what is proven about it, on one line:
 * `model · NEAR AI · ◆ TEE verified | Not TEE-attested | Before TEE checks · Proof ›`, or `Scripted test actor · no model call`.
 * The wrapper stops clicks so a Proof inside a clickable card never also opens the card.
 */
export function AiProvenance({ round, agent, role, unknownNote }: { round: TestnetRound | null; agent: Agent | null | undefined; role: "proposer" | "forecaster"; unknownNote?: string }) {
  const [open, setOpen] = useState(false);
  const line = provenanceLine(agent?.provenance);
  if (line.kind === "unknown") return <span className="aiprov is-unknown" onClick={stop} title={unknownNote}>{line.text}</span>;
  if (line.kind === "scripted") return <span className="aiprov is-scripted" onClick={stop} title="A deterministic test fixture, not an LLM. Its bets only exercise code branches.">{line.text}</span>;
  const tee = line.tee ?? "not-attested";
  return <span className="aiprov" onClick={stop}>
    <span className="aiprov-model" title={line.fullModel ?? undefined}>{line.model}</span>
    {line.provider ? <><i aria-hidden="true">·</i><span>{line.provider}</span></> : null}
    <span className="aiprov-status"><span className={`aiprov-tee is-${tee}`} title={TEE_TIPS[tee]}>{tee === "verified" ? "◆ " : ""}{line.teeLabel}</span>
    {line.proof ? <><i aria-hidden="true">·</i><button type="button" className="aiprov-proof" onClick={() => setOpen(true)} aria-label={`Proof for ${agent?.name ?? "this agent"}`}>Proof ›</button></> : null}</span>
    {line.proof === "tee" && round && agent && "id" in agent
      ? <TeeProofDrawer open={open} onClose={() => setOpen(false)} round={round.roundId} proof={round.tee.find((t) => t.proposalId === agent.id)} />
      : line.proof === "record" ? <RecordProofDrawer open={open} onClose={() => setOpen(false)} round={round} agent={agent ?? null} role={role} /> : null}
  </span>;
}

/** Proof of a model call that was not checked inside an enclave: what the saved record shows, and what it does not prove. */
function RecordProofDrawer({ round, agent, role, open, onClose }: { round: TestnetRound | null; agent: Agent | null; role: "proposer" | "forecaster"; open: boolean; onClose: () => void }) {
  const { active, mark, reset } = useHighlight();
  const view = recordProofView(round, agent, role);
  if (!view) return null;
  return <Drawer open={open} onClose={() => { onClose(); reset(); }} title={<ProofTitle title={view.title} sub="Saved operator record" />}>
    <ProofColumns json={view.json} rows={view.rows} truncated={view.truncated} active={active}>
      <h3>What this record shows</h3>
      <ul className="tee-claims aiprov-claims">{view.claims.map((c) => <li key={c.id} tabIndex={0} className="tone-plain" {...mark(c.keys)}>
        <span className="aiprov-claim-label">{c.label}</span>
        <span className={c.mono ? "mono aiprov-claim-value" : "aiprov-claim-value"}>{c.href ? <a href={c.href} target="_blank" rel="noreferrer">{c.value} <Icon name="external" /></a> : c.value}</span>
        {c.copy ? <span className="tee-actions"><CopyButton text={c.copy} label="Copy" /></span> : null}
      </li>)}</ul>
      <h3>Does not prove</h3>
      <ul className="tee-not">{view.notProven.map((t) => <li key={t}>{t}</li>)}</ul>
      {view.evidenceUrl ? <ul className="stack tee-links"><li><a href={view.evidenceUrl} target="_blank" rel="noreferrer">Evidence file on GitHub <Icon name="external" /></a></li></ul> : null}
    </ProofColumns>
  </Drawer>;
}
