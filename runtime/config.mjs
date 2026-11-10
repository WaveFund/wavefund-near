import { readFile } from 'node:fs/promises';
import { isAddress } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';

// Public disposable Anvil mnemonic. Never use these accounts with real funds.
export const LOCAL_MNEMONIC = 'test test test test test test test test test test test junk';
export const LOCAL_CHAIN_ID = 31337;
export const CONTRACT_NAMES = ['safe', 'stable', 'asset', 'oracle', 'router', 'poolManager', 'engine', 'module', 'tracker', 'tokens', 'registry', 'hook', 'market'];
export const STAGES = ['idle', 'analysing', 'opening', 'proposing', 'forecasting', 'selecting', 'executing', 'evaluating', 'settling', 'redeeming', 'completed', 'failed', 'interrupted'];

export function assertLocalRpc(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Local RPC URL is invalid'); }
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Writes require an HTTP loopback Anvil RPC, without credentials or query parameters');
  }
  return url.toString();
}

export function localAccounts() {
  return Array.from({ length: 5 }, (_, addressIndex) => mnemonicToAccount(LOCAL_MNEMONIC, { addressIndex }));
}

export function validateManifest(input) {
  if (input?.schemaVersion !== 1 || Number(input.chainId) !== LOCAL_CHAIN_ID || input.mode !== 'local-simulation') throw new Error('Expected local-simulation manifest for chain 31337');
  const contracts = {};
  for (const key of CONTRACT_NAMES) {
    const address = input.contracts?.[key];
    if (!isAddress(address ?? '') || /^0x0{40}$/i.test(address)) throw new Error(`Manifest contract missing/invalid: ${key}`);
    contracts[key] = address;
  }
  if (new Set(Object.values(contracts).map((a) => a.toLowerCase())).size !== CONTRACT_NAMES.length) throw new Error('Manifest contract addresses must be distinct');
  const accounts = localAccounts();
  const expected = { owner: accounts[0].address, keeper: accounts[0].address, proposers: [accounts[1].address, accounts[4].address], forecasters: [accounts[2].address, accounts[3].address] };
  for (const key of ['owner', 'keeper']) if (input.actors?.[key]?.toLowerCase() !== expected[key].toLowerCase()) throw new Error(`Manifest actor must be disposable local ${key}`);
  for (const key of ['proposers', 'forecasters']) {
    if (!Array.isArray(input.actors?.[key]) || input.actors[key].length !== 2 || expected[key].some((a, i) => input.actors[key][i]?.toLowerCase() !== a.toLowerCase())) throw new Error(`Manifest ${key} do not match disposable local accounts`);
  }
  const timing = Object.fromEntries(['tradingSeconds', 'twapWindowSeconds', 'executionGraceSeconds', 'evaluationSeconds'].map((key) => [key, Number(input.timing?.[key])]));
  if (Object.values(timing).some((n) => !Number.isSafeInteger(n) || n <= 0) || timing.tradingSeconds < timing.twapWindowSeconds + 20 || timing.evaluationSeconds <= timing.executionGraceSeconds || timing.tradingSeconds > 3600 || timing.evaluationSeconds > 3600) throw new Error('Invalid bounded demo timing');
  const block = Number(input.deployedAtBlock);
  if (!Number.isSafeInteger(block) || block < 0) throw new Error('Invalid deployment block');
  // Whitelist fields: never reflect arbitrary JSON, keys or secrets through HTTP state.
  return { schemaVersion: 1, chainId: LOCAL_CHAIN_ID, rpcUrl: assertLocalRpc(input.rpcUrl ?? 'http://127.0.0.1:8545'), mode: 'local-simulation', deployedAtBlock: block, contracts, actors: expected, timing };
}

export async function loadManifest(path) { return validateManifest(JSON.parse(await readFile(path, 'utf8'))); }
export function deploymentKey(manifest) { return `${manifest.chainId}:${manifest.contracts.engine.toLowerCase()}:${manifest.deployedAtBlock}`; }
export const json = (value) => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item);
export function safeError(error) { return String(error?.shortMessage ?? error?.message ?? error).slice(0, 700); }
