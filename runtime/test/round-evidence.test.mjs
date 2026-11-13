// Developer C: published testnet round evidence projection and endpoint. Reads repository files only; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startServer } from '../server.mjs';
import { ROUND_SOURCES, loadRoundEvidence, roundEvidenceFromEnvironment, discoverRoundSources } from '../operator/round-evidence.mjs';
import { buildRoundEvidence } from '../operator/tidepool-round-export.mjs';
import { roundScope, v2AmountOut, moduleCheckAtPool } from '../agents/round-rules.mjs';

const ROOT = new URL('../../', import.meta.url);
const read = async (path) => JSON.parse(await readFile(new URL(path, ROOT), 'utf8'));
// Reads the real files, then applies one mutation to a single file to simulate tampered or malformed evidence.
const tampered = (file, mutate) => async (path) => { const value = await read(path); if (path === file) mutate(value); return value; };
const runtime = () => ({ state: async () => ({ stage: 'idle' }), start: () => {}, close: async () => {} });

test('round 7 is a hybrid test: real AI proposers, scripted forecasters, an actual swap and a measured loss', async () => {
  const { rounds, network } = await loadRoundEvidence();
  assert.deepEqual(network, { chainId: 1313161555, name: 'Aurora testnet' });
  const r7 = rounds.find((round) => round.roundId === '7');
  assert.equal(r7.kind, 'real-ai-proposals-scripted-forecasters');
  assert.equal(r7.genuineModelCalls, 4); assert.equal(r7.scriptedForecasters, 4); assert.equal(r7.attestationVerified, false);
  assert.deepEqual(r7.proposals.map((item) => [item.name, item.allocationBps]), [['Hold', 4487], ['Conservative', 500], ['Balanced', 4500], ['Momentum', 7500], ['HighBeta', 9500]]);
  assert.deepEqual(r7.winner, { proposalId: '3', name: 'Momentum', allocationBps: 7500, isHold: false });
  assert.ok(r7.forecasters.length === 4 && r7.forecasters.every((item) => item.action === 'buy' && item.scripted === true), 'round 7 forecasters are scripted fixtures');
  assert.equal(r7.swap.transactionHash, '0x63a743ae801bc7ee0e51b71397e87148e1838ffccbc6c7397d05a2e92a028ead');
  assert.equal(r7.swap.independentlyChecked, true);
  assert.equal(r7.realisedReturnX18, '997835674193170672', 'a measured -0.2164% return, shown as a loss');
  assert.deepEqual(r7.reputation, { agent: '0x8b6af0b1738b941c0c7dd4deec6fabee3447888f', score: '-1', transactionHash: '0x0a2be8476e8527709b049a84ab2ac9ccc33d6674060835badd39f6805b7dfe04', blockNumber: '277266787', contract: '0xac9c56f1c032f74a9e84703602894315df2d9488' });
  assert.deepEqual(r7.checks, { independentPassed: true, returnRecomputed: true, payoutsRecomputed: true, swapChecked: true });
  assert.equal(r7.payouts.find((item) => item.name === 'Quant').profitLoss, '-31981');
  assert.equal(r7.transactions.length, 50);
  assert.ok(r7.transactions.every((item) => /^0x[0-9a-f]{64}$/.test(item.transactionHash) && /^\d+$/.test(item.blockNumber)));
});

test('round 8: eight genuine calls, every forecaster abstained, Hold won, no swap and full redemptions', async () => {
  const r8 = (await loadRoundEvidence()).rounds.find((round) => round.roundId === '8');
  assert.equal(r8.genuineModelCalls, 8); assert.equal(r8.scriptedForecasters, 0);
  assert.deepEqual(r8.winner, { proposalId: '0', name: 'Hold', allocationBps: 7489, isHold: true });
  assert.ok(r8.forecasters.length === 4 && r8.forecasters.every((item) => item.action === 'abstain' && item.scripted === false && item.reason.length > 0));
  assert.equal(r8.swap, null, 'Hold won: no investment swap');
  assert.ok(r8.payouts.every((item) => item.payout === '10000000' && item.deposit === '10000000' && item.profitLoss === '0'));
  assert.equal(r8.totals.deposits, r8.totals.paid);
  assert.equal(r8.reputation, null, 'Hold rounds never score');
  assert.ok(r8.correction.includes('eight distinct agent wallets'));
  assert.ok(r8.limitations.some((item) => /abstained/.test(item)));
});

test('tampered or malformed evidence is rejected instead of displayed', async () => {
  const cases = [
    ['docs/test-evidence/round7-hybrid/report.json', (r) => { r.confirmedTransactions[3].hash = 'javascript:alert(1)'; }, /32-byte hash/],
    ['docs/test-evidence/round7-hybrid/report.json', (r) => { r.completion.chainId = 1313161554; }, /Aurora testnet/],
    ['docs/test-evidence/round8-swarm/independent.json', (r) => { r.winner = '3'; }, /winner disagrees/],
    ['docs/test-evidence/round7-hybrid/swap-independent.json', (r) => { r.hash = `0x${'1'.repeat(64)}`; }, /different transaction/],
    ['docs/test-evidence/round7-hybrid/report.json', (r) => { r.completion.payouts[0].profitLoss = '0'; }, /payout arithmetic/],
    ['docs/test-evidence/round8-swarm/report.json', (r) => { r.completion.payouts[0].payout = 10000000; }, /integer string/],
    ['docs/test-evidence/round7-hybrid/report.json', (r) => { r.confirmedTransactions[0].label = '<img src=x>'; }, /label/],
    ['docs/test-evidence/round7-hybrid/report.json', (r) => { r.completion.round.rMin = '1000000000000000000'; }, /payout bounds are inconsistent/],
    ['docs/test-evidence/round8-swarm/report.json', (r) => { r.completion.round.evaluationEnd = r.completion.round.tradingStart; }, /payout bounds are inconsistent/],
    ['docs/test-evidence/tidepool-v1/happy-path.json', (r) => { delete r.completion.round.twapWindow; }, /TWAP window/],
  ];
  for (const [file, mutate, expected] of cases) await assert.rejects(loadRoundEvidence({ read: tampered(file, mutate) }), expected, String(expected));
  // A report/independent disagreement that is structurally valid is surfaced, not hidden.
  const disagreeing = await loadRoundEvidence({ read: tampered('docs/test-evidence/round7-hybrid/independent.json', (r) => { r.recomputedReturn = '1000000000000000000'; }) });
  assert.equal(disagreeing.rounds[0].checks.returnRecomputed, false);
  const hostileText = await loadRoundEvidence({ read: tampered('docs/test-evidence/round8-swarm/report.json', (r) => { r.limitations[0] = '\u202eevil\u0000 text'; }) });
  assert.equal(hostileText.rounds[1].limitations[0], 'evil text');
});

test('GET /api/evidence/testnet-rounds only; disabled is 404 and invalid evidence is 503', async () => {
  const evidence = await roundEvidenceFromEnvironment({});
  const app = await startServer({ port: 19264, runtime: runtime(), funding: null, reputation: null, evidence });
  const call = (path, init) => fetch(`http://127.0.0.1:19264${path}`, init);
  try {
    const response = await call('/api/evidence/testnet-rounds');
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).rounds.slice(0, 3).map((round) => round.roundId), ['7', '8', '1'], 'fixed sources first, discovered rounds after');
    for (const method of ['POST', 'PUT', 'DELETE']) assert.equal((await call('/api/evidence/testnet-rounds', { method, headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 404, method);
    assert.equal((await call('/api/evidence')).status, 404);
    assert.equal((await call('/api/evidence/testnet-rounds', { headers: { Origin: 'https://evil.example' } })).status, 403);
  } finally { await app.close(); }
  assert.equal(await roundEvidenceFromEnvironment({ WAVEFUND_EVIDENCE: 'disabled' }), null);
  const broken = await roundEvidenceFromEnvironment({}, { read: tampered('docs/test-evidence/round7-hybrid/report.json', (r) => { r.completion.chainId = 1; }) });
  const second = await startServer({ port: 19265, runtime: runtime(), funding: null, reputation: null, evidence: broken });
  try {
    const response = await fetch('http://127.0.0.1:19265/api/evidence/testnet-rounds');
    assert.equal(response.status, 503); assert.equal((await response.json()).code, 'EVIDENCE_INVALID');
  } finally { await second.close(); }
});

test('the Tidepool round is identified by network + engine + round id and keeps scripted forecasters scripted', async () => {
  const { rounds, stacks } = await loadRoundEvidence();
  assert.deepEqual(stacks.map((stack) => [stack.id, stack.engine]), [['original', '0x825b31dbc1af25b230d31caf5210c2b5a8fe22af'], ['tidepool', '0xba96a117f4de33c38df72002651f11024ed14a14']]);
  const tidepool = rounds.find((round) => round.stack.id === 'tidepool');
  assert.equal(tidepool.key, '1313161555:0xba96a117f4de33c38df72002651f11024ed14a14:1');
  assert.equal(tidepool.roundId, '1'); assert.equal(tidepool.evidence, 'saved-independently-verified');
  assert.deepEqual(tidepool.winner, { proposalId: '3', name: 'Momentum', allocationBps: 7500, isHold: false });
  assert.ok(tidepool.forecasters.every((item) => item.scripted === true), 'test-fixture forecasters are never shown as model decisions');
  assert.equal(tidepool.swap.transactionHash, '0x4dc76edba6d01cb0eacb6bcd8538ce9d5071b4e24d2872a8c4ed13da61a2de40');
  assert.equal(tidepool.swap.stableDelta, '-149610000'); assert.equal(tidepool.swap.assetDelta, '71692173391461052');
  assert.equal(tidepool.realisedReturnX18, '993541889635073190');
  assert.deepEqual(tidepool.market, { tradingStart: '1794434097', tradingEnd: '1794434503', evaluationEnd: '1794434683', twapWindowSeconds: '90',
    returnBounds: { minX18: '950000000000000000', maxX18: '1050000000000000000' }, longPayoutX18: '435418896350731900' }, 'the round terms are read from its own completion record');
  assert.deepEqual(tidepool.payouts.map((item) => [item.name, item.payout]), [['Quant', '9934985'], ['Guardian', '10020700'], ['FeeAnalyst', '10000000'], ['StressAnalyst', '9981677']]);
  assert.deepEqual([tidepool.reputation.score, tidepool.reputation.contract], ['-1', '0xfa71a652547284d1034ae6813ed4a882cb354e92']);
  assert.deepEqual(tidepool.checks, { independentPassed: true, returnRecomputed: true, payoutsRecomputed: true, swapChecked: true });
  // Round ids alone are not unique across engines; keys are.
  assert.equal(new Set(rounds.map((round) => round.key)).size, rounds.length);
  const original7 = rounds.find((round) => round.roundId === '7');
  assert.notEqual(original7.stack.engine, tidepool.stack.engine);
  await assert.rejects(loadRoundEvidence({ sources: [ROUND_SOURCES[2], ROUND_SOURCES[2]] }), /share one network \+ engine \+ round id/);
});

test('evidence naming another Safe, engine or reputation contract than its stack is rejected', async () => {
  const cases = [
    ['docs/test-evidence/tidepool-v1/plan.json', (p) => { p.safe = '0x781430393ec48f5c2af78be63ae273875b180ad1'; }, /different Safe/],
    ['docs/test-evidence/tidepool-v1/plan.json', (p) => { p.engine = '0x825b31dbc1af25b230d31caf5210c2b5a8fe22af'; }, /different engine/],
    ['docs/test-evidence/tidepool-v1/reputation.json', (r) => { r[2].reputation = '0xac9c56f1c032f74a9e84703602894315df2d9488'; }, /different contract/],
    ['docs/test-evidence/tidepool-v1/capital-linkage.json', (c) => { c.executionHash = `0x${'3'.repeat(64)}`; }, /execute transaction/],
    ['deployments/aurora-testnet-tidepool-reputation.json', (m) => { m.contracts.engine = '0x825b31dbc1af25b230d31caf5210c2b5a8fe22af'; }, /different engine/],
  ];
  for (const [file, mutate, expected] of cases) await assert.rejects(loadRoundEvidence({ read: tampered(file, mutate) }), expected, String(expected));
});

// ---------------------------------------------------------------- discovered pre-registered Tidepool rounds
// Fixtures are SYNTHETIC: the public Tidepool round 1 files relabelled as another round id, with pre-registered terms.
const V1 = 'docs/test-evidence/tidepool-v1';
const ONE = 10n ** 18n;
const SETTLE = { stablePrice: 999920000000000000n, assetPrice: 2068220000000000000000n }; // public round 1 settlement oracle update
const relabel = (value, n) => JSON.parse(JSON.stringify(value).replaceAll('"round1:', `"round${n}:`).replaceAll('reputation:round1"', `reputation:round${n}"`));

function probeEvent(n, completion, transactions) {
  const rs = 80000000000n; const ra = rs * 10n ** 30n / 2070000000000000000000n; const amount = 5000000000n;
  const reserves = (stable, asset, blockNumber) => ({ blockNumber, reserveStable: String(stable), reserveAsset: String(asset), poolAssetPriceX18: String(stable * 10n ** 30n / asset) });
  const bought = v2AmountOut(amount, rs, ra);
  const back = v2AmountOut(bought, ra - bought, rs + amount);
  const p = completion.portfolio; const ending = BigInt(p.stableQty6) * SETTLE.stablePrice / 1000000n + BigInt(p.assetQty18) * SETTLE.assetPrice / ONE;
  const inputs = { stablePrice: SETTLE.stablePrice, assetPrice: SETTLE.assetPrice, maxSlippageBps: 100n, referenceStableIn: 149610000n, referenceAssetIn: 71692173391461052n };
  const str = (value) => JSON.parse(JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v));
  const settle = transactions.find((t) => t.label === `round${n}:settle`);
  return str({ stage: 'manipulation-probe', roundId: String(n), status: 'complete', pair: '0x218f2849e4401c194bf9068edf41fd3a8f643a1b', router: '0x26ec2afbdfdfb972f106100a3deae5887353d9b9',
    token0: '0x38d81431b9f76d9699af7517040d5221d9dea252', stableAmount: amount, before: reserves(rs, ra, '10'), manipulated: reserves(rs + amount, ra - bought, '12'),
    atSettlement: reserves(rs + amount, ra - bought, settle.blockNumber), restored: reserves(rs + amount - back, ra, '20'),
    oracleAtManipulation: { stablePrice: SETTLE.stablePrice, assetPrice: SETTLE.assetPrice, publishedAt: '1794434600' }, poolDeviationBeforeBps: '8', poolDeviationManipulatedBps: '1300',
    assetBought: bought, stableRecovered: back, stableAllowanceAfter: '0', assetAllowanceAfter: '0',
    settlement: { settleHash: settle.hash, oracle: { ...SETTLE, publishedAt: p.oraclePublishedAt }, stableQty6: p.stableQty6, assetQty18: p.assetQty18, startingValueX18: p.startingValueX18,
      measuredReturnX18: p.realisedReturn, oracleEndingValueX18: ending, oracleRecomputedReturnX18: ending * ONE / BigInt(p.startingValueX18), observationHash: p.observationHash, usedOracle: true, poolMarkedReturnX18: '1020000000000000000' },
    moduleCheck: { computedNotExecuted: true, referenceIsExecutedSwap: true,
      before: moduleCheckAtPool({ reserves: { reserveStable: rs, reserveAsset: ra }, ...inputs }), manipulated: moduleCheckAtPool({ reserves: { reserveStable: rs + amount, reserveAsset: ra - bought }, ...inputs }) },
    transactions: ['approve', 'swap', 'approveRestore', 'restore'].map((name, i) => ({ label: `round${n}:probe:${name}`, hash: `0x${String(i + 1).repeat(64)}`, blockNumber: String(10 + i * 4) })) });
}

// A session as the operator would hold it: plan, completion, journal (confirmed + prepared), reputation journal, verifier output.
async function session(n, { target = 3, hold = false, flat = false, probe = false, evaluationSeconds = 180 } = {}) {
  const report = relabel(await read(`${V1}/happy-path.json`), n); const plan = relabel(await read(`${V1}/plan.json`), n);
  const independent = await read(`${V1}/independent-round.json`); const reputation = relabel(await read(`${V1}/reputation.json`), n);
  const completion = report.completion; const id = String(n);
  for (const item of [plan, plan.snapshot, completion, independent]) item.roundId = id;
  Object.assign(plan, { scriptedTarget: target, evaluationSeconds });
  Object.assign(completion, { scriptedTarget: target, evaluationSeconds, scope: roundScope({ hybrid: true, scriptedTarget: target, evaluationSeconds, probe: probe ? { stableAmount: 5000000000n } : null }) });
  completion.round.evaluationEnd = String(BigInt(completion.round.tradingEnd) + BigInt(evaluationSeconds));
  if (hold) { completion.winner = '0'; completion.round.winnerId = 0; independent.winner = '0'; }
  if (flat) for (const holder of [completion.round, completion.portfolio]) holder.realisedReturn = ONE.toString();
  if (flat) independent.recomputedReturn = ONE.toString();
  const done = reputation.find((e) => e.stage === 'reputationComplete'); done.roundId = id; done.returnFactor = completion.round.realisedReturn; done.point = flat ? '0' : '-1';
  const confirmed = report.confirmedTransactions.map((t) => ({ ...t }));
  // A later round has its own execute transaction; the manifest's demonstration swap belongs to round 1 only.
  if (n !== 1) confirmed.find((t) => t.label === `round${n}:execute`).hash = `0x${'e7'.repeat(32)}`;
  if (probe) confirmed.push(...probeEvent(n, completion, confirmed).transactions.map((t) => ({ stage: 'confirmed', label: t.label, actor: 'owner', hash: t.hash, blockNumber: t.blockNumber, gasUsed: '50000', gasPrice: '70000000' })));
  const execute = confirmed.find((t) => t.label === `round${n}:execute`);
  const journal = [...confirmed.flatMap((t) => [{ stage: 'prepared', label: t.label, hash: t.hash, nonce: 1, calldataHash: `0x${'c'.repeat(64)}` }, t]),
    { stage: 'execution', hash: execute.hash, swaps: hold ? [] : [{ sender: '0x26ec2aFBDFdFB972F106100A3deaE5887353d9B9', to: '0x37947266Fc1c2B20FFa36869af5DD531F2D80f11', amount0In: '149610000', amount1In: '0', amount0Out: '0', amount1Out: '71692173391461052' }] },
    ...(probe ? [probeEvent(n, completion, confirmed)] : [])];
  const swapCheck = hold ? null : { blockNumber: execute.blockNumber, stableBefore: '199480000', stableAfter: '49870000', assetBefore: '0', assetAfter: '71692173391461052', stableAllowance: '0', assetAllowance: '0', slippageBps: 100, token0: '0x38d81431b9f76d9699af7517040d5221d9dea252' };
  return { roundId: id, plan, complete: completion, journal, reputationEvents: hold ? [] : reputation, independent, swapCheck,
    manifest: await read('deployments/aurora-testnet-tidepool.json'), reputationManifest: await read('deployments/aurora-testnet-tidepool-reputation.json') };
}
// Serves exported files as if they were committed under docs/test-evidence/tidepool-rounds/.
function serving(exports) {
  const files = new Map(); const dirs = [];
  for (const [n, output] of Object.entries(exports)) { dirs.push({ name: n, directory: true }); for (const [name, value] of Object.entries(output)) files.set(`docs/test-evidence/tidepool-rounds/${n}/${name}`, structuredClone(value)); }
  return { list: async () => dirs, read: async (path) => files.has(path) ? structuredClone(files.get(path)) : read(path), files };
}

test('exported pre-registered rounds are discovered and validated like fixed sources: scored+probe, Hold and flat-0', async () => {
  const scored = buildRoundEvidence(await session(2, { probe: true }));
  const hold = buildRoundEvidence(await session(3, { target: 0, hold: true, evaluationSeconds: 900 }));
  const flat = buildRoundEvidence(await session(4, { flat: true }));
  assert.deepEqual(Object.keys(scored.files).sort(), ['capital-linkage.json', 'independent.json', 'manipulation-probe.json', 'plan.json', 'report.json', 'reputation.json', 'round.json', 'swap-independent.json']);
  assert.deepEqual(Object.keys(hold.files).sort(), ['independent.json', 'plan.json', 'report.json', 'round.json'], 'Hold: no swap, capital or reputation file');
  assert.ok(!JSON.stringify(scored.files['report.json'].confirmedTransactions).includes('calldataHash'), 'prepared journal internals are not exported');
  const { list, read: served } = serving({ round2: scored.files, round3: hold.files, round4: flat.files });
  const evidence = await loadRoundEvidence({ list, read: served });
  assert.deepEqual(evidence.rounds.map((round) => round.roundId), ['7', '8', '1', '2', '3', '4']);
  const [r2, r3, r4] = evidence.rounds.slice(3);
  assert.equal(r2.key, '1313161555:0xba96a117f4de33c38df72002651f11024ed14a14:2');
  assert.deepEqual(r2.preRegistration, { scriptedTarget: '3', evaluationSeconds: 180 });
  assert.equal(r2.swap.stableDelta, '-149610000'); assert.equal(r2.reputation.score, '-1');
  assert.deepEqual(r2.checks, { independentPassed: true, returnRecomputed: true, payoutsRecomputed: true, swapChecked: true, probeOracleUsed: true });
  assert.equal(r2.manipulationProbe.measuredReturnX18, r2.realisedReturnX18); assert.equal(r2.manipulationProbe.moduleCheck.manipulated.buyAsset.wouldReject, true);
  assert.equal(r2.manipulationProbe.transactions.length, 4);
  assert.deepEqual(r3.winner, { proposalId: '0', name: 'Hold', allocationBps: 0, isHold: true });
  assert.deepEqual([r3.swap, r3.reputation, r3.manipulationProbe], [null, null, null]);
  assert.deepEqual(r3.preRegistration, { scriptedTarget: '0', evaluationSeconds: 900 });
  assert.equal(r3.market.evaluationEnd - 0, Number(r3.market.tradingEnd) + 900);
  assert.equal(r4.realisedReturnX18, ONE.toString()); assert.equal(r4.reputation.score, '0', 'flat round scores zero');
  // The fixed sources are untouched by discovery.
  const fixed = await loadRoundEvidence({ discover: false });
  assert.deepEqual(evidence.rounds.slice(0, 3), fixed.rounds);
  // Discovery returns exactly the committed round folders, in order, and each one validates through the real loader.
  const { readdir } = await import('node:fs/promises');
  const onDisk = (await readdir(new URL('../../docs/test-evidence/tidepool-rounds/', import.meta.url), { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory() && /^round[0-9]+$/.test(entry.name)).map((entry) => entry.name.slice(5)).sort((a, b) => Number(a) - Number(b));
  const discovered = await discoverRoundSources();
  assert.deepEqual(discovered.map((source) => source.roundId), onDisk);
  const live = await loadRoundEvidence();
  assert.deepEqual(live.rounds.filter((round) => round.stack.id === 'tidepool').map((round) => round.roundId).slice(1), onDisk);
});

test('malformed discovered rounds are rejected, not displayed', async () => {
  const good = buildRoundEvidence(await session(2, { probe: true })).files;
  const holdFiles = buildRoundEvidence(await session(3, { target: 0, hold: true })).files;
  const round3Reputation = buildRoundEvidence(await session(3)).files['reputation.json'];
  const variant = (mutate, name = 'round2', files = good) => { const copy = structuredClone(files); mutate(copy); return { [name]: copy }; };
  const cases = [
    [variant(() => {}, 'round02'), /unexpected evidence directory/],
    [variant(() => {}, 'round3'), /manifest names round 2/],
    [variant((f) => { f['round.json'].files.swap = 'swap'; }), /manifest file swap/],
    [variant((f) => { delete f['round.json'].files.capital; }), /swap and capital linkage come together/],
    [variant((f) => { f['round.json'].stack = 'original'; }), /Tidepool stack/],
    [variant((f) => { f['round.json'].extra = true; }), /unexpected fields/],
    [variant((f) => { delete f['round.json'].files.independent; }), /missing report, plan or independent/],
    [variant((f) => { delete f['report.json'].completion.scriptedTarget; delete f['report.json'].completion.evaluationSeconds; delete f['plan.json'].scriptedTarget; }), /pre-registered target and evaluation window/],
    [variant((f) => { f['plan.json'].scriptedTarget = 2; f['report.json'].completion.scriptedTarget = 2; }), /winner is not the pre-registered scripted target/],
    [variant((f) => { f['plan.json'].scriptedTarget = 2; }), /disagree on the scripted target/],
    [variant((f) => { f['report.json'].completion.evaluationSeconds = 600; f['plan.json'].evaluationSeconds = 600; }), /evaluationEnd - tradingEnd/],
    [variant((f) => { f['report.json'].completion.evaluationSeconds = 4000; }), /180\.\.3600/],
    [variant((f) => { f['report.json'].completion.scope = 'Forecasters picked proposal3.'; }), /SCRIPTED/],
    [variant((f) => { f['reputation.json'][2].point = '1'; }), /sign\(return - 1\)/],
    [variant((f) => { f['reputation.json'][1].label = 'reputation:round1'; }), /labelled for another round/],
    [variant((f) => { f['reputation.json'] = structuredClone(round3Reputation); f['round.json'].files.reputation = 'reputation'; }, 'round3', holdFiles), /Hold rounds never score/],
    [variant((f) => { f['manipulation-probe.json'].settlement.measuredReturnX18 = '1000000000000000000'; }), /disagrees with the round portfolio/],
    [variant((f) => { f['manipulation-probe.json'].settlement.oracleRecomputedReturnX18 = '1'; }), /oracle arithmetic/],
    [variant((f) => { f['manipulation-probe.json'].pair = '0x' + '12'.repeat(20); }), /investment pair/],
    [variant((f) => { f['manipulation-probe.json'].stableAmount = '20000000001'; }), /20000 test USDC cap/],
    [variant((f) => { f['manipulation-probe.json'].transactions[1].hash = '0x' + '9'.repeat(64); }), /not a confirmed round transaction/],
    [variant((f) => { f['manipulation-probe.json'].moduleCheck.manipulated.buyAsset.wouldReject = false; }), /rejection does not follow/],
    [variant((f) => { f['manipulation-probe.json'].settlement.usedOracle = false; }), /status and oracle check disagree/],
    [variant((f) => { f['manipulation-probe.json'].secret = 'x'; }), /unexpected fields/],
    [variant((f) => { f['manipulation-probe.json'].manipulated.poolAssetPriceX18 = '1'; }), /price does not match its reserves/],
    [variant((f) => { f['manipulation-probe.json'].settlement.settleHash = '0x' + '4'.repeat(64); }), /settlement other than the round settle/],
  ];
  for (const [exports, expected] of cases) {
    const { list, read: served } = serving(exports);
    await assert.rejects(loadRoundEvidence({ list, read: served }), expected, String(expected));
  }
  // Discriminates: the unmodified exports load, and a duplicate of the fixed round 1 is caught by the key check.
  const ok = serving({ round2: good }); assert.equal((await loadRoundEvidence(ok)).rounds.length, 4);
  const dup = buildRoundEvidence(await session(1)).files;
  await assert.rejects(loadRoundEvidence(serving({ round1: dup })), /share one network \+ engine \+ round id/);
});

test('the exporter refuses unresolved, failed, unverified or secret-bearing sessions', async () => {
  const cases = [
    [(s) => { s.journal.push({ stage: 'prepared', label: 'round2:redeem:Quant', hash: '0x' + 'f'.repeat(64) }); }, /unresolved prepared/],
    [(s) => { s.independent.passed = false; }, /independent verifier/],
    [(s) => { s.independent.recomputedReturn = '1'; }, /disagrees with the completion/],
    [(s) => { s.swapCheck = null; }, /balance read is required/],
    [(s) => { s.plan.records[0].apiKey = 'unit-test-placeholder'; }, /looks secret/],
    [(s) => { s.plan.records[0].note = `0x${'ab'.repeat(120)}`; }, /raw signed bytes/],
    [(s) => { s.journal.push({ stage: 'run', status: 'failed', reason: 'x' }); }, /failed stage/],
    [(s) => { s.complete.roundId = '5'; }, /another round/],
    [(s) => { s.swapCheck.stableAllowance = '7'; }, /projection checks failed/],
  ];
  for (const [mutate, expected] of cases) { const s = await session(2); mutate(s); assert.throws(() => buildRoundEvidence(s), expected, String(expected)); }
  const hold = await session(3, { target: 0, hold: true }); hold.reputationEvents = (await session(3)).reputationEvents;
  assert.throws(() => buildRoundEvidence(hold), /Hold rounds never score/);
  const unrecorded = await session(2); unrecorded.reputationEvents = [];
  const result = buildRoundEvidence(unrecorded);
  assert.equal(result.files['reputation.json'], undefined); assert.match(result.warnings[0], /record-reputation --round/);
});
