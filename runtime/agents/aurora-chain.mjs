import { createPublicClient, createWalletClient, http, encodeFunctionData, parseAbi, decodeEventLog,
  keccak256, concatHex, pad, zeroAddress, zeroHash } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { auroraTestnet } from 'viem/chains';
import { createManagerService } from '../operator/manager.mjs';
import { normalizeAuthenticatedPrices } from './supra-observation.mjs';
import { supraProofBytes } from '../../scripts/lib/supra-proof.mjs';
import { verifySupraAtChainTime } from './supra-clock.mjs';

const RPC = 'https://testnet.aurora.dev';
const OPERATOR = '0x1903bDDF6F73eE4aA8F66D170E7590D28CD3f8B9';
const VERIFIER = '0x6Cd59830AAD978446e6cc7f6cc173aF7656Fb917';
const artifactNames = { safe: 'Safe', stable: 'AuroraTestToken', asset: 'AuroraTestToken', oracle: 'SupraPortfolioOracle',
  engine: 'QuantumRound', module: 'TradingSafeModule', tracker: 'PerformanceTracker', market: 'WaveV4ProposalMarket', registry: 'ProposerRegistry', tokens: 'ProposalTokens' };
// Minimal public ABIs for the investment AMM (Uniswap-V2 style router/pair). Used only by the operator probe.
export const EXTRA_ABIS = Object.freeze({
  router: parseAbi(['function swapExactTokensForTokens(uint256 amountIn,uint256 amountOutMin,address[] path,address to,uint256 deadline) returns(uint256[] amounts)', 'function factory() view returns(address)']),
  pair: parseAbi(['function getReserves() view returns(uint112 reserve0,uint112 reserve1,uint32 blockTimestampLast)', 'function token0() view returns(address)', 'function token1() view returns(address)',
    'event Swap(address indexed sender,uint256 amount0In,uint256 amount1In,uint256 amount0Out,uint256 amount1Out,address indexed to)']),
});
export const sameAddress = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
export const requireLive = (condition, message) => { if (!condition) throw new Error(message); };
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));


export function createAuroraChain({ manifest, artifacts, privateKey, actorKeys, actorNames = ['Momentum', 'Conservative', 'Quant', 'Guardian'], events = [], emit, acknowledge }) {
  requireLive(manifest?.chainId === 1313161555 && manifest.schemaVersion === 1, 'Aurora testnet manifest required');
  const contracts = manifest.contracts;
  const accounts = { owner: privateKeyToAccount(privateKey) };
  requireLive(Array.isArray(actorNames) && actorNames.length >= 4 && actorNames.length <= 8 && new Set(actorNames).size === actorNames.length && actorNames.every(n => /^[A-Za-z]{1,24}$/.test(n) && n !== 'owner'), 'Invalid actor roster');
  for (const name of actorNames) accounts[name] = privateKeyToAccount(actorKeys[name]);
  requireLive(sameAddress(accounts.owner.address, OPERATOR), 'Wrong dedicated testnet operator');
  requireLive(new Set(Object.values(accounts).map(x => x.address.toLowerCase())).size === actorNames.length + 1, 'Agent wallets must be distinct');
  const client = createPublicClient({ chain: auroraTestnet, transport: http(RPC, { retryCount: 1, timeout: 20000 }) });
  const broadcast = createPublicClient({ chain: auroraTestnet, transport: http(RPC, { retryCount: 0, timeout: 20000 }) });
  const abi = (name) => EXTRA_ABIS[name] ?? artifacts[artifactNames[name]].abi;
  const read = (name, functionName, args = [], blockNumber) => client.readContract({ address: contracts[name], abi: abi(name), functionName, args, blockNumber });
  const receipts = new Map(events.filter(e => e.stage === 'confirmed').map(e => [e.label, e.hash]));
  let gasCost = 0n;
  async function send(label, actor, to, data = '0x', value = 0n) {
    if (receipts.has(label)) return client.getTransactionReceipt({ hash: receipts.get(label) });
    const account = accounts[actor]; requireLive(account, 'Unknown actor');
    requireLive(value === 0n || (actor === 'owner' && value <= 300000000000000n && Object.entries(accounts).some(([name, a]) => name !== 'owner' && sameAddress(a.address, to))), 'Native transfers restricted to bounded test-agent gas funding');
    const tx = { account, to, data, value, type: 'legacy' };
    const gas = await client.estimateGas(tx) * 125n / 100n;
    const gasPrice = await client.getGasPrice();
    const maxCost = gas * gasPrice;
    requireLive(maxCost <= 1500000000000000n && gasCost + maxCost <= 3000000000000000n, 'Testnet gas budget exceeded');
    requireLive(await client.getBalance({ address: account.address }) >= maxCost + value, 'Insufficient actor test ETH');
    const nonce = await client.getTransactionCount({ address: account.address, blockTag: 'pending' });
    const wallet = createWalletClient({ account, chain: auroraTestnet, transport: http(RPC, { retryCount: 0 }) });
    const signed = await wallet.signTransaction({ ...tx, gas, gasPrice, nonce });
    const hash = keccak256(signed);
    emit({ stage: 'prepared', label, actor, from: account.address, to, hash, nonce, gas, gasPrice, value, calldataHash: keccak256(data) });
    await acknowledge(hash); // Host fsyncs the prepared journal entry before acknowledging.
    requireLive(await broadcast.sendRawTransaction({ serializedTransaction: signed }) === hash, 'Broadcast hash mismatch');
    const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120000, pollingInterval: 1000 });
    requireLive(receipt.status === 'success', 'Transaction reverted; inspect its known hash');
    for (const entry of receipt.logs.filter(x => sameAddress(x.address, contracts.safe))) {
      let event; try { event = decodeEventLog({ abi: abi('safe'), ...entry }); } catch { continue; }
      requireLive(event.eventName !== 'ExecutionFailure' && event.eventName !== 'ExecutionFromModuleFailure', 'Safe inner execution failed');
    }
    gasCost += receipt.gasUsed * gasPrice;
    emit({ stage: 'confirmed', label, actor, hash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed, gasPrice });
    receipts.set(label, hash); return receipt;
  }
  const tx = (label, actor, name, method, args = []) => send(label, actor, contracts[name], encodeFunctionData({ abi: abi(name), functionName: method, args }));
  async function ownerCall(label, name, method, args) {
    const data = encodeFunctionData({ abi: abi(name), functionName: method, args });
    const signature = concatHex([pad(accounts.owner.address, { size: 32 }), zeroHash, '0x01']);
    const params = [contracts[name], 0n, data, 0, 0n, 0n, 0n, zeroAddress, zeroAddress, signature];
    if (!receipts.has(label)) requireLive((await client.simulateContract({ account: accounts.owner, address: contracts.safe, abi: abi('safe'), functionName: 'execTransaction', args: params })).result === true, 'Safe owner action simulation failed');
    return tx(label, 'owner', 'safe', 'execTransaction', params);
  }
  async function inspect() {
    const abis = Object.fromEntries(Object.keys(artifactNames).map(key => [key, abi(key)]));
    const result = await createManagerService({ publicClient: client, contracts, abis, chainId: 1313161555 }).inspect();
    requireLive(result.moduleEnabled && result.owners.length === 1 && sameAddress(result.owners[0], OPERATOR) && result.threshold === 1, 'Unexpected Safe ownership or module state');
    return result;
  }
  async function waitUntil(timestamp) {
    const start = Date.now(); const current = (await client.getBlock()).timestamp;
    const maxWait = Number(timestamp > current ? timestamp - current : 0n) * 1000 + 120000;
    while ((await client.getBlock()).timestamp < timestamp) {
      requireLive(Date.now() - start < maxWait, 'Chain-time wait expired'); await sleep(4000);
    }
  }
  async function verifiedProof(minimumTime = 0n) {
    const verifierAbi = parseAbi(['error IncorrectFutureUpdate(uint256 FutureLengthInMsecs)', 'function verifyOracleProofV2(bytes) returns ((uint256[] pairs,uint256[] prices,uint256[] timestamp,uint256[] decimal,uint256[] round))']);
    for (let i = 0; i < 36; i++) {
      const response = await fetch('https://rpc-testnet-dora-2.supra.com/get_proof', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pair_indexes: [19, 89], chain_type: 'evm' }) });
      requireLive(response.ok, 'Supra public proof service unavailable');
      const body = await response.text(); requireLive(body.length <= 1000000, 'Supra response too large');
      const proof = supraProofBytes(JSON.parse(body));
      const prices = (await verifySupraAtChainTime({
        verify: () => client.simulateContract({ address: VERIFIER, abi: verifierAbi, functionName: 'verifyOracleProofV2', args: [proof] }),
        blockTime: async () => (await client.getBlock()).timestamp, waitUntil,
      })).result;
      requireLive(prices.pairs.length === 2 && new Set(prices.pairs.map(String)).size === 2 && prices.pairs.includes(19n) && prices.pairs.includes(89n), 'Unexpected authenticated feeds');
      if (prices.timestamp.some(t => t / 1000n < minimumTime)) { await sleep(5000); continue; }
      const now = (await client.getBlock()).timestamp;
      const latest = prices.timestamp.reduce((a, b) => a > b ? a : b);
      requireLive(latest <= (now + 30n) * 1000n, 'Oracle too far ahead of chain');
      await waitUntil((latest + 999n) / 1000n);
      const normalized = normalizeAuthenticatedPrices(prices, (await client.getBlock()).timestamp * 1000n);
      return { proof, ...normalized, timestampsMs: prices.timestamp };
    }
    throw new Error('No authenticated post-deadline prices available');
  }
  async function refresh(label, minimumTime = 0n) {
    const observation = await verifiedProof(minimumTime);
    await tx(label, 'owner', 'oracle', 'update', [observation.proof]);
    const values = await read('oracle', 'read');
    emit({ stage: 'oracle', label, values, proofHash: keccak256(observation.proof), timestampsMs: observation.timestampsMs }); return values;
  }
  async function portfolio(prices) {
    const block = await client.getBlock();
    const [stable, asset] = await Promise.all([read('stable', 'balanceOf', [contracts.safe], block.number), read('asset', 'balanceOf', [contracts.safe], block.number)]);
    const stableValue = stable * prices.stable / 1000000n; const assetValue = asset * prices.asset / 10n ** 18n;
    requireLive(stableValue + assetValue > 0n, 'Empty investment Safe');
    return { stableBalance: stable.toString(), assetBalance: asset.toString(), currentAllocationBps: Number(assetValue * 10000n / (stableValue + assetValue)) };
  }
  return { contracts, accounts, client, abi, read, send, tx, ownerCall, inspect, refresh, verifiedProof, portfolio, waitUntil };
}
