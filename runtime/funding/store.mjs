import { mkdirSync, openSync, closeSync, readFileSync, writeFileSync, fsyncSync, renameSync, unlinkSync, lstatSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { clone, requireFunding } from './schema.mjs';

// One private directory per deployment. A lock surviving a crash requires operator review;
// it is never automatically removed based on age/PID, preventing concurrent recovery sends.
export function createFundingStore(directory) {
  const root = resolve(directory); mkdirSync(root, { recursive: true, mode: 0o700 });
  const stat = lstatSync(root);
  requireFunding(stat.isDirectory() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0, 'STORE_DIRECTORY_PERMISSIONS');
  const file = join(root, 'funding.json'); const lock = join(root, 'funding.lock');
  function load() {
    let raw;
    try { const stat = lstatSync(file); requireFunding(stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0, 'STORE_FILE_PERMISSIONS'); raw = readFileSync(file, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return { schemaVersion: 1, records: {} }; throw error; }
    const data = JSON.parse(raw);
    requireFunding(data?.schemaVersion === 1 && data.records && typeof data.records === 'object' && !Array.isArray(data.records), 'STORE_CORRUPT');
    return data;
  }
  return {
    read() { return clone(load()); },
    transaction(update) {
      let fd;
      try { fd = openSync(lock, 'wx', 0o600); } catch { requireFunding(false, 'STORE_LOCKED'); }
      let temporary;
      try {
        const data = load(); const result = update(data);
        requireFunding(!result?.then, 'ASYNC_STORE_TRANSACTION');
        temporary = join(root, `funding-${randomUUID()}.tmp`);
        const out = openSync(temporary, 'wx', 0o600);
        try { writeFileSync(out, JSON.stringify(data)); fsyncSync(out); } finally { closeSync(out); }
        renameSync(temporary, file); temporary = undefined;
        const dir = openSync(root, 'r'); try { fsyncSync(dir); } finally { closeSync(dir); }
        return clone(result);
      } finally {
        if (temporary) { try { unlinkSync(temporary); } catch {} }
        closeSync(fd); unlinkSync(lock);
      }
    },
  };
}
