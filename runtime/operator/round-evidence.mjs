import { readFile } from 'node:fs/promises';

// Developer C: validated, read-only projection of the published Aurora testnet round evidence
// (docs/test-evidence/round7-hybrid and round8-swarm). It reports what happened, including scripted forecasters,
// abstentions, no-swap Hold outcomes and losses, and cross-checks each report against its independent recomputation.
// Nothing here reads a chain, signs or moves funds; explorer links are built by the dashboard from validated hashes.

export const EVIDENCE_PATH = '/api/evidence/testnet-rounds';
const CHAIN_ID = 1313161555;
const ROOT = new URL('../../', import.meta.url);
export const ROUND_SOURCES = Object.freeze([
  Object.freeze({ roundId: '7', dir: 'docs/test-evidence/round7-hybrid', files: ['report', 'plan', 'independent', 'swap-independent'],
    title: 'Hybrid test: genuine AI proposers, scripted forecasters' }),
  Object.freeze({ roundId: '8', dir: 'docs/test-evidence/round8-swarm', files: ['report', 'plan', 'independent'],
    title: 'Genuine eight-agent run: forecasters abstained, Hold won' }),
]);
const REPUTATION_MANIFEST = 'deployments/aurora-testnet-reputation.json';

const HASH = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const UINT = /^(0|[1-9][0-9]{0,77})$/;
const INT = /^(0|-?[1-9][0-9]{0,77})$/;
const NAME = /^[A-Za-z][A-Za-z0-9]{0,31}$/;
const LABEL = /^round[0-9]{1,4}:[A-Za-z0-9:]{1,80}$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g;

class EvidenceError extends Error {}
const check = (condition, message) => { if (!condition) throw new EvidenceError(`Round evidence rejected: ${message}`); };
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const uint = (value, label) => { check(typeof value === 'string' && UINT.test(value), `${label} must be an unsigned integer string`); return value; };
const int = (value, label) => { check(typeof value === 'string' && INT.test(value), `${label} must be an integer string`); return value; };
const hash = (value, label) => { check(typeof value === 'string' && HASH.test(value), `${label} must be a 32-byte hash`); return value.toLowerCase(); };
const name = (value, label) => { check(typeof value === 'string' && NAME.test(value), `${label} must be a plain name`); return value; };
const count = (value, label) => { check(Number.isSafeInteger(value) && value >= 0, `${label} must be a non-negative integer`); return value; };
const bps = (value, label) => { check(Number.isSafeInteger(value) && value >= 0 && value <= 10_000, `${label} must be basis points`); return value; };
function text(value, label, max = 400) {
  check(typeof value === 'string', `${label} must be text`);
  const cleaned = value.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
  check(cleaned.length > 0, `${label} is empty`);
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}\u2026` : cleaned;
}

function projectRound(source, files, reputationManifest) {
  const { report, plan, independent } = files;
  check(isObject(report) && isObject(plan) && isObject(independent) && isObject(report.completion), 'missing report, plan or independent check');
  const completion = report.completion; const round = completion.round;
  check(completion.chainId === CHAIN_ID && plan.chainId === CHAIN_ID && independent.chainId === CHAIN_ID, 'every file must be Aurora testnet 1313161555');
  check(completion.roundId === source.roundId && String(plan.roundId) === source.roundId && independent.roundId === source.roundId, 'round ids disagree');
  check(completion.stage === 'complete' && isObject(round), 'the round is not complete');
  const winnerId = uint(completion.winner, 'winner');
  check(String(round.winnerId) === winnerId && independent.winner === winnerId, 'the winner disagrees between files');

  check(Array.isArray(plan.proposals) && plan.proposals.length > 0, 'proposals are missing');
  const proposals = plan.proposals.map((item, index) => {
    check(isObject(item) && Number.isSafeInteger(item.id), `proposal ${index} is malformed`);
    return { id: String(item.id), name: name(item.name, `proposal ${index} name`), allocationBps: bps(item.allocationBps, `proposal ${index} allocation`), rationale: text(item.rationale, `proposal ${index} rationale`, 320) };
  });
  const winner = proposals.find((item) => item.id === winnerId);
  check(winner, 'the winning proposal is not in the plan');
  const proposers = (Array.isArray(plan.records) ? plan.records : []).filter((item) => item?.role === 'proposer').map((item) => ({
    name: name(item.name, 'proposer'), provider: text(item.provider, 'proposer provider', 40), confidenceBps: bps(item.decision?.confidenceBps, 'proposer confidence'),
  }));

  check(Array.isArray(completion.decisions), 'forecaster decisions are missing');
  const forecasters = completion.decisions.map((item, index) => {
    check(isObject(item), `decision ${index} is malformed`);
    const label = `decision ${index}`;
    const base = { name: name(item.name, `${label} name`) };
    if (item.action === 'abstain') return { ...base, action: 'abstain', reason: text(item.reason, `${label} reason`, 200), scripted: false };
    check(item.action === 'buy' && ['long', 'short'].includes(item.side) && Number.isSafeInteger(item.proposalId), `${label} must be a buy with a side or an abstention`);
    // Fixture forecasts carry an explicit "functional scenario fixture" rationale in the published evidence.
    const scripted = /fixture/i.test(String(item.forecast?.rationale ?? ''));
    return { ...base, action: 'buy', side: item.side, proposalId: String(item.proposalId), credits: uint(item.creditAmount, `${label} credits`), scripted };
  });

  check(Array.isArray(completion.payouts), 'payouts are missing');
  const independentPayouts = new Map((Array.isArray(independent.payouts) ? independent.payouts : []).map((item) => [item?.name, item?.actualPayout]));
  const payouts = completion.payouts.map((item, index) => ({
    name: name(item?.name, `payout ${index} name`), deposit: uint(item.deposit, `payout ${index} deposit`), payout: uint(item.payout, `payout ${index} amount`),
    profitLoss: int(item.profitLoss, `payout ${index} profit/loss`),
  }));
  for (const item of payouts) check(BigInt(item.payout) - BigInt(item.deposit) === BigInt(item.profitLoss), `payout arithmetic for ${item.name}`);

  const execution = Array.isArray(report.execution) ? report.execution.filter((item) => item?.stage === 'execution') : [];
  let swap = null;
  if (execution.length) {
    const checked = files['swap-independent'];
    check(execution.length === 1 && isObject(checked), 'a swap needs exactly one execution and its independent balance check');
    const transactionHash = hash(execution[0].hash, 'swap transaction');
    check(hash(checked.hash, 'independent swap hash') === transactionHash, 'the independent swap check names a different transaction');
    check(typeof checked.safe === 'string' && ADDRESS.test(checked.safe), 'the swap Safe is invalid');
    swap = {
      transactionHash, blockNumber: uint(checked.blockNumber, 'swap block'), safe: checked.safe.toLowerCase(),
      stableDelta: int(checked.rows?.stable?.delta, 'stable delta'), assetDelta: int(checked.rows?.asset?.delta, 'asset delta'),
      slippageBps: bps(checked.slippageBps, 'slippage'), routerAllowancesZero: checked.routerAllowancesZero === true, independentlyChecked: checked.passed === true,
    };
  }

  check(Array.isArray(report.confirmedTransactions) && report.confirmedTransactions.length > 0, 'confirmed transactions are missing');
  const transactions = report.confirmedTransactions.map((item, index) => {
    check(isObject(item) && typeof item.label === 'string' && LABEL.test(item.label), `transaction ${index} label`);
    return { label: item.label, transactionHash: hash(item.hash, `transaction ${index}`), blockNumber: uint(item.blockNumber, `transaction ${index} block`) };
  });

  const realisedReturnX18 = uint(round.realisedReturn, 'realised return');
  const recorded = (Array.isArray(reputationManifest?.historicalRoundsRecorded) ? reputationManifest.historicalRoundsRecorded : []).find((item) => item?.roundId === source.roundId);
  const usage = isObject(report.modelUsage) ? { inputTokens: count(report.modelUsage.inputTokens, 'input tokens'), outputTokens: count(report.modelUsage.outputTokens, 'output tokens') } : null;
  return {
    roundId: source.roundId, title: source.title, date: text(report.date, 'date', 20), kind: text(report.kind, 'kind', 80), source: source.dir,
    genuineModelCalls: count(report.genuineModelCalls, 'genuine model calls'), scriptedForecasters: count(report.scriptedForecasters, 'scripted forecasters'),
    model: text(completion.provider?.model, 'model', 80), attestationVerified: completion.provider?.attestationVerified === true, modelUsage: usage,
    proposals, proposers, winner: { proposalId: winner.id, name: winner.name, allocationBps: winner.allocationBps, isHold: winner.id === '0' },
    forecasters, swap, realisedReturnX18,
    totals: { deposits: uint(round.totalDeposits, 'total deposits'), paid: uint(round.totalPaid, 'total paid') },
    payouts, transactions,
    reputation: recorded ? { agent: recorded.agent.toLowerCase(), score: int(recorded.score, 'recorded score'), transactionHash: hash(recorded.transactionHash, 'reputation transaction'), blockNumber: uint(recorded.blockNumber, 'reputation block') } : null,
    checks: {
      independentPassed: independent.passed === true,
      returnRecomputed: independent.recomputedReturn === realisedReturnX18 && completion.portfolio?.realisedReturn === realisedReturnX18,
      payoutsRecomputed: payouts.every((item) => independentPayouts.get(item.name) === item.payout),
      swapChecked: swap ? swap.independentlyChecked : null,
    },
    scope: text(completion.scope, 'scope', 400),
    correction: typeof report.scopeStatementCorrection === 'string' ? text(report.scopeStatementCorrection, 'correction', 400) : null,
    limitations: (Array.isArray(report.limitations) ? report.limitations : []).map((item, index) => text(item, `limitation ${index}`, 240)),
  };
}

const defaultRead = async (path) => JSON.parse(await readFile(new URL(path, ROOT), 'utf8'));

// Loads and validates every round once. Structural problems throw; cross-file disagreements are reported in `checks`.
export async function loadRoundEvidence({ read = defaultRead } = {}) {
  const reputationManifest = await read(REPUTATION_MANIFEST);
  check(reputationManifest?.chainId === CHAIN_ID, 'the reputation manifest is not Aurora testnet');
  const rounds = [];
  for (const source of ROUND_SOURCES) {
    const files = {};
    for (const file of source.files) files[file] = await read(`${source.dir}/${file}.json`);
    rounds.push(projectRound(source, files, reputationManifest));
  }
  return Object.freeze({ schemaVersion: 1, network: { chainId: CHAIN_ID, name: 'Aurora testnet' }, evidence: 'published-test-evidence', rounds });
}

// WAVEFUND_EVIDENCE=disabled removes the endpoint. Invalid evidence keeps the server running and answers 503.
export async function roundEvidenceFromEnvironment(env = process.env, options = {}) {
  if ((env.WAVEFUND_EVIDENCE ?? '').trim() === 'disabled') return null;
  try {
    const evidence = await loadRoundEvidence(options);
    return { read: () => evidence };
  } catch {
    return { read: () => { throw new EvidenceError('invalid'); } };
  }
}

export async function handleEvidenceRequest(evidence, request, url, send) {
  if (!evidence || request.method !== 'GET' || url.pathname !== EVIDENCE_PATH) return send(404, { error: 'Not found' });
  try { return send(200, evidence.read()); } catch { return send(503, { error: 'Published round evidence failed validation.', code: 'EVIDENCE_INVALID' }); }
}
