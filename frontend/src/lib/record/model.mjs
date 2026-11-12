// Pure display logic for the Track record page, shared by the dashboard and `node --test`. No floats for money or
// returns. Missing or malformed values never become zero: they make the item unavailable instead.
import { AURORA_TESTNET, explorerUrl, formatUnits, isAddress, isIntegerString, isTxHash, safeText } from '../funding/model.mjs';

const SIGNED = /^(0|-?[1-9][0-9]{0,77})$/;
const CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const NAME = /^[A-Za-z][A-Za-z0-9]{0,31}$/;
const LABEL = /^round[0-9]{1,4}:[A-Za-z0-9:]{1,80}$/;
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
  return { ok: true, board: {
    label: 'Performance reputation', contract: isAddress(input.contract) ? input.contract.toLowerCase() : null,
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
  return { id: item.id, name: item.name, allocationBps: item.allocationBps, rationale: safeText(item.rationale, 320) ?? '' };
}

function round(item) {
  if (!isObject(item) || typeof item.roundId !== 'string' || !/^\d{1,6}$/.test(item.roundId) || !isObject(item.winner)) return null;
  const proposals = (Array.isArray(item.proposals) ? item.proposals : []).map(proposal);
  if (!proposals.length || proposals.includes(null)) return null;
  const winner = proposals.find((p) => p.id === item.winner.proposalId);
  if (!winner) return null;
  const forecasters = (Array.isArray(item.forecasters) ? item.forecasters : []).filter(isObject).map((f) => ({
    name: typeof f.name === 'string' && NAME.test(f.name) ? f.name : 'Forecaster',
    action: f.action === 'abstain' ? 'abstain' : f.action === 'buy' && ['long', 'short'].includes(f.side) ? 'buy' : 'unknown',
    side: f.side === 'long' || f.side === 'short' ? f.side : null,
    proposalId: typeof f.proposalId === 'string' && /^\d{1,3}$/.test(f.proposalId) ? f.proposalId : null,
    reason: safeText(f.reason, 200), scripted: f.scripted === true,
  }));
  const payouts = (Array.isArray(item.payouts) ? item.payouts : []).filter(isObject).map((p) => ({
    name: typeof p.name === 'string' && NAME.test(p.name) ? p.name : 'Forecaster',
    deposit: isIntegerString(p.deposit) ? p.deposit : null, payout: isIntegerString(p.payout) ? p.payout : null, profitLoss: isSignedInteger(p.profitLoss) ? p.profitLoss : null,
  }));
  const transactions = (Array.isArray(item.transactions) ? item.transactions : []).filter((t) => isObject(t) && typeof t.label === 'string' && LABEL.test(t.label) && isTxHash(t.transactionHash) && isIntegerString(t.blockNumber))
    .map((t) => ({ label: t.label, transactionHash: t.transactionHash.toLowerCase(), blockNumber: t.blockNumber, url: explorerUrl(AURORA_TESTNET, 'tx', t.transactionHash) }));
  const swap = isObject(item.swap) && isTxHash(item.swap.transactionHash) ? {
    transactionHash: item.swap.transactionHash.toLowerCase(), url: explorerUrl(AURORA_TESTNET, 'tx', item.swap.transactionHash),
    stableDelta: isSignedInteger(item.swap.stableDelta) ? item.swap.stableDelta : null, assetDelta: isSignedInteger(item.swap.assetDelta) ? item.swap.assetDelta : null,
    independentlyChecked: item.swap.independentlyChecked === true,
  } : null;
  const reputation = isObject(item.reputation) && isAddress(item.reputation.agent) && isSignedInteger(item.reputation.score) && isTxHash(item.reputation.transactionHash) ? {
    agent: item.reputation.agent.toLowerCase(), score: item.reputation.score, transactionHash: item.reputation.transactionHash.toLowerCase(),
    url: explorerUrl(AURORA_TESTNET, 'tx', item.reputation.transactionHash),
  } : null;
  const checks = isObject(item.checks) ? item.checks : {};
  return {
    roundId: item.roundId, title: safeText(item.title, 120) ?? `Round ${item.roundId}`, date: safeText(item.date, 20), kind: safeText(item.kind, 80),
    genuineModelCalls: Number.isSafeInteger(item.genuineModelCalls) ? item.genuineModelCalls : null,
    scriptedForecasters: Number.isSafeInteger(item.scriptedForecasters) ? item.scriptedForecasters : null,
    model: safeText(item.model, 80), attestationVerified: item.attestationVerified === true,
    proposals, winner: { ...winner, isHold: winner.id === '0' }, forecasters, swap,
    realisedReturnX18: isIntegerString(item.realisedReturnX18) ? item.realisedReturnX18 : null,
    payouts, transactions, droppedTransactions: (Array.isArray(item.transactions) ? item.transactions.length : 0) - transactions.length, reputation,
    checks: { independentPassed: checks.independentPassed === true, returnRecomputed: checks.returnRecomputed === true, payoutsRecomputed: checks.payoutsRecomputed === true, swapChecked: checks.swapChecked === true ? true : checks.swapChecked === false ? false : null },
    scope: safeText(item.scope, 400), correction: safeText(item.correction, 400),
    limitations: (Array.isArray(item.limitations) ? item.limitations : []).map((text) => safeText(text, 240)).filter(Boolean),
  };
}

export function validateRoundEvidence(input) {
  if (!isObject(input) || input.schemaVersion !== 1 || input.network?.chainId !== AURORA_TESTNET || !Array.isArray(input.rounds)) {
    return { ok: false, error: 'The testnet round evidence is missing or is not from Aurora testnet.' };
  }
  const rounds = input.rounds.map(round).filter(Boolean);
  if (!rounds.length) return { ok: false, error: 'No valid testnet round evidence was returned.' };
  return { ok: true, rounds };
}
