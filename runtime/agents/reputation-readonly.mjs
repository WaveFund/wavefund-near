import { isAddress, keccak256, parseAbi } from 'viem';

const abi = parseAbi([
  'function engine() view returns(address)', 'function tracker() view returns(address)',
  'function statistics(address) view returns(uint256 samples,uint256 positive,uint256 negative,uint256 flat)',
  'function score(address) view returns(int256)',
]);
class ReputationReadError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const check = (value, code) => { if (!value) throw new ReputationReadError(code); };
const address = value => {
  check(isAddress(value ?? '') && !/^0x0{40}$/i.test(value), 'REPUTATION_CONFIGURATION');
  return value.toLowerCase();
};

// Inject a trusted, read-only public client. No routes, keys, signing or registry selection scores.
export function createReputationReader({ client, manifest, clock = () => Math.floor(Date.now() / 1000), maxAgeSeconds = 120 }) {
  check(manifest?.schemaVersion === 1 && manifest.chainId === 1313161555, 'REPUTATION_CONFIGURATION');
  const contract = address(manifest.contracts?.reputation);
  const engine = address(manifest.contracts?.engine); const tracker = address(manifest.contracts?.tracker);
  const runtimeHash = manifest.runtimeHash;
  check(/^0x[0-9a-fA-F]{64}$/.test(runtimeHash ?? '') && Number.isSafeInteger(maxAgeSeconds) && maxAgeSeconds > 0
    && typeof client?.getChainId === 'function' && typeof client?.getBlock === 'function'
    && typeof client?.getCode === 'function' && typeof client?.readContract === 'function', 'REPUTATION_CONFIGURATION');
  return {
    async read(agentInput) {
      const agent = address(agentInput);
      try {
        check(await client.getChainId() === 1313161555, 'REPUTATION_WRONG_NETWORK');
        const block = await client.getBlock(); const now = clock();
        check(typeof block?.number === 'bigint' && block.number >= 0n && typeof block.timestamp === 'bigint'
          && Number.isSafeInteger(now) && block.timestamp <= BigInt(now)
          && BigInt(now) - block.timestamp <= BigInt(maxAgeSeconds), 'REPUTATION_STALE');
        const blockNumber = block.number;
        const code = await client.getCode({ address: contract, blockNumber });
        check(typeof code === 'string' && /^0x(?:[0-9a-fA-F]{2})+$/.test(code)
          && keccak256(code).toLowerCase() === runtimeHash.toLowerCase(), 'REPUTATION_CODE_MISMATCH');
        const read = functionName => client.readContract({ address: contract, abi, functionName,
          ...(functionName === 'statistics' || functionName === 'score' ? { args: [agent] } : {}), blockNumber });
        const [boundEngine, boundTracker, counts, score] = await Promise.all(['engine', 'tracker', 'statistics', 'score'].map(read));
        check(address(boundEngine) === engine && address(boundTracker) === tracker, 'REPUTATION_BINDING_MISMATCH');
        check(Array.isArray(counts) && counts.length === 4 && counts.every(x => typeof x === 'bigint' && x >= 0n)
          && typeof score === 'bigint', 'REPUTATION_INVALID_DATA');
        const [samples, positive, negative, flat] = counts;
        check(samples === positive + negative + flat && score === positive - negative, 'REPUTATION_INVALID_DATA');
        check(await client.getChainId() === 1313161555, 'REPUTATION_WRONG_NETWORK');
        return { schemaVersion: 1, chainId: 1313161555, contract, agent, blockNumber: String(blockNumber),
          blockTimestamp: String(block.timestamp), samples: String(samples), positive: String(positive),
          negative: String(negative), flat: String(flat), score: String(score), hasEvaluatedStrategies: samples > 0n,
          metric: 'absolute-marked-return-points-v1', evidence: 'trusted-rpc-pinned-contract-reads',
          scope: 'Selected, executed and settled strategies only; not lending creditworthiness.' };
      } catch (error) {
        if (error instanceof ReputationReadError) throw error;
        throw new ReputationReadError('REPUTATION_UNAVAILABLE');
      }
    },
  };
}
