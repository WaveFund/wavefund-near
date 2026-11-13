// Offline verification only: no network, credentials, inference or signing.
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { verifyTeeProposals } from '../runtime/agents/tee-proof.mjs';
const { values, positionals } = parseArgs({ allowPositionals: true, options: { policy: { type: 'string' } } });
if (positionals.length !== 1 || !/^[1-9][0-9]{0,3}$/.test(positionals[0]) || !values.policy) {
  console.error('Usage: node scripts/verify-tee.mjs <round> --policy <reviewed-public-policy.json>'); process.exit(2);
}
try {
  const dir = new URL(`../docs/test-evidence/tidepool-rounds/round${positionals[0]}/`, import.meta.url);
  const read = async path => JSON.parse(await readFile(path, 'utf8'));
  const [plan, proof, policy] = await Promise.all([read(new URL('plan.json', dir)), read(new URL('tee.json', dir)), read(values.policy)]);
  const proposals = await verifyTeeProposals(plan, proof.receipts, policy);
  console.log(JSON.stringify({ round: positionals[0], verified: true, proposals, note: 'Offline recheck at captured time against reviewed policy; saved receipts are public RPC observations, not a light-client proof. No proof of same serving instance, TLS path or source provenance.' }, null, 2));
} catch {
  console.error('TEE_NOT_VERIFIED: missing evidence/policy or verification failed. Old rounds cannot be attested retroactively.'); process.exitCode = 1;
}
