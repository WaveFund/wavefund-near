# Wavefund NEAR AI verification

Implemented on `feat/tee-onboarding`; no live attested round is claimed yet. Rounds 1–8 remain unverified. New paid calls and the coordinated testnet round require a separate bounded approval and an idle operator wallet.

## Sources checked 13 November 2026

- [NEAR AI verification](https://docs.near.ai/cloud/verification)
- [Gateway attestation](https://docs.near.ai/cloud/verification/cloud-api/gateway-attestation)
- [Model candidates](https://docs.near.ai/cloud/verification/cloud-api/model-attestations)
- [Response signatures](https://docs.near.ai/cloud/verification/cloud-api/response-signatures)
- [Nonce, measurements, event logs and GPU evidence](https://docs.near.ai/cloud/verification/reference/quote-nonce-signer)
- [NVIDIA JWT verification](https://docs.nvidia.com/attestation/nv-attestation-sdk-cpp/latest/api/group__attestation__result__verification.html)
- [NVIDIA public JWKS](https://docs.api.nvidia.com/attestation/reference/keys)

## Corrections to the handoff

The contract emits `ProposalCreated`, not `ProposalSubmitted`. Export verifies that event. A gateway signature does not attest model execution. A model signer can be shared by serving instances: signer matching does not prove the exact instance served the response. Full hardware verification requires Intel-signed collateral, not parsing/echoed report fields. Raw HTTP response hashes and hashes of normalized model decisions are different: we preserve both and bind their meaning explicitly.

No code from the other submission was copied. Its exact-byte and independent-check design was reviewed; Wavefund's policy was independently written against these sources.

## Request sequence

1. Generate 32 random bytes, hex-encoded. Request `GET https://cloud-api.near.ai/v1/attestation/report` with `model=<canonical ID>`, `provider=near`, `signing_algo=ecdsa`, `include_tls_fingerprint=false`, `nonce=<64 hex>` and `x-no-aliasing: true`. No API key goes to this public endpoint.
2. Verify gateway and **every** model candidate before inference. Missing, duplicate-at-signature-match or rejected evidence fails closed.
3. Verify each Intel quote using `@phala/dcap-qvl@0.7.1`, Intel's production root, and saved Intel-signed collateral from the library's default Phala PCCS mirror. Require `UpToDate`, debug clear, correct report-data signer/nonce, raw app-compose hash matching MRCONFIGID, replayed RTMR3, and an explicitly reviewed `mrTd:mrConfigId` allowlist. No automatic trust-on-first-use.
4. Require GPU evidence. Check the payload nonce before sending it unchanged as JSON to `https://nras.attestation.nvidia.com/v3/attest/gpu`. Verify the returned overall ES384 EAT JWT against separately pinned NVIDIA public JWKs, issuer, subject, nonce, iat/nbf/exp and boolean overall verdict. The verified overall verdict is the relying-party GPU decision; device submodule JWTs/digests are not independently audited by this implementation.
5. Only then send one non-streamed completion to `/v1/chat/completions`, canonical model ID, no aliasing, and `Accept-Encoding: identity`. The user-message context includes a reserved `teeChallenge` equal to the fresh attestation nonce, plus the Safe/engine/round/snapshot identity, so the response signature cannot be replayed against another challenge or round. Save the exact UTF-8 body once before sending, and the exact decompressed response before parsing. Existing four/eight-call and cost-estimate budgets remain in the bounded provider. There is no paid retry or fallback.
6. Fetch `/v1/signature/<chat-id>?signing_algo=ecdsa`, using the completion API credential only on NEAR's fixed hostname. A 2xx error object, missing signature or 404 fails closed; this implementation does not retry signature fetching.
7. Require `signature_kind=provider_tee`, recover EIP-191 signer, compare the claimed address and match exactly one verified model report. Expected signed text is `<canonical model>:<SHA256(request bytes)>:<SHA256(response bytes)>`. A gateway/unknown kind is rejected for this model-level claim.
8. Revalidate the signed JSON decision and literal role/context prompt. Proposal rationale carries `NEAR AI (TEE verified) sha256:<raw response hash> · ...`. Export independently reads canonical successful proposal receipts on Aurora testnet and checks `ProposalCreated` engine/round/proposal/sender/allocation/hash.

## Policy and dependency

`docs/tee-policy.example.json` is intentionally empty and fails before a network/model call. Supply a reviewed **public** policy with gateway/model measurements and NVIDIA ES384 public keys using `--tee-policy`. Keys must come from NVIDIA's fixed HTTPS JWKS endpoint, never the response evidence itself. Review measured configurations/source provenance independently before allowlisting. Key rotation may require a reviewed public policy refresh; never silently trust a new key from a token's `jku`/`jwk`.

One new exact dependency, `@phala/dcap-qvl@0.7.1`, is needed because a home-made quote parser cannot verify the Intel certificate/collateral/signature chain. It is the verifier linked by NEAR's documented Node example. Its actual package API exposes `report.asTd10()`, unlike the current docs' alternate `report.type/data` sample. All new dependency execution is isolated. No other npm dependencies were added.

## Running once approved

Use a new pre-registered round >8. Coordinate with the operator owner, publish the target beforehand, and preserve existing signing/recovery journals. Do not run these commands from this branch while Claude's runner is active.

The existing Python plan command now accepts `--tee --tee-policy <reviewed-public-policy.json>` for hybrid/swarm. Keep `--run-inference`, the explicit target for hybrid, and the existing call caps. Repeat the policy arguments at `--phase run` so saved records are cryptographically rechecked before round authorization/opening. Non-TEE profiles retain their behavior.

Export with the existing script plus `--tee-policy <reviewed-public-policy.json>`. It writes a public `tee.json` receipt bundle. Public evidence contains bodies, signatures, quotes/collateral and tokens, never Authorization headers or API credentials. Review it with the existing publication/secret checks.

The evidence API only accepts TEE claims when `WAVEFUND_TEE_POLICY` points to the separately reviewed public policy; it independently reruns verification at load time. Without that policy a new TEE evidence source is rejected, not downgraded into an invented green badge. Existing non-TEE sources need no policy.

Offline recheck (no key or network):

```sh
node scripts/verify-tee.mjs 9 --policy /path/to/reviewed-public-policy.json
```

This checks saved signed material at its captured verification time. It is not a current collateral-revocation query. The nonce/ordering guarantee is implemented by the client; an offline transcript is not an independent timestamping service. Saved EVM receipts remain trusted public-RPC observations, not a light-client proof. No TLS channel binding, reproducible image/source provenance, same-serving-instance guarantee, investment alpha or guarantee of privacy from the gateway is claimed.

## UI and live gate

A new proposal badge requires all independent hardware/signature checks AND the on-chain binding. Each check is visible in “What was verified.” Old rounds cannot gain attestation retrospectively.

Still pending: reviewed policy populated from genuine evidence; approved live calls; a new round/export; screenshots of a genuinely verified badge; externally funded throwaway-wallet browser end-to-end. Synthetic tests are explicitly not hardware evidence. The ordinary demo and old rounds must continue working without attestation services or this policy.

Direct auxiliary HTTP calls and collateral-fetch operations are recorded separately from model-call usage; the library may make multiple HTTP requests per collateral operation. No paid retry is introduced.

## Genuine free preflight result

The unauthenticated Qwen attestation report returned a gateway report and one model candidate. Both passed DCAP as UpToDate, debug/nonce/configuration/event-log checks. NVIDIA returned a signed overall verdict that passed ES384, issuer, nonce and time checks against its official live JWKS. No API key, completion or transaction was used. See `docs/test-evidence/tee-public-preflight.json`.

`docs/tee-policy.candidate.json` contains only public measurements and the relevant public NVIDIA key. Its top-level schema is **0**, so it is not a runnable policy. A reviewer must assess the measured workloads and the documented source/instance limitations before extracting `proposedPolicy`. Observing a valid quote does not automatically approve that workload. Key rotation or deployment changes require a new review. Raw public preflight/collateral/GPU review material is retained only in the isolated build container under `/tmp/wavefund-tee-public-*.json` for local review.

The provider and record rechecker expose only structured TEE error codes. Non-empty hidden-reasoning fields are rejected rather than published in an exact-body evidence bundle.
