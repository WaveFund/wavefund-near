import { readFileSync, writeFileSync, cpSync, mkdirSync, mkdtempSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
// This script makes its own public-source-only scratch copy. It never modifies your checkout.
const root = fileURLToPath(new URL('../', import.meta.url));
if (!existsSync(join(root, 'node_modules'))) throw new Error('Install locked dependencies in your isolated environment first');
const scratch = mkdtempSync(join(tmpdir(), 'wavefund-tee-mutants-'));
for (const dir of ['runtime/agents', 'frontend/src/lib']) {
  mkdirSync(join(scratch, dir), { recursive: true }); cpSync(join(root, dir), join(scratch, dir), { recursive: true, filter: source => !basename(source).startsWith('.') });
}
for (const file of ['runtime/test/tee.test.mjs', 'runtime/test/tee-proof.test.mjs', 'runtime/test/fixtures/tee-synthetic.mjs', 'frontend/test/tee.test.mjs']) {
  mkdirSync(join(scratch, file, '..'), { recursive: true }); cpSync(join(root, file), join(scratch, file));
}
cpSync(join(root, 'package.json'), join(scratch, 'package.json'));
symlinkSync(join(root, 'node_modules'), join(scratch, 'node_modules'), 'dir');
process.chdir(scratch);
const cases = [
 ['TEE requested on old plan', 'runtime/agents/tee-record.mjs', "throw new Error('TEE_REQUESTED_BUT_PLAN_UNVERIFIED')", 'void 0'],
 ['TEE record set required', 'runtime/agents/tee-record.mjs', "throw new Error('TEE_RECORD_SET_INCOMPLETE')", 'void 0'],
 ['evidence schema', 'runtime/agents/tee-client.mjs', 'evidence?.schemaVersion === 1', 'true'],
 ['public-only NVIDIA policy keys', 'runtime/agents/tee-client.mjs', "!Object.hasOwn(k, 'd')", 'true'],
 ['model preflight before payment', 'runtime/agents/tee-client.mjs', "check(Array.isArray(models) && models.length > 0 && models.length <= 16, 'TEE_MODEL_REPORTS_MISSING');", 'void 0;'],
 ['GPU nonce before submission', 'runtime/agents/tee-client.mjs', "check(payload?.nonce?.toLowerCase() === nonce, 'TEE_GPU_NONCE_MISMATCH');", 'void 0;'],
 ['TDX debug', 'runtime/agents/tee.mjs', '&& !(td.tdAttributes[0] & 1)', ''],
 ['TCB policy', 'runtime/agents/tee.mjs', "quoteResult.status === 'UpToDate'", 'true'],
 ['echoed nonce', 'runtime/agents/tee.mjs', 'report.request_nonce?.toLowerCase() === nonce', 'true'],
 ['quote nonce/signer', 'runtime/agents/tee.mjs', 'Buffer.from(td.reportData).equals(expected)', 'true'],
 ['configuration', 'runtime/agents/tee.mjs', 'Buffer.from(td.mrConfigId).equals(config)', 'true'],
 ['event log', 'runtime/agents/tee.mjs', 'replayRtmr3(report.event_log).equals(Buffer.from(td.rtMr3))', 'true'],
 ['measurement policy', 'runtime/agents/tee.mjs', 'allowedMeasurements.includes(measurement)', 'true'],
 ['GPU crypto signature', 'runtime/agents/tee.mjs', "verifyCrypto('sha384',", "((...args) => true)('sha384',"],
 ['GPU pinned kid', 'runtime/agents/tee.mjs', 'k.kid === head.kid && ', ''],
 ['GPU issuer', 'runtime/agents/tee.mjs', "claims.iss === 'https://nras.attestation.nvidia.com'", 'true'],
 ['GPU nonce', 'runtime/agents/tee.mjs', 'claims.eat_nonce.toLowerCase() === nonce', 'true'],
 ['GPU expiry', 'runtime/agents/tee.mjs', 'at < claims.exp', 'true'],
 ['GPU verdict', 'runtime/agents/tee.mjs', "claims['x-nvidia-overall-att-result'] === true", "claims['x-nvidia-overall-att-result'] !== null"],
 ['canonical model', 'runtime/agents/tee.mjs', 'request.model === model', 'true'],
 ['unique signer', 'runtime/agents/tee.mjs', 'candidates.length === 1', 'candidates.length >= 1'],
 ['all model candidates', 'runtime/agents/tee.mjs', 'modelReports.every(r => r[key] === true)', 'modelReports.some(r => r[key] === true)'],
 ['all privacy checks', 'runtime/agents/tee.mjs', 'TEE_CHECKS.every(k => p[k] === true)', 'TEE_CHECKS.some(k => p[k] === true)'],
 ['literal prompt binding', 'runtime/agents/tee-record.mjs', "throw new Error('TEE_PROMPT_RECORD_MISMATCH')", 'void 0'],
 ['signed decision binding', 'runtime/agents/tee-record.mjs', "throw new Error('TEE_SIGNED_DECISION_MISMATCH')", 'void 0'],
 ['record recheck flags', 'runtime/agents/tee-record.mjs', "throw new Error('TEE_RECORD_RECHECK_FAILED')", 'void 0'],
 ['old rounds cannot gain TEE', 'runtime/agents/tee-proof.mjs', 'Number(plan.roundId) > 8', 'Number(plan.roundId) > 0'],
 ['proposal receipt engine', 'runtime/agents/tee-proof.mjs', 'receipt.to?.toLowerCase() !== plan.engine.toLowerCase()', 'false'],
 ['proposal receipt unique', 'runtime/agents/tee-proof.mjs', 'matches.length === 1', 'matches.length >= 1'],
 ['proposal allocation', 'runtime/agents/tee.mjs', 'Number(event.allocationBps) === decision.allocationBps', 'true'],
 ['proposal hash', 'runtime/agents/tee.mjs', 'event.rationale.startsWith(`NEAR AI (TEE verified) sha256:${sha256(Buffer.from(record.teeEvidence.responseBody))} · `)', 'true'],
 ['UI every check', 'frontend/src/lib/tee.mjs', 'checks.every(c => c.ok)', 'checks.some(c => c.ok)'],
];
const tests = ['runtime/test/tee.test.mjs','runtime/test/tee-proof.test.mjs','frontend/test/tee.test.mjs'];
const run = () => spawnSync(process.execPath, ['--test', ...tests], { encoding: 'utf8', timeout: 20000 });
const baseline = run(); if (baseline.status !== 0) { console.log(baseline.stdout,baseline.stderr); process.exit(2); }
let caught = 0; const survivors = [];
for (const [name,file,before,after] of cases) {
 const clean = readFileSync(file,'utf8'); if (!clean.includes(before)) throw new Error(`missing mutation: ${name}`);
 try { writeFileSync(file, clean.replace(before,after)); const result = run();
   if (result.status !== 0 && !result.error && !result.stderr.includes('SyntaxError')) { caught++; console.log(`CAUGHT ${name}`); }
   else { survivors.push(name); console.log(`SURVIVED ${name}`); }
 } finally { writeFileSync(file,clean); }
}
const restored = run(); console.log(JSON.stringify({caught,total:cases.length,survivors,restoredPass:restored.status===0}));
if(survivors.length || restored.status!==0) process.exitCode=1;
