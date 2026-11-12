// Dedicated operator/test-token rehearsal on Aurora TESTNET. No AI or mainnet calls.
// Input is JSON on stdin, including an ephemeral privateKey and compiled artifacts.
// Run inside an isolated Node container; persist stdout as a private local JSONL journal.
import { createPublicClient, createWalletClient, http, encodeDeployData, encodeFunctionData,
  keccak256, getCreate2Address, toHex, pad, concatHex, zeroAddress, zeroHash, parseAbi,
  decodeEventLog } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { auroraTestnet } from 'viem/chains';
import { supraProofBytes } from '../../scripts/lib/supra-proof.mjs';
import { verifySupraAtChainTime } from '../agents/supra-clock.mjs';
import readline from 'node:readline';

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const iterator = lines[Symbol.asyncIterator]();
const config = JSON.parse((await iterator.next()).value);
const account = privateKeyToAccount(config.privateKey); delete config.privateKey;
const log = (data) => console.log(JSON.stringify(data, (_, v) => typeof v === 'bigint' ? v.toString() : v));
const rpc = 'https://testnet.aurora.dev';
const client = createPublicClient({ chain: auroraTestnet, transport: http(rpc, { retryCount: 2, timeout: 20000 }) });
const wallet = createWalletClient({ account, chain: auroraTestnet, transport: http(rpc, { retryCount: 0, timeout: 20000 }) });
const artifacts = config.artifacts;
const contracts = { ...(config.contracts ?? {}) };
const completed = new Set(config.completed ?? []);
let stage = 'preflight';
const abi = (name) => artifacts[name].abi;
const read = (name, address, functionName, args = []) => client.readContract({ address, abi: abi(name), functionName, args });
const same = (a, b) => a.toLowerCase() === b.toLowerCase();
const requireThat = (condition, message) => { if (!condition) throw new Error(message); };
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
async function send(label, data, to) {
  stage = label;
  if (completed.has(label)) return;
  const tx = { account, data, ...(to ? { to } : {}), value: 0n, type: 'legacy' };
  const gas = (await client.estimateGas(tx)) * 125n / 100n;
  const gasPrice = await client.getGasPrice();
  requireThat(gas * gasPrice <= 1500000000000000n, 'Per-transaction gas budget exceeded');
  requireThat(await client.getBalance({ address: account.address }) >= gas * gasPrice, 'Insufficient test ETH');
  const nonce = await client.getTransactionCount({ address: account.address, blockTag: 'pending' });
  const signed = await wallet.signTransaction({ ...tx, gas, gasPrice, nonce });
  const hash = keccak256(signed);
  // Record the known hash BEFORE broadcasting. Never retry an ambiguous write.
  log({ stage: 'prepared', label, hash, nonce, to, calldataHash: keccak256(data), gas, gasPrice });
  requireThat(JSON.parse((await iterator.next()).value).ack === hash, 'Missing durable acknowledgement');
  requireThat(await client.sendRawTransaction({ serializedTransaction: signed }) === hash, 'Broadcast hash mismatch');
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120000 });
  requireThat(receipt.status === 'success', 'Transaction reverted');
  for (const entry of receipt.logs) {
    if (contracts.safe && same(entry.address, contracts.safe)) {
      try { const event = decodeEventLog({ abi: abi('Safe'), ...entry }); requireThat(event.eventName !== 'ExecutionFailure', 'Safe inner execution failed'); }
      catch (error) { if (error.message === 'Safe inner execution failed') throw error; }
    }
  }
  log({ stage: 'confirmed', label, hash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed, contractAddress: receipt.contractAddress });
  completed.add(label);
  return receipt;
}
async function deploy(key, name, args) {
  if (contracts[key]) { requireThat((await client.getCode({ address: contracts[key] }))?.length > 2, 'Missing resumed contract'); return contracts[key]; }
  const receipt = await send(`deploy:${key}`, encodeDeployData({ abi: abi(name), bytecode: artifacts[name].bytecode.object, args }));
  requireThat(receipt?.contractAddress, 'Missing deployment address; recover journal before resuming');
  contracts[key] = receipt.contractAddress;
  log({ stage: 'contract', key, address: contracts[key] }); return contracts[key];
}
const call = (label, name, address, functionName, args = []) => send(label, encodeFunctionData({ abi: abi(name), functionName, args }), address);
async function ownerCall(label, name, address, functionName, args) {
  const data = encodeFunctionData({ abi: abi(name), functionName, args });
  const signature = concatHex([pad(account.address, { size: 32 }), zeroHash, '0x01']);
  const params = [address, 0n, data, 0, 0n, 0n, 0n, zeroAddress, zeroAddress, signature];
  if (!completed.has(label)) requireThat((await client.simulateContract({ account, address: contracts.safe, abi: abi('Safe'), functionName: 'execTransaction', args: params })).result === true, 'Safe simulation failed');
  return call(label, 'Safe', contracts.safe, 'execTransaction', params);
}
async function refresh(label, minimumTime = 0n) {
  if (completed.has(label)) return;
  for (let attempt = 0; attempt < 36; attempt++) {
    const response = await fetch('https://rpc-testnet-dora-2.supra.com/get_proof', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pair_indexes: [19, 89], chain_type: 'evm' }), signal: AbortSignal.timeout(20000), redirect: 'error' });
    requireThat(response.ok, 'Supra proof endpoint unavailable');
    const text = await response.text(); requireThat(text.length < 1000000, 'Oversized proof response');
    const proof = supraProofBytes(JSON.parse(text));
    const verified = await verifySupraAtChainTime({ verify: async () => (await client.simulateContract({ account,
      address: contracts.verifier, abi: parseAbi(['function verifyOracleProofV2(bytes) returns ((uint256[] pairs,uint256[] prices,uint256[] timestamp,uint256[] decimal,uint256[] round))']),
      functionName: 'verifyOracleProofV2', args: [proof] })).result,
      blockTime: async () => (await client.getBlock()).timestamp,
      waitUntil });
    if (verified.timestamp.every(t => t / 1000n >= minimumTime)) {
      // Feed publication can lead Aurora's latest block by a few seconds.
      // Wait for chain time; never relax the consumer's future-time rejection.
      const latestMs = verified.timestamp.reduce((a, b) => a > b ? a : b);
      const chainTime = (await client.getBlock()).timestamp;
      requireThat(latestMs <= (chainTime + 30n) * 1000n, 'Oracle publication too far ahead of chain time');
      await waitUntil((latestMs + 999n) / 1000n);
      log({ stage: 'authenticatedProof', label, pairs: verified.pairs, timestampsMs: verified.timestamp });
      await call(label, 'SupraPortfolioOracle', contracts.oracle, 'update', [proof]);
      log({ stage: 'oracle', label, prices: await read('SupraPortfolioOracle', contracts.oracle, 'read'), proofHash: keccak256(proof) }); return;
    }
    await delay(5000);
  }
  throw new Error('No post-deadline oracle proof available');
}
async function waitUntil(timestamp) {
  const start = Date.now();
  const initial = (await client.getBlock()).timestamp;
  const timeout = Number(timestamp > initial ? timestamp - initial : 0n) * 1000 + 120000;
  while ((await client.getBlock()).timestamp < timestamp) {
    requireThat(Date.now() - start <= timeout, 'Chain-time wait expired');
    await delay(4000);
  }
}

try {
  requireThat(await client.getChainId() === 1313161555, 'Wrong chain');
  requireThat(same(account.address, '0x1903bDDF6F73eE4aA8F66D170E7590D28CD3f8B9'), 'Wrong dedicated testnet operator');
  contracts.poolManager = '0xfaf156a5a6c36b1b280f64d420869b06e4c98f80';
  contracts.router = '0x26ec2aFBDFdFB972F106100A3deaE5887353d9B9';
  contracts.verifier = '0x6Cd59830AAD978446e6cc7f6cc173aF7656Fb917';
  contracts.hookDeployer = '0xcdfe26b5b6d41ff513385aea7217380401240154';
  const singleton = '0x41675C099F32341bf84BFc5382aF534df5C7461a';
  requireThat(keccak256(await client.getCode({ address: singleton })) === '0x1fe2df852ba3299d6534ef416eefa406e56ced995bca886ab7a553e6d0c5e1c4', 'Safe singleton hash mismatch');
  requireThat(keccak256(await client.getCode({ address: contracts.poolManager })) === '0xa0a841a2fe338fd7d26f8d96fc33009a7ecef1220301f0173ce2fd517fc01784', 'PoolManager hash mismatch');
  log({ stage: 'preflight', operator: account.address, balanceWei: await client.getBalance({ address: account.address }), scope: 'Single operator, worthless test assets; no AI' });
  contracts.oracle = '0x4c92a21c56b5fcb453ec7c5ffd0117768dca5e46';
  contracts.stable = '0x38d81431b9f76d9699af7517040d5221d9dea252';
  contracts.asset = '0x8d52924ccf3648f575e92ac5b1be72f2a1a1dc5a';
  requireThat(await read('AuroraTestToken', contracts.stable, 'decimals') === 6, 'Wrong Tidepool decimals');
  for (const key of ['oracle','stable','asset']) requireThat((await client.getCode({address:contracts[key]}))?.length > 2,'Missing shared dependency');
  await deploy('safe', 'SafeProxy', [singleton]);
  await call('safe:setup', 'Safe', contracts.safe, 'setup', [[account.address], 1n, zeroAddress, '0x', zeroAddress, zeroAddress, 0n, zeroAddress]);
  await deploy('tokens', 'ProposalTokens', [account.address]);
  await call('tokens:decimals', 'ProposalTokens', contracts.tokens, 'setCreditDecimals', [6]);
  await deploy('registry', 'ProposerRegistry', [account.address, contracts.stable]);
  await deploy('market', 'WaveV4ProposalMarket', [contracts.poolManager, contracts.tokens, account.address]);
  await deploy('engine', 'QuantumRound', [account.address, contracts.stable, contracts.tokens, contracts.registry, contracts.market]);
  if (!contracts.hook) {
    const code = encodeDeployData({ abi: abi('WaveHook'), bytecode: artifacts.WaveHook.bytecode.object, args: [contracts.poolManager, contracts.market] });
    const bytecodeHash = keccak256(code); let salt; let address;
    for (let i = 0; i < 1000000; i++) { salt = toHex(i, { size: 32 }); address = getCreate2Address({ from: contracts.hookDeployer, salt, bytecodeHash }); if ((BigInt(address) & 16383n) === 2752n) break; }
    requireThat((BigInt(address) & 16383n) === 2752n, 'Hook salt search exhausted');
    await call('deploy:hook', 'HookDeployer', contracts.hookDeployer, 'deploy', [salt, code]); contracts.hook = address; log({ stage: 'contract', key: 'hook', address });
  }
  await call('market:engine', 'WaveV4ProposalMarket', contracts.market, 'setQuantumRound', [contracts.engine]);
  await call('market:hook', 'WaveV4ProposalMarket', contracts.market, 'setWaveHook', [contracts.hook]);
  const roundRole = keccak256(toHex('QUANTUM_ROUND_ROLE'));
  for (const [key, name] of [['tokens', 'ProposalTokens'], ['registry', 'ProposerRegistry']]) await call(`${key}:role`, name, contracts[key], 'grantRole', [roundRole, contracts.engine]);
  await deploy('tracker', 'PerformanceTracker', [contracts.engine, contracts.oracle, account.address, 900n]);
  await deploy('module', 'TradingSafeModule', [contracts.safe, contracts.engine, contracts.stable, contracts.asset, contracts.router, contracts.oracle, contracts.tracker]);
  await call('tracker:bind', 'PerformanceTracker', contracts.tracker, 'bindModule', [contracts.module]);
  await call('engine:bind', 'QuantumRound', contracts.engine, 'bindExecution', [contracts.module, contracts.tracker]);
  await call('engine:keeper', 'QuantumRound', contracts.engine, 'grantRole', [keccak256(toHex('KEEPER_ROLE')), account.address]);
  await call('engine:admin', 'QuantumRound', contracts.engine, 'grantRole', [zeroHash, contracts.safe]);
  for (const [key, name] of [['tokens', 'ProposalTokens'], ['registry', 'ProposerRegistry'], ['engine', 'QuantumRound']]) await call(`${key}:seal`, name, contracts[key], 'renounceRole', [zeroHash, account.address]);
  await ownerCall('safe:module', 'Safe', contracts.safe, 'enableModule', [contracts.module]);
  if (!completed.has('amm:addLiquidity')) {
  await refresh('oracle:pool');
  const [stableUsd, assetUsd] = await read('SupraPortfolioOracle', contracts.oracle, 'read');
  const lpStable = 80000n * 1000000n;
  const lpAsset = lpStable * 10n ** 12n * stableUsd / assetUsd;
  requireThat(await read('AuroraTestToken',contracts.stable,'balanceOf',[account.address]) >= lpStable + 1000n*1000000n,'Insufficient supplied Tidepool USDC');
  await call('mint:operator:asset', 'AuroraTestToken', contracts.asset, 'mint', [account.address, lpAsset]);
  await call('transfer:forecastSeed', 'AuroraTestToken', contracts.stable, 'transfer', [contracts.safe, 100n * 1000000n]);
  for (const [key, amount] of [['stable', lpStable], ['asset', lpAsset]]) await call(`approve:lp:${key}`, 'AuroraTestToken', contracts[key], 'approve', [contracts.router, amount]);
  const routerAbi = parseAbi(['function factory() view returns(address)', 'function addLiquidity(address,address,uint256,uint256,uint256,uint256,address,uint256) returns(uint256,uint256,uint256)']);
  requireThat(same(await client.readContract({ address: contracts.router, abi: routerAbi, functionName: 'factory' }), '0x60913758635b54e6C9685f92201A5704eEe74748'), 'Unexpected AMM factory');
  await send('amm:addLiquidity', encodeFunctionData({ abi: routerAbi, functionName: 'addLiquidity', args: [contracts.stable, contracts.asset, lpStable, lpAsset, lpStable * 99n / 100n, lpAsset * 99n / 100n, account.address, (await client.getBlock()).timestamp + 300n] }), contracts.router);
  }
  await ownerCall('safe:approveSeed', 'AuroraTestToken', contracts.stable, 'approve', [contracts.engine, 100n * 1000000n]);
  await ownerCall('safe:seed', 'QuantumRound', contracts.engine, 'addProtocolLiquiditySeed', [100n * 1000000n]);
  await ownerCall('safe:clearSeedApproval', 'AuroraTestToken', contracts.stable, 'approve', [contracts.engine, 0n]);
  await call('proposer:register', 'ProposerRegistry', contracts.registry, 'registerAgent', ['Wavefund deterministic test operator']);
  await call('proposer:approveBond', 'AuroraTestToken', contracts.stable, 'approve', [contracts.registry, 1000000n]);
  await call('forecaster:approve', 'AuroraTestToken', contracts.stable, 'approve', [contracts.engine, 10000000n]);
  requireThat(await read('AuroraTestToken',contracts.stable,'balanceOf',[contracts.safe]) === 0n,'Safe must remain unfunded before bridge');
  await deploy('reputation', 'AgentReputation', [contracts.engine, contracts.tracker]);
  log({ stage: 'manifest', schemaVersion: 1, chainId: 1313161555, contracts, integrations: { fundingProvider: 'tidepool-community-testnet' } });
} catch (error) {
  log({ stage, status: 'failed', errorName: error.name, reason: error.shortMessage ?? (error.name === 'Error' ? error.message : 'Inspect known transaction hash; no retry') });
  process.exitCode = 1;
} finally { lines.close(); }
