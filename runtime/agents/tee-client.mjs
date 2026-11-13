import { randomBytes } from 'node:crypto';
import { inspectReport, hex, verifyGpuToken, verifyCompletion } from './tee.mjs';
import { providerConfig } from './provider.mjs';

const BASE = 'https://cloud-api.near.ai/v1';
const NRAS = 'https://nras.attestation.nvidia.com/v3/attest/gpu';
const check = (ok, why) => { if (!ok) throw new Error(why); };
const REPORT_KEYS = ['nonceBound', 'tdxQuoteVerified', 'configurationBound', 'eventLogVerified', 'measurementPolicyMatched'];
export function validateTeePolicy(policy) {
  check(policy?.schemaVersion === 1 && Array.isArray(policy.gatewayMeasurements) && Array.isArray(policy.modelMeasurements)
    && policy.gatewayMeasurements.length > 0 && policy.modelMeasurements.length > 0
    && [...policy.gatewayMeasurements, ...policy.modelMeasurements].every(m => /^[a-f0-9]{96}:[a-f0-9]{96}$/.test(m))
    && Array.isArray(policy.nrasKeys) && policy.nrasKeys.length > 0 && policy.nrasKeys.length <= 1024
    && policy.nrasKeys.every(k => k && k.kty === 'EC' && k.crv === 'P-384' && typeof k.kid === 'string' && typeof k.x === 'string' && typeof k.y === 'string' && !Object.hasOwn(k, 'd')),  'TEE_POLICY_NOT_CONFIGURED');
  return policy;
}
async function defaultVerify(quote, collateral, at) {
  const dcap = (await import('@phala/dcap-qvl')).default;
  return dcap.verify(quote, collateral, at);
}
async function defaultCollateral(quote) {
  const dcap = (await import('@phala/dcap-qvl')).default;
  return dcap.getCollateral(dcap.PHALA_PCCS_URL, quote);
}
export async function verifyTeeEvidence(evidence, policy, { quoteVerifier = defaultVerify } = {}) {
  validateTeePolicy(policy);
  check(evidence?.schemaVersion === 1, 'TEE_EVIDENCE_SCHEMA_INVALID');
  const at = evidence.verificationTime;
  check(Number.isSafeInteger(at) && Number.isSafeInteger(evidence.preflightTime) && evidence.preflightTime <= at && at - evidence.preflightTime <= 300, 'TEE_EVIDENCE_TIME_INVALID');
  hex(evidence.nonce, 32);
  const all = evidence.attestationReport?.model_attestations;
  check(Array.isArray(all) && all.length > 0 && all.length <= 16, 'TEE_MODEL_REPORTS_MISSING');
  const reports = [evidence.attestationReport.gateway_attestation, ...all];
  const model = JSON.parse(evidence.requestBody).model;
  const results = [];
  for (const [i, report] of reports.entries()) {
    check(report && (i === 0 || report.model_name === model), 'TEE_WRONG_REPORT_MODEL');
    const qr = await quoteVerifier(hex(report.intel_quote), evidence.collateral[i], at);
    const r = inspectReport(report, qr, { nonce: evidence.nonce, allowedMeasurements: i === 0 ? policy.gatewayMeasurements : policy.modelMeasurements });
    check(REPORT_KEYS.every(k => r[k]), 'TEE_REPORT_REJECTED');
    if (i > 0) {
      const gpu = typeof report.nvidia_payload === 'string' ? JSON.parse(report.nvidia_payload) : null;
      r.gpuAttested = gpu?.nonce?.toLowerCase() === evidence.nonce && verifyGpuToken(evidence.gpuTokens[i - 1], evidence.nonce, policy.nrasKeys, at);
      check(r.gpuAttested, 'TEE_GPU_REJECTED');
      results.push({ ...r, signingAddress: report.signing_address, algorithm: report.signing_algo });
    }
  }
  return verifyCompletion({ model, nonce: evidence.nonce, requestBody: evidence.requestBody, responseBody: evidence.responseBody, signature: evidence.signature, modelReports: results });
}

// All HTTP destinations are fixed constants. No provider/model endpoint or headers are read from an evidence file.
export function createTeeProvider(config, { policy, fetchImpl = fetch, quoteVerifier = defaultVerify, getCollateral = defaultCollateral, now = () => Math.floor(Date.now() / 1000), nonceFactory = () => randomBytes(32).toString('hex'), maxCalls = 4, timeoutMs = 20000 } = {}) {
  const checked = providerConfig({ WAVEFUND_AGENT_MODE: config.mode, WAVEFUND_AGENT_MODEL: config.model, WAVEFUND_ALLOW_REMOTE_INFERENCE: '1', NEARAI_API_KEY: config.apiKey });
  check(checked.mode === 'near-ai', 'TEE_NEEDS_NEAR_AI'); validateTeePolicy(policy);
  check(Number.isInteger(maxCalls) && maxCalls >= 1 && maxCalls <= 8 && Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 60000, 'TEE_INVALID_LIMITS');
  let calls = 0; let auxiliaryCalls = 0;
  async function request(url, options = {}, cap = 4 * 1024 * 1024) {
    const response = await fetchImpl(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
    check(response.ok, `TEE_HTTP_${response.status}`);
    check(response.body, 'TEE_EMPTY_RESPONSE');
    const reader = response.body.getReader(); const parts = []; let size = 0;
    try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; check(size <= cap, 'TEE_RESPONSE_TOO_LARGE'); parts.push(value); } }
    finally { await reader.cancel().catch(() => {}); }
    return Buffer.concat(parts).toString('utf8');
  }
  return {
    info: Object.freeze({ mode: 'near-ai', model: checked.model, attestationVerified: false, teeRequired: true }),
    async complete({ system, context }) {
      check(++calls <= maxCalls, 'TEE_CALL_BUDGET_EXHAUSTED');
      const auxiliaryBefore = auxiliaryCalls;
      const nonce = nonceFactory(); hex(nonce, 32);
      const headers = { 'Content-Type': 'application/json', 'Accept-Encoding': 'identity', 'x-no-aliasing': 'true' };
      const auth = { ...headers, Authorization: `Bearer ${checked.apiKey}` };
      const preflightTime = now();
      auxiliaryCalls++;
      const attestationReport = JSON.parse(await request(`${BASE}/attestation/report?${new URLSearchParams({ model: checked.model, provider: 'near', include_tls_fingerprint: 'false', signing_algo: 'ecdsa', nonce })}`, { headers }));
      const models = attestationReport.model_attestations;
      check(Array.isArray(models) && models.length > 0 && models.length <= 16, 'TEE_MODEL_REPORTS_MISSING');
      const reports = [attestationReport.gateway_attestation, ...models]; const collateral = []; const gpuTokens = [];
      for (const [i, report] of reports.entries()) {
        check(report && (i === 0 || report.model_name === checked.model), 'TEE_WRONG_REPORT_MODEL');
        const quote = hex(report.intel_quote); collateral.push(await getCollateral(quote));
        const result = await quoteVerifier(quote, collateral[i], now());
        const flags = inspectReport(report, result, { nonce, allowedMeasurements: i === 0 ? policy.gatewayMeasurements : policy.modelMeasurements });
        check(REPORT_KEYS.every(k => flags[k]), 'TEE_REPORT_REJECTED');
        if (i > 0) {
          const payload = JSON.parse(report.nvidia_payload ?? 'null');
          check(payload?.nonce?.toLowerCase() === nonce, 'TEE_GPU_NONCE_MISMATCH');
          auxiliaryCalls++;
          const nras = JSON.parse(await request(NRAS, { method: 'POST', headers, body: JSON.stringify(payload) }));
          check(nras?.[0]?.[0] === 'JWT' && verifyGpuToken(nras[0][1], nonce, policy.nrasKeys, now()), 'TEE_GPU_REJECTED');
          gpuTokens.push(nras[0][1]);
        }
      }
      // Only now can a paid completion leave this process. Serialize once; don't wrap or modify its fetch later.
      const requestBody = JSON.stringify({ model: checked.model, messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify({ ...context, teeChallenge: nonce }) }], max_tokens: 1800, temperature: 0.2, stream: false, chat_template_kwargs: { enable_thinking: false }, response_format: { type: 'json_object' } });
      const responseBody = await request(`${BASE}/chat/completions`, { method: 'POST', headers: auth, body: requestBody }, 65536);
      const payload = JSON.parse(responseBody); const choice = payload.choices?.[0];
      check(choice?.finish_reason === 'stop' && !choice.message?.tool_calls?.length && typeof choice.message?.content === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(payload.id), 'TEE_COMPLETION_INVALID');
      auxiliaryCalls++;
      const signature = JSON.parse(await request(`${BASE}/signature/${payload.id}?signing_algo=ecdsa`, { headers: auth }, 65536));
      const teeEvidence = { schemaVersion: 1, nonce, preflightTime, verificationTime: now(), requestBody, responseBody, attestationReport, collateral, gpuTokens, signature };
      const privacy = await verifyTeeEvidence(teeEvidence, policy, { quoteVerifier });
      check(privacy.verified, 'TEE_RESPONSE_REJECTED');
      return { value: JSON.parse(choice.message.content), usage: { inputTokens: payload.usage?.prompt_tokens ?? null, outputTokens: payload.usage?.completion_tokens ?? null }, privacy, teeEvidence, auxiliaryCalls: auxiliaryCalls - auxiliaryBefore, collateralFetches: reports.length };
    },
  };
}
