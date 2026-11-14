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
3. Verify each Intel quote using `@phala/dcap-qvl@0.7.0`, Intel's production root, and saved Intel-signed collateral from the library's default Phala PCCS mirror. Require `UpToDate`, debug clear, correct report-data signer/nonce, raw app-compose hash matching MRCONFIGID, replayed RTMR3, and an explicitly reviewed `mrTd:mrConfigId` allowlist. No automatic trust-on-first-use.
4. Require GPU evidence. Check the payload nonce before sending it unchanged as JSON to `https://nras.attestation.nvidia.com/v3/attest/gpu`. Verify the returned overall ES384 EAT JWT against separately pinned NVIDIA public JWKs, issuer, subject, nonce, iat/nbf/exp and boolean overall verdict. The verified overall verdict is the relying-party GPU decision; device submodule JWTs/digests are not independently audited by this implementation.
5. Only then send one non-streamed completion to `/v1/chat/completions`, canonical model ID, no aliasing, and `Accept-Encoding: identity`. The user-message context includes a reserved `teeChallenge` equal to the fresh attestation nonce, plus the Safe/engine/round/snapshot identity, so the response signature cannot be replayed against another challenge or round. Save the exact UTF-8 body once before sending, and the exact decompressed response before parsing. Existing four/eight-call and cost-estimate budgets remain in the bounded provider. No accepted or ambiguous generation is retried. Optional API-key fallback can try the identical request on another configured key only after explicit HTTP 401/402/429 rejection (at most three HTTP attempts per logical call).
6. Fetch `/v1/signature/<chat-id>?signing_algo=ecdsa`, using the completion API credential only on NEAR's fixed hostname. A 2xx error object, missing signature or 404 fails closed; this implementation does not retry signature fetching.
7. Require `signature_kind=provider_tee`, recover EIP-191 signer, compare the claimed address and match exactly one verified model report. Expected signed text is `<canonical model>:<SHA256(request bytes)>:<SHA256(response bytes)>`. A gateway/unknown kind is rejected for this model-level claim.
8. Revalidate the signed JSON decision and literal role/context prompt. Proposal rationale carries `NEAR AI (TEE verified) sha256:<raw response hash> · ...`. Export independently reads canonical successful proposal receipts on Aurora testnet and checks `ProposalCreated` engine/round/proposal/sender/allocation/hash.

## Policy and dependency

`docs/tee-policy.example.json` is intentionally empty and fails before a network/model call. Supply a reviewed **public** policy with gateway/model measurements and NVIDIA ES384 public keys using `--tee-policy`. Keys must come from NVIDIA's fixed HTTPS JWKS endpoint, never the response evidence itself. Review measured configurations/source provenance independently before allowlisting. Key rotation may require a reviewed public policy refresh; never silently trust a new key from a token's `jku`/`jwk`.

One new exact dependency, `@phala/dcap-qvl@0.7.0`, is needed because a home-made quote parser cannot verify the Intel certificate/collateral/signature chain. It is the verifier linked by NEAR's documented Node example. Its actual package API exposes `report.asTd10()`, unlike the current docs' alternate `report.type/data` sample. All new dependency execution is isolated. No other npm dependencies were added.

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

Direct auxiliary HTTP calls and collateral-fetch operations are recorded separately from model-call usage; the library may make multiple HTTP requests per collateral operation. Accepted or ambiguous generations and failed TEE proofs are never retried; explicit HTTP credential rejections may use the bounded key fallback above.

## Genuine free preflight result

The unauthenticated Qwen attestation report returned a gateway report and one model candidate. Both passed DCAP as UpToDate, debug/nonce/configuration/event-log checks. NVIDIA returned a signed overall verdict that passed ES384, issuer, nonce and time checks against its official live JWKS. No API key, completion or transaction was used. See `docs/test-evidence/tee-public-preflight.json`.

`docs/tee-policy.candidate.json` (now regenerated by `node scripts/tee-preflight.mjs --write-candidate`, see below) contains only public measurements and public NVIDIA keys. Its top-level schema is **0**, so it is not a runnable policy. A reviewer must assess the measured workloads and the documented source/instance limitations before extracting `proposedPolicy`. Observing a valid quote does not automatically approve that workload. Key rotation or deployment changes require a new review. Raw public preflight/collateral/GPU review material is retained only in the isolated build container under `/tmp/wavefund-tee-public-*.json` for local review.

The provider and record rechecker expose only structured TEE error codes. Non-empty hidden-reasoning fields are rejected rather than published in an exact-body evidence bundle.

## Trust-policy decision (13 November 2026): Outcome B, observed-pinned

`docs/tee-policy.json` records `trustBasis: "observed-at-2026-11-13-not-independently-reproduced"`. The UI and export say "measurements pinned from NEAR AI's live attestation on 2026-11-13; not independently reproduced", never "independently verified". `validateTeePolicy` rejects any other basis.
- **mrTd half: reproduced.** [dstack v0.5.12](https://github.com/Dstack-TEE/meta-dstack/releases/tag/v0.5.12) publishes `os_image_hash` 8db40cb2… (gateway) and 91fd5d69… (model), and both match the RTMR3 `os-image-hash` events. Recomputing MRTD from that release's `ovmf.fd` with [dstack-mr's algorithm](https://github.com/Dstack-TEE/dstack/blob/next/dstack/dstack-mr/src/tdvf.rs) gives both observed values exactly: two-pass on QEMU 8.2.2 for the gateway, single-pass on QEMU 9.2.1 for the model.
- **mrConfigId half: not reproduced.** It is NEAR AI's app-compose hash. NEAR AI publishes no expected value ([image provenance](https://docs.near.ai/cloud/verification/cloud-api/image-provenance), [verification policy](https://docs.near.ai/cloud/verification/reference/verification-policy)), so it is trust-on-first-use. The model compose also launches a compose-manager that pulls serving containers at runtime, so this hash does not pin the model-serving image.
- A fresh unauthenticated fetch at 15:08Z returned the same measurements as the 14:20Z candidate. `nrasKeys` holds all 212 current keys from [NVIDIA's JWKS](https://nras.attestation.nvidia.com/.well-known/jwks.json). NVIDIA rotates keys about hourly, so **refresh `nrasKeys` from that endpoint right before a live round**, or the GPU check fails closed.

### swarm2 proposer coverage (13 November 2026, 15:16-15:34Z)

`node scripts/tee-preflight.mjs` fetches each swarm2 proposer model's public attestation report (unauthenticated, fresh nonce, **no model call**), verifies every Intel quote with `@phala/dcap-qvl`, checks nonce, compose/mrConfigId and RTMR3 replay, has NVIDIA NRAS verify the GPU payload against the freshly fetched JWKS, and prints each observed `mrTd:mrConfigId` and whether the policy already holds it. `--write-candidate` writes `docs/tee-policy.candidate.json` for models that are missing; it never edits the real policy.

| Proposer | Model | mrConfigId (observed) |
|---|---|---|
| Conservative, Balanced, Contrarian | Qwen3.6-35B-A3B-FP8, Qwen3.8-27B, Qwen3-VL-30B-A3B-Instruct | `01e8416a…` (shared, already pinned) |
| Momentum | z-ai/glm-5.3-flash | `01c900dc…` (7/7 samples) |
| HighBeta | deepseek-ai/DeepSeek-V4.1-Flash-1017 | `01448683…` (19/20) and `01c53e25…` (1/20): two serving compose hashes, both pinned |

All five returned the same gateway measurement and the same model mrTd `df4d77c8…891b`, which is the value reproduced from dstack v0.5.12 above, with RTMR3 `os-image-hash` 91fd5d69…9829. So the **same observed-pinned basis** applies: mrTd reproduced, mrConfigId pinned as observed. `docs/tee-policy.json` lists the per-model values under `models`; `modelMeasurements` is their union (the report's `model_name` is checked separately). The NRAS JWKS re-fetch returned the same 212 keys. A third DeepSeek compose hash, if NEAR AI rotates one in, fails closed with `TEE_REPORT_REJECTED`; rerun the preflight before a live round.

`Qwen/Qwen3.8-27B-abliterated` is no longer a proposer. `deepseek/deepseek-v4.1-flash` and `moonshotai/kimi-k2.6` list a `hugging_face_id` but the report endpoint answers "No provider found that supports attestation reports", so swarm2 runs five proposers plus Hold.


### Round 10 compatibility fixes and replay

Round10 has four attested Qwen3.6 proposer responses and four explicitly scripted forecasters. `node scripts/verify-tee.mjs 10 --policy docs/tee-policy.json` rechecks the saved proofs and proposal bindings. Multiple fully verified model attestations may bind the same ECDSA signing address; every report must still pass all nonce/quote/GPU/configuration/event-log/measurement checks. No unmatched signer is accepted. The regression failed with the original exactly-one condition, and the captured rejected DeepSeek proof passes after the fix.

Live NVIDIA key rotation is explicitly enabled in the reviewed policy. Unknown keys come only from NVIDIA's fixed HTTPS JWKS endpoint, must verify a nonce-bound unexpired successful verdict, and are durably retained before generation. This trusts NVIDIA's HTTPS publication; it does not reproduce gateway source code or relax model measurements. Offline replay uses retained keys only. See AGENT-LAYER.md and the pre-registered round schedule for limits and failed attempts.
