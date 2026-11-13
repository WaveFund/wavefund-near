// Pure helpers for the TEE proof viewer. Presentation of an already backend-verified public projection.
import { teeDisplay, TEE_CHECKS } from './tee.mjs';

const HASH = /^0x[0-9a-fA-F]{64}$/;
const ROUND = /^[1-9][0-9]{0,3}$/;
// Never shown, at any depth. Public NVIDIA claims (e.g. gpuTokenSha256, eat_nonce) do not match.
const SECRET_KEY = /^(api[-_]?key|apikey|key|token|access[-_]?token|auth[-_]?token|id[-_]?token|bearer|authorization|auth|headers?|cookies?|set-cookie|secret|password|passwd|private[-_]?key|credentials?)$/i;
const MAX_DEPTH = 8;

export const GITHUB_EVIDENCE_BASE = 'https://github.com/WaveFund/wavefund-near/blob/main/docs/test-evidence/tidepool-rounds';
export const EXPLORER_TX_BASE = 'https://explorer.testnet.aurora.dev/tx/';

export function isSecretKey(key) { return SECRET_KEY.test(String(key)); }

/** Deep copy of JSON-safe data with every secret-looking key removed. */
export function sanitizeProof(value, depth = 0) {
  if (depth > MAX_DEPTH) return undefined;
  if (Array.isArray(value)) return value.map(v => sanitizeProof(v, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) if (!isSecretKey(k) && typeof v !== 'function') out[k] = sanitizeProof(v, depth + 1);
    return out;
  }
  return typeof value === 'bigint' ? value.toString() : value;
}

export function explorerTxUrl(hash) { return typeof hash === 'string' && HASH.test(hash) ? EXPLORER_TX_BASE + hash.toLowerCase() : null; }
export function evidenceFileUrl(round, file = 'plan.json') {
  return ROUND.test(String(round)) && /^[a-z0-9-]+\.json$/.test(file) ? `${GITHUB_EVIDENCE_BASE}/round${round}/${file}` : null;
}
export function recheckCommand(round) {
  return ROUND.test(String(round)) ? `node scripts/verify-tee.mjs ${round} --policy <reviewed-public-policy.json>` : null;
}

const MAX_VALUE = 40;
/** Explicit, always-visible limits. Wording follows docs/TEE-VERIFICATION.md. */
export const NOT_VERIFIED = Object.freeze([
  'Measurements are pinned from NEAR AI\'s own live attestation; they are not independently reproduced.',
  'That the same serving instance handled every request.',
  'TLS channel binding between us and the model.',
  'Reproducible image or source provenance.',
  'That the proposal is a good investment.',
]);
const shorten = (v) => v.length > MAX_VALUE ? `${v.slice(0, 20)}…${v.slice(-14)}` : v;

/** Line-numbered view of pretty JSON. Long string values are shortened for display only; `key` is the JSON key on that line. */
export function jsonRows(json) {
  let truncated = false;
  const rows = String(json).split('\n').map((line, i) => {
    const key = /^\s*"([^"]+)":/.exec(line)?.[1] ?? null;
    const text = line.replace(/"((?:[^"\\]|\\.)*)"(?=,?$)/g, (m, inner) => { if (inner.length <= MAX_VALUE) return m; truncated = true; return `"${shorten(inner)}"`; });
    return { n: i + 1, text, key };
  });
  return { rows, truncated };
}

/** "What this proves" rows; `keys` are the JSON keys they highlight. Only built for a verified proof. */
export function proofClaims(view, proof) {
  if (!view.verified) return [];
  return [
    { id: 'model', tone: 'plain', text: `Proposed by ${proof.name} using ${view.model}`, keys: ['name', 'model', 'proposalId'] },
    { id: 'ai', tone: 'ai', text: 'Written by the attested model: the signature covers the exact request and response', keys: ['signatureKind', 'signatureValid', 'signerMatchesAttestation', 'requestSha256', 'responseSha256'] },
    { id: 'tee', tone: 'ok', text: 'Ran inside a verified TEE: Intel TDX quote, NVIDIA GPU, fresh nonce, measurements in policy', keys: ['verified', 'trustBasis', ...TEE_CHECKS.map(c => c[0]).filter(k => !['signatureValid', 'signerMatchesAttestation'].includes(k))] },
    { id: 'bound', tone: 'ok', text: `Bound to the on-chain proposal${view.txUrl ? ' transaction' : ''}`, keys: ['proposalBound', 'transactionHash'] },
  ];
}

/** Everything the drawer renders, derived from the proof; `verified` is never true unless teeDisplay says so. */
export function proofView(proof, round) {
  const display = teeDisplay(proof);
  const verified = display.verified && display.checks.every(c => c.ok);
  const publicProof = sanitizeProof(proof) ?? {};
  const json = JSON.stringify(publicProof, null, 2);
  const at = proof?.privacy?.verificationTime;
  const view = {
    verified, model: display.model,
    checks: display.checks,
    trustBasis: typeof proof?.trustBasis === 'string' ? proof.trustBasis : null,
    json, ...jsonRows(json),
    title: `Proposal #${String(proof?.proposalId ?? '?').slice(0, 4)} · ${typeof proof?.name === 'string' ? proof.name.slice(0, 40) : 'unknown'} · round ${ROUND.test(String(round)) ? round : '?'}`,
    verifiedAt: Number.isSafeInteger(at) && at > 1e9 && at < 4e9 ? new Date(at * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : null,
    txUrl: explorerTxUrl(proof?.transactionHash),
    evidenceUrl: evidenceFileUrl(round),
    command: recheckCommand(round),
    notVerified: NOT_VERIFIED,
    headline: verified ? 'Every check passed' : `${display.checks.filter(c => !c.ok).length} check(s) did not pass`,
  };
  view.claims = proofClaims(view, proof);
  return view;
}
