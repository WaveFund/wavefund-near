// Pure builder for PUBLIC per-round evidence of a pre-registered Tidepool round. No network, keys or file IO.
// Inputs are the operator session's public files (plan, complete event, journal), the reputation journal, the
// independent verifier output and an independent post-execution balance read. Only public hashes, receipts and
// values leave: prepared entries (nonces/calldata hashes), worker internals and anything key-like are never copied.
import { DISCOVERED_FILES, validateTidepoolRoundFiles } from './round-evidence.mjs';

const CHAIN_ID = 1313161555;
const NAMES = ['Hold', 'Conservative', 'Balanced', 'Momentum', 'HighBeta'];
const check = (condition, message) => { if (!condition) throw new Error(`Export refused: ${message}`); };
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const pick = (value, keys) => Object.fromEntries(keys.filter((key) => value[key] !== undefined).map((key) => [key, value[key]]));
const FORBIDDEN_KEY = /private|secret|apikey|api_key|actorkeys|mnemonic|seed ?phrase|signedtransaction|serialized|rawtransaction|authorization/i;

// Defence in depth: the public files must not contain key-like fields or raw signed transactions.
export function assertPublic(value, path = 'evidence') {
  if (Array.isArray(value)) return value.forEach((item, index) => assertPublic(item, `${path}[${index}]`));
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) { check(!FORBIDDEN_KEY.test(key), `${path}.${key} looks secret`); assertPublic(item, `${path}.${key}`); }
    return;
  }
  if (typeof value === 'string') check(!/0x[0-9a-fA-F]{200,}/.test(value), `${path} holds raw signed bytes`);
}

const sumUsage = (records) => records.reduce((total, record) => ({ inputTokens: total.inputTokens + (record.usage?.inputTokens ?? 0), outputTokens: total.outputTokens + (record.usage?.outputTokens ?? 0) }), { inputTokens: 0, outputTokens: 0 });

export function buildRoundEvidence({ roundId, plan, complete, journal, reputationEvents = [], independent, swapCheck = null, manifest, reputationManifest }) {
  check(typeof roundId === 'string' && /^[1-9][0-9]{0,3}$/.test(roundId), 'round id must be a positive integer');
  check(manifest?.chainId === CHAIN_ID && plan?.chainId === CHAIN_ID && complete?.chainId === CHAIN_ID, 'Aurora testnet only');
  check(complete.stage === 'complete' && String(complete.roundId) === roundId && String(plan.roundId) === roundId, 'session files are for another round or incomplete');
  check(same(plan.engine, manifest.contracts.engine) && same(plan.safe, manifest.contracts.safe), 'session ran on another engine or Safe than the Tidepool manifest');
  check(Array.isArray(journal), 'journal missing');
  const prefix = `round${roundId}:`;
  const own = journal.filter((event) => typeof event?.label === 'string' && event.label.startsWith(prefix));
  const confirmedHashes = new Set(own.filter((e) => e.stage === 'confirmed').map((e) => e.hash));
  const unresolved = own.filter((e) => e.stage === 'prepared' && !confirmedHashes.has(e.hash));
  check(unresolved.length === 0, `unresolved prepared transactions: ${unresolved.map((e) => e.label).join(', ')}`);
  check(!journal.some((e) => e?.status === 'failed' && e.stage !== 'manipulation-probe-failed'), 'the session journal records a failed stage');
  const confirmedTransactions = own.filter((e) => e.stage === 'confirmed').map((e) => pick(e, ['stage', 'label', 'actor', 'hash', 'blockNumber', 'gasUsed', 'gasPrice']));
  const winner = String(complete.winner);
  const target = complete.scriptedTarget ?? null;
  const records = Array.isArray(plan.records) ? plan.records : [];
  const genuine = records.filter((r) => r.provider === 'near-ai');
  const scripted = records.filter((r) => r.role === 'forecaster' && r.provider === 'test-fixture');
  const hybrid = plan.kind === 'ai-proposals-scripted-forecasters';
  const evaluationSeconds = complete.evaluationSeconds;
  const winnerName = NAMES[Number(winner)] ?? `proposal${winner}`;

  check(independent?.chainId === CHAIN_ID && String(independent.roundId) === roundId && independent.passed === true, 'the independent verifier output is missing, for another round, or failed');
  check(String(independent.winner) === winner && independent.recomputedReturn === complete.round?.realisedReturn, 'the independent verifier disagrees with the completion');

  const execution = journal.filter((e) => e.stage === 'execution');
  check(execution.length === 1, 'exactly one execution event is required');
  const swaps = Array.isArray(execution[0].swaps) ? execution[0].swaps : [];
  const executeTx = confirmedTransactions.find((e) => e.label === `${prefix}execute`);
  check(executeTx && executeTx.hash === execution[0].hash, 'the execution event is not the round execute transaction');

  const limitations = [
    'Tidepool community testnet, not official mainnet 1Click execution.',
    'Investment and forecast tokens/liquidity are worthless test assets.',
    'Four real proposals use the same model and operator-defined risk mandates.',
    ...(hybrid ? [`All forecast bets are explicitly SCRIPTED fixtures aimed at the pre-registered target (proposal ${target}, ${NAMES[target]}); the winner reflects that script, not forecasting skill.`] : []),
    `Return is a ${evaluationSeconds}-second marked test portfolio observation at the oracle price, not real investment profit.`,
  ];
  const files = {};
  files.report = { schemaVersion: 1, date: new Date(Number(complete.round.evaluationEnd) * 1000).toISOString().slice(0, 10),
    kind: hybrid ? 'tidepool-funded-real-ai-proposals-scripted-forecasters' : 'tidepool-funded-real-ai-agents',
    genuineModelCalls: genuine.length, scriptedForecasters: scripted.length, modelUsage: sumUsage(genuine),
    maximumAuthorizedCostUsd: hybrid ? '0.05' : '0.10', preRegistration: { scriptedTarget: target, evaluationSeconds },
    completion: complete, confirmedTransactions, limitations };
  files.plan = plan;
  files.independent = independent;

  if (swaps.length) {
    check(swapCheck, 'the round swapped: an independent post-execution balance read is required');
    check(String(swapCheck.blockNumber) === String(executeTx.blockNumber), 'the balance read is not at the execution block');
    const stableDelta = BigInt(swapCheck.stableAfter) - BigInt(swapCheck.stableBefore);
    const assetDelta = BigInt(swapCheck.assetAfter) - BigInt(swapCheck.assetBefore);
    const swap = swaps[0]; const stableIs0 = same(swapCheck.token0, manifest.contracts.stable);
    const stableIn = BigInt(stableIs0 ? swap.amount0In : swap.amount1In); const stableOut = BigInt(stableIs0 ? swap.amount0Out : swap.amount1Out);
    const assetIn = BigInt(stableIs0 ? swap.amount1In : swap.amount0In); const assetOut = BigInt(stableIs0 ? swap.amount1Out : swap.amount0Out);
    const passed = swaps.length === 1 && stableDelta === stableOut - stableIn && assetDelta === assetOut - assetIn && String(swapCheck.stableAllowance) === '0' && String(swapCheck.assetAllowance) === '0';
    files.swap = { chainId: CHAIN_ID, blockNumber: String(swapCheck.blockNumber), safe: manifest.contracts.safe.toLowerCase(),
      tokens: { stable: { before: String(swapCheck.stableBefore), after: String(swapCheck.stableAfter), routerAllowance: String(swapCheck.stableAllowance) },
        asset: { before: String(swapCheck.assetBefore), after: String(swapCheck.assetAfter), routerAllowance: String(swapCheck.assetAllowance) } },
      slippageBps: Number(swapCheck.slippageBps), passed };
    files.capital = { chainId: CHAIN_ID, safe: manifest.contracts.safe.toLowerCase(), engine: manifest.contracts.engine.toLowerCase(), roundId,
      fundedAmount: String(manifest.funding?.deliveredAmount ?? '0'), preparedStableAmount: plan.snapshot.portfolio.stableBalance, preparedAssetAmount: plan.snapshot.portfolio.assetBalance,
      sameSafeAndCapital: same(plan.snapshot.safe, manifest.contracts.safe), executionHash: executeTx.hash };
  }

  const label = `reputation:round${roundId}`;
  const reputation = [
    ...reputationEvents.filter((e) => e?.label === label && e.stage === 'prepared').map((e) => pick(e, ['stage', 'label', 'hash', 'nonce', 'gas', 'gasPrice'])),
    ...reputationEvents.filter((e) => e?.label === label && e.stage === 'confirmed').map((e) => pick(e, ['stage', 'label', 'hash', 'blockNumber'])),
    ...reputationEvents.filter((e) => e?.stage === 'reputationComplete' && String(e.roundId) === roundId).slice(-1)
      .map((e) => pick(e, ['stage', 'chainId', 'reputation', 'roundId', 'winner', 'agent', 'returnFactor', 'point', 'score', 'statistics', 'previousStatistics', 'previousScore', 'verifiedFrom'])),
  ];
  const warnings = [];
  if (winner === '0') check(reputation.length === 0, 'a Hold round has a reputation record; Hold rounds never score');
  else if (reputation.some((e) => e.stage === 'reputationComplete')) {
    check(reputation.filter((e) => e.stage === 'confirmed').length === 1, 'the reputation record needs exactly one confirmed transaction');
    files.reputation = reputation;
  } else warnings.push('Reputation not yet recorded for this scored round; run record-reputation --round and export again.');

  const probes = journal.filter((e) => e.stage === 'manipulation-probe' && String(e.roundId) === roundId);
  if (probes.length) {
    const probe = probes[probes.length - 1]; const { stage, ...rest } = probe;
    if (['complete', 'complete-oracle-mismatch'].includes(probe.status)) files.probe = { chainId: CHAIN_ID, ...rest };
    else warnings.push(`Manipulation probe did not complete (${probe.status}); not exported as evidence.`);
  }
  if (journal.some((e) => e.stage === 'manipulation-probe-failed')) warnings.push('A manipulation-probe-failed event exists in the journal; inspect it.');

  const roleFiles = Object.fromEntries(Object.keys(files).map((role) => [role, DISCOVERED_FILES[role]]));
  const manifestFile = { schemaVersion: 1, stack: 'tidepool', roundId,
    title: target === null ? `Round ${roundId}: ${winnerName} won` : `Pre-registered round ${roundId}: scripted target ${NAMES[target]}`, files: roleFiles };
  const output = { 'round.json': manifestFile, ...Object.fromEntries(Object.entries(files).map(([role, value]) => [`${DISCOVERED_FILES[role]}.json`, value])) };
  assertPublic(output);
  // Round-trip through the same validator the API uses before anything is written.
  const projection = validateTidepoolRoundFiles({ source: { roundId, dir: 'in-memory', files: roleFiles, title: manifestFile.title }, files, manifest, reputationManifest });
  check(Object.values(projection.checks).every((value) => value !== false), `projection checks failed: ${JSON.stringify(projection.checks)}`);
  return { files: output, projection, warnings };
}
