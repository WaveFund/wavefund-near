import { createPublicClient, http } from 'viem';
import { AURORA_MAINNET_CHAIN_ID } from './routes.mjs';

// Read-only RPC readers for the funding proof. "Trusted" means operator-chosen, not cryptographically verified:
// a dishonest or compromised RPC can lie. The verifier authenticates each reader's chain id on every call.
// Defaults are the chains' official public endpoints (checked live 2026-11-11: chain ids 42161 / 1313161554,
// `finalized` block tag supported). An operator may substitute their own nodes, https only.
export const ARBITRUM_ONE_CHAIN_ID = 42161;
export const DEFAULT_RPC_ENDPOINTS = Object.freeze({
  [ARBITRUM_ONE_CHAIN_ID]: 'https://arb1.arbitrum.io/rpc',
  [AURORA_MAINNET_CHAIN_ID]: 'https://mainnet.aurora.dev',
});
export const EXPLORER_TX_URL = Object.freeze({
  [ARBITRUM_ONE_CHAIN_ID]: 'https://arbiscan.io/tx/',
  [AURORA_MAINNET_CHAIN_ID]: 'https://explorer.mainnet.aurora.dev/tx/',
});

export function createTrustedChainReaders({ endpoints = DEFAULT_RPC_ENDPOINTS, timeoutMs = 15000, transportFactory = http } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60000) throw new Error('timeoutMs must be 1000..60000');
  const readers = {};
  for (const chainId of [ARBITRUM_ONE_CHAIN_ID, AURORA_MAINNET_CHAIN_ID]) {
    const raw = endpoints?.[chainId];
    let url;
    try { url = new URL(raw); } catch { throw new Error(`Missing or invalid RPC endpoint for chain ${chainId}`); }
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error(`RPC endpoint for chain ${chainId} must be https without embedded credentials`);
    // No retries: a failed read is reported as unavailable evidence, never retried into a different answer.
    readers[chainId] = createPublicClient({ transport: transportFactory(url.toString(), { timeout: timeoutMs, retryCount: 0 }) });
  }
  return Object.freeze(readers);
}
