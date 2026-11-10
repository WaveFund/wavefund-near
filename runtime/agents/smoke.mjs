import { randomBytes } from 'node:crypto';
import { providerConfig, createProvider } from './provider.mjs';

// No wallets, research documents or strategy execution are involved in this probe.
export async function inferenceSmoke(env = process.env, { run = false, fetchImpl = fetch } = {}) {
  if (!run) return { status: 'not-run', requestsSent: 0, reason: 'Pass --run and explicitly enable remote inference.' };
  const config = providerConfig(env);
  if (!config || config.mode !== 'near-ai') throw new Error('Smoke test requires explicitly enabled near-ai mode');
  const nonce = randomBytes(16).toString('hex');
  const provider = createProvider(config, { fetchImpl, maxCalls: 1, timeoutMs: 20000 });
  const result = await provider.complete({
    system: 'Return only a JSON object with exactly two fields: status equal to "ok", and nonce copied exactly from the user input. No commentary, markdown or additional fields.',
    context: { nonce },
  });
  const value = result.value;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'nonce,status'
    || value.status !== 'ok' || value.nonce !== nonce) throw new Error('Smoke response failed challenge validation');
  return { status: 'passed', provider: 'near-ai', model: config.model, requestsSent: 1,
    responseValidated: true, attestationVerified: false, tradesSubmitted: 0, usage: result.usage };
}
