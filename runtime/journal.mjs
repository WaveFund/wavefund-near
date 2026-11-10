import { readFile, writeFile, rename, mkdir, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { deploymentKey, json } from './config.mjs';

export async function acquireLock(file) {
  await mkdir(path.dirname(file), { recursive: true });
  let handle;
  try { handle = await open(file, 'wx', 0o600); } catch (error) {
    if (error.code === 'EEXIST') throw new Error('Another runtime or an interrupted session owns this local demo. Stop it or explicitly reset the local workspace.');
    throw error;
  }
  await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  return async () => { await handle.close(); await unlink(file); };
}

export async function openJournal(file, manifest) {
  let data;
  try { data = JSON.parse(await readFile(file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const key = deploymentKey(manifest);
  if (data && (data.schemaVersion !== 1 || data.deploymentKey !== key)) throw new Error('Journal belongs to another deployment; use the explicit local reset command');
  data ??= { schemaVersion: 1, deploymentKey: key, stage: 'idle', running: false, error: null, roundId: null, actions: [], agents: [], messages: [], initialBalances: {}, payouts: {} };
  if (data.running || data.actions.some((a) => ['prepared', 'broadcast', 'unknown'].includes(a.status))) {
    data.running = false; data.stage = 'interrupted'; data.error = 'Previous execution was interrupted. Inspect transaction receipts or reset this disposable local deployment; automatic resubmission is disabled.';
  }
  let pending = Promise.resolve();
  function save() {
    const encoded = json(data);
    pending = pending.then(async () => { await mkdir(path.dirname(file), { recursive: true }); const temporary = `${file}.tmp`; await writeFile(temporary, encoded, { mode: 0o600 }); await rename(temporary, file); });
    return pending;
  }
  await save();
  return { data, save, async stage(stage, message) { data.stage = stage; data.messages.push({ timestamp: new Date().toISOString(), stage, message }); await save(); } };
}
