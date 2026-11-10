import { createPublicClient, custom } from 'viem';

const METHODS = new Set(['eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call', 'eth_getTransactionReceipt', 'eth_getTransactionByHash', 'eth_getTransactionCount', 'eth_getBalance', 'web3_clientVersion']);
export function readonlyRPC(url = 'https://testnet.aurora.dev', { fetchImpl = fetch } = {}) {
  const parsed = new URL(url);
  const local = parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if ((!local && parsed.href !== 'https://testnet.aurora.dev/') || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') throw new Error('Read-only RPC must be loopback or the official Aurora testnet endpoint');
  let id = 0;
  return { async request({ method, params = [] }) {
    if (!METHODS.has(method)) throw new Error('RPC method is not read-only or is unsupported');
    const requestId = ++id;
    const response = await fetchImpl(parsed.href, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }) });
    if (!response.ok) throw new Error(`Read-only RPC HTTP ${response.status}`);
    if (!response.body) throw new Error('RPC response missing body');
    const reader = response.body.getReader(); const chunks = []; let size = 0;
    try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 1048576) throw new Error('RPC response too large'); chunks.push(value); } } finally { await reader.cancel().catch(() => {}); }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const result = JSON.parse(new TextDecoder().decode(bytes));
    if (result.id !== requestId || result.jsonrpc !== '2.0') throw new Error('RPC response identity mismatch');
    if (result.error) throw new Error(`RPC error ${Number(result.error.code)}`);
    if (!Object.hasOwn(result, 'result')) throw new Error('RPC result missing');
    return result.result;
  } };
}
export const readonlyClient = (rpc) => createPublicClient({ transport: custom(rpc, { retryCount: 0 }) });
export async function probeAurora(rpc) {
  const chainId = Number(BigInt(await rpc.request({ method: 'eth_chainId' })));
  if (chainId !== 1313161555) throw new Error('Expected Aurora testnet chain 1313161555');
  const block = await rpc.request({ method: 'eth_getBlockByNumber', params: ['latest', false] });
  if (!block?.number || !block.timestamp) throw new Error('Missing Aurora block');
  const probeAddress = '0x000000000000000000000000000000000000c0de';
  const call = (code) => rpc.request({ method: 'eth_call', params: [{ to: probeAddress, data: '0x' }, block.number, { [probeAddress]: { code } }] });
  let invalidRejected = false; try { await call('0xfe'); } catch { invalidRejected = true; }
  const expected = '0x' + '2a'.padStart(64, '0');
  const transient = await call('0x602a60005d60005c60005260206000f3');
  const mcopy = await call('0x602a6000526020600060205e60206020f3');
  if (!invalidRejected || transient !== expected || mcopy !== expected) throw new Error('Aurora opcode probe or negative control failed');
  return { chainId, blockNumber: BigInt(block.number).toString(), timestamp: BigInt(block.timestamp).toString(), invalidOpcodeRejected: true, transientStorage: true, mcopy: true, transactionsSent: 0, note: 'Unsigned ephemeral eth_call proof only; not a deployed Safe/v4 lifecycle.' };
}
