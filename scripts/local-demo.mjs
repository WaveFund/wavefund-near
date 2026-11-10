import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { providerConfig, subprocessEnvironment } from '../runtime/agents/provider.mjs';
import { LOCAL_MNEMONIC } from '../runtime/config.mjs';

// Starts only a fresh disposable local chain. Never attaches to an existing RPC.
const children = [];
let stopping = false;
function child(command, args, env = {}, inferenceAccess = false) {
  const childEnv = subprocessEnvironment({ ...process.env, NEXT_TELEMETRY_DISABLED: '1', ...env }, inferenceAccess);
  const proc = spawn(command, args, { stdio: 'inherit', env: childEnv });
  children.push(proc); return proc;
}
async function command(name, args) {
  const proc = child(name, args);
  await new Promise((resolve, reject) => { proc.once('error', reject); proc.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${name} exited ${code}`))); });
}
function stop() { if (stopping) return; stopping = true; for (const proc of children.reverse()) if (proc.exitCode === null) proc.kill('SIGTERM'); }
process.once('SIGINT', stop); process.once('SIGTERM', stop);
try {
  providerConfig(); // Validate optional inference configuration before starting any chain process.
  await mkdir('deployments', { recursive: true });
  await mkdir('.run/local-demo', { recursive: true });
  try { await access('.run/local-demo/journal.json'); throw new Error('A previous journal exists. Preserve it or explicitly remove .run/local-demo after stopping the old demo.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  // Fail rather than accidentally deploying into somebody else's local chain.
  try { await fetch('http://127.0.0.1:8545', { method: 'POST', body: '{}', signal: AbortSignal.timeout(800) }); throw new Error('Port 8545 is already serving HTTP. Stop that node before starting a fresh demo.'); } catch (error) { if (error.message.includes('already serving')) throw error; }
  const anvil = child('anvil', ['--host', '127.0.0.1', '--port', '8545', '--chain-id', '31337', '--mnemonic', LOCAL_MNEMONIC, '--silent']);
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (anvil.exitCode !== null) throw new Error('Owned Anvil process exited before startup');
    try { const result = await (await fetch('http://127.0.0.1:8545', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }) })).json(); if (result.result === '0x7a69') { ready = true; break; } } catch {}
    await delay(100);
  }
  if (!ready) throw new Error('Local Anvil startup timed out');
  const compiler = process.env.WAVEFUND_SOLC ? ['--use', process.env.WAVEFUND_SOLC, '--offline'] : [];
  await command('forge', ['script', 'script/LocalDemo.s.sol:LocalDemo', '--rpc-url', 'http://127.0.0.1:8545', '--broadcast', '--slow', ...compiler]);
  const broadcast = JSON.parse(await readFile('broadcast/LocalDemo.s.sol/31337/run-latest.json', 'utf8'));
  if (!broadcast.receipts?.length || broadcast.receipts.some((r) => BigInt(r.status) !== 1n)) throw new Error('Local deployment receipts incomplete or failed');
  const manifest = JSON.parse(await readFile('deployments/local.json', 'utf8'));
  manifest.deployedAtBlock = Math.min(...broadcast.receipts.map((r) => Number(BigInt(r.blockNumber))));
  await writeFile('deployments/local.json', JSON.stringify(manifest, null, 2) + '\n');
  const api = child(process.execPath, ['runtime/server.mjs'], {}, true);
  const ui = child(process.execPath, ['node_modules/next/dist/bin/next', 'dev', 'frontend', '--hostname', '127.0.0.1', '--port', '3000']);
  console.log('Open http://127.0.0.1:3000 — disposable simulation only. Ctrl+C stops owned processes.');
  await Promise.race([anvil, api, ui].map((proc) => new Promise((_, reject) => proc.once('exit', (code) => reject(new Error(`Demo process exited ${code}`))))));
} catch (error) { if (!stopping) { console.error(error.message); process.exitCode = 1; } } finally { stop(); }
