import { createKeyFallback } from './key-fallback.mjs';
import { randomBytes } from 'node:crypto';
import { inspectReport, hex, verifyGpuToken, verifyCompletion, sha256 } from './tee.mjs';
import { providerConfig } from './provider.mjs';

const BASE = 'https://cloud-api.near.ai/v1';
const NRAS = 'https://nras.attestation.nvidia.com/v3/attest/gpu';
export const NVIDIA_JWKS = 'https://nras.attestation.nvidia.com/.well-known/jwks.json';
const check = (ok, why) => { if (!ok) throw new Error(why); };
const REPORT_KEYS = ['nonceBound', 'tdxQuoteVerified', 'configurationBound', 'eventLogVerified', 'measurementPolicyMatched'];
export async function verifyGpuWithRotation(token, nonce, policy, { at, fetchKeys, onRotation, now = () => at } = {}) {
  if (verifyGpuToken(token, nonce, policy.nrasKeys, now())) return true;
  if (policy.allowOfficialNvidiaRotation !== true || typeof onRotation !== 'function') return false;
  let kid;
  try { kid = JSON.parse(Buffer.from(token.split('.')[0], 'base64url')).kid; } catch { return false; }
  if (typeof kid !== 'string' || !/^[A-Za-z0-9_.-]{1,160}$/.test(kid) || policy.nrasKeys.some(k => k.kid === kid) || policy.nrasKeys.length >= 1024) return false;
  // The caller supplies only a fixed-endpoint transport, never an evidence-controlled URL or key.
  const jwks = await fetchKeys();
  const candidates = Array.isArray(jwks?.keys) ? jwks.keys.filter(k => k?.kid === kid) : [];
  if (candidates.length !== 1) return false;
  const { kty, crv, x, y } = candidates[0];
  if (kty !== 'EC' || crv !== 'P-384' || typeof x !== 'string' || typeof y !== 'string' || !/^[A-Za-z0-9_-]{64}$/.test(x) || !/^[A-Za-z0-9_-]{64}$/.test(y) || Object.hasOwn(candidates[0], 'd')) return false;
  const key = { kty, crv, kid, x, y };
  if (!verifyGpuToken(token, nonce, [key], now())) return false;
  // Persist the accepted public key before proceeding to a paid completion. Offline rechecks still use pinned keys.
  await onRotation({ source: NVIDIA_JWKS, key });
  policy.nrasKeys.push(key);
  return true;
}
export function responseFailureDetails(evidence, privacy) {
  const sig = evidence.signature ?? {};
  const model = JSON.parse(evidence.requestBody).model;
  const parts = typeof sig.text === 'string' ? /^([A-Za-z0-9][A-Za-z0-9_./:-]{0,119}):([a-f0-9]{64}):([a-f0-9]{64})$/.exec(sig.text) : null;
  const requestHash = sha256(Buffer.from(evidence.requestBody)), responseHash = sha256(Buffer.from(evidence.responseBody));
  const details = {
    signatureKind: ['provider_tee','gateway'].includes(sig.signature_kind) ? sig.signature_kind : 'missing-or-unknown',
    algorithmIsEcdsa: sig.signing_algo === 'ecdsa', providerError: Boolean(sig.error_code),
    textFormatValid: Boolean(parts), textModelMatches: parts?.[1] === model,
    requestHashMatches: parts?.[2] === requestHash, responseHashMatches: parts?.[3] === responseHash,
    signatureValid: privacy.signatureValid === true, signerMatchesAttestation: privacy.signerMatchesAttestation === true,
    matchingAttestationCount: (evidence.attestationReport?.model_attestations ?? []).filter(r => typeof r.signing_address === 'string' && typeof sig.signing_address === 'string' && r.signing_address.toLowerCase() === sig.signing_address.toLowerCase()).length,
    requestHash, responseHash,
  };
  const reason = details.signatureKind !== 'provider_tee' || !details.algorithmIsEcdsa || details.providerError ? 'MODEL_SIGNATURE_REQUIRED'
    : !details.textFormatValid || !details.textModelMatches ? 'SIGNATURE_TEXT_MODEL_MISMATCH'
    : !details.requestHashMatches ? 'SIGNED_REQUEST_HASH_MISMATCH'
    : !details.responseHashMatches ? 'SIGNED_RESPONSE_HASH_MISMATCH'
    : !details.signatureValid ? 'INVALID_RESPONSE_SIGNATURE'
    : !details.signerMatchesAttestation ? 'SIGNER_ATTESTATION_MISMATCH' : 'OTHER_COMPLETION_CHECK_FAILED';
  // Never persist arbitrary provider error text, headers or hidden reasoning in diagnostics.
  const signature = {
    text: parts ? sig.text : null,
    signature: typeof sig.signature === 'string' && /^0x[a-f0-9]{130}$/i.test(sig.signature) ? sig.signature : null,
    signing_address: typeof sig.signing_address === 'string' && /^0x[a-f0-9]{40}$/i.test(sig.signing_address) ? sig.signing_address : null,
    signing_algo: details.algorithmIsEcdsa ? 'ecdsa' : null, signature_kind: details.signatureKind, error_code: details.providerError ? 'REDACTED_PROVIDER_ERROR' : null,
  };
  return { reason, checks: details, evidence: { ...evidence, signature } };
}
// The only accepted basis today: values pinned from NEAR AI's live attestation, labelled as not independently reproduced.
export const TEE_TRUST_BASIS = /^observed-at-\d{4}-\d{2}-\d{2}-not-independently-reproduced$/;
export function validateTeePolicy(policy) {
  check(policy?.schemaVersion === 1 && (policy.allowOfficialNvidiaRotation === undefined || typeof policy.allowOfficialNvidiaRotation === 'boolean') && TEE_TRUST_BASIS.test(policy.trustBasis ?? '') && Array.isArray(policy.gatewayMeasurements) && Array.isArray(policy.modelMeasurements)
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
export function createTeeProvider(config, { policy, fetchImpl = fetch, quoteVerifier = defaultVerify, getCollateral = defaultCollateral, now = () => Math.floor(Date.now() / 1000), nonceFactory = () => randomBytes(32).toString('hex'), maxCalls = 4, timeoutMs = 20000, onVerificationFailure, onNvidiaKeyRotation } = {}) {
  const checked = providerConfig({ WAVEFUND_AGENT_MODE: config.mode, WAVEFUND_AGENT_MODEL: config.model, WAVEFUND_ALLOW_REMOTE_INFERENCE: '1', NEARAI_API_KEY: config.apiKey, NEARAI_API_KEY_1: config.backupApiKeys?.[0], NEARAI_API_KEY_2: config.backupApiKeys?.[1] });
  const credentials = createKeyFallback({ ...checked, fetchImpl });
  check(checked.mode === 'near-ai', 'TEE_NEEDS_NEAR_AI'); validateTeePolicy(policy);
  check(Number.isInteger(maxCalls) && maxCalls >= 1 && maxCalls <= 8 && Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 60000, 'TEE_INVALID_LIMITS');
  let calls = 0; let auxiliaryCalls = 0;
  async function request(url, options = {}, cap = 4 * 1024 * 1024) {
    const response = await credentials.fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
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
      try {
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
          const token = nras?.[0]?.[0] === 'JWT' ? nras[0][1] : null;
          const gpuVerified = typeof token === 'string' && await verifyGpuWithRotation(token, nonce, policy, { at: now(), now, onRotation: onNvidiaKeyRotation,
            fetchKeys: async () => { auxiliaryCalls++; return JSON.parse(await request(NVIDIA_JWKS, { headers }, 1024 * 1024)); } });
          if (!gpuVerified) {
            let kid = null;
            try { const value = JSON.parse(Buffer.from(token.split('.')[0], 'base64url')).kid; if (typeof value === 'string' && /^[A-Za-z0-9_.-]{1,160}$/.test(value)) kid = value; } catch {}
            const policyHasKey = kid !== null && policy.nrasKeys.some(k => k.kid === kid);
            await onVerificationFailure?.({ reason: !token ? 'GPU_TOKEN_MISSING' : !policyHasKey ? 'GPU_SIGNING_KEY_NOT_PINNED' : 'GPU_VERDICT_REJECTED',
              checks: { phase: 'gpu-preflight', signingKeyId: kid, policyHasKey, tokenPresent: typeof token === 'string' },
              evidence: { phase: 'gpu-preflight', nonce, preflightTime, attestationReport, collateral, token: typeof token === 'string' ? token : null } });
          }
          check(gpuVerified, 'TEE_GPU_REJECTED');
          gpuTokens.push(nras[0][1]);
        }
      }
      // Only now can a paid completion leave this process. Serialize once; don't wrap or modify its fetch later.
      const requestBody = JSON.stringify({ model: checked.model, messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify({ ...context, teeChallenge: nonce }) }], max_tokens: 1800, temperature: 0.2, stream: false, chat_template_kwargs: { enable_thinking: false }, response_format: { type: 'json_object' } });
      const responseBody = await request(`${BASE}/chat/completions`, { method: 'POST', headers: auth, body: requestBody }, 65536);
      const payload = JSON.parse(responseBody); const choice = payload.choices?.[0];
      check(choice?.finish_reason === 'stop' && !choice.message?.tool_calls?.length && !choice.message?.reasoning_content && !choice.message?.reasoning && typeof choice.message?.content === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(payload.id), 'TEE_COMPLETION_INVALID');
      auxiliaryCalls++;
      const signature = JSON.parse(await request(`${BASE}/signature/${payload.id}?signing_algo=ecdsa`, { headers: auth }, 65536));
      const teeEvidence = { schemaVersion: 1, nonce, preflightTime, verificationTime: now(), requestBody, responseBody, attestationReport, collateral, gpuTokens, signature };
      const privacy = await verifyTeeEvidence(teeEvidence, policy, { quoteVerifier });
      if (!privacy.verified) await onVerificationFailure?.(responseFailureDetails(teeEvidence, privacy));
      check(privacy.verified, 'TEE_RESPONSE_REJECTED');
      return { value: JSON.parse(choice.message.content), credentialUse: credentials.usage(), usage: { inputTokens: payload.usage?.prompt_tokens ?? null, outputTokens: payload.usage?.completion_tokens ?? null }, privacy, teeEvidence, auxiliaryCalls: auxiliaryCalls - auxiliaryBefore, collateralFetches: reports.length };
      } catch (error) {
        if (/^TEE_[A-Z0-9_]+$/.test(error?.message ?? '')) throw error;
        throw new Error('TEE_INFERENCE_OR_VERIFICATION_FAILED');
      }
    },
  };
}
