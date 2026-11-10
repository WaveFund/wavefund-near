import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { readonlyRPC, readonlyClient } from '../runtime/operator/readonly-rpc.mjs';
import { loadManifest } from '../runtime/config.mjs';
import { auditReceipts } from '../runtime/operator/recovery.mjs';
try {
  const manifest = await loadManifest(process.env.LOCAL_MANIFEST ?? 'deployments/local.json');
  const journal = JSON.parse(await readFile(process.env.LOCAL_JOURNAL ?? '.run/local-demo/journal.json', 'utf8'));
  const report = await auditReceipts({ publicClient: readonlyClient(readonlyRPC(manifest.rpcUrl)), journal, contracts: manifest.contracts });
  await mkdir('.run/recovery', { recursive: true }); await writeFile('.run/recovery/audit.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ file: '.run/recovery/audit.json', allConfirmed: report.allConfirmed, needsManualReview: report.needsManualReview, automaticRetry: false }));
  if (report.needsManualReview) process.exitCode = 2;
} catch (error) { console.error(error.message); process.exitCode = 1; }
