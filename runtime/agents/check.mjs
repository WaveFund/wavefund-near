import { providerConfig } from './provider.mjs';
// Configuration inspection only: no HTTP request, key output or billable inference.
try {
  const enabled = process.env.WAVEFUND_ALLOW_REMOTE_INFERENCE === '1';
  // Validate credentials/model while preserving the actual disabled state in the report.
  const config = providerConfig({ ...process.env, ...(process.env.WAVEFUND_AGENT_MODE === 'near-ai' ? { WAVEFUND_ALLOW_REMOTE_INFERENCE: '1' } : {}) });
  console.log(JSON.stringify(config ? { mode: config.mode, model: config.model, credentialConfigured: Boolean(config.apiKey), remoteInferenceEnabled: config.mode === 'near-ai' && enabled, readyForExplicitRun: config.mode === 'local' || enabled, requestsSent: 0 } : { mode: 'fixture', readyForExplicitRun: false, requestsSent: 0 }));
} catch (error) { console.error(error.message); process.exitCode = 1; }
