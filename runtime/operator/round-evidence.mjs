import { verifyTeeProposals } from '../agents/tee-proof.mjs';
import { readFile, readdir } from 'node:fs/promises';

// Developer C: validated, read-only projection of the published Aurora testnet round evidence for two separate
// contract stacks (the original testnet stack and the Tidepool-funded stack). A round is identified by
// network + engine + round id, because each engine has its own "round 1". Everything here is SAVED evidence that was
// independently verified when it was recorded; nothing reads a chain, signs or moves funds.

export const EVIDENCE_PATH = '/api/evidence/testnet-rounds';
const CHAIN_ID = 1313161555;
const ROOT = new URL('../../', import.meta.url);

export const STACKS = Object.freeze({
  original: Object.freeze({ label: 'Testnet Safe v1', manifest: 'deployments/aurora-testnet.json', reputationManifest: 'deployments/aurora-testnet-reputation.json' }),
  tidepool: Object.freeze({ label: 'Testnet Safe v2', manifest: 'deployments/aurora-testnet-tidepool.json', reputationManifest: 'deployments/aurora-testnet-tidepool-reputation.json' }),
});
export const ROUND_SOURCES = Object.freeze([
  Object.freeze({ stack: 'original', roundId: '7', dir: 'docs/test-evidence/round7-hybrid', files: { report: 'report', plan: 'plan', independent: 'independent', swap: 'swap-independent' },
    title: 'Hybrid test: genuine AI proposers, scripted forecasters' }),
  Object.freeze({ stack: 'original', roundId: '8', dir: 'docs/test-evidence/round8-swarm', files: { report: 'report', plan: 'plan', independent: 'independent' },
    title: 'Genuine eight-agent run: forecasters abstained, Hold won' }),
  Object.freeze({ stack: 'tidepool', roundId: '1', dir: 'docs/test-evidence/tidepool-v1', files: { report: 'happy-path', plan: 'plan', independent: 'independent-round', swap: 'swap-independent', capital: 'capital-linkage', reputation: 'reputation' },
    title: 'Tidepool-funded round: genuine AI proposers, scripted forecasters' }),
]);

// Pre-registered Tidepool rounds exported by scripts/export-tidepool-round.mjs: one directory per round, each with a
// round.json manifest naming its files. They are validated exactly like the fixed sources above.
export const DISCOVERED_ROUNDS_DIR = 'docs/test-evidence/tidepool-rounds';
export const DISCOVERED_FILES = Object.freeze({ report: 'report', plan: 'plan', independent: 'independent', swap: 'swap-independent', capital: 'capital-linkage', reputation: 'reputation', probe: 'manipulation-probe', tee: 'tee' });
const ROUND_DIR = /^round([1-9][0-9]{0,3})$/;
const MAX_PROBE_STABLE = 20000n * 1000000n;
const PROBE_LABELS = ['approve', 'swap', 'resetApproval', 'approveRestore', 'restore', 'resetRestoreApproval'];

const HASH = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const UINT = /^(0|[1-9][0-9]{0,77})$/;
const INT = /^(0|-?[1-9][0-9]{0,77})$/;
const NAME = /^[A-Za-z][A-Za-z0-9]{0,31}$/;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9_./:-]{0,119}$/;
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
  if (manifest.demonstration?.investmentSwapTransactionHash && manifest.demonstration.roundId === source.roundId) check(hash(manifest.demonstration.investmentSwapTransactionHash, 'manifest swap') === transactionHash, 'the manifest names a different swap');
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
    check(confirmed.label === `reputation:round${source.roundId}` && done.roundId === source.roundId, 'the reputation transaction is labelled for another round');
    // Newer records carry the per-round point; the contract's score is cumulative per agent across rounds.
    const point = done.point === undefined ? null : int(done.point, 'recorded point');
    if (point !== null) {
      check(['-1', '0', '1'].includes(point), 'the recorded point must be -1, 0 or 1');
      const factor = BigInt(uint(done.returnFactor, 'reputation return factor')); const one = 10n ** 18n;
      check(point === (factor > one ? '1' : factor < one ? '-1' : '0'), 'the recorded point is not sign(return - 1)');
    }
    return { agent: address(done.agent, 'reputation agent'), score: point ?? int(done.score, 'recorded score'), ...(point === null ? {} : { cumulativeScore: int(done.score, 'cumulative score') }),
      transactionHash: hash(confirmed.hash, 'reputation transaction'), blockNumber: uint(confirmed.blockNumber, 'reputation block'), contract: stack.reputation };
  }
  const recorded = (Array.isArray(reputationManifest?.historicalRoundsRecorded) ? reputationManifest.historicalRoundsRecorded : []).find((item) => item?.roundId === source.roundId);
  return recorded ? { agent: address(recorded.agent, 'reputation agent'), score: int(recorded.score, 'recorded score'), transactionHash: hash(recorded.transactionHash, 'reputation transaction'), blockNumber: uint(recorded.blockNumber, 'reputation block'), contract: stack.reputation } : null;
}

const exact = (value, keys, label) => check(isObject(value) && Object.keys(value).sort().join() === [...keys].sort().join(), `${label} has unexpected fields`);

// Discovered rounds are pre-registered: scripted target and evaluation window are fixed in the plan before the run.
function preRegistrationFor(source, plan, completion, round, winnerId) {
  const present = plan.scriptedTarget !== undefined || completion.scriptedTarget !== undefined || completion.evaluationSeconds !== undefined;
  if (!present) { check(!source.discovered, 'a discovered round must carry its pre-registered target and evaluation window'); return null; }
  const target = completion.scriptedTarget;
  check(target === null || (Number.isSafeInteger(target) && target >= 0 && target <= 4), 'the scripted target must be a proposal id 0..4 or null');
  check((plan.scriptedTarget ?? null) === target, 'the plan and completion disagree on the scripted target');
  check(Number.isSafeInteger(completion.evaluationSeconds) && completion.evaluationSeconds >= 180 && completion.evaluationSeconds <= 3600, 'the evaluation window must be 180..3600 seconds');
  check((plan.evaluationSeconds ?? 180) === completion.evaluationSeconds, 'the plan and completion disagree on the evaluation window');
  check(BigInt(uint(round.evaluationEnd, 'evaluation end')) - BigInt(uint(round.tradingEnd, 'trading end')) === BigInt(completion.evaluationSeconds), 'the recorded window is not evaluationEnd - tradingEnd');
  if (target !== null) check(winnerId === String(target), 'the winner is not the pre-registered scripted target');
  if (source.discovered && target !== null) check(/pre-registered proposal[0-4]\b/.test(String(completion.scope)) && /SCRIPTED/.test(String(completion.scope)), 'the scope must state SCRIPTED forecasters and the pre-registered target');
  const terms = { scriptedTarget: target === null ? null : String(target), evaluationSeconds: completion.evaluationSeconds };
  if (plan.profile !== 'swarm2-v1') return terms;
  // swarm2 pre-registers its deterministic trade rule and minimum edge in the plan.
  check(plan.tradeRule === 'expected-payout-value-v1' && Number.isSafeInteger(plan.minEdgeBps) && plan.minEdgeBps >= 1 && plan.minEdgeBps <= 10000, 'a swarm2 plan must record its trade rule and minimum edge');
  return { ...terms, tradeRule: plan.tradeRule, minEdgeBps: plan.minEdgeBps };
}

const reservesShape = ['blockNumber', 'reserveStable', 'reserveAsset', 'poolAssetPriceX18'];
const sideShape = ['amountIn', 'oracleExpectedOut', 'minimumOut', 'poolOut', 'wouldReject'];
function probeReserves(value, label) {
  exact(value, reservesShape, label);
  const out = Object.fromEntries(reservesShape.map((key) => [key, uint(value[key], `${label} ${key}`)]));
  check(BigInt(out.reserveStable) > 0n && BigInt(out.reserveAsset) > 0n && BigInt(out.poolAssetPriceX18) === BigInt(out.reserveStable) * 10n ** 30n / BigInt(out.reserveAsset), `${label} price does not match its reserves`);
  return out;
}
function probeModuleCheck(value, label) {
  exact(value, ['maxSlippageBps', 'buyAsset', 'sellAsset'], label);
  const sides = {};
  for (const side of ['buyAsset', 'sellAsset']) {
    exact(value[side], sideShape, `${label} ${side}`);
    const item = Object.fromEntries(sideShape.slice(0, 4).map((key) => [key, uint(value[side][key], `${label} ${side} ${key}`)]));
    check(typeof value[side].wouldReject === 'boolean' && value[side].wouldReject === (BigInt(item.poolOut) < BigInt(item.minimumOut)), `${label} ${side} rejection does not follow from its numbers`);
    sides[side] = { ...item, wouldReject: value[side].wouldReject };
  }
  const slippage = uint(value.maxSlippageBps, `${label} slippage`);
  check(BigInt(slippage) <= 1000n, `${label} slippage exceeds the module cap`);
  return { maxSlippageBps: slippage, ...sides };
}
const PROBE_KEYS = ['chainId', 'roundId', 'status', 'pair', 'router', 'token0', 'stableAmount', 'before', 'manipulated', 'atSettlement', 'restored', 'oracleAtManipulation',
  'poolDeviationBeforeBps', 'poolDeviationManipulatedBps', 'assetBought', 'stableRecovered', 'stableAllowanceAfter', 'assetAllowanceAfter', 'settlement', 'moduleCheck', 'transactions'];
const SETTLEMENT_KEYS = ['settleHash', 'oracle', 'stableQty6', 'assetQty18', 'startingValueX18', 'measuredReturnX18', 'oracleEndingValueX18', 'oracleRecomputedReturnX18', 'observationHash', 'usedOracle', 'poolMarkedReturnX18'];
const ORACLE_KEYS = ['stablePrice', 'assetPrice', 'publishedAt'];

// Optional operator manipulation probe: strict shape, cross-checked against the round's own transactions and return.
function probeFor(source, value, stack, manifest, completion, transactions, realisedReturnX18) {
  exact(value, PROBE_KEYS, 'manipulation probe');
  check(value.chainId === CHAIN_ID && value.roundId === source.roundId, 'the manipulation probe names another network or round');
  check(['complete', 'complete-oracle-mismatch'].includes(value.status), 'only a completed manipulation probe is evidence');
  check(stack.investmentPair && address(value.pair, 'probe pair') === stack.investmentPair, 'the probe used a pool other than the investment pair');
  address(value.router, 'probe router'); const token0 = address(value.token0, 'probe token0');
  const stableAmount = BigInt(uint(value.stableAmount, 'probe amount'));
  check(stableAmount > 0n && stableAmount <= MAX_PROBE_STABLE, 'the probe amount exceeds the 20000 test USDC cap');
  check(token0 === stack.stable || token0 === address(manifest.contracts?.asset, 'stack asset'), 'the probe pair token0 is not a stack token');
  const before = probeReserves(value.before, 'probe before'); const manipulated = probeReserves(value.manipulated, 'probe manipulated');
  const atSettlement = probeReserves(value.atSettlement, 'probe at settlement'); const restored = probeReserves(value.restored, 'probe restored');
  check(BigInt(manipulated.reserveStable) > BigInt(before.reserveStable) && BigInt(manipulated.poolAssetPriceX18) > BigInt(before.poolAssetPriceX18), 'the probe did not raise the pool price');
  exact(value.oracleAtManipulation, ORACLE_KEYS, 'probe oracle');
  const oracleAtManipulation = Object.fromEntries(ORACLE_KEYS.map((key) => [key, uint(value.oracleAtManipulation[key], `probe oracle ${key}`)]));
  const assetBought = uint(value.assetBought, 'probe asset bought'); const stableRecovered = uint(value.stableRecovered, 'probe stable recovered');
  check(BigInt(assetBought) > 0n && value.stableAllowanceAfter === '0' && value.assetAllowanceAfter === '0', 'the probe left an allowance or bought nothing');
  const deviationBefore = int(value.poolDeviationBeforeBps, 'probe deviation before'); const deviationManipulated = int(value.poolDeviationManipulatedBps, 'probe deviation');
  exact(value.settlement, SETTLEMENT_KEYS, 'probe settlement');
  const st = value.settlement;
  exact(st.oracle, ORACLE_KEYS, 'probe settlement oracle');
  const sp = BigInt(uint(st.oracle.stablePrice, 'settlement stable price')); const ap = BigInt(uint(st.oracle.assetPrice, 'settlement asset price')); uint(st.oracle.publishedAt, 'settlement published');
  const settle = transactions.find((item) => item.label === `round${source.roundId}:settle`);
  check(settle && hash(st.settleHash, 'probe settle hash') === settle.transactionHash, 'the probe names a settlement other than the round settle transaction');
  hash(st.observationHash, 'probe observation hash');
  check(st.measuredReturnX18 === realisedReturnX18 && completion.portfolio?.stableQty6 === st.stableQty6 && completion.portfolio?.assetQty18 === st.assetQty18
    && completion.portfolio?.startingValueX18 === st.startingValueX18, 'the probe settlement disagrees with the round portfolio');
  const ending = BigInt(uint(st.stableQty6, 'probe stable quantity')) * sp / 1000000n + BigInt(uint(st.assetQty18, 'probe asset quantity')) * ap / 10n ** 18n;
  const recomputed = ending * 10n ** 18n / BigInt(uint(st.startingValueX18, 'probe starting value'));
  check(uint(st.oracleEndingValueX18, 'probe oracle ending') === ending.toString() && uint(st.oracleRecomputedReturnX18, 'probe oracle return') === recomputed.toString(), 'the probe oracle arithmetic does not recompute');
  uint(st.poolMarkedReturnX18, 'probe pool-marked return');
  check(typeof st.usedOracle === 'boolean' && (value.status === 'complete') === st.usedOracle, 'the probe status and oracle check disagree');
  exact(value.moduleCheck, ['computedNotExecuted', 'referenceIsExecutedSwap', 'before', 'manipulated'], 'probe module check');
  check(value.moduleCheck.computedNotExecuted === true && typeof value.moduleCheck.referenceIsExecutedSwap === 'boolean', 'the module check must be computed, not executed');
  const moduleBefore = probeModuleCheck(value.moduleCheck.before, 'probe module check before'); const moduleManipulated = probeModuleCheck(value.moduleCheck.manipulated, 'probe module check manipulated');
  check(Array.isArray(value.transactions) && value.transactions.length >= 4 && value.transactions.length <= PROBE_LABELS.length, 'the probe transaction list is incomplete');
  const probeTransactions = value.transactions.map((item, index) => {
    exact(item, ['label', 'hash', 'blockNumber'], `probe transaction ${index}`);
    check(PROBE_LABELS.some((name) => item.label === `round${source.roundId}:probe:${name}`), `probe transaction ${index} label`);
    const listed = transactions.find((tx) => tx.label === item.label);
    check(listed && listed.transactionHash === hash(item.hash, `probe transaction ${index}`) && listed.blockNumber === uint(item.blockNumber, `probe transaction ${index} block`), `probe transaction ${index} is not a confirmed round transaction`);
    return { label: item.label, transactionHash: listed.transactionHash, blockNumber: listed.blockNumber };
  });
  for (const required of ['approve', 'swap', 'approveRestore', 'restore']) check(probeTransactions.some((item) => item.label === `round${source.roundId}:probe:${required}`), `the probe is missing its ${required} transaction`);
  const oracleUsed = st.usedOracle === true && recomputed.toString() === realisedReturnX18;
  return { oracleUsed, projection: {
    stableAmount: stableAmount.toString(), pair: stack.investmentPair, assetBought, stableRecovered,
    pool: { before, manipulated, atSettlement, restored }, oracleAtManipulation, poolDeviationBeforeBps: deviationBefore, poolDeviationManipulatedBps: deviationManipulated,
    measuredReturnX18: realisedReturnX18, oracleRecomputedReturnX18: recomputed.toString(), poolMarkedReturnX18: st.poolMarkedReturnX18, settlementOracle: { stablePriceX18: sp.toString(), assetPriceX18: ap.toString() },
    moduleCheck: { computedNotExecuted: true, referenceIsExecutedSwap: value.moduleCheck.referenceIsExecutedSwap, before: moduleBefore, manipulated: moduleManipulated },
    transactions: probeTransactions,
  } };
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
  // Multi-model (swarm2) plans carry one model per agent record; older single-model plans keep their unchanged projection.
  const multiModel = plan.profile === 'swarm2-v1';
  const modelFor = (agentName, role) => {
    const matches = (Array.isArray(plan.records) ? plan.records : []).filter((r) => r?.name === agentName && r?.role === role);
    check(matches.length === 1 && typeof matches[0].model === 'string' && MODEL.test(matches[0].model), `${role} ${agentName} needs exactly one record with a model id`);
    return matches[0].model;
  };
  const proposals = plan.proposals.map((item, index) => {
    check(isObject(item) && Number.isSafeInteger(item.id), `proposal ${index} is malformed`);
    const projected = { id: String(item.id), name: name(item.name, `proposal ${index} name`), allocationBps: bps(item.allocationBps, `proposal ${index} allocation`), rationale: text(item.rationale, `proposal ${index} rationale`, 320) };
    return multiModel && item.id !== 0 ? { ...projected, model: modelFor(projected.name, 'proposer') } : projected;
  });
  if (multiModel) check(new Set(plan.records.map((r) => r.model)).size === plan.records.length, 'a multi-model plan reuses a model');
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
    if (multiModel) { base.model = modelFor(base.name, 'forecaster'); check(item.model === base.model, `${label} model differs from its plan record`); }
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
  // The round's own market terms, read from the completion record: the trading/evaluation window, the TWAP window used for
  // selection, the performance-to-payout bounds and the LONG settlement ratio. Displayed as recorded, never assumed globally.
  const market = {
    tradingStart: uint(round.tradingStart, 'trading start'), tradingEnd: uint(round.tradingEnd, 'trading end'), evaluationEnd: uint(round.evaluationEnd, 'evaluation end'),
    twapWindowSeconds: uint(round.twapWindow, 'TWAP window'), returnBounds: { minX18: uint(round.rMin, 'return lower bound'), maxX18: uint(round.rMax, 'return upper bound') },
    longPayoutX18: uint(round.pi, 'LONG payout ratio'),
  };
  check(BigInt(market.tradingStart) < BigInt(market.tradingEnd) && BigInt(market.tradingEnd) < BigInt(market.evaluationEnd) && BigInt(market.twapWindowSeconds) > 0n
    && BigInt(market.returnBounds.minX18) < 10n ** 18n && BigInt(market.returnBounds.maxX18) > 10n ** 18n && BigInt(market.longPayoutX18) <= 10n ** 18n, 'the round timing or payout bounds are inconsistent');
  const preRegistration = preRegistrationFor(source, plan, completion, round, winnerId);
  const reputation = reputationFor(source, files, stack, reputationManifest);
  if (reputation) check(winnerId !== '0', 'a Hold round carries a reputation record, but Hold rounds never score');
  if (reputation && Array.isArray(files.reputation)) check(BigInt(uint(files.reputation.find((item) => item?.stage === 'reputationComplete').returnFactor ?? realisedReturnX18, 'reputation factor')) === BigInt(realisedReturnX18), 'the reputation record scores a different return');
  const manipulationProbe = files.probe === undefined ? null : probeFor(source, files.probe, stack, manifest, completion, transactions, realisedReturnX18);
  const usage = isObject(report.modelUsage) ? { inputTokens: count(report.modelUsage.inputTokens, 'input tokens'), outputTokens: count(report.modelUsage.outputTokens, 'output tokens') } : null;
  return {
    key: roundKey(CHAIN_ID, stack.engine, source.roundId), slug: roundSlug(CHAIN_ID, stack.engine, source.roundId), roundId: source.roundId,
    stack: { id: stack.id, label: stack.label, engine: stack.engine, safe: stack.safe, reputation: stack.reputation },
    evidence: 'saved-independently-verified', title: source.title, date: text(report.date, 'date', 20), kind: text(report.kind, 'kind', 80), source: source.dir,
    genuineModelCalls: count(report.genuineModelCalls, 'genuine model calls'), scriptedForecasters: count(report.scriptedForecasters, 'scripted forecasters'),
    model: text(completion.provider?.model, 'model', 80), ...(multiModel ? { models: new Set(plan.records.map((r) => r.model)).size } : {}), attestationVerified: Array.isArray(files.verifiedTee) && files.verifiedTee.length === 4, tee: files.verifiedTee ?? [], modelUsage: usage,
    proposals, proposers, winner: { proposalId: winner.id, name: winner.name, allocationBps: winner.allocationBps, isHold: winner.id === '0' },
    forecasters, swap, realisedReturnX18, market,
    totals: { deposits: uint(round.totalDeposits, 'total deposits'), paid: uint(round.totalPaid, 'total paid') },
    // Forecasting collateral is separate from the Safe: deposits plus the sponsor seed sit in the market until redemption.
    collateral: typeof independent.collateralAtCollapse === 'string' && typeof independent.endingCollateral === 'string' ? {
      atCollapse: uint(independent.collateralAtCollapse, 'collateral at collapse'), ending: uint(independent.endingCollateral, 'ending collateral'),
      seed: (BigInt(uint(independent.collateralAtCollapse, 'collateral at collapse')) - BigInt(round.totalDeposits)).toString() } : null,
    payouts, transactions, reputation, preRegistration, manipulationProbe: manipulationProbe?.projection ?? null,
    checks: {
      independentPassed: independent.passed === true,
      returnRecomputed: independent.recomputedReturn === realisedReturnX18 && completion.portfolio?.realisedReturn === realisedReturnX18,
      payoutsRecomputed: payouts.every((item) => independentPayouts.get(item.name) === item.payout),
      swapChecked: swap ? swap.independentlyChecked : null,
      ...(manipulationProbe ? { probeOracleUsed: manipulationProbe.oracleUsed } : {}),
    },
    scope: text(completion.scope, 'scope', 400),
    correction: typeof report.scopeStatementCorrection === 'string' ? text(report.scopeStatementCorrection, 'correction', 400) : null,
    limitations: (Array.isArray(report.limitations) ? report.limitations : []).map((item, index) => text(item, `limitation ${index}`, 240)),
  };
}

// Validates one in-memory Tidepool round exactly as a discovered directory would be (used by the exporter before writing).
export function validateTidepoolRoundFiles({ source, files, manifest, reputationManifest }) {
  return projectRound({ ...source, stack: 'tidepool', discovered: true }, files, stackIdentity('tidepool', manifest, reputationManifest), manifest, reputationManifest);
}

const defaultRead = async (path) => JSON.parse(await readFile(new URL(path, ROOT), 'utf8'));
const defaultList = async (dir) => {
  try { return (await readdir(new URL(`${dir}/`, ROOT), { withFileTypes: true })).filter((entry) => !entry.name.startsWith('.')).map((entry) => ({ name: entry.name, directory: entry.isDirectory() })); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
};

// Every directory under tidepool-rounds/ must be roundN/ with a strict round.json manifest; anything else is rejected.
export async function discoverRoundSources({ read = defaultRead, list = defaultList } = {}) {
  const entries = await list(DISCOVERED_ROUNDS_DIR);
  check(Array.isArray(entries), 'round directory listing failed');
  const sources = [];
  for (const entry of entries) {
    if (!entry.directory) continue; // e.g. a README beside the round directories
    const match = ROUND_DIR.exec(entry.name);
    check(match, `unexpected evidence directory ${String(entry.name).slice(0, 40)}`);
    const dir = `${DISCOVERED_ROUNDS_DIR}/${entry.name}`;
    const manifest = await read(`${dir}/round.json`);
    exact(manifest, ['schemaVersion', 'stack', 'roundId', 'title', 'files'], `${entry.name} manifest`);
    check(manifest.schemaVersion === 1 && manifest.stack === 'tidepool', `${entry.name} manifest must be schema 1 on the Tidepool stack`);
    check(manifest.roundId === match[1], `${entry.name} manifest names round ${String(manifest.roundId).slice(0, 12)}`);
    check(isObject(manifest.files) && ['report', 'plan', 'independent'].every((role) => Object.hasOwn(manifest.files, role)), `${entry.name} manifest is missing report, plan or independent`);
    for (const [role, file] of Object.entries(manifest.files)) check(Object.hasOwn(DISCOVERED_FILES, role) && file === DISCOVERED_FILES[role], `${entry.name} manifest file ${String(role).slice(0, 20)}`);
    check(Object.hasOwn(manifest.files, 'swap') === Object.hasOwn(manifest.files, 'capital'), `${entry.name} swap and capital linkage come together`);
    sources.push(Object.freeze({ stack: 'tidepool', roundId: manifest.roundId, dir, files: Object.freeze({ ...manifest.files }), title: text(manifest.title, `${entry.name} title`, 120), discovered: true }));
  }
  return sources.sort((a, b) => Number(a.roundId) - Number(b.roundId));
}

// Loads and validates every round once. Structural problems throw; cross-file disagreements are reported in `checks`.
export async function loadRoundEvidence({ read = defaultRead, list = defaultList, sources = ROUND_SOURCES, discover = true, teePolicy } = {}) {
  const stacks = {}; const manifests = {};
  for (const id of Object.keys(STACKS)) {
    const manifest = await read(STACKS[id].manifest); const reputationManifest = await read(STACKS[id].reputationManifest);
    manifests[id] = { manifest, reputationManifest }; stacks[id] = stackIdentity(id, manifest, reputationManifest);
  }
  const rounds = [];
  const all = [...sources, ...(discover ? await discoverRoundSources({ read, list }) : [])];
  for (const source of all) {
    check(Object.hasOwn(stacks, source.stack), `unknown stack ${source.stack}`);
    const files = {};
    for (const [role, file] of Object.entries(source.files)) files[role] = await read(`${source.dir}/${file}.json`);
    if (files.plan?.teeRequired === true) {
      check(files.tee && teePolicy, 'TEE evidence requires the reviewed verification policy');
      files.verifiedTee = await verifyTeeProposals(files.plan, files.tee.receipts, teePolicy);
    } else check(!files.tee && files.report?.completion?.provider?.attestationVerified !== true, 'Unexpected historical TEE claim');
    rounds.push(projectRound(source, files, stacks[source.stack], manifests[source.stack].manifest, manifests[source.stack].reputationManifest));
  }
  check(new Set(rounds.map((round) => round.key)).size === rounds.length, 'two rounds share one network + engine + round id');
  return Object.freeze({ schemaVersion: 2, network: { chainId: CHAIN_ID, name: 'Aurora testnet' }, evidence: 'published-test-evidence', stacks: Object.values(stacks), rounds });
}

// WAVEFUND_EVIDENCE=disabled removes the endpoint. Invalid evidence keeps the server running and answers 503.
export async function roundEvidenceFromEnvironment(env = process.env, options = {}) {
  if ((env.WAVEFUND_EVIDENCE ?? '').trim() === 'disabled') return null;
  try {
    const teePolicy = env.WAVEFUND_TEE_POLICY ? JSON.parse(await readFile(env.WAVEFUND_TEE_POLICY, 'utf8')) : undefined;
    const evidence = await loadRoundEvidence({ ...options, ...(teePolicy ? { teePolicy } : {}) });
    return { read: () => evidence };
  } catch {
    return { read: () => { throw new EvidenceError('invalid'); } };
  }
}

export async function handleEvidenceRequest(evidence, request, url, send) {
  if (!evidence || request.method !== 'GET' || url.pathname !== EVIDENCE_PATH) return send(404, { error: 'Not found' });
  try { return send(200, evidence.read()); } catch { return send(503, { error: 'Published round evidence failed validation.', code: 'EVIDENCE_INVALID' }); }
}
