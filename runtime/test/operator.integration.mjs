// Disposable Anvil only. Safe actions are deliberately executed here with PUBLIC TEST keys.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createPublicClient, createWalletClient, http, encodeFunctionData, decodeFunctionData, decodeEventLog, pad, concatHex, zeroAddress } from 'viem';
import { localAccounts, loadManifest } from '../config.mjs';
import { safeAbi } from '../chain.mjs';
import { createRuntime } from '../demo.mjs';
import { createManagerService, managerSafeAbi } from '../operator/manager.mjs';
import { auditReceipts } from '../operator/recovery.mjs';
import { createAuroraRuntime, artifactAbis } from '../operator/aurora.mjs';
import { startServer } from '../server.mjs';
if (process.env.WAVEFUND_OPERATOR_INTEGRATION !== '1') throw new Error('Explicit disposable local integration mode required');
const manifestPath = process.env.LOCAL_MANIFEST ?? 'deployments/local.json'; const manifest = await loadManifest(manifestPath);
const client = createPublicClient({ transport: http(manifest.rpcUrl) }); assert.equal(await client.getChainId(), 31337); assert.match(await client.request({ method: 'web3_clientVersion' }), /anvil/i);
const accounts = localAccounts(); const chain = { id: 31337, name: 'Anvil', nativeCurrency: { name: 'test ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [manifest.rpcUrl] } } }; const wallet = createWalletClient({ account: accounts[0], chain, transport: http(manifest.rpcUrl) });
await mkdir('.run/operator-integration', { recursive: true }); const dir = await mkdtemp('.run/operator-integration/run-');
const runtime = await createRuntime({ manifestPath, journalPath: `${dir}/journal.json`, paceMs: 0, agentEnv: {} });
const abis = await artifactAbis();
const manager = runtime.manager; const evidence = { kind: 'local-safe-owner-workflow', checks: [] };
async function execute(transaction) {
  const signature = concatHex([pad(accounts[0].address, { size: 32 }), pad('0x00', { size: 32 }), '0x01']);
  const simulation = await client.simulateContract({ account: accounts[0], address: manifest.contracts.safe, abi: safeAbi, functionName: 'execTransaction', args: [transaction.to, 0n, transaction.data, 0, 0n, 0n, 0n, zeroAddress, zeroAddress, signature] });
  assert.equal(simulation.result, true); const hash = await wallet.writeContract(simulation.request); const receipt = await client.waitForTransactionReceipt({ hash }); assert.equal(receipt.status, 'success');
  assert.ok(receipt.logs.some((log) => { try { return log.address.toLowerCase() === manifest.contracts.safe.toLowerCase() && decodeEventLog({ abi: safeAbi, data: log.data, topics: log.topics }).eventName === 'ExecutionSuccess'; } catch { return false; } }));
  return hash;
}
try {
  let state = await manager.inspect(); assert.equal(state.moduleEnabled, true); assert.equal(state.oracle.usable, true); assert.equal(state.threshold, 1); evidence.checks.push('actual Safe1.4.1 and full module/tracker/asset bindings inspected');
  const before = await client.getTransactionCount({ address: accounts[0].address }); const prepared = await manager.prepare({ action: 'policy', slippageBps: 75 }); assert.equal(await client.getTransactionCount({ address: accounts[0].address }), before); assert.equal(prepared.unsignedOnly, true);
  const decoded = decodeFunctionData({ abi: abis.module, data: prepared.safeTransactionBuilder.transactions[0].data }); assert.equal(decoded.functionName, 'configurePolicy'); assert.equal(decoded.args[0], 75);
  await execute(prepared.safeTransactionBuilder.transactions[0]); state = await manager.inspect(); assert.equal(state.maxSlippageBps, 75); evidence.checks.push('unsigned preparation sends zero transactions; exported policy calldata executes through actual Safe');
  await assert.rejects(manager.prepare({ action: 'policy', slippageBps: 1001 }), /bounds/); await assert.rejects(manager.prepare({ action: 'enable' }), /already enabled/); await assert.rejects(manager.prepare({ action: 'policy', slippageBps: 75, recipient: accounts[1].address }), /Unexpected/);
  await assert.rejects(manager.prepare({ action: 'seed', amountMicro: '2000000001' }), /Insufficient/);
  await assert.rejects(manager.prepare({ action: 'withdraw-seed', amountMicro: '100000001' }), /exceeds/);
  const seed = await manager.prepare({ action: 'seed', amountMicro: '25000000' });
  assert.equal(seed.safeTransactionBuilder.transactions.length, 4);
  for (const transaction of seed.safeTransactionBuilder.transactions) { assert.equal(transaction.value, '0'); await execute(transaction); }
  let funded = await manager.inspect(); assert.equal(funded.stableBalance, '1975000000'); assert.equal(funded.sponsorReserve, '125000000');
  const allowanceAbi = [{ type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'address' }], outputs: [{ type: 'uint256' }] }];
  assert.equal(await client.readContract({ address: manifest.contracts.stable, abi: allowanceAbi, functionName: 'allowance', args: [manifest.contracts.safe, manifest.contracts.engine] }), 0n);
  const withdraw = await manager.prepare({ action: 'withdraw-seed', amountMicro: '25000000' }); await execute(withdraw.safeTransactionBuilder.transactions[0]); funded = await manager.inspect(); assert.equal(funded.stableBalance, '2000000000'); assert.equal(funded.sponsorReserve, '100000000'); evidence.checks.push('explicit sponsorship moves only the reviewed amount; approval clears; only unallocated reserve can return');
  const authorize = await manager.prepare({ action: 'authorize', tradingSeconds: 120, evaluationSeconds: 180, executionGraceSeconds: 60, twapWindowSeconds: 30 }); await execute(authorize.safeTransactionBuilder.transactions[0]); assert.equal((await manager.inspect()).pendingAuthorization, '1'); await assert.rejects(manager.prepare({ action: 'policy', slippageBps: 10 }), /pending/); await assert.rejects(manager.prepare({ action: 'seed', amountMicro: '1' }), /authorization/); const revoke = await manager.prepare({ action: 'revoke' }); await execute(revoke.safeTransactionBuilder.transactions[0]); assert.equal((await manager.inspect()).pendingAuthorization, '0'); evidence.checks.push('exact authorization and revocation work; pending authorization blocks policy changes');
  // Insert one disposable module ahead of ours to discriminate the linked-list predecessor computation.
  await execute({ to: manifest.contracts.safe, data: encodeFunctionData({ abi: managerSafeAbi, functionName: 'enableModule', args: [accounts[4].address] }) });
  const disable = await manager.prepare({ action: 'disable' }); const disabled = decodeFunctionData({ abi: managerSafeAbi, data: disable.safeTransactionBuilder.transactions[0].data }); assert.equal(disabled.args[0].toLowerCase(), accounts[4].address.toLowerCase()); await execute(disable.safeTransactionBuilder.transactions[0]); assert.equal((await manager.inspect()).moduleEnabled, false);
  await assert.rejects(manager.prepare({ action: 'authorize', tradingSeconds: 120, evaluationSeconds: 180, executionGraceSeconds: 60, twapWindowSeconds: 30 }), /Enable/);
  await execute({ to: manifest.contracts.safe, data: encodeFunctionData({ abi: managerSafeAbi, functionName: 'disableModule', args: ['0x0000000000000000000000000000000000000001', accounts[4].address] }) });
  const enable = await manager.prepare({ action: 'enable' }); await execute(enable.safeTransactionBuilder.transactions[0]); assert.equal((await manager.inspect()).moduleEnabled, true); evidence.checks.push('disable finds real predecessor; disabled module blocks authorization; owner can re-enable');
  const badClient = new Proxy(client, { get(target, property) { if (property === 'readContract') return async (args) => args.address.toLowerCase() === manifest.contracts.module.toLowerCase() && args.functionName === 'engine' ? zeroAddress : target.readContract(args); return target[property]; } });
  await assert.rejects(createManagerService({ publicClient: badClient, contracts: manifest.contracts, abis }).inspect(), /Unsafe manager/); evidence.checks.push('mismatched module binding rejected');
  const completed = await runtime.start(); assert.equal(completed.stage, 'completed'); const audited = await runtime.recovery(); assert.equal(audited.allConfirmed, true); assert.equal(audited.actions.length, 27);
  const cloned = structuredClone(runtime.journal.data); cloned.actions[0].status = 'unknown'; assert.equal((await auditReceipts({ publicClient: client, journal: cloned, contracts: manifest.contracts })).allConfirmed, true); assert.equal(cloned.actions[0].status, 'unknown'); cloned.actions[0].blockHash = '0x' + '11'.repeat(32); assert.equal((await auditReceipts({ publicClient: client, journal: cloned, contracts: manifest.contracts })).needsManualReview, true); evidence.checks.push('complete reference round still works; 27 receipts audited; unknown receipt reconciled read-only; chain mismatch detected');
  const app = await startServer({ runtime, port: 19232 });
  try { const response = await fetch('http://127.0.0.1:19232/api/manager'); assert.equal(response.status, 200); const rejected = await fetch('http://127.0.0.1:19232/api/manager/prepare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'policy', slippageBps: 50, recipient: accounts[1].address }) }); assert.equal(rejected.status, 400); const research = await (await fetch('http://127.0.0.1:19232/api/research')).json(); assert.equal(research.settlementEligible, false); } finally { await app.close(); }
  // Interface test only: local contract data with an explicitly mocked chain identifier, not Aurora deployment proof.
  const monitorClient = new Proxy(client, { get(target, property) { return property === 'getChainId' ? async () => 1313161555 : target[property]; } });
  const monitor = await createAuroraRuntime({ manifest: { schemaVersion: 1, chainId: 1313161555, contracts: manifest.contracts }, client: monitorClient, abis: await artifactAbis() });
  assert.equal((await monitor.state()).mode, 'aurora-testnet-readonly'); assert.throws(() => monitor.start(), /read-only/); assert.equal((await monitor.manager.prepare({ action: 'policy', slippageBps: 50 })).safeTransactionBuilder.chainId, '1313161555');
  const monitorApp = await startServer({ runtime: monitor, port: 19233 });
  try { const health = await (await fetch('http://127.0.0.1:19233/api/health')).json(); assert.equal(health.chainId, 1313161555); const noWrite = await fetch('http://127.0.0.1:19233/api/demo/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); assert.equal(noWrite.status, 409); } finally { await monitorApp.close(); }
  evidence.checks.push('testnet read-only adapter interface and HTTP write rejection tested with explicit local-chain data double; no public deployment inferred');
  evidence.manager = await manager.inspect(); evidence.audit = audited; evidence.checks.push('manager, validation and research HTTP routes verified');
  await writeFile('.run/operator-integration/latest-evidence.json', JSON.stringify(evidence, null, 2) + '\n');
  console.log(`PASS ${evidence.checks.length} manager/recovery integration checks; no public transaction`);
} finally { await runtime.close(); }
