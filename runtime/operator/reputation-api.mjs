import { readFile } from 'node:fs/promises';
import { createPublicClient, http } from 'viem';
import { createReputationReader } from '../agents/reputation-readonly.mjs';

// Developer C: read-only HTTP projection of the on-chain performance reputation (AgentReputation).
// Every check on network, runtime code, bindings, freshness, counts and score arithmetic lives in the shared
// createReputationReader (runtime/agents/reputation-readonly.mjs); this module adds none of its own. It never
// accepts an RPC URL, contract or agent from the request, and has no signing, execution or retry route.

export const REPUTATION_PATH = '/api/agents/reputation';
const AURORA_TESTNET_RPC = 'https://testnet.aurora.dev';
export { REPUTATION_CHAIN_ID, REPUTATION_STACKS, TRUSTED_PROPOSERS, createReputationBoard } from '../agents/reputation-board.mjs';
import { REPUTATION_STACKS, createReputationBoard } from '../agents/reputation-board.mjs';

// WAVEFUND_REPUTATION unset or "live": read Aurora testnet through the fixed public RPC. "disabled": no endpoint.
// Building the board makes no network request; reads happen only when the endpoint is called.
export async function reputationBoardFromEnvironment(env = process.env, stackId = 'original') {
  const mode = (env.WAVEFUND_REPUTATION ?? '').trim();
  if (mode === 'disabled') return null;
  if (mode && mode !== 'live') throw new Error('WAVEFUND_REPUTATION must be unset, "live" or "disabled"');
  const stack = REPUTATION_STACKS[stackId];
  if (!stack) throw new Error('Unknown reputation stack');
  const manifest = JSON.parse(await readFile(new URL(`../../${stack.manifest}`, import.meta.url), 'utf8'));
  const client = createPublicClient({ transport: http(AURORA_TESTNET_RPC, { retryCount: 0, timeout: 15_000 }) });
  return createReputationBoard({ reader: createReputationReader({ client, manifest }), manifest, stack });
}

// One board per stack, each with its own pinned manifest. Returns null when reputation is disabled.
export async function reputationBoardsFromEnvironment(env = process.env) {
  const original = await reputationBoardFromEnvironment(env, 'original');
  if (!original) return null;
  return { original, tidepool: await reputationBoardFromEnvironment(env, 'tidepool') };
}

// GET /api/agents/reputation (original stack, unchanged) and /api/agents/reputation/{original|tidepool}. Nothing else
// exists under /api/agents, and request query parameters are ignored. A single board option is the original stack.
export async function handleReputationRequest(boards, request, url, send) {
  const set = typeof boards?.read === 'function' ? { original: boards } : boards;
  const stackId = url.pathname === REPUTATION_PATH ? 'original' : url.pathname.startsWith(`${REPUTATION_PATH}/`) ? url.pathname.slice(REPUTATION_PATH.length + 1) : null;
  const board = set && stackId && Object.hasOwn(REPUTATION_STACKS, stackId) ? set[stackId] : null;
  if (!board || request.method !== 'GET') return send(404, { error: 'Not found' });
  try { return send(200, await board.read()); } catch { return send(503, { error: 'Outcome reputation is unavailable.', code: 'REPUTATION_UNAVAILABLE' }); }
}
