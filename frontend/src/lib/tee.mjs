// Presentation of a backend-verified public evidence projection; this is not a browser hardware verifier.
export const TEE_CHECKS = Object.freeze([
  ['nonceBound', 'Fresh nonce', 'The hardware quote binds our client-generated challenge and the signer.'],
  ['tdxQuoteVerified', 'Intel TDX', 'The quote chain and UpToDate policy passed, with debug mode disabled.'],
  ['gpuAttested', 'NVIDIA GPU', 'A pinned NVIDIA key signed a successful, nonce-bound attestation verdict.'],
  ['signatureValid', 'Exact response', 'The signature covers the exact request and response bytes.'],
  ['signerMatchesAttestation', 'Model signer', 'Exactly one retained model report matches the response signer.'],
  ['configurationBound', 'Configuration', 'The raw configuration hash matches the verified quote.'],
  ['eventLogVerified', 'Event log', 'Replaying the measurement events matches the quote.'],
  ['measurementPolicyMatched', 'Approved measurements', 'Measurements match the separately reviewed allowlist.'],
]);
export function teeDisplay(value) {
  const p = value?.privacy;
  const checks = TEE_CHECKS.map(([key, label, detail]) => ({ key, label, detail, ok: p?.[key] === true }));
  checks.push({ key: 'proposalBound', label: 'On-chain proposal', detail: 'The ProposalCreated event carries the signed response hash and allocation.', ok: value?.proposalBound === true });
  const verified = p?.schemaVersion === 1 && p.verified === true && p.signatureKind === 'provider_tee'
    && /^[a-f0-9]{64}$/.test(p.responseSha256 ?? '') && /^[a-f0-9]{64}$/.test(p.requestSha256 ?? '') && checks.every(c => c.ok);
  return { verified, checks, model: typeof p?.model === 'string' ? p.model : null };
}
