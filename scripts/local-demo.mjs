import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

// Starts only a fresh disposable local chain. Never attaches to an existing RPC and never installs tools.
const FOUNDRY_HINT = 'Install Foundry 1.5.1 with the official version manager (`foundryup --install 1.5.1`, see README "Judge quickstart" step 1) and make sure it is on PATH.';
export const REQUIRED_TOOLS = Object.freeze([
  Object.freeze({ name: 'forge', args: ['--version'], hint: FOUNDRY_HINT }),
  Object.freeze({ name: 'anvil', args: ['--version'], hint: FOUNDRY_HINT }),
]);
export const NEXT_BIN = 'node_modules/next/dist/bin/next';
export const COMMAND_NOT_FOUND = 127;

// In an isolated container the API and UI must listen on the container's interfaces so the host can reach the
// published ports. Only an explicit WAVEFUND_CONTAINER=1 enables this (server.mjs applies the same rule);
// Anvil always stays on loopback inside the container.
export function listenHost(env = process.env) { return env.WAVEFUND_CONTAINER === '1' ? '0.0.0.0' : '127.0.0.1'; }

export class DemoError extends Error {
  constructor(message, exitCode = 1) { super(message); this.name = 'DemoError'; this.exitCode = Number.isInteger(exitCode) && exitCode > 0 ? exitCode : 1; }
}

// Runs `<tool> --version` without a shell and reports a missing tool with an actionable message.
export function checkTool({ name, args, hint }, { spawnImpl = spawn, timeoutMs = 10_000 } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false; let output = ''; let timer;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); if (error) reject(error); else resolve(value); };
    let proc;
    try { proc = spawnImpl(name, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false }); }
    catch (error) { finish(new DemoError(`${name} could not be started (${error?.code ?? 'spawn failed'}). ${hint} This launcher does not install tools.`, error?.code === 'ENOENT' ? COMMAND_NOT_FOUND : 1)); return; }
    timer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} finish(new DemoError(`\`${name} --version\` did not finish within ${timeoutMs / 1000}s. ${hint}`)); }, timeoutMs);
    proc.stdout?.on('data', (chunk) => { output = (output + chunk).slice(0, 2000); });
    proc.once('error', (error) => finish(error?.code === 'ENOENT'
      ? new DemoError(`${name} was not found on PATH. ${hint} This launcher does not install tools.`, COMMAND_NOT_FOUND)
      : new DemoError(`${name} could not be started (${error?.code ?? 'error'}). ${hint}`)));
    proc.once('close', (code, signal) => (code === 0
      ? finish(null, { name, version: output.trim().split('\n')[0] || 'unknown version' })
      : finish(new DemoError(`\`${name} --version\` exited ${code ?? signal}. ${hint}`))));
  });
}

const exists = (path) => access(path).then(() => true, () => false);

// Checks every prerequisite before any process is started, and reports all problems together.
export async function preflight({ spawnImpl = spawn, fileExists = exists, tools = REQUIRED_TOOLS } = {}) {
  const found = []; const problems = []; let missingCommand = false;
  for (const tool of tools) {
    try { found.push(await checkTool(tool, { spawnImpl })); }
    catch (error) { problems.push(error.message); missingCommand ||= error.exitCode === COMMAND_NOT_FOUND; }
  }
  if (!(await fileExists(NEXT_BIN))) problems.push('Next.js is not installed. Restore dependencies in your isolated environment with `npm ci --ignore-scripts --no-audit --no-fund`.');
  if (problems.length) throw new DemoError(['Local demo preflight failed:', ...problems.map((problem) => `  - ${problem}`)].join('\n'), missingCommand ? COMMAND_NOT_FOUND : 1);
  return found;
}

// Tracks only processes this launcher started. Startup errors become rejections, never unhandled 'error' events.
export function createProcessGroup({ spawnImpl = spawn } = {}) {
  const children = []; let stopping = false;
  function start(name, command, args, options = {}) {
    let proc;
    try { proc = spawnImpl(command, args, { stdio: 'inherit', shell: false, ...options }); }
    catch (error) { throw new DemoError(`${name} could not be started (${error?.code ?? 'spawn failed'})`, error?.code === 'ENOENT' ? COMMAND_NOT_FOUND : 1); }
    const done = new Promise((resolve, reject) => {
      proc.once('error', (error) => reject(new DemoError(error?.code === 'ENOENT' ? `${name} (${command}) was not found on PATH` : `${name} failed to start (${error?.code ?? 'error'})`, error?.code === 'ENOENT' ? COMMAND_NOT_FOUND : 1)));
      proc.once('exit', (code, signal) => (code === 0 ? resolve() : reject(new DemoError(`${name} exited ${code ?? signal}`, code))));
    });
    done.catch(() => {}); // Observed by the caller; never an unhandled rejection.
    const entry = { name, proc, done };
    children.push(entry);
    return entry;
  }
  const running = ({ proc }) => proc.pid !== undefined && proc.exitCode === null && proc.signalCode === null;
  async function stop({ graceMs = 5000 } = {}) {
    if (stopping) return; stopping = true;
    const live = children.filter(running);
    for (const { proc } of [...live].reverse()) { try { proc.kill('SIGTERM'); } catch {} }
    const exited = live.map(({ proc }) => new Promise((resolve) => { if (proc.exitCode !== null || proc.signalCode !== null) resolve(); else proc.once('exit', resolve); }));
    await Promise.race([Promise.all(exited), delay(graceMs)]);
    for (const entry of live) if (running(entry)) { try { entry.proc.kill('SIGKILL'); } catch {} }
  }
  return { start, stop, get stopping() { return stopping; }, owned: () => children.map(({ name, proc }) => ({ name, pid: proc.pid })) };
}

export async function main({ spawnImpl = spawn } = {}) {
  const group = createProcessGroup({ spawnImpl });
  const onSignal = () => { void group.stop(); };
  process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal);
  try {
    const [{ providerConfig, subprocessEnvironment }, { LOCAL_MNEMONIC }] = await Promise.all([import('../runtime/agents/provider.mjs'), import('../runtime/config.mjs')]);
    providerConfig(); // Validate optional inference configuration before starting any chain process.
    const tools = await preflight({ spawnImpl });
    console.log(`Preflight: ${tools.map((tool) => tool.version).join(' · ')}`);
    const child = (name, command, args, env = {}, inferenceAccess = false) => group.start(name, command, args, { env: subprocessEnvironment({ ...process.env, NEXT_TELEMETRY_DISABLED: '1', ...env }, inferenceAccess) });
    await mkdir('deployments', { recursive: true });
    await mkdir('.run/local-demo', { recursive: true });
    try { await access('.run/local-demo/journal.json'); throw new DemoError('A previous journal exists. Preserve it or explicitly remove .run/local-demo after stopping the old demo.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    // Fail rather than accidentally deploying into somebody else's local chain.
    try { await fetch('http://127.0.0.1:8545', { method: 'POST', body: '{}', signal: AbortSignal.timeout(800) }); throw new DemoError('Port 8545 is already serving HTTP. Stop that node before starting a fresh demo.'); } catch (error) { if (error instanceof DemoError) throw error; }
    const anvil = child('anvil', 'anvil', ['--host', '127.0.0.1', '--port', '8545', '--chain-id', '31337', '--mnemonic', LOCAL_MNEMONIC, '--silent']);
    let ready = false; let anvilFailure = null;
    anvil.done.then(() => { anvilFailure = new DemoError('Owned Anvil process exited before startup'); }, (error) => { anvilFailure = error; });
    for (let i = 0; i < 100 && !ready; i++) {
      if (anvilFailure) throw anvilFailure;
      try { const result = await (await fetch('http://127.0.0.1:8545', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }) })).json(); ready = result.result === '0x7a69'; } catch {}
      if (!ready) await delay(100);
    }
    if (anvilFailure) throw anvilFailure;
    if (!ready) throw new DemoError('Local Anvil startup timed out');
    const compiler = process.env.WAVEFUND_SOLC ? ['--use', process.env.WAVEFUND_SOLC, '--offline'] : [];
    await child('forge', 'forge', ['script', 'script/LocalDemo.s.sol:LocalDemo', '--rpc-url', 'http://127.0.0.1:8545', '--broadcast', '--slow', ...compiler]).done;
    const broadcast = JSON.parse(await readFile('broadcast/LocalDemo.s.sol/31337/run-latest.json', 'utf8'));
    if (!broadcast.receipts?.length || broadcast.receipts.some((r) => BigInt(r.status) !== 1n)) throw new DemoError('Local deployment receipts incomplete or failed');
    const manifest = JSON.parse(await readFile('deployments/local.json', 'utf8'));
    manifest.deployedAtBlock = Math.min(...broadcast.receipts.map((r) => Number(BigInt(r.blockNumber))));
    await writeFile('deployments/local.json', JSON.stringify(manifest, null, 2) + '\n');
    const host = listenHost();
    // The read-only evidence API needs the reviewed public TEE policy to load round 9 (runtime/operator/round-evidence.mjs).
    const teePolicy = process.env.WAVEFUND_TEE_POLICY || (await access('docs/tee-policy.json').then(() => 'docs/tee-policy.json', () => undefined));
    const api = child('api', process.execPath, ['runtime/server.mjs'], { ...(host === '0.0.0.0' ? { HOST: host } : {}), ...(teePolicy ? { WAVEFUND_TEE_POLICY: teePolicy } : {}) }, true);
    const ui = child('frontend', process.execPath, [NEXT_BIN, 'dev', 'frontend', '--hostname', host, '--port', '3000']);
    console.log('Open http://127.0.0.1:3000 — disposable simulation only. Funding preview: http://127.0.0.1:3000/fund?fixtures=1 (labelled fixtures). Ctrl+C stops owned processes.');
    await Promise.race([anvil, api, ui].map((entry) => entry.done.then(() => { throw new DemoError(`${entry.name} exited unexpectedly`); })));
    return 1;
  } catch (error) {
    if (group.stopping) return 0; // Deliberate Ctrl+C / SIGTERM stop, as before.
    console.error(error?.message ?? String(error));
    return error instanceof DemoError ? error.exitCode : 1;
  } finally {
    await group.stop();
    process.removeListener('SIGINT', onSignal); process.removeListener('SIGTERM', onSignal);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
