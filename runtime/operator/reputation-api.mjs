import { readFile } from 'node:fs/promises';
import { createPublicClient, http } from 'viem';
import { createReputationReader } from '../agents/reputation-readonly.mjs';

// Developer C: read-only HTTP projection of the on-chain performance reputation (AgentReputation).
// Every check on network, runtime code, bindings, freshness, counts and score arithmetic lives in the shared
// createReputationReader (runtime/agents/reputation-readonly.mjs); this module adds none of its own. It never
// accepts an RPC URL, contract or agent from the request, and has no signing, execution or retry route.

export const REPUTATION_CHAIN_ID = 1313161555;
export const REPUTATION_PATH = '/api/agents/reputation';
const AURORA_TESTNET_RPC = 'https://testnet.aurora.dev';
const MANIFEST_URL = new URL('../../deployments/aurora-testnet-reputation.json', import.meta.url);

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

export function createReputationBoard({ reader, manifest = null, proposers = TRUSTED_PROPOSERS, clock = () => Math.floor(Date.now() / 1000), nowMs = () => Date.now(), cacheMs = 15_000 }) {
  if (typeof reader?.read !== 'function') throw new Error('The reputation board requires the shared reputation reader');
  if (!Array.isArray(proposers) || proposers.length === 0
    || !proposers.every((item) => typeof item?.name === 'string' && /^[A-Za-z][A-Za-z0-9]{0,31}$/.test(item.name) && ADDRESS.test(item.address ?? ''))) {
    throw new Error('The trusted proposer list is invalid');
  }
  if (!Number.isSafeInteger(cacheMs) || cacheMs < 0) throw new Error('Invalid reputation cache interval');
  const contract = typeof manifest?.contracts?.reputation === 'string' && ADDRESS.test(manifest.contracts.reputation) ? manifest.contracts.reputation.toLowerCase() : null;
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
      network: { chainId: REPUTATION_CHAIN_ID, name: 'Aurora testnet' }, contract, observedAt: clock(),
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

// WAVEFUND_REPUTATION unset or "live": read Aurora testnet through the fixed public RPC. "disabled": no endpoint.
// Building the board makes no network request; reads happen only when the endpoint is called.
export async function reputationBoardFromEnvironment(env = process.env) {
  const mode = (env.WAVEFUND_REPUTATION ?? '').trim();
  if (mode === 'disabled') return null;
  if (mode && mode !== 'live') throw new Error('WAVEFUND_REPUTATION must be unset, "live" or "disabled"');
  const manifest = JSON.parse(await readFile(MANIFEST_URL, 'utf8'));
  const client = createPublicClient({ transport: http(AURORA_TESTNET_RPC, { retryCount: 0, timeout: 15_000 }) });
  return createReputationBoard({ reader: createReputationReader({ client, manifest }), manifest });
}

// Only GET /api/agents/reputation exists under /api/agents. Request query parameters are ignored.
export async function handleReputationRequest(board, request, url, send) {
  if (!board || request.method !== 'GET' || url.pathname !== REPUTATION_PATH) return send(404, { error: 'Not found' });
  try { return send(200, await board.read()); } catch { return send(503, { error: 'Performance reputation is unavailable.', code: 'REPUTATION_UNAVAILABLE' }); }
}
