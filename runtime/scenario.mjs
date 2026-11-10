import { runDemo } from './demo.mjs';
import { json, safeError } from './config.mjs';
try {
  const state = await runDemo({ manifestPath: process.env.LOCAL_MANIFEST ?? 'deployments/local.json', journalPath: process.env.LOCAL_JOURNAL ?? '.run/local-demo/journal.json', artifactsDir: process.env.CONTRACT_ARTIFACTS ?? 'out', rpcUrl: process.env.LOCAL_RPC_URL, paceMs: 0, onStage: (stage) => console.log(stage) });
  if (state.stage !== 'completed' || state.receipts.some((receipt) => receipt.status !== 'success')) throw new Error('Scenario did not complete successfully');
  console.log(json(state));
} catch (error) { console.error(safeError(error)); process.exitCode = 1; }
