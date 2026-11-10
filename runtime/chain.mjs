import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createPublicClient, createWalletClient, http, parseAbi, encodeFunctionData, decodeEventLog, pad, concatHex, zeroAddress } from 'viem';
import { assertLocalRpc, localAccounts, LOCAL_CHAIN_ID, safeError } from './config.mjs';

export const tokenAbi = parseAbi(['function balanceOf(address) view returns(uint256)', 'function approve(address,uint256) returns(bool)', 'function allowance(address,address) view returns(uint256)']);
export const oracleAbi = parseAbi(['function read() view returns(uint256 stableUsdX18,uint256 assetUsdX18,uint256 publishedAt)', 'function setPrices(uint256 stableUsdX18,uint256 assetUsdX18)']);
export const safeAbi = parseAbi(['function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) payable returns(bool success)', 'event ExecutionSuccess(bytes32 indexed txHash,uint256 payment)', 'event ExecutionFailure(bytes32 indexed txHash,uint256 payment)']);
const artifactNames = { engine: 'QuantumRound', module: 'TradingSafeModule', tracker: 'PerformanceTracker', market: 'WaveV4ProposalMarket', registry: 'ProposerRegistry', tokens: 'ProposalTokens' };

export async function connectChain({ rpcUrl, manifest, artifactsDir, journal, control = {} }) {
  const url = assertLocalRpc(rpcUrl ?? manifest.rpcUrl);
  const chain = { id: LOCAL_CHAIN_ID, name: 'Wavefund local simulation', nativeCurrency: { name: 'Test ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [url] } } };
  const transport = () => http(url, { retryCount: 0, timeout: 15_000 });
  const publicClient = createPublicClient({ chain, transport: transport() });
  const accounts = localAccounts();
  const wallets = accounts.map((account) => createWalletClient({ account, chain, transport: transport() }));
  const abis = { stable: tokenAbi, asset: tokenAbi, oracle: oracleAbi, safe: safeAbi };
  for (const [key, name] of Object.entries(artifactNames)) abis[key] = JSON.parse(await readFile(path.join(artifactsDir, `${name}.sol`, `${name}.json`), 'utf8')).abi;
  async function assertWritable() {
    if (control.stopping) throw new Error('Local runtime is stopping; no further writes allowed');
    if (await publicClient.getChainId() !== LOCAL_CHAIN_ID) throw new Error('Refusing a write outside local chain 31337');
    const version = await publicClient.request({ method: 'web3_clientVersion' });
    if (!/anvil/i.test(version)) throw new Error('Refusing writes: RPC is not Anvil');
  }
  await assertWritable();
  for (const [name, address] of Object.entries(manifest.contracts)) if (!(await publicClient.getCode({ address }))) throw new Error(`Missing deployed ${name} code; stale manifest or node reset`);
  if (journal.data.actions.length) {
    const first = journal.data.actions.find((action) => action.hash && action.blockHash);
    if (first) {
      const receipt = await publicClient.getTransactionReceipt({ hash: first.hash }).catch(() => null);
      if (!receipt || receipt.blockHash !== first.blockHash) throw new Error('Journal transactions are absent from this chain; reset the stale local journal explicitly');
    }
  }
  const read = (key, functionName, args = [], blockNumber) => publicClient.readContract({ address: manifest.contracts[key], abi: abis[key], functionName, args, ...(blockNumber != null ? { blockNumber } : {}) });

  async function tx(index, key, functionName, args, label, { safeAction = false } = {}) {
    await assertWritable();
    const wallet = wallets[index];
    const nonce = await publicClient.getTransactionCount({ address: accounts[index].address, blockTag: 'pending' });
    const action = { id: journal.data.actions.length + 1, label, from: accounts[index].address, to: manifest.contracts[key], functionName, nonce, status: 'prepared', hash: null, blockNumber: null, blockHash: null };
    journal.data.actions.push(action); await journal.save();
    let submitted = false;
    try {
      const simulation = await publicClient.simulateContract({ account: wallet.account, address: manifest.contracts[key], abi: abis[key], functionName, args, nonce });
      if (safeAction && simulation.result !== true) throw new Error('Safe simulation reported unsuccessful execution');
      // Once submission starts, an RPC error may conceal a broadcast. Never retry automatically.
      submitted = true;
      action.hash = await wallet.writeContract(simulation.request);
      action.status = 'broadcast'; await journal.save();
      const receipt = await publicClient.waitForTransactionReceipt({ hash: action.hash, confirmations: 1, retryCount: 0, timeout: 30_000 });
      action.blockNumber = receipt.blockNumber.toString(); action.blockHash = receipt.blockHash;
      if (receipt.status !== 'success') { action.status = 'failed'; throw new Error(`Transaction reverted: ${label}`); }
      if (safeAction) {
        const events = receipt.logs.filter((log) => log.address.toLowerCase() === manifest.contracts.safe.toLowerCase()).flatMap((log) => {
          try { return [decodeEventLog({ abi: safeAbi, data: log.data, topics: log.topics })]; } catch { return []; }
        });
        if (!events.some((event) => event.eventName === 'ExecutionSuccess') || events.some((event) => event.eventName === 'ExecutionFailure')) throw new Error('Safe receipt lacks confirmed internal execution success');
      }
      action.status = 'success'; await journal.save(); return receipt;
    } catch (error) {
      if (action.status !== 'failed') action.status = submitted ? 'unknown' : 'failed';
      action.error = safeError(error); await journal.save(); throw error;
    }
  }
  async function ownerCall(key, functionName, args, label) {
    const data = encodeFunctionData({ abi: abis[key], functionName, args });
    const signature = concatHex([pad(accounts[0].address, { size: 32 }), pad('0x00', { size: 32 }), '0x01']);
    return tx(0, 'safe', 'execTransaction', [manifest.contracts[key], 0n, data, 0, 0n, 0n, 0n, zeroAddress, zeroAddress, signature], label, { safeAction: true });
  }
  async function advanceTo(timestamp) {
    await assertWritable();
    const current = (await publicClient.getBlock()).timestamp;
    if (timestamp <= current) return;
    await publicClient.request({ method: 'evm_setNextBlockTimestamp', params: [Number(timestamp)] });
    await publicClient.request({ method: 'evm_mine', params: [] });
  }
  return { manifest, publicClient, accounts, abis, read, tx, ownerCall, advanceTo };
}

export function namedOutputs(abi, functionName, result) {
  const outputs = abi.find((item) => item.type === 'function' && item.name === functionName)?.outputs;
  if (!outputs?.length) throw new Error(`Missing output schema: ${functionName}`);
  return Object.fromEntries(outputs.map((output, i) => [output.name || String(i), outputs.length === 1 ? result : result[i]]));
}
