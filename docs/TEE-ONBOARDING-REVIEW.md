# Review checkpoint — TEE and onboarding

Branch: `feat/tee-onboarding`, separate worktree `wavefund-near-codex`, base `feat/rich-rounds` at `b0578fe`. Main checkout, live operators, private journals/credentials and the other submission were not modified.

## Implemented

- Three role guides, existing-route links with missing-data fallbacks, compact lifecycle strip.
- Wallet panel remains available when monitoring has no round/API data; trading requires matching displayed/on-chain round identities, stale position reads are cleared and superseded requests ignored. No new server-side signer.
- Old read-only/trading-unavailable copy and developer-command empty states corrected.
- Opt-in `--tee --tee-policy` path; quote/config/event-log/measurement and signed GPU checks precede any paid completion. Existing paid-call budgets remain.
- Signed request includes the fresh nonce and exact Safe/engine/round/snapshot identity; evidence times must fit the plan window. This closes a review-discovered response-replay gap.
- Exact-byte signature verification, normalized decision/prompt recheck, hashed proposal rationale and actual `ProposalCreated` event binding.
- Export and API recheck use a separately reviewed policy; per-proposal UI checks; offline recheck CLI. Old rounds stay unverified.
- One pinned dependency: `@phala/dcap-qvl@0.7.0`; no Solidity changes.

## Verification

- Offline regression: 272 runtime tests, 104 frontend tests, all passing.
- Python bridge: 12 passing; no real wallet/model/Docker calls made by those tests.
- Typecheck and production build pass in isolated snapshot.
- Genuine unauthenticated public preflight: gateway and model both UpToDate with nonce/configuration/event-log checks passing; NVIDIA ES384 signature/nonce/verdict verified against its official JWKS. Zero paid model calls. Public summary: `docs/test-evidence/tee-public-preflight.json`. `docs/tee-policy.candidate.json` is schema0 and deliberately not accepted as a runtime policy pending review.
- Genuine saved CPU collateral and NVIDIA token were also rechecked successfully inside a container after its network was disconnected. This validates serialization/offline hardware recheck, not a model completion.
- Real pinned DCAP package smoke: expected exports exist and malformed quote rejected as `Failed to decode quote`. This is NOT a genuine hardware-attestation test.
- Targeted mutation audit: 37/37 caught; baseline green before and after. Initial allocation mutant survived; added a signed-versus-changed-local decision test and reran successfully. Reproduce with `node scripts/test-tee-mutations.mjs` in an installed isolated copy; it creates its own public-source scratch directory.
- Browser: Home role links and manager/forecaster guides inspected; no horizontal overflow on checked views at 390px and 1440px; dark/light inspected. With intentionally unavailable API from isolated preview origin, wallet panel still renders and offers browser-wallet guidance. This is NOT a funded wallet trade test. No verified badge screenshot can exist honestly before the live gate.
- Public-source scan: existing address-pattern hits in unchanged files; none in the newly added TEE/guide files. No private credential/journal included.

## Still gated — do not call the full live task complete

1. Review the public measurement/NVIDIA-key candidate from the genuine preflight and, only if accepted, extract its proposedPolicy as a schema1 runtime policy. The empty example deliberately rejects all calls. Do not turn this into automatic trust-on-first-use.
2. Fresh explicit approval for the additional model calls, pre-register a new round >8 and coordinate operator idleness with Claude. Capture verification before inference; never backfill old rounds.
3. Run the new attested round, verify/export it, then capture the genuinely verified Proposals drawer and run the offline CLI against its evidence.
4. Claude funds a throwaway test wallet between rounds; run the wallet approve/deposit/claim/buy/redemption browser test. Codex did not touch operator keys or send any transaction.

## Material limitations

Only ECDSA provider_tee response signatures are supported. UpToDate TCB policy is strict. Missing GPU evidence, unsupported algorithms, stale/unknown keys or ambiguous model signers reject the plan. Nvidia's signed overall GPU verdict is checked; device submodule chains are not independently audited. No same-serving-instance, TLS-channel, source-provenance, performance or creditworthiness guarantee is implied. See TEE-VERIFICATION.md for exact boundaries.
