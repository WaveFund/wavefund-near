import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { isAddress, parseAbi } from 'viem';
import { CONTRACT_NAMES } from '../config.mjs';
import { namedOutputs } from '../chain.mjs';
import { readonlyRPC, readonlyClient } from './readonly-rpc.mjs';
import { createManagerService } from './manager.mjs';
import { researchStatus } from './research.mjs';

export function validateAuroraManifest(input) {
  if (input?.schemaVersion !== 1 || input.chainId !== 1313161555) throw new Error('Aurora manifest must identify testnet chain 1313161555');
  const contracts = {};
  for (const key of CONTRACT_NAMES) { const address = input.contracts?.[key]; if (!isAddress(address ?? '') || /^0x0{40}$/i.test(address)) throw new Error(`Missing Aurora contract: ${key}`); contracts[key] = address; }
  if (new Set(Object.values(contracts).map((address) => address.toLowerCase())).size !== CONTRACT_NAMES.length) throw new Error('Aurora contract addresses must be distinct');
  return { schemaVersion: 1, chainId: 1313161555, contracts };
}
export async function artifactAbis(directory = 'out') {
  const result = { oracle: parseAbi(['function read() view returns(uint256,uint256,uint256)']) };
  for (const [key, name] of Object.entries({ module: 'TradingSafeModule', tracker: 'PerformanceTracker', engine: 'QuantumRound', market: 'WaveV4ProposalMarket', registry: 'ProposerRegistry', tokens: 'ProposalTokens' })) result[key] = JSON.parse(await readFile(path.join(directory, `${name}.sol`, `${name}.json`), 'utf8')).abi;
  return result;
}
export async function createAuroraRuntime({ manifestPath = 'deployments/aurora-testnet.json', artifactsDir = 'out', manifest: suppliedManifest, client: suppliedClient, abis: suppliedAbis } = {}) {
  const manifest = validateAuroraManifest(suppliedManifest ?? JSON.parse(await readFile(manifestPath, 'utf8')));
  const abis = suppliedAbis ?? await artifactAbis(artifactsDir); const publicClient = suppliedClient ?? readonlyClient(readonlyRPC());
  const manager = createManagerService({ publicClient, contracts: manifest.contracts, abis, chainId: 1313161555 });
  await manager.inspect(); // Reject wrong networks, code and bindings before exposing a monitoring dashboard.
  let cached; let cachedAt = 0;
  const read = (name, functionName, args, blockNumber) => publicClient.readContract({ address: manifest.contracts[name], abi: abis[name], functionName, args, blockNumber });
  return {
    metadata: { mode: 'aurora-testnet-readonly', chainId: 1313161555 }, manager,
    async state() {
      if (cached && Date.now() - cachedAt < 5000) return cached;
      const inspected = await manager.inspect(); const pinned = BigInt(inspected.blockNumber); const id = BigInt(inspected.currentRoundId); const proposals = []; let round = null; let value = null;
      if (id > 0n) {
        const data = namedOutputs(abis.engine, 'rounds', await read('engine', 'rounds', [id], pinned));
        round = { status: Number(data.status), tradingEnd: data.tradingEnd.toString(), evaluationEnd: data.evaluationEnd.toString(), realisedReturnX18: data.realisedReturn.toString(), piX18: data.pi.toString(), winnerId: Number(data.winnerId) };
        for (let i = 0; i < Number(data.proposalCount); i++) { const proposal = namedOutputs(abis.engine, 'proposals', await read('engine', 'proposals', [id, BigInt(i)], pinned)); const [probability] = await read('market', 'probabilities', [id, BigInt(i)], pinned); proposals.push({ id: String(i), label: i === 0 ? 'Hold current assets' : `${Number(proposal.tEthBps) / 100}% approved asset`, allocationBps: Number(proposal.tEthBps), probabilityX18: probability.toString(), twapX18: proposal.probabilityTwap.toString(), rationale: proposal.rationale, proposer: proposal.proposer }); }
      }
      const token = parseAbi(['function balanceOf(address) view returns(uint256)']);
      const engineBalance = await publicClient.readContract({ address: manifest.contracts.stable, abi: token, functionName: 'balanceOf', args: [manifest.contracts.engine], blockNumber: pinned });
      try { const prices = await read('oracle', 'read', [], pinned); value = (BigInt(inspected.stableBalance) * prices[0] / 1000000n + BigInt(inspected.assetBalance) * prices[1] / 10n ** 18n).toString(); } catch {}
      if (engineBalance < BigInt(inspected.sponsorReserve)) throw new Error('Onchain sponsor reserve exceeds actual forecasting collateral');
      cached = { mode: 'aurora-testnet-readonly', chainId: 1313161555, running: false, stage: 'monitoring', roundId: id ? id.toString() : null, safe: { address: manifest.contracts.safe, stableBalance: inspected.stableBalance, assetBalance: inspected.assetBalance, valueUsdX18: value }, sponsor: { reserve: inspected.sponsorReserve }, forecast: { escrow: (engineBalance - BigInt(inspected.sponsorReserve)).toString(), deposits: id ? namedOutputs(abis.engine, 'rounds', await read('engine', 'rounds', [id], pinned)).totalDeposits.toString() : '0', participants: [] }, round, proposals, agents: [], agentRecords: [], receipts: [], inference: { mode: 'not-connected', model: null, status: 'read-only', attestationVerified: false }, error: inspected.oracle.usable ? null : 'Oracle unavailable or stale. Monitoring never supplies a fallback price.' };
      cachedAt = Date.now(); return cached;
    },
    start() { throw new Error('Aurora monitoring is read-only. Owners must review and execute Safe actions separately.'); },
    research: () => researchStatus('.run/research/latest.json'),
    recovery: async () => ({ readOnly: true, automaticRetry: false, status: 'not-configured', message: 'No signed Aurora execution journal has been supplied; no transactions assumed.' }),
    close: async () => {},
  };
}
