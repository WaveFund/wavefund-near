// Pure presentation of an actor's AI provenance (which model made an output, and what is proven about it). Shared by
// the AiProvenance component and `node --test`. Input is the validated projection from model.mjs; nothing here
// upgrades a claim: "TEE verified" only comes from a proposal whose proof teeDisplay already verified.
import { jsonRows } from '../tee-proof-view.mjs';
import { LAST_PRE_TEE_ROUND } from './model.mjs';

export const TEE_LABELS = Object.freeze({ verified: 'TEE verified', 'not-attested': 'Not TEE-attested', 'before-tee': 'Before TEE checks' });
export const TEE_TIPS = Object.freeze({
  verified: 'The NEAR AI answer was checked inside a verified enclave (Intel TDX + NVIDIA GPU attestation, signed response) before it was submitted.',
  'not-attested': 'This model was called through NEAR AI without hardware attestation, so the answer was not checked inside an enclave.',
  'before-tee': `TEE checks were added after round ${LAST_PRE_TEE_ROUND}. Attestation must be captured at call time, so this round can never be attested retroactively.`,
});
export const PROVIDER_LABELS = Object.freeze({ 'near-ai': 'NEAR AI', scripted: 'Scripted' });
export const SCRIPTED_TEXT = 'Scripted test actor · no model call';
export const UNKNOWN_TEXT = 'Model not recorded';

/** "Qwen/Qwen3.6-35B-A3B-FP8" -> "Qwen3.6-35B-A3B-FP8"; the full id stays available as a title. */
export function shortModel(id) {
  if (typeof id !== 'string' || !id) return null;
  const tail = id.slice(id.lastIndexOf('/') + 1);
  return tail || id;
}

/**
 * The inline line for one actor. `proof` is 'tee' (open the existing TEE proof), 'record' (open the record drawer)
 * or null (no Proof link: scripted, unknown, or nothing recorded to show).
 */
export function provenanceLine(prov) {
  if (!prov || prov.status === 'unknown') return { kind: 'unknown', text: UNKNOWN_TEXT, model: null, fullModel: null, provider: null, tee: null, teeLabel: null, proof: null };
  if (prov.status === 'scripted') return { kind: 'scripted', text: SCRIPTED_TEXT, model: null, fullModel: null, provider: PROVIDER_LABELS.scripted, tee: null, teeLabel: null, proof: null };
  const proof = prov.tee === 'verified' ? 'tee' : prov.inputHash && prov.outputHash ? 'record' : null;
  const provider = prov.provider ? PROVIDER_LABELS[prov.provider] ?? null : null;
  const teeLabel = TEE_LABELS[prov.tee] ?? null;
  const model = shortModel(prov.model);
  return { kind: 'model', text: [model, provider, teeLabel].filter(Boolean).join(' · '), model, fullModel: prov.model, provider, tee: prov.tee, teeLabel, proof };
}

/** What a non-TEE record does not prove. The first item depends on why there is no enclave check. */
export function doesNotProve(tee) {
  return [
    tee === 'before-tee' ? `That the answer came from an enclave: the round ran before TEE checks (added after round ${LAST_PRE_TEE_ROUND}) and cannot be attested retroactively.`
      : 'That the answer came from an enclave: it was not checked by hardware attestation.',
    'That the hashes are independent: they are the operator\'s own record of the request and response.',
    'Which model really answered: the model id is the provider\'s claim.',
    'That the output is a good forecast or investment.',
  ];
}

const MODEL_LIMITATION = /\b(model|scripted|attest|TEE|fixture)/i;

/**
 * Everything the record proof drawer renders for one actor in a saved round. `agent` is a validated proposal or
 * forecaster; `role` is 'proposer' or 'forecaster'. The JSON is the agent's public record only: no prompt text.
 */
export function recordProofView(round, agent, role) {
  const prov = agent?.provenance ?? null;
  if (!round || !prov || prov.status !== 'model') return null;
  const decision = role === 'proposer'
    ? { allocationBps: agent.allocationBps, rationale: agent.rationale || null }
    : { action: agent.action, ...(agent.side ? { side: agent.side } : {}), ...(agent.proposalId ? { proposalId: agent.proposalId } : {}), ...(agent.credits ? { credits: agent.credits } : {}), ...(agent.reason ? { reason: agent.reason } : {}) };
  const record = {
    round: round.roundId, stack: round.stack.label, role, name: agent.name, ...(role === 'proposer' ? { proposalId: agent.id } : {}),
    provider: prov.provider, model: prov.model, scripted: false, teeStatus: prov.tee,
    inputHash: prov.inputHash, outputHash: prov.outputHash, ...(prov.proposeTx ? { proposeTx: prov.proposeTx } : {}), decision,
  };
  const json = JSON.stringify(record, null, 2);
  const limitation = round.limitations.find((item) => MODEL_LIMITATION.test(item)) ?? null;
  const claims = [
    { id: 'model', label: 'Model', value: prov.model ?? 'not recorded', mono: true, keys: ['model', 'name', 'role'] },
    { id: 'provider', label: 'Provider', value: prov.provider ? PROVIDER_LABELS[prov.provider] : 'not recorded', keys: ['provider'] },
    { id: 'tee', label: 'Hardware attestation', value: TEE_LABELS[prov.tee], keys: ['teeStatus'] },
    { id: 'input', label: 'Input hash (sha256)', value: prov.inputHash ?? 'not recorded', mono: true, copy: prov.inputHash, keys: ['inputHash'] },
    { id: 'output', label: 'Output hash (sha256)', value: prov.outputHash ?? 'not recorded', mono: true, copy: prov.outputHash, keys: ['outputHash'] },
    ...(role === 'proposer' ? [{ id: 'tx', label: 'Propose transaction', value: prov.proposeTx ?? 'not recorded', mono: true, href: prov.proposeTxUrl, keys: ['proposeTx', 'proposalId'] }] : []),
    { id: 'round', label: 'Round', value: [round.kind, limitation].filter(Boolean).join(' — ') || `Round ${round.roundId}`, keys: ['round', 'stack'] },
  ];
  return {
    title: `${agent.name} · ${role === 'proposer' ? `proposal #${agent.id}` : 'forecaster'} · round ${round.roundId}`,
    claims, notProven: doesNotProve(prov.tee), json, ...jsonRows(json), evidenceUrl: round.evidenceUrl ?? null,
  };
}

/** Distinct models and the TEE position of a whole saved round, for its header caps and facts. */
export function roundProvenance(round) {
  const actors = [...round.proposals.filter((p) => p.id !== '0'), ...round.forecasters];
  const models = [...new Set(actors.map((a) => a.provenance?.status === 'model' ? a.provenance.model : null).filter(Boolean))];
  const challengers = round.proposals.filter((p) => p.id !== '0');
  const verified = challengers.filter((p) => p.provenance?.tee === 'verified').length;
  const tee = Number(round.roundId) <= LAST_PRE_TEE_ROUND ? 'before-tee' : round.attestationVerified ? 'verified' : verified > 0 ? 'partial' : 'not-attested';
  return { models, verified, challengers: challengers.length, tee };
}

/**
 * The saved Tidepool round that is the same round the live monitor shows, or null. It must have the same round id and
 * the same challengers (id, name and allocation); otherwise the live page shows provenance as unknown, never borrowed.
 */
export function savedRoundForLive(rounds, roundId, proposals) {
  if (!Array.isArray(rounds) || typeof roundId !== 'string' || !Array.isArray(proposals)) return null;
  const round = rounds.find((item) => item.stack.id === 'tidepool' && item.roundId === roundId);
  if (!round) return null;
  const live = proposals.filter((p) => p.id !== '0');
  const same = live.length > 0 && live.length === round.proposals.filter((p) => p.id !== '0').length
    && live.every((p) => round.proposals.some((s) => s.id === p.id && s.name === p.name && s.allocationBps === p.allocationBps));
  return same ? round : null;
}
