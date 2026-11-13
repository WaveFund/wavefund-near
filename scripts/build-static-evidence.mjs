#!/usr/bin/env node
// Writes the read-only evidence the API would serve into frontend/public/evidence/, so a hosted static frontend
// (NEXT_PUBLIC_DATA_MODE=static, e.g. Vercel) shows every completed round with no backend. Same projection and the same
// TEE verification as the API (loadRoundEvidence with the committed docs/tee-policy.json). No network, keys or signing.
//   node scripts/build-static-evidence.mjs           write the files
//   node scripts/build-static-evidence.mjs --check   exit 1 if the committed files are stale
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { loadRoundEvidence } from '../runtime/operator/round-evidence.mjs';
import { loadTidepoolDemo } from '../runtime/operator/tidepool-demo.mjs';

const OUT = new URL('../frontend/public/evidence/', import.meta.url);
export async function buildStaticEvidence() {
  const policy = JSON.parse(await readFile(new URL('../docs/tee-policy.json', import.meta.url), 'utf8'));
  const rounds = await loadRoundEvidence({ teePolicy: policy });
  const { demo } = await loadTidepoolDemo();
  const text = (value) => JSON.stringify(value, null, 1) + '\n';
  return { 'testnet-rounds.json': text(rounds), 'tidepool-demo.json': text(demo) };
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const files = await buildStaticEvidence();
  if (process.argv.includes('--check')) {
    const stale = [];
    for (const [name, body] of Object.entries(files)) {
      const current = await readFile(new URL(name, OUT), 'utf8').catch(() => null);
      if (current !== body) stale.push(name);
    }
    if (stale.length) { console.error(`STALE static evidence: ${stale.join(', ')} (run node scripts/build-static-evidence.mjs)`); process.exit(1); }
    console.log('static evidence up to date');
  } else {
    await mkdir(OUT, { recursive: true });
    for (const [name, body] of Object.entries(files)) await writeFile(new URL(name, OUT), body);
    console.log(`wrote ${Object.keys(files).join(', ')} to frontend/public/evidence/`);
  }
}
