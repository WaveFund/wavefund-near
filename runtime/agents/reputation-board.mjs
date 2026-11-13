// Pure reputation board (no Node APIs): shared by the API server and the static/hosted frontend, which reads
// Aurora testnet straight from the browser. All checks live in the shared reader (reputation-readonly.mjs).
export const REPUTATION_CHAIN_ID = 1313161555;
// Separate contract histories: each stack has its own reputation contract and engine. Scores are never summed across them.
export const REPUTATION_STACKS = Object.freeze({
  original: Object.freeze({ id: 'original', label: 'Testnet Safe v1', manifest: 'deployments/aurora-testnet-reputation.json' }),
  tidepool: Object.freeze({ id: 'tidepool', label: 'Testnet Safe v2', manifest: 'deployments/aurora-testnet-tidepool-reputation.json' }),
});

// Trusted proposer identities (the four strategy proposers' wallets on Aurora testnet).
export const TRUSTED_PROPOSERS = Object.freeze([
  Object.freeze({ name: 'Conservative', address: '0x5613C60B04Fa16363C3a388AA4545073fb440345' }),
  Object.freeze({ name: 'Balanced', address: '0xcBF919ed9A28Da19786d97e1282C92B186500Cb8' }),
  Object.freeze({ name: 'Momentum', address: '0x8B6aF0B1738b941c0C7dd4deeC6fabEe3447888F' }),
  Object.freeze({ name: 'HighBeta', address: '0x1Ba3C5bf69b1Dd2077d7550Ee4f479bB35B5EA0a' }),
]);

// Codes the shared reader throws. Anything else (including raw RPC errors) is reported as unavailable, never echoed.
const READER_CODES = new Set(['REPUTATION_WRONG_NETWORK', 'REPUTATION_STALE', 'REPUTATION_CODE_MISMATCH', 'REPUTATION_BINDING_MISMATCH',
  'REPUTATION_INVALID_DATA', 'REPUTATION_UNAVAILABLE', 'REPUTATION_CONFIGURATION']);
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const SCOPE = 'Selected, executed and settled non-Hold strategies only: +1 positive, -1 negative, 0 flat. Unselected proposals earn nothing. Not a lending credit score.';

export function createReputationBoard({ reader, manifest = null, stack = REPUTATION_STACKS.original, proposers = TRUSTED_PROPOSERS, clock = () => Math.floor(Date.now() / 1000), nowMs = () => Date.now(), cacheMs = 15_000 }) {
  if (typeof reader?.read !== 'function') throw new Error('The reputation board requires the shared reputation reader');
  if (!Array.isArray(proposers) || proposers.length === 0
    || !proposers.every((item) => typeof item?.name === 'string' && /^[A-Za-z][A-Za-z0-9]{0,31}$/.test(item.name) && ADDRESS.test(item.address ?? ''))) {
    throw new Error('The trusted proposer list is invalid');
  }
  if (!Number.isSafeInteger(cacheMs) || cacheMs < 0) throw new Error('Invalid reputation cache interval');
  const contract = typeof manifest?.contracts?.reputation === 'string' && ADDRESS.test(manifest.contracts.reputation) ? manifest.contracts.reputation.toLowerCase() : null;
  const engine = typeof manifest?.contracts?.engine === 'string' && ADDRESS.test(manifest.contracts.engine) ? manifest.contracts.engine.toLowerCase() : null;
  if (!Object.hasOwn(REPUTATION_STACKS, stack?.id)) throw new Error('Unknown reputation stack');
  const list = proposers.map((item) => Object.freeze({ name: item.name, address: item.address.toLowerCase() }));
  let cached = null; let cachedAt = 0; let inFlight = null;

  async function load() {
    // One failing agent never hides the others; a failure is reported as unavailable, never as a zero score.
    const settled = await Promise.allSettled(list.map((item) => reader.read(item.address)));
    const agents = list.map((item, index) => {
      const result = settled[index];
      if (result.status === 'fulfilled') return { name: item.name, address: item.address, status: 'ok', reputation: result.value, code: null };
      return { name: item.name, address: item.address, status: 'unavailable', reputation: null, code: READER_CODES.has(result.reason?.code) ? result.reason.code : 'REPUTATION_UNAVAILABLE' };
    });
    const available = agents.filter((agent) => agent.status === 'ok').length;
    return {
      schemaVersion: 1, label: 'Performance reputation', metric: 'absolute-marked-return-points-v1', scope: SCOPE,
      notCreditScore: true, selectionWinsIncluded: false,
      network: { chainId: REPUTATION_CHAIN_ID, name: 'Aurora testnet' }, stack: { id: stack.id, label: stack.label, engine }, contract, observedAt: clock(),
      evidence: 'fresh-rpc-read',
      status: available === agents.length ? 'ok' : available === 0 ? 'unavailable' : 'partial', agents,
    };
  }

  return {
    // Cached briefly and de-duplicated so dashboard polling cannot multiply public RPC load.
    async read() {
      if (cached && nowMs() - cachedAt < cacheMs) return cached;
      if (!inFlight) inFlight = load().then((value) => { cached = value; cachedAt = nowMs(); return value; }).finally(() => { inFlight = null; });
      return inFlight;
    },
  };
}

