// Wavefund's verification policy. Exact bytes in, independent results out. No network or saved-flag trust.
import { createHash, createPublicKey, verify as verifyCrypto } from 'node:crypto';
import { recoverMessageAddress } from 'viem';

export const TEE_CHECKS = Object.freeze(['nonceBound', 'tdxQuoteVerified', 'gpuAttested', 'signatureValid', 'signerMatchesAttestation', 'configurationBound', 'eventLogVerified', 'measurementPolicyMatched']);
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const hash = (kind, ...values) => { const h = createHash(kind); for (const v of values) h.update(v); return h.digest(); };
const parse = value => typeof value === 'string' ? JSON.parse(value) : value;
const check = (ok, why) => { if (!ok) throw new Error(why); };
export function hex(value, length) {
  check(typeof value === 'string' && /^(?:0x)?(?:[a-fA-F0-9]{2})+$/.test(value), 'TEE_INVALID_HEX');
  const b = Buffer.from(value.replace(/^0x/, ''), 'hex');
  check(length === undefined || b.length === length, 'TEE_INVALID_HEX_LENGTH'); return b;
}
export function replayRtmr3(value) {
  const events = parse(value); check(Array.isArray(events) && events.length <= 4096, 'TEE_EVENT_LOG_INVALID');
  let extended = Buffer.alloc(48);
  for (const e of events) {
    if (e.imr !== 3) continue;
    check(Number.isInteger(e.event_type) && e.event_type >= 0 && e.event_type <= 0xffffffff && typeof e.event === 'string', 'TEE_EVENT_INVALID');
    const type = Buffer.alloc(4); type.writeUInt32LE(e.event_type);
    const payload = e.event_payload ? hex(e.event_payload) : Buffer.alloc(0);
    const digest = hash('sha384', type, ':', Buffer.from(e.event), ':', payload);
    if (e.digest) check(hex(e.digest, 48).equals(digest), 'TEE_EVENT_DIGEST_MISMATCH');
    extended = hash('sha384', extended, digest);
  }
  return extended;
}
export function verifyGpuToken(token, nonce, keys, at) {
  try {
    check(typeof token === 'string' && token.length <= 1024 * 1024, 'GPU_TOKEN_INVALID');
    const parts = token.split('.'); check(parts.length === 3 && parts.every(p => /^[A-Za-z0-9_-]+$/.test(p)), 'GPU_JWT_INVALID');
    const head = JSON.parse(Buffer.from(parts[0], 'base64url')); const claims = JSON.parse(Buffer.from(parts[1], 'base64url'));
    check(head.alg === 'ES384' && !head.crit && !head.jku && !head.jwk, 'GPU_JWT_ALGORITHM');
    const matches = keys.filter(k => k.kid === head.kid && k.kty === 'EC' && k.crv === 'P-384' && (!k.alg || k.alg === 'ES384') && (!k.use || k.use === 'sig'));
    check(matches.length === 1, 'GPU_KEY_NOT_PINNED');
    check(verifyCrypto('sha384', Buffer.from(`${parts[0]}.${parts[1]}`), { key: createPublicKey({ key: matches[0], format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, Buffer.from(parts[2], 'base64url')), 'GPU_SIGNATURE_INVALID');
    check(claims.iss === 'https://nras.attestation.nvidia.com' && claims.sub === 'NVIDIA-PLATFORM-ATTESTATION', 'GPU_ISSUER_INVALID');
    check(typeof claims.eat_nonce === 'string' && claims.eat_nonce.toLowerCase() === nonce, 'GPU_NONCE_INVALID');
    check(Number.isSafeInteger(at) && Number.isSafeInteger(claims.iat) && Number.isSafeInteger(claims.exp) && claims.iat <= at && at < claims.exp && (!claims.nbf || claims.nbf <= at), 'GPU_TIME_INVALID');
    return claims['x-nvidia-overall-att-result'] === true;
  } catch { return false; }
}

/** quoteResult MUST come from the trusted DCAP adapter, never from JSON evidence flags. */
export function inspectReport(report, quoteResult, { nonce, allowedMeasurements }) {
  const out = { nonceBound: false, tdxQuoteVerified: false, configurationBound: false, eventLogVerified: false, measurementPolicyMatched: false };
  try {
    const td = quoteResult?.report?.asTd10?.();
    out.tdxQuoteVerified = quoteResult.status === 'UpToDate' && td != null && Buffer.from(td.tdAttributes).length === 8 && !(td.tdAttributes[0] & 1);
    if (!out.tdxQuoteVerified) return out;
    check(report.signing_algo === 'ecdsa', 'TEE_ALGORITHM_UNSUPPORTED');
    const identity = hex(report.signing_address, 20); const nonceBytes = hex(nonce, 32);
    // This profile explicitly requests NO TLS fingerprint; TLS connection binding is outside its claim.
    check(!report.tls_cert_fingerprint, 'TEE_UNEXPECTED_TLS_BINDING');
    const expected = Buffer.concat([identity, Buffer.alloc(12), nonceBytes]);
    out.nonceBound = report.request_nonce?.toLowerCase() === nonce && Buffer.from(td.reportData).equals(expected)
      && (report.report_data === undefined || hex(report.report_data, 64).equals(expected));
    const compose = parse(report.info?.tcb_info)?.app_compose;
    check(typeof compose === 'string' && compose.length <= 1024 * 1024, 'TEE_COMPOSE_MISSING');
    const config = Buffer.concat([Buffer.from([1]), hash('sha256', Buffer.from(compose)), Buffer.alloc(15)]);
    out.configurationBound = Buffer.from(td.mrConfigId).equals(config);
    out.eventLogVerified = replayRtmr3(report.event_log).equals(Buffer.from(td.rtMr3));
    const measurement = `${Buffer.from(td.mrTd).toString('hex')}:${Buffer.from(td.mrConfigId).toString('hex')}`;
    out.measurementPolicyMatched = Array.isArray(allowedMeasurements) && allowedMeasurements.includes(measurement);
  } catch { /* Fail closed; keep independently established checks. */ }
  return out;
}

export function privacyVerified(p) {
  return p?.schemaVersion === 1 && p.signatureKind === 'provider_tee' && TEE_CHECKS.every(k => p[k] === true)
    && /^[a-f0-9]{64}$/.test(p.requestSha256 ?? '') && /^[a-f0-9]{64}$/.test(p.responseSha256 ?? '');
}

export async function verifyCompletion({ model, nonce, requestBody, responseBody, signature, modelReports }) {
  const requestSha256 = sha256(Buffer.from(requestBody)); const responseSha256 = sha256(Buffer.from(responseBody));
  const p = { schemaVersion: 1, model, nonceBound: false, tdxQuoteVerified: false, gpuAttested: false, configurationBound: false,
    eventLogVerified: false, measurementPolicyMatched: false, signatureKind: signature?.signature_kind ?? null,
    signatureValid: false, signerMatchesAttestation: false, requestSha256, responseSha256, verified: false };
  try {
    hex(nonce, 32);
    check(signature?.signature_kind === 'provider_tee' && signature.signing_algo === 'ecdsa' && !signature.error_code, 'TEE_MODEL_SIGNATURE_REQUIRED');
    const request = JSON.parse(requestBody); check(request.model === model, 'TEE_MODEL_MISMATCH');
    check(JSON.parse(request.messages?.[1]?.content ?? 'null')?.teeChallenge === nonce, 'TEE_REQUEST_NONCE_MISMATCH');
    const text = `${model}:${requestSha256}:${responseSha256}`;
    if (signature.text === text) {
      const signer = await recoverMessageAddress({ message: text, signature: signature.signature });
      p.signatureValid = signer.toLowerCase() === signature.signing_address?.toLowerCase();
    }
    const candidates = modelReports.filter(r => r.signingAddress?.toLowerCase() === signature.signing_address?.toLowerCase() && r.algorithm === signature.signing_algo);
    p.signerMatchesAttestation = p.signatureValid && candidates.length === 1;
    // All candidates must have passed preflight; never select one good report from a mixed set.
    for (const key of TEE_CHECKS.filter(k => !['signatureValid', 'signerMatchesAttestation'].includes(k))) p[key] = modelReports.length > 0 && modelReports.every(r => r[key] === true);
    p.verified = privacyVerified(p);
  } catch { /* Not verified. */ }
  return Object.freeze(p);
}

export function proposalRationale(record, fallback) {
  if (!record?.attestationVerified) return `NEAR AI model summary (test assets): ${fallback}`;
  check(record.privacy?.verified === true && privacyVerified(record.privacy), 'TEE_RECORD_UNVERIFIED');
  return `NEAR AI (TEE verified) sha256:${record.privacy.responseSha256} · ${fallback}`.slice(0, 512);
}
export function proposalBinding(record, event) {
  if (!record?.privacy?.verified || !privacyVerified(record.privacy)) return false;
  try {
    const response = JSON.parse(record.teeEvidence.responseBody); const decision = JSON.parse(response.choices[0].message.content);
    return event.rationale.startsWith(`NEAR AI (TEE verified) sha256:${sha256(Buffer.from(record.teeEvidence.responseBody))} · `)
      && record.privacy.responseSha256 === sha256(Buffer.from(record.teeEvidence.responseBody))
      && Number(event.allocationBps) === decision.allocationBps && Number(event.allocationBps) === record.decision.allocationBps;
  } catch { return false; }
}
