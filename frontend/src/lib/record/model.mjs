import { teeDisplay } from '../tee.mjs';
// Pure display logic for the Track record page, shared by the dashboard and `node --test`. No floats for money or
// returns. Missing or malformed values never become zero: they make the item unavailable instead.
import { AURORA_TESTNET, explorerUrl, formatUnits, isAddress, isIntegerString, isTxHash, safeText } from '../funding/model.mjs';

const SIGNED = /^(0|-?[1-9][0-9]{0,77})$/;
const CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const NAME = /^[A-Za-z][A-Za-z0-9]{0,31}$/;
const LABEL = /^round[0-9]{1,4}:[A-Za-z0-9:]{1,80}$/;
// A model id as the runtime allowlist accepts it (e.g. "anthropic/claude-haiku-5-5"); anything else is not shown.
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9_./:-]{0,119}$/;
export const agentModel = (value) => typeof value === 'string' && MODEL_ID.test(value) ? value : null;
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isTime = (value) => Number.isSafeInteger(value) && value > 0;
const MINUS = '−';

export const STALE_AFTER_SECONDS = 90;
export const isSignedInteger = (value) => typeof value === 'string' && SIGNED.test(value);

// "-1" -> "−1", "2" -> "+2", "0" -> "0". Anything that is not a signed integer string is null (shown as unavailable).
export function formatPoints(score) {
  if (!isSignedInteger(score)) return null;
  if (score === '0') return '0';
  return score.startsWith('-') ? `${MINUS}${score.slice(1)}` : `+${score}`;
}

// Signed base-unit amount (e.g. a profit/loss) with an explicit sign; null when malformed.
export function formatSignedUnits(raw, decimals) {
  if (!isSignedInteger(raw)) return null;
  const negative = raw.startsWith('-');
  const text = formatUnits(negative ? raw.slice(1) : raw, decimals);
  if (text === null) return null;
  return raw === '0' ? text : `${negative ? MINUS : '+'}${text}`;
}

// A return factor scaled by 1e18 (1e18 = flat) as a signed percentage with four decimals, rounded half away from zero.
export function formatReturnX18(x18) {
  if (!isIntegerString(x18)) return null;
  const diff = BigInt(x18) - 10n ** 18n;
  const scaled = diff * 10n ** 7n / 10n ** 18n; // percent with five decimals, truncated toward zero
  const magnitude = ((scaled < 0n ? -scaled : scaled) + 5n) / 10n;
  const text = `${magnitude / 10_000n}.${(magnitude % 10_000n).toString().padStart(4, '0')}%`;
  if (magnitude === 0n) return '0.0000%';
  return diff < 0n ? `${MINUS}${text}` : `+${text}`;
}

// ---------------------------------------------------------------- performance reputation

export function validateReputationBoard(input) {
  const reject = (error) => ({ ok: false, error });
  if (!isObject(input) || input.schemaVersion !== 1) return reject('The reputation response is missing or uses an unsupported schema.');
  if (input.network?.chainId !== AURORA_TESTNET) return reject('Performance reputation must come from Aurora testnet.');
  if (!Array.isArray(input.agents)) return reject('The reputation response lists no agents.');
  const agents = input.agents.filter(isObject).map((agent) => {
    const base = { name: typeof agent.name === 'string' && NAME.test(agent.name) ? agent.name : 'Unknown agent', address: isAddress(agent.address) ? agent.address.toLowerCase() : null };
    if (agent.status !== 'ok' || !isObject(agent.reputation)) {
      return { ...base, status: 'unavailable', code: typeof agent.code === 'string' && CODE.test(agent.code) ? agent.code : 'REPUTATION_UNAVAILABLE', reputation: null };
    }
    const r = agent.reputation;
    const counts = ['samples', 'positive', 'negative', 'flat', 'blockNumber', 'blockTimestamp'];
    // Shape only: the shared reader already validated network, code, bindings, freshness and arithmetic.
    if (!counts.every((key) => isIntegerString(r[key])) || !isSignedInteger(r.score) || (r.chainId !== undefined && r.chainId !== AURORA_TESTNET)) {
      return { ...base, status: 'unavailable', code: 'REPUTATION_INVALID_RESPONSE', reputation: null };
    }
    return { ...base, status: 'ok', code: null, reputation: {
      score: r.score, samples: r.samples, positive: r.positive, negative: r.negative, flat: r.flat,
      blockNumber: r.blockNumber, blockTimestamp: r.blockTimestamp, hasEvaluatedStrategies: r.samples !== '0',
    } };
  });
  const stack = isObject(input.stack) && ['original', 'tidepool'].includes(input.stack.id)
    ? { id: input.stack.id, label: safeText(input.stack.label, 60) ?? input.stack.id, engine: isAddress(input.stack.engine) ? input.stack.engine.toLowerCase() : null } : null;
  return { ok: true, board: {
    label: 'Outcome reputation', stack, contract: isAddress(input.contract) ? input.contract.toLowerCase() : null,
    observedAt: isTime(input.observedAt) ? input.observedAt : null, notCreditScore: input.notCreditScore === true, selectionWinsIncluded: false,
    status: ['ok', 'partial', 'unavailable'].includes(input.status) ? input.status : 'unavailable', agents,
  } };
}

// The last good snapshot goes stale when refreshes keep failing; settled history is still shown, labelled stale.
export function snapshotStale({ receivedAt, now }) {
  return isTime(receivedAt) && isTime(now) && now - receivedAt > STALE_AFTER_SECONDS;
}

export function reputationState(agent, { stale = false } = {}) {
  if (!agent) return 'loading';
  if (agent.status !== 'ok' || !agent.reputation) return agent.code === 'REPUTATION_STALE' ? 'stale' : 'unavailable';
  if (stale) return 'stale';
  return agent.reputation.hasEvaluatedStrategies ? 'scored' : 'no-history';
}

export const STATE_LABELS = Object.freeze({
  loading: 'Loading', unavailable: 'Unavailable', stale: 'Stale', 'no-history': 'No evaluated strategies', scored: 'Scored',
});

export const REPUTATION_CODE_TEXT = Object.freeze({
  REPUTATION_WRONG_NETWORK: 'The RPC did not report Aurora testnet.',
  REPUTATION_STALE: 'The latest block is older than the reader allows.',
  REPUTATION_CODE_MISMATCH: 'The contract code does not match the pinned deployment.',
  REPUTATION_BINDING_MISMATCH: 'The contract is bound to a different engine or tracker.',
  REPUTATION_INVALID_DATA: 'The on-chain counts and score were inconsistent.',
  REPUTATION_INVALID_RESPONSE: 'The API response was malformed.',
  REPUTATION_CONFIGURATION: 'The reputation reader is misconfigured.',
  REPUTATION_UNAVAILABLE: 'The Aurora testnet RPC could not be read.',
});
export function reputationCodeText(code) {
  return typeof code === 'string' && Object.hasOwn(REPUTATION_CODE_TEXT, code) ? REPUTATION_CODE_TEXT[code] : REPUTATION_CODE_TEXT.REPUTATION_UNAVAILABLE;
}

// ---------------------------------------------------------------- published testnet rounds

function proposal(item) {
  if (!isObject(item) || typeof item.id !== 'string' || !/^\d{1,3}$/.test(item.id) || typeof item.name !== 'string' || !NAME.test(item.name)
    || !Number.isSafeInteger(item.allocationBps) || item.allocationBps < 0 || item.allocationBps > 10_000) return null;
  const model = agentModel(item.model);
  return { id: item.id, name: item.name, allocationBps: item.allocationBps, rationale: safeText(item.rationale, 320) ?? '', ...(model ? { model } : {}) };
}

// ---------------------------------------------------------------- AI provenance

const SHA256 = /^[0-9a-f]{64}$/;
const PROVIDERS = ['near-ai', 'scripted'];
// TEE checks were added at round 9; earlier rounds can never be attested retroactively.
export const LAST_PRE_TEE_ROUND = 8;
const INVALID = Symbol('invalid provenance');

/**
 * Provenance of one actor in a saved round: which model answered (or that it was scripted), the operator's own hashes,
 * the on-chain propose transaction, and the TEE status. When the API sends provenance fields they must all be valid and
 * agree with the round's own transactions, or the round is rejected. An older API without them gives only what it knows.
 */
function actorProvenance(raw, { role, roundId, name, transactions, teeVerified, scriptedHint }) {
  const tee = teeVerified ? 'verified' : Number(roundId) <= LAST_PRE_TEE_ROUND ? 'before-tee' : 'not-attested';
  if (raw.provider === undefined) {
    if (scriptedHint) return { status: 'scripted', model: null, provider: 'scripted', inputHash: null, outputHash: null, proposeTx: null, proposeTxUrl: null, tee };
    const model = agentModel(raw.model);
    return { status: model ? 'model' : 'unknown', model, provider: null, inputHash: null, outputHash: null, proposeTx: null, proposeTxUrl: null, tee };
  }
  if (!PROVIDERS.includes(raw.provider) || typeof raw.scripted !== 'boolean' || raw.scripted !== (raw.provider === 'scripted')) return INVALID;
  if (raw.scripted ? raw.model !== null : agentModel(raw.model) === null) return INVALID;
  if (typeof raw.inputHash !== 'string' || !SHA256.test(raw.inputHash) || typeof raw.outputHash !== 'string' || !SHA256.test(raw.outputHash)) return INVALID;
  let proposeTx = null;
  if (role === 'proposer') {
    if (!isTxHash(raw.proposeTx)) return INVALID;
    proposeTx = raw.proposeTx.toLowerCase();
    const label = `round${roundId}:propose:${name}`;
    if (!transactions.some((t) => t.label === label && t.transactionHash === proposeTx)) return INVALID;
  } else if (raw.proposeTx !== undefined) return INVALID;
  return { status: raw.scripted ? 'scripted' : 'model', model: raw.scripted ? null : raw.model, provider: raw.provider, inputHash: raw.inputHash, outputHash: raw.outputHash,
    proposeTx, proposeTxUrl: proposeTx ? explorerUrl(AURORA_TESTNET, 'tx', proposeTx) : null, tee };
}

// Where the round's plan.json lives in the public repository, from the evidence directory the API names.
export const GITHUB_REPO_BLOB = 'https://github.com/WaveFund/wavefund-near/blob/main/';
const EVIDENCE_DIR = /^docs\/test-evidence\/[a-z0-9-]{1,40}(\/round[1-9][0-9]{0,3})?$/;
export const evidencePlanUrl = (source) => typeof source === 'string' && EVIDENCE_DIR.test(source) ? `${GITHUB_REPO_BLOB}${source}/plan.json` : null;

const SLUG = /^1313161555-0x[0-9a-f]{40}-\d{1,6}$/;
function round(item) {
  if (!isObject(item) || typeof item.roundId !== 'string' || !/^\d{1,6}$/.test(item.roundId) || !isObject(item.winner)) return null;
  // A round without a valid network + engine identity is not shown: "Round 1" alone is ambiguous across engines.
  if (typeof item.slug !== 'string' || !SLUG.test(item.slug) || !item.slug.endsWith(`-${item.roundId}`) || !isObject(item.stack) || !isAddress(item.stack.engine)
    || item.slug !== `1313161555-${item.stack.engine.toLowerCase()}-${item.roundId}` || !['original', 'tidepool'].includes(item.stack.id)) return null;
  const proposals = (Array.isArray(item.proposals) ? item.proposals : []).map(proposal);
  if (!proposals.length || proposals.includes(null)) return null;
  const winner = proposals.find((p) => p.id === item.winner.proposalId);
  if (!winner) return null;
  const rawForecasters = (Array.isArray(item.forecasters) ? item.forecasters : []).filter(isObject);
  const forecasters = rawForecasters.map((f) => ({
    name: typeof f.name === 'string' && NAME.test(f.name) ? f.name : 'Forecaster',
    action: f.action === 'abstain' ? 'abstain' : f.action === 'buy' && ['long', 'short'].includes(f.side) ? 'buy' : 'unknown',
    side: f.side === 'long' || f.side === 'short' ? f.side : null,
    proposalId: typeof f.proposalId === 'string' && /^\d{1,3}$/.test(f.proposalId) ? f.proposalId : null,
    reason: safeText(f.reason, 200), scripted: f.scripted === true,
    credits: isIntegerString(f.credits) ? f.credits : null,
    ...(agentModel(f.model) ? { model: f.model } : {}),
  }));
  // Distinct per-agent models; 0 for single-model rounds whose evidence names no per-agent model.
  const models = new Set([...proposals, ...forecasters].map((agent) => agent.model).filter(Boolean)).size;
  const payouts = (Array.isArray(item.payouts) ? item.payouts : []).filter(isObject).map((p) => ({
    name: typeof p.name === 'string' && NAME.test(p.name) ? p.name : 'Forecaster',
    deposit: isIntegerString(p.deposit) ? p.deposit : null, payout: isIntegerString(p.payout) ? p.payout : null, profitLoss: isSignedInteger(p.profitLoss) ? p.profitLoss : null,
    external: p.external === true,
  }));
  const transactions = (Array.isArray(item.transactions) ? item.transactions : []).filter((t) => isObject(t) && typeof t.label === 'string' && LABEL.test(t.label) && isTxHash(t.transactionHash) && isIntegerString(t.blockNumber))
    .map((t) => ({ label: t.label, transactionHash: t.transactionHash.toLowerCase(), blockNumber: t.blockNumber, url: explorerUrl(AURORA_TESTNET, 'tx', t.transactionHash) }));
  // Per-actor provenance, checked against the round's own transactions and TEE proofs.
  const tee = (Array.isArray(item.tee) ? item.tee : []).filter(t => Number(item.roundId) > LAST_PRE_TEE_ROUND && proposals.some(p => p.id !== '0' && p.id === t?.proposalId && p.name === t.name) && teeDisplay(t).verified);
  const rawProposals = item.proposals;
  for (const [index, p] of proposals.entries()) {
    if (p.id === '0') continue;
    const provenance = actorProvenance(rawProposals[index], { role: 'proposer', roundId: item.roundId, name: p.name, transactions, teeVerified: tee.some((t) => t.proposalId === p.id), scriptedHint: false });
    if (provenance === INVALID) return null;
    p.provenance = provenance;
  }
  for (const [index, f] of forecasters.entries()) {
    const provenance = actorProvenance(rawForecasters[index], { role: 'forecaster', roundId: item.roundId, name: f.name, transactions, teeVerified: false, scriptedHint: f.scripted });
    if (provenance === INVALID || (provenance.provider !== null && provenance.status !== 'unknown' && f.scripted !== (provenance.status === 'scripted'))) return null;
    f.provenance = provenance;
  }
  const nonHold = proposals.filter((p) => p.id !== '0');
  const swap = isObject(item.swap) && isTxHash(item.swap.transactionHash) ? {
    transactionHash: item.swap.transactionHash.toLowerCase(), url: explorerUrl(AURORA_TESTNET, 'tx', item.swap.transactionHash),
    stableDelta: isSignedInteger(item.swap.stableDelta) ? item.swap.stableDelta : null, assetDelta: isSignedInteger(item.swap.assetDelta) ? item.swap.assetDelta : null,
    independentlyChecked: item.swap.independentlyChecked === true,
    slippageBps: Number.isSafeInteger(item.swap.slippageBps) && item.swap.slippageBps >= 0 && item.swap.slippageBps <= 10_000 ? item.swap.slippageBps : null,
  } : null;
  const reputation = isObject(item.reputation) && isAddress(item.reputation.agent) && isSignedInteger(item.reputation.score) && isTxHash(item.reputation.transactionHash) ? {
    agent: item.reputation.agent.toLowerCase(), score: item.reputation.score, transactionHash: item.reputation.transactionHash.toLowerCase(),
    url: explorerUrl(AURORA_TESTNET, 'tx', item.reputation.transactionHash),
  } : null;
  const checks = isObject(item.checks) ? item.checks : {};
  // The round's own terms. Bounds must straddle a flat return and the window must run forward, or no terms are shown.
  const m = isObject(item.market) ? item.market : null;
  const market = m && isObject(m.returnBounds) && [m.tradingStart, m.tradingEnd, m.evaluationEnd, m.twapWindowSeconds, m.returnBounds.minX18, m.returnBounds.maxX18, m.longPayoutX18].every(isIntegerString)
    && BigInt(m.tradingStart) < BigInt(m.tradingEnd) && BigInt(m.tradingEnd) < BigInt(m.evaluationEnd) && BigInt(m.returnBounds.minX18) < 10n ** 18n && BigInt(m.returnBounds.maxX18) > 10n ** 18n && BigInt(m.longPayoutX18) <= 10n ** 18n
    ? { tradingStart: m.tradingStart, tradingEnd: m.tradingEnd, evaluationEnd: m.evaluationEnd, twapWindowSeconds: m.twapWindowSeconds, returnBounds: { minX18: m.returnBounds.minX18, maxX18: m.returnBounds.maxX18 }, longPayoutX18: m.longPayoutX18 } : null;
  const collateral = isObject(item.collateral) && isIntegerString(item.collateral.atCollapse) && isIntegerString(item.collateral.ending) && isIntegerString(item.collateral.seed)
    ? { atCollapse: item.collateral.atCollapse, ending: item.collateral.ending, seed: item.collateral.seed } : null;
  return {
    slug: item.slug, roundId: item.roundId, collateral,
    totals: isObject(item.totals) && isIntegerString(item.totals.deposits) && isIntegerString(item.totals.paid) ? { deposits: item.totals.deposits, paid: item.totals.paid } : { deposits: null, paid: null },
    stack: { id: item.stack.id, label: safeText(item.stack.label, 60) ?? item.stack.id, engine: item.stack.engine.toLowerCase(), safe: isAddress(item.stack.safe) ? item.stack.safe.toLowerCase() : null, reputation: isAddress(item.stack.reputation) ? item.stack.reputation.toLowerCase() : null },
    evidence: item.evidence === 'saved-independently-verified' ? 'saved-independently-verified' : 'unlabelled',
    title: safeText(item.title, 120) ?? `Round ${item.roundId}`, date: safeText(item.date, 20), kind: safeText(item.kind, 80),
    genuineModelCalls: Number.isSafeInteger(item.genuineModelCalls) ? item.genuineModelCalls : null,
    scriptedForecasters: Number.isSafeInteger(item.scriptedForecasters) ? item.scriptedForecasters : null,
    model: safeText(item.model, 80), models, tee, source: typeof item.source === 'string' && EVIDENCE_DIR.test(item.source) ? item.source : null, evidenceUrl: evidencePlanUrl(item.source),
    // Every non-Hold proposal, and only those, carries its own verified TEE proof: n proofs for n proposals, n distinct ids.
    attestationVerified: Number(item.roundId) > LAST_PRE_TEE_ROUND && item.attestationVerified === true && nonHold.length > 0 && Array.isArray(item.tee) && item.tee.length === nonHold.length
      && new Set(item.tee.map(t => t?.proposalId)).size === nonHold.length && item.tee.every(t => nonHold.some(p => p.id === t?.proposalId && p.name === t.name) && teeDisplay(t).verified),
    proposals, winner: { ...winner, isHold: winner.id === '0' }, forecasters, swap, market,
    realisedReturnX18: isIntegerString(item.realisedReturnX18) ? item.realisedReturnX18 : null,
    payouts, transactions, droppedTransactions: (Array.isArray(item.transactions) ? item.transactions.length : 0) - transactions.length, reputation,
    checks: { independentPassed: checks.independentPassed === true, returnRecomputed: checks.returnRecomputed === true, payoutsRecomputed: checks.payoutsRecomputed === true, swapChecked: checks.swapChecked === true ? true : checks.swapChecked === false ? false : null },
    scope: safeText(item.scope, 400), correction: safeText(item.correction, 400),
    limitations: (Array.isArray(item.limitations) ? item.limitations : []).map((text) => safeText(text, 240)).filter(Boolean),
  };
}

export function validateRoundEvidence(input) {
  if (!isObject(input) || ![1, 2].includes(input.schemaVersion) || input.network?.chainId !== AURORA_TESTNET || !Array.isArray(input.rounds)) {
    return { ok: false, error: 'The testnet round evidence is missing or is not from Aurora testnet.' };
  }
  const rounds = input.rounds.map(round).filter(Boolean);
  if (!rounds.length) return { ok: false, error: 'No valid testnet round evidence was returned.' };
  if (new Set(rounds.map((item) => item.slug)).size !== rounds.length) return { ok: false, error: 'Two rounds share one network + engine + round id.' };
  return { ok: true, rounds };
}

// Finds a round by its network + engine + round slug. A bare round number is accepted only when exactly one round has it.
export function findRound(rounds, param) {
  if (!Array.isArray(rounds) || typeof param !== 'string') return { round: null, ambiguous: false };
  const bySlug = rounds.find((item) => item.slug === param.toLowerCase());
  if (bySlug) return { round: bySlug, ambiguous: false };
  if (!/^\d{1,6}$/.test(param)) return { round: null, ambiguous: false };
  const matches = rounds.filter((item) => item.roundId === param);
  return matches.length === 1 ? { round: matches[0], ambiguous: false } : { round: null, ambiguous: matches.length > 1 };
}

// Exact decimal for an x18 return factor, e.g. "0.993541889635073190" (no rounding).
export function exactFactorX18(x18) {
  if (!isIntegerString(x18)) return null;
  const value = BigInt(x18); const whole = value / 10n ** 18n; const fraction = (value % 10n ** 18n).toString().padStart(18, '0');
  return `${whole}.${fraction}`;
}
