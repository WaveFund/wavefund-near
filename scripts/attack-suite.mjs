#!/usr/bin/env node
// Live attack suite: simulates attacks against the DEPLOYED Tidepool stack with eth_call only.
// No keys, no signing, no transactions. Every call is pinned to ONE block number and must revert
// with its exact named custom error (decoded from the contract ABI). A call that succeeds, or reverts
// with a different error, fails the suite (exit 1).
// Usage: node scripts/attack-suite.mjs [--rpc URL] [--out docs/test-evidence/attack-suite.json] [--block N]
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, http, encodeFunctionData, decodeErrorResult } from 'viem';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ERROR_ABI_SOURCES = {
  TradingSafeModule: '/private/tmp/wavefund-safe-round-artifacts/TradingSafeModule.sol/TradingSafeModule.json',
  QuantumRound: '/private/tmp/wavefund-safe-round-artifacts/QuantumRound.sol/QuantumRound.json',
  PerformanceTracker: '/private/tmp/wavefund-safe-round-artifacts/PerformanceTracker.sol/PerformanceTracker.json',
  AuroraTestToken: '/private/tmp/wavefund-safe-round-artifacts/AuroraTestToken.sol/AuroraTestToken.json',
  AgentReputation: '/private/tmp/wavefund-final-source-artifacts/AgentReputation.json',
};
const STRANGER = '0x00000000000000000000000000000000000dead1';
const FORECASTER_R8 = '0x954362D2D831fC9430122d95F79c2eE3841E975D'; // round 8 payouts[0], already redeemed

/** Pure: classify a raw eth_call outcome against an expectation. Exported for offline tests. */
export function classify({ expectedError, abi }, outcome) {
  if (outcome.ok) return { observedError: null, pass: false, note: 'call SUCCEEDED (attack not blocked)' };
  const data = outcome.data;
  if (typeof data !== 'string' || !/^0x[0-9a-fA-F]{8,}$/.test(data)) return { observedError: null, pass: false, note: 'revert without decodable data' };
  let name;
  try { name = decodeErrorResult({ abi, data }).errorName; } catch { return { observedError: `undecodable:${data.slice(0, 10)}`, pass: false, note: 'selector not in ABI' }; }
  return { observedError: name, pass: name === expectedError };
}

/** Pull revert data out of whatever shape a viem/RPC error takes. */
export function revertDataOf(error) {
  for (let e = error; e; e = e.cause) {
    if (typeof e.data === 'string' && e.data.startsWith('0x')) return e.data;
    if (e.data && typeof e.data.data === 'string') return e.data.data;
  }
  const m = /"data":"(0x[0-9a-fA-F]+)"/.exec(String(error?.message ?? '') + String(error?.details ?? ''));
  return m ? m[1] : undefined;
}

export function buildAttacks(c) {
  const rep = (id) => ({ id });
  return [
    { name: 'Non-owner authorizes a round on the Safe module', contract: 'TradingSafeModule', address: c.module, function: 'authorizeRound', from: STRANGER, args: [9n, 2000000000n, 2000003600n, 2000001800n, 990000000000000000n, 1010000000000000000n, 60n], expectedError: 'OnlySafe' },
    { name: 'Re-execute an already-executed settled round (8)', contract: 'TradingSafeModule', address: c.module, function: 'execute', from: STRANGER, args: [8n, 0n, 2000000000n], expectedError: 'NotExecutable' },
    { name: 'Execute a cancelled round (4)', contract: 'TradingSafeModule', address: c.module, function: 'execute', from: STRANGER, args: [4n, 0n, 2000000000n], expectedError: 'NotExecutable' },
    { name: 'Non-keeper opens a round', contract: 'QuantumRound', address: c.engine, function: 'openRound', from: STRANGER, args: [2000000000n, 3600n, 990000000000000000n, 1010000000000000000n, 60n], expectedError: 'AccessControlUnauthorizedAccount' },
    { name: 'Settle the performance observation of round 8 again', contract: 'PerformanceTracker', address: c.tracker, function: 'settle', from: STRANGER, args: [8n], expectedError: 'AlreadyObserved' },
    { name: 'Collapse an already-settled round (8)', contract: 'QuantumRound', address: c.engine, function: 'collapse', from: STRANGER, args: [8n], expectedError: 'AlreadyCollapsed' },
    { name: 'Redeem round 8 twice (already-paid forecaster)', contract: 'QuantumRound', address: c.engine, function: 'redeem', from: FORECASTER_R8, args: [8n], expectedError: 'NothingToRedeem' },
    { name: 'Record reputation for a Hold round (6)', contract: 'AgentReputation', address: c.reputation, function: 'record', from: STRANGER, args: [6n], expectedError: 'NoAgentWinner' },
    { name: 'Record reputation for a Hold round (7)', contract: 'AgentReputation', address: c.reputation, function: 'record', from: STRANGER, args: [7n], expectedError: 'NoAgentWinner' },
    { name: 'Record reputation for round 8 a second time', contract: 'AgentReputation', address: c.reputation, function: 'record', from: STRANGER, args: [8n], expectedError: 'AlreadyRecorded' },
    { name: 'Stranger mints test tokens', contract: 'AuroraTestToken', address: c.asset, function: 'mint', from: STRANGER, args: [STRANGER, 1000000000000000000n], expectedError: 'OnlyOperator' },
    { name: 'Submit a proposal to a settled (non-trading) round', contract: 'QuantumRound', address: c.engine, function: 'propose', from: STRANGER, args: [8n, { tEthBps: 5000 }, 'attack'], expectedError: 'TradingNotOpen' },
  ];
}

async function loadAbi(file) { return JSON.parse(await readFile(file, 'utf8')).abi; }

export async function runSuite({ client, manifest, abis, block, attacks = buildAttacks(manifest.contracts) }) {
  const results = [];
  for (const a of attacks) {
    const abi = abis[a.contract];
    let outcome;
    try {
      await client.call({ account: a.from, to: a.address, data: encodeFunctionData({ abi, functionName: a.function, args: a.args }), blockNumber: block });
      outcome = { ok: true };
    } catch (error) { outcome = { ok: false, data: revertDataOf(error) }; }
    const verdict = classify({ expectedError: a.expectedError, abi }, outcome);
    results.push({ name: a.name, contract: a.contract, address: a.address, function: a.function, from: a.from, args: a.args.map((x) => (typeof x === 'bigint' ? x.toString() : typeof x === 'object' ? JSON.stringify(x) : x)), expectedError: a.expectedError, observedError: verdict.observedError, pass: verdict.pass, blockNumber: block.toString() });
  }
  return results;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { rpc: { type: 'string', default: 'https://testnet.aurora.dev' }, out: { type: 'string', default: path.join(ROOT, 'docs/test-evidence/attack-suite.json') }, block: { type: 'string' } } });
  const manifest = JSON.parse(await readFile(path.join(ROOT, 'deployments/aurora-testnet-tidepool.json'), 'utf8'));
  const abis = Object.fromEntries(await Promise.all(Object.entries(ERROR_ABI_SOURCES).map(async ([k, f]) => [k, await loadAbi(f)])));
  const client = createPublicClient({ transport: http(values.rpc, { fetchOptions: { headers: { 'user-agent': 'wavefund-attack-suite/1' } } }) });
  if (await client.getChainId() !== manifest.chainId) throw new Error('wrong chain');
  const block = values.block ? BigInt(values.block) : await client.getBlockNumber();
  const results = await runSuite({ client, manifest, abis, block });
  const failed = results.filter((r) => !r.pass);
  const doc = { schemaVersion: 1, kind: 'live-attack-suite', chainId: manifest.chainId, rpc: values.rpc, blockNumber: block.toString(), method: 'eth_call at one pinned block; no keys, no transactions', total: results.length, passed: results.length - failed.length, results };
  await writeFile(values.out, JSON.stringify(doc, null, 2) + '\n');
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  expected=${r.expectedError} observed=${r.observedError}`);
  console.log(`${doc.passed}/${doc.total} blocked at block ${doc.blockNumber}`);
  process.exit(failed.length ? 1 : 0);
}
