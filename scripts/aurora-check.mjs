import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { artifactAbis } from '../runtime/operator/aurora.mjs';
import { isAddress } from 'viem';
import { readonlyRPC, readonlyClient, probeAurora } from '../runtime/operator/readonly-rpc.mjs';
import { createManagerService } from '../runtime/operator/manager.mjs';
import { CONTRACT_NAMES } from '../runtime/config.mjs';
try {
  const rpc = readonlyRPC(); const network = await probeAurora(rpc);
  const report = { network, stack: null, readyForPublicCycle: false, blockers: [] };
  let manifest;
  try { manifest = JSON.parse(await readFile('deployments/aurora-testnet.json', 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; report.blockers.push('No deployed Wavefund Aurora manifest; no addresses invented.'); }
  if (manifest) {
    if (manifest.schemaVersion !== 1 || manifest.chainId !== 1313161555 || CONTRACT_NAMES.some((name) => !isAddress(manifest.contracts?.[name] ?? '') || /^0x0{40}$/i.test(manifest.contracts[name])) || new Set(Object.values(manifest.contracts).map((value) => value.toLowerCase())).size !== CONTRACT_NAMES.length) throw new Error('Invalid Aurora deployment manifest');
    const abis = await artifactAbis();
    report.stack = await createManagerService({ publicClient: readonlyClient(rpc), contracts: manifest.contracts, abis, chainId: 1313161555 }).inspect();
    if (!report.stack.moduleEnabled) report.blockers.push('Owner has not enabled the module.');
    if (!report.stack.oracle.usable) report.blockers.push('No fresh usable settlement oracle.');
    report.blockers.push('A complete signed Aurora round and actual venue fill still require explicit operator execution.');
  }
  await mkdir('.run/aurora', { recursive: true }); await writeFile('.run/aurora/readiness.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
