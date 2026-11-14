import { startServer } from '../runtime/server.mjs';
import { createAuroraRuntime } from '../runtime/operator/aurora.mjs';
import { cachedRead, httpPolicy } from '../runtime/http-policy.mjs';

httpPolicy(process.env);
if (process.env.WAVEFUND_HOSTED !== '1') throw new Error('Explicit hosted mode required');
const runtime = await createAuroraRuntime({
  manifestPath: 'deployments/aurora-testnet-tidepool.json', artifactsDir: 'runtime/abi',
});
const monitored = { ...runtime, state: cachedRead(() => runtime.state(), 10000),
  manager: { ...runtime.manager, inspect: cachedRead(() => runtime.manager.inspect(), 15000) } };
const app = await startServer({ runtime: monitored, host: '0.0.0.0' });
console.log('Wavefund Aurora testnet API ready; no signing or inference credentials loaded.');
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => app.close().then(() => process.exit(0)));
