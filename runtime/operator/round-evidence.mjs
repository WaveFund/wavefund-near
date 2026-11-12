import { readFile } from 'node:fs/promises';

// Developer C: validated, read-only projection of the published Aurora testnet round evidence for two separate
// contract stacks (the original testnet stack and the Tidepool-funded stack). A round is identified by
// network + engine + round id, because each engine has its own "round 1". Everything here is SAVED evidence that was
// independently verified when it was recorded; nothing reads a chain, signs or moves funds.

export const EVIDENCE_PATH = '/api/evidence/testnet-rounds';
const CHAIN_ID = 1313161555;
const ROOT = new URL('../../', import.meta.url);

export const STACKS = Object.freeze({
  original: Object.freeze({ label: 'Original testnet stack', manifest: 'deployments/aurora-testnet.json', reputationManifest: 'deployments/aurora-testnet-reputation.json' }),
  tidepool: Object.freeze({ label: 'Tidepool testnet stack', manifest: 'deployments/aurora-testnet-tidepool.json', reputationManifest: 'deployments/aurora-testnet-tidepool-reputation.json' }),
});
export const ROUND_SOURCES = Object.freeze([
  Object.freeze({ stack: 'original', roundId: '7', dir: 'docs/test-evidence/round7-hybrid', files: { report: 'report', plan: 'plan', independent: 'independent', swap: 'swap-independent' },
    title: 'Hybrid test: genuine AI proposers, scripted forecasters' }),
  Object.freeze({ stack: 'original', roundId: '8', dir: 'docs/test-evidence/round8-swarm', files: { report: 'report', plan: 'plan', independent: 'independent' },
    title: 'Genuine eight-agent run: forecasters abstained, Hold won' }),
  Object.freeze({ stack: 'tidepool', roundId: '1', dir: 'docs/test-evidence/tidepool-v1', files: { report: 'happy-path', plan: 'plan', independent: 'independent-round', swap: 'swap-independent', capital: 'capital-linkage', reputation: 'reputation' },
    title: 'Tidepool-funded round: genuine AI proposers, scripted forecasters' }),
]);

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
const address = (value, label) => { check(typeof value === 'string' && ADDRESS.test(value) && !/^0x0{40}$/i.test(value), `${label} must be an address`); return value.toLowerCase(); };
const name = (value, label) => { check(typeof value === 'string' && NAME.test(value), `${label} must be a plain name`); return value; };
const count = (value, label) => { check(Number.isSafeInteger(value) && value >= 0, `${label} must be a non-negative integer`); return value; };
const bps = (value, label) => { check(Number.isSafeInteger(value) && value >= 0 && value <= 10_000, `${label} must be basis points`); return value; };
function text(value, label, max = 400) {
  check(typeof value === 'string', `${label} must be text`);
  const cleaned = value.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
  check(cleaned.length > 0, `${label} is empty`);
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}\u2026` : cleaned;
}
export const roundKey = (chainId, engine, roundId) => `${chainId}:${engine.toLowerCase()}:${roundId}`;
export const roundSlug = (chainId, engine, roundId) => `${chainId}-${engine.toLowerCase()}-${roundId}`;

// Identity of one contract stack, cross-checked between its deployment and reputation manifests.
function stackIdentity(id, manifest, reputationManifest) {
  check(manifest?.chainId === CHAIN_ID && reputationManifest?.chainId === CHAIN_ID, `${id} manifests must be Aurora testnet 1313161555`);
  const engine = address(manifest.contracts?.engine, `${id} engine`);
  check(address(reputationManifest.contracts?.engine, `${id} reputation engine`) === engine, `${id} reputation is bound to a different engine`);
  return { id, label: STACKS[id].label, chainId: CHAIN_ID, engine, safe: address(manifest.contracts?.safe, `${id} Safe`), stable: address(manifest.contracts?.stable, `${id} stable token`),
    reputation: address(reputationManifest.contracts?.reputation, `${id} reputation contract`), investmentPair: typeof manifest.integrations?.investmentPair === 'string' ? address(manifest.integrations.investmentPair, `${id} pair`) : null };
}

function swapFor(source, files, stack, manifest, transactions) {
  const { report } = files; const checked = files.swap;
  const execution = Array.isArray(report.execution) ? report.execution.filter((item) => item?.stage === 'execution') : [];
  if (execution.length) { // original stack format: report.execution + per-row deltas
    check(execution.length === 1 && isObject(checked), 'a swap needs exactly one execution and its independent balance check');
    const transactionHash = hash(execution[0].hash, 'swap transaction');
    check(hash(checked.hash, 'independent swap hash') === transactionHash, 'the independent swap check names a different transaction');
    check(address(checked.safe, 'swap Safe') === stack.safe, 'the swap ran on a different Safe');
    return { transactionHash, blockNumber: uint(checked.blockNumber, 'swap block'), safe: stack.safe, stableDelta: int(checked.rows?.stable?.delta, 'stable delta'), assetDelta: int(checked.rows?.asset?.delta, 'asset delta'),
      slippageBps: bps(checked.slippageBps, 'slippage'), routerAllowancesZero: checked.routerAllowancesZero === true, independentlyChecked: checked.passed === true };
  }
  if (!files.capital) return null; // no execution recorded: Hold, no swap
  // Tidepool format: the capital linkage names the execution, which must be the round's execute transaction and the manifest's swap.
  const capital = files.capital;
  check(capital.chainId === CHAIN_ID && address(capital.safe, 'capital Safe') === stack.safe && address(capital.engine, 'capital engine') === stack.engine && capital.roundId === source.roundId, 'the capital linkage names a different Safe, engine or round');
  const transactionHash = hash(capital.executionHash, 'execution hash');
  const execute = transactions.find((item) => item.label === `round${source.roundId}:execute`);
  check(execute && execute.transactionHash === transactionHash, 'the execution hash is not the round execute transaction');
  if (manifest.demonstration?.investmentSwapTransactionHash) check(hash(manifest.demonstration.investmentSwapTransactionHash, 'manifest swap') === transactionHash, 'the manifest names a different swap');
  check(isObject(checked) && checked.chainId === CHAIN_ID && address(checked.safe, 'swap Safe') === stack.safe, 'the swap balance check names a different Safe or network');
  const before = uint(checked.tokens?.stable?.before, 'stable before'); const after = uint(checked.tokens?.stable?.after, 'stable after');
  const assetBefore = uint(checked.tokens?.asset?.before, 'asset before'); const assetAfter = uint(checked.tokens?.asset?.after, 'asset after');
  return { transactionHash, blockNumber: uint(checked.blockNumber, 'swap block'), safe: stack.safe, stableDelta: (BigInt(after) - BigInt(before)).toString(), assetDelta: (BigInt(assetAfter) - BigInt(assetBefore)).toString(),
    slippageBps: bps(checked.slippageBps, 'slippage'), routerAllowancesZero: checked.tokens?.stable?.routerAllowance === '0' && checked.tokens?.asset?.routerAllowance === '0', independentlyChecked: checked.passed === true };
}

function reputationFor(source, files, stack, reputationManifest) {
  if (Array.isArray(files.reputation)) { // Tidepool: the recorded reputation transaction and its completed result
    const done = files.reputation.find((item) => item?.stage === 'reputationComplete');
    const confirmed = files.reputation.find((item) => item?.stage === 'confirmed');
    if (!done) return null;
    check(done.chainId === CHAIN_ID && address(done.reputation, 'reputation contract') === stack.reputation && done.roundId === source.roundId, 'the reputation record names a different contract or round');
    check(confirmed, 'the reputation record has no confirmed transaction');
    return { agent: address(done.agent, 'reputation agent'), score: int(done.score, 'recorded score'), transactionHash: hash(confirmed.hash, 'reputation transaction'), blockNumber: uint(confirmed.blockNumber, 'reputation block'), contract: stack.reputation };
  }
  const recorded = (Array.isArray(reputationManifest?.historicalRoundsRecorded) ? reputationManifest.historicalRoundsRecorded : []).find((item) => item?.roundId === source.roundId);
  return recorded ? { agent: address(recorded.agent, 'reputation agent'), score: int(recorded.score, 'recorded score'), transactionHash: hash(recorded.transactionHash, 'reputation transaction'), blockNumber: uint(recorded.blockNumber, 'reputation block'), contract: stack.reputation } : null;
}

function projectRound(source, files, stack, manifest, reputationManifest) {
  const { report, plan, independent } = files;
  check(isObject(report) && isObject(plan) && isObject(independent) && isObject(report.completion), 'missing report, plan or independent check');
  const completion = report.completion; const round = completion.round;
  check(completion.chainId === CHAIN_ID && plan.chainId === CHAIN_ID && independent.chainId === CHAIN_ID, 'every file must be Aurora testnet 1313161555');
  check(completion.roundId === source.roundId && String(plan.roundId) === source.roundId && independent.roundId === source.roundId, 'round ids disagree');
  check(address(plan.engine, 'plan engine') === stack.engine, 'the plan names a different engine from its stack');
  check(address(plan.safe, 'plan Safe') === stack.safe, 'the plan names a different Safe from its stack');
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
  const records = Array.isArray(plan.records) ? plan.records : [];
  const fixtureForecasters = new Set(records.filter((item) => item?.role === 'forecaster' && item?.provider === 'test-fixture').map((item) => item.name));
  const proposers = records.filter((item) => item?.role === 'proposer').map((item) => ({
    name: name(item.name, 'proposer'), provider: text(item.provider, 'proposer provider', 40), confidenceBps: bps(item.decision?.confidenceBps, 'proposer confidence'),
  }));

  check(Array.isArray(completion.decisions), 'forecaster decisions are missing');
  const forecasters = completion.decisions.map((item, index) => {
    check(isObject(item), `decision ${index} is malformed`);
    const label = `decision ${index}`;
    const base = { name: name(item.name, `${label} name`) };
    if (item.action === 'abstain') return { ...base, action: 'abstain', reason: text(item.reason, `${label} reason`, 200), scripted: fixtureForecasters.has(base.name) };
    check(item.action === 'buy' && ['long', 'short'].includes(item.side) && Number.isSafeInteger(item.proposalId), `${label} must be a buy with a side or an abstention`);
    // Fixture forecasts carry an explicit "functional scenario fixture" rationale or a test-fixture provider record.
    const scripted = fixtureForecasters.has(base.name) || /fixture/i.test(String(item.forecast?.rationale ?? ''));
    return { ...base, action: 'buy', side: item.side, proposalId: String(item.proposalId), credits: uint(item.creditAmount, `${label} credits`), scripted };
  });

  check(Array.isArray(completion.payouts), 'payouts are missing');
  const independentPayouts = new Map((Array.isArray(independent.payouts) ? independent.payouts : []).map((item) => [item?.name, item?.actualPayout]));
  const payouts = completion.payouts.map((item, index) => ({
    name: name(item?.name, `payout ${index} name`), deposit: uint(item.deposit, `payout ${index} deposit`), payout: uint(item.payout, `payout ${index} amount`),
    profitLoss: int(item.profitLoss, `payout ${index} profit/loss`),
  }));
  for (const item of payouts) check(BigInt(item.payout) - BigInt(item.deposit) === BigInt(item.profitLoss), `payout arithmetic for ${item.name}`);

  check(Array.isArray(report.confirmedTransactions) && report.confirmedTransactions.length > 0, 'confirmed transactions are missing');
  const transactions = report.confirmedTransactions.map((item, index) => {
    check(isObject(item) && typeof item.label === 'string' && LABEL.test(item.label), `transaction ${index} label`);
    return { label: item.label, transactionHash: hash(item.hash, `transaction ${index}`), blockNumber: uint(item.blockNumber, `transaction ${index} block`) };
  });
  const swap = swapFor(source, files, stack, manifest, transactions);
  const realisedReturnX18 = uint(round.realisedReturn, 'realised return');
  const usage = isObject(report.modelUsage) ? { inputTokens: count(report.modelUsage.inputTokens, 'input tokens'), outputTokens: count(report.modelUsage.outputTokens, 'output tokens') } : null;
  return {
    key: roundKey(CHAIN_ID, stack.engine, source.roundId), slug: roundSlug(CHAIN_ID, stack.engine, source.roundId), roundId: source.roundId,
    stack: { id: stack.id, label: stack.label, engine: stack.engine, safe: stack.safe, reputation: stack.reputation },
    evidence: 'saved-independently-verified', title: source.title, date: text(report.date, 'date', 20), kind: text(report.kind, 'kind', 80), source: source.dir,
    genuineModelCalls: count(report.genuineModelCalls, 'genuine model calls'), scriptedForecasters: count(report.scriptedForecasters, 'scripted forecasters'),
    model: text(completion.provider?.model, 'model', 80), attestationVerified: completion.provider?.attestationVerified === true, modelUsage: usage,
    proposals, proposers, winner: { proposalId: winner.id, name: winner.name, allocationBps: winner.allocationBps, isHold: winner.id === '0' },
    forecasters, swap, realisedReturnX18,
    totals: { deposits: uint(round.totalDeposits, 'total deposits'), paid: uint(round.totalPaid, 'total paid') },
    // Forecasting collateral is separate from the Safe: deposits plus the sponsor seed sit in the market until redemption.
    collateral: typeof independent.collateralAtCollapse === 'string' && typeof independent.endingCollateral === 'string' ? {
      atCollapse: uint(independent.collateralAtCollapse, 'collateral at collapse'), ending: uint(independent.endingCollateral, 'ending collateral'),
      seed: (BigInt(uint(independent.collateralAtCollapse, 'collateral at collapse')) - BigInt(round.totalDeposits)).toString() } : null,
    payouts, transactions, reputation: reputationFor(source, files, stack, reputationManifest),
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
export async function loadRoundEvidence({ read = defaultRead, sources = ROUND_SOURCES } = {}) {
  const stacks = {}; const manifests = {};
  for (const id of Object.keys(STACKS)) {
    const manifest = await read(STACKS[id].manifest); const reputationManifest = await read(STACKS[id].reputationManifest);
    manifests[id] = { manifest, reputationManifest }; stacks[id] = stackIdentity(id, manifest, reputationManifest);
  }
  const rounds = [];
  for (const source of sources) {
    check(Object.hasOwn(stacks, source.stack), `unknown stack ${source.stack}`);
    const files = {};
    for (const [role, file] of Object.entries(source.files)) files[role] = await read(`${source.dir}/${file}.json`);
    rounds.push(projectRound(source, files, stacks[source.stack], manifests[source.stack].manifest, manifests[source.stack].reputationManifest));
  }
  check(new Set(rounds.map((round) => round.key)).size === rounds.length, 'two rounds share one network + engine + round id');
  return Object.freeze({ schemaVersion: 2, network: { chainId: CHAIN_ID, name: 'Aurora testnet' }, evidence: 'published-test-evidence', stacks: Object.values(stacks), rounds });
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
