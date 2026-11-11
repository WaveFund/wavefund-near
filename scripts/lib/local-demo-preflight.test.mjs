// Developer C: local-demo preflight and child-process tests. Nothing here installs tools or starts a chain.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { COMMAND_NOT_FOUND, DemoError, checkTool, createProcessGroup, listenHost, preflight, REQUIRED_TOOLS } from '../local-demo.mjs';

test('only explicit container mode listens beyond loopback', () => {
  assert.equal(listenHost({}), '127.0.0.1');
  assert.equal(listenHost({ WAVEFUND_CONTAINER: '1' }), '0.0.0.0');
  for (const value of ['true', 'yes', '0', ' 1', '']) assert.equal(listenHost({ WAVEFUND_CONTAINER: value }), '127.0.0.1', value);
});

// Fake child process: behaviour is 'missing', 'version:<text>' or 'exit:<code>'. Events are emitted asynchronously like Node.
function fakeSpawn(behaviour, calls = []) {
  return (command, args) => {
    calls.push([command, ...args]);
    const proc = new EventEmitter(); proc.stdout = new EventEmitter(); proc.pid = 4242; proc.exitCode = null; proc.signalCode = null; proc.kill = () => true;
    const mode = typeof behaviour === 'function' ? behaviour(command) : behaviour;
    setImmediate(() => {
      if (mode === 'missing') proc.emit('error', Object.assign(new Error(`spawn ${command} ENOENT`), { code: 'ENOENT' }));
      else if (mode.startsWith('version:')) { proc.stdout.emit('data', `${mode.slice(8)}\nCommit SHA: fixture\n`); proc.emit('close', 0, null); }
      else proc.emit('close', Number(mode.slice(5)), null);
    });
    return proc;
  };
}
const present = () => true;

test('missing forge and anvil fail with actionable guidance and nothing is installed', async () => {
  const calls = [];
  await assert.rejects(preflight({ spawnImpl: fakeSpawn('missing', calls), fileExists: present }), (error) => {
    assert.ok(error instanceof DemoError);
    assert.equal(error.exitCode, COMMAND_NOT_FOUND);
    for (const text of ['forge was not found on PATH', 'anvil was not found on PATH', 'foundryup --install 1.5.1', 'does not install tools']) assert.ok(error.message.includes(text), text);
    return true;
  });
  assert.deepEqual(calls, [['forge', '--version'], ['anvil', '--version']], 'only version probes are run; no installer is invoked');
});

test('one missing tool is reported even when the other is present', async () => {
  const spawnImpl = fakeSpawn((command) => (command === 'anvil' ? 'missing' : 'version:forge Version: 1.5.1-stable'));
  await assert.rejects(preflight({ spawnImpl, fileExists: present }), (error) => error.message.includes('anvil was not found') && !error.message.includes('forge was not found'));
});

test('present tools report their versions; a failing version probe keeps its context', async () => {
  const tools = await preflight({ spawnImpl: fakeSpawn('version:Version: 1.5.1-stable'), fileExists: present });
  assert.deepEqual(tools.map((tool) => tool.version), ['Version: 1.5.1-stable', 'Version: 1.5.1-stable']);
  await assert.rejects(checkTool(REQUIRED_TOOLS[0], { spawnImpl: fakeSpawn('exit:3') }), (error) => error.message.includes('exited 3') && error.exitCode === 1);
  const throwing = () => { throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); };
  await assert.rejects(checkTool(REQUIRED_TOOLS[1], { spawnImpl: throwing }), /anvil could not be started \(EACCES\)/);
});

test('missing Next.js dependencies are reported with the isolated install command', async () => {
  await assert.rejects(preflight({ spawnImpl: fakeSpawn('version:Version: 1.5.1'), fileExists: () => false }), (error) => {
    assert.ok(error.message.includes('npm ci --ignore-scripts')); assert.equal(error.exitCode, 1); return true;
  });
});

test('child startup errors reject instead of crashing the launcher', async () => {
  const group = createProcessGroup();
  const entry = group.start('api', 'wavefund-definitely-missing-binary', []);
  await assert.rejects(entry.done, (error) => error instanceof DemoError && error.exitCode === COMMAND_NOT_FOUND && /not found on PATH/.test(error.message));
  await group.stop();
});

test('non-zero child exit codes are preserved', async () => {
  const group = createProcessGroup();
  const entry = group.start('forge', process.execPath, ['-e', 'process.exit(7)'], { stdio: 'ignore' });
  await assert.rejects(entry.done, (error) => error.exitCode === 7 && /forge exited 7/.test(error.message));
  await group.stop();
});

test('stop terminates only processes started by this launcher', async (t) => {
  const outsider = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  t.after(() => { if (outsider.exitCode === null && outsider.signalCode === null) outsider.kill('SIGKILL'); });
  const group = createProcessGroup();
  const owned = group.start('ui', process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  await new Promise((resolve) => setTimeout(resolve, 200));
  await group.stop({ graceMs: 3000 });
  await assert.rejects(owned.done);
  assert.notEqual(owned.proc.signalCode ?? owned.proc.exitCode, null, 'owned child stopped');
  assert.equal(outsider.exitCode, null); assert.equal(outsider.signalCode, null, 'unrelated process untouched');
  assert.deepEqual(group.owned().map((item) => item.name), ['ui']);
});
