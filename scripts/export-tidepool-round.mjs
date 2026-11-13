#!/usr/bin/env node
import { verifyTeeProposals } from '../runtime/agents/tee-proof.mjs';
// Export PUBLIC evidence for one pre-registered Tidepool round into docs/test-evidence/tidepool-rounds/round<N>/.
// Pure Node + public RPC reads only (no keys, no signing). Usage:
//   node scripts/export-tidepool-round.mjs --session .run/tidepool-v1/r2-conservative --round 2 \
//     [--reputation-journal .run/tidepool-v1/reputation.jsonl] [--independent <session>/independent.json] [--out docs/test-evidence/tidepool-rounds] [--replace]
// <session>/independent.json is the stdout of scripts/verify-aurora-round.mjs for this session (run it first).
import { readFile, writeFile, mkdir, rename, access } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import path from 'node:path';
import { createPublicClient, http, parseAbi } from 'viem';
import { buildRoundEvidence } from '../runtime/operator/tidepool-round-export.mjs';

const { values } = parseArgs({ options: {
  session: { type: 'string' }, round: { type: 'string' }, 'reputation-journal': { type: 'string', default: '.run/tidepool-v1/reputation.jsonl' },
  independent: { type: 'string' }, out: { type: 'string', default: 'docs/test-evidence/tidepool-rounds' },
  manifest: { type: 'string', default: 'deployments/aurora-testnet-tidepool.json' }, 'reputation-manifest': { type: 'string', default: 'deployments/aurora-testnet-tidepool-reputation.json' },
  replace: { type: 'boolean', default: false }, 'tee-policy': { type: 'string' },
} });
const fail = (message) => { console.error(message); process.exit(1); };
if (!values.session || !/^[1-9][0-9]{0,3}$/.test(values.round ?? '')) fail('Usage: --session <dir> --round <N> (see header)');
const json = async (file) => JSON.parse(await readFile(file, 'utf8'));
const jsonl = async (file, optional = false) => {
  try { return (await readFile(file, 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line)); }
  catch (error) { if (optional && error.code === 'ENOENT') return []; throw error; }
};
const session = values.session; const roundId = values.round;
const [manifest, reputationManifest, plan, complete, journal, reputationEvents, independent] = await Promise.all([
  json(values.manifest), json(values['reputation-manifest']), json(path.join(session, 'plan.json')), json(path.join(session, 'complete.json')),
  jsonl(path.join(session, 'journal.jsonl')), jsonl(values['reputation-journal'], true), json(values.independent ?? path.join(session, 'independent.json')),
]);

// Independent public read of the Safe's balances around the execution block (only when the round swapped).
let swapCheck = null;
const execution = journal.find((e) => e.stage === 'execution');
if (execution?.swaps?.length) {
  const client = createPublicClient({ transport: http('https://testnet.aurora.dev', { retryCount: 1, timeout: 20000 }) });
  if (await client.getChainId() !== 1313161555) fail('Wrong RPC chain');
  const executeTx = journal.find((e) => e.stage === 'confirmed' && e.label === `round${roundId}:execute`);
  if (!executeTx) fail('No confirmed execute transaction in the journal');
  const receipt = await client.getTransactionReceipt({ hash: executeTx.hash });
  if (receipt.status !== 'success' || receipt.to.toLowerCase() !== manifest.contracts.module.toLowerCase()) fail('Execute receipt mismatch');
  const block = receipt.blockNumber; const { contracts } = manifest;
  const erc20 = parseAbi(['function balanceOf(address) view returns(uint256)', 'function allowance(address,address) view returns(uint256)']);
  const read = (address, abi, functionName, args, blockNumber) => client.readContract({ address, abi, functionName, args, blockNumber });
  const [stableBefore, stableAfter, assetBefore, assetAfter, stableAllowance, assetAllowance, slippageBps, token0] = await Promise.all([
    read(contracts.stable, erc20, 'balanceOf', [contracts.safe], block - 1n), read(contracts.stable, erc20, 'balanceOf', [contracts.safe], block),
    read(contracts.asset, erc20, 'balanceOf', [contracts.safe], block - 1n), read(contracts.asset, erc20, 'balanceOf', [contracts.safe], block),
    read(contracts.stable, erc20, 'allowance', [contracts.safe, contracts.router], block), read(contracts.asset, erc20, 'allowance', [contracts.safe, contracts.router], block),
    read(contracts.module, parseAbi(['function maxSlippageBps() view returns(uint16)']), 'maxSlippageBps', [], block),
    read(manifest.integrations.investmentPair, parseAbi(['function token0() view returns(address)']), 'token0', []),
  ]);
  swapCheck = { blockNumber: block.toString(), stableBefore, stableAfter, assetBefore, assetAfter, stableAllowance, assetAllowance, slippageBps, token0 };
}

let teeProof = null;
if (plan.teeRequired === true) {
  if (!values['tee-policy']) fail('TEE export requires a separately reviewed --tee-policy file');
  const client = createPublicClient({ transport: http('https://testnet.aurora.dev', { retryCount: 0, timeout: 20000 }) });
  if (await client.getChainId() !== 1313161555) fail('Wrong TEE receipt chain');
  const receipts = [];
  for (const entry of journal.filter(e => e.stage === 'confirmed' && e.label?.startsWith(`round${roundId}:propose:`))) {
    const receipt = await client.getTransactionReceipt({ hash: entry.hash });
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    if (block.hash !== receipt.blockHash || receipt.blockNumber.toString() !== entry.blockNumber.toString()) fail('Noncanonical TEE proposal receipt');
    receipts.push(receipt);
  }
  const policy = await json(values['tee-policy']);
  await verifyTeeProposals(plan, receipts, policy);
  teeProof = { schemaVersion: 1, receipts };
}
const { files, projection, warnings } = buildRoundEvidence({ roundId, plan, complete, journal, reputationEvents, independent, swapCheck, manifest, reputationManifest });
if (teeProof) { files['tee.json'] = teeProof; files['round.json'].files.tee = 'tee'; }
const dir = path.join(values.out, `round${roundId}`);
if (!values.replace) { try { await access(dir); fail(`${dir} exists; pass --replace to overwrite after review`); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
await mkdir(dir, { recursive: true });
for (const [name, value] of Object.entries(files)) {
  const target = path.join(dir, name);
  await writeFile(`${target}.tmp`, `${JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2)}\n`);
  await rename(`${target}.tmp`, target);
}
console.log(JSON.stringify({ written: dir, files: Object.keys(files), winner: projection.winner, realisedReturnX18: projection.realisedReturnX18,
  preRegistration: projection.preRegistration, checks: projection.checks, warnings }, null, 2));
