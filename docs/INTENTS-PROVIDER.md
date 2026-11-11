# NEAR Intents provider (1Click) client

`runtime/intents/` is a server-side client for the NEAR Intents **1Click API**. It adds a second execution route alongside the existing Trisolaris swap. It does not replace Trisolaris and does not touch the forecasting contracts.

**Status (2026-11-11):**

- The client is implemented and unit-tested with injected fixtures.
- **No execution quote has been requested from the live provider, and no deposit has been made.** The only live calls made during development were `GET /v0/tokens` and **dry** `POST /v0/quote` requests, all unauthenticated and creating no deposit address.

## What the client does and does not do

| Does | Does not |
|---|---|
| Lists supported assets with their exact `assetId`, `blockchain` and `decimals` | Hold wallet keys, sign transactions or intents, or move money |
| Requests **dry** quotes (`previewOrder`) | Choose the winning strategy or mark a round executed |
| Requests execution quotes (`prepareOrder`), only when the client is built with `allowExecutionQuotes: true` | Write the execution journal |
| Verifies the 1Click ed25519 quote signature | Retry any request, deposit or broadcast |
| Reads execution status and binds it to the prepared quote | Fall back to Trisolaris or any other venue |

A valid provider signature establishes **payload origin only**. The coordinator still enforces treasury policy and contract authorization.

## Interface

```js
import { createIntentsClient } from './runtime/intents/index.mjs';

const client = createIntentsClient({
  apiKey,                       // optional 1Click partner JWT, sent as X-API-Key; never returned or logged
  transport,                    // optional ({ method, url, headers, body, signal, maxBytes }) => { status, headers, bodyText }
  clock,                        // optional { now(): epochMs }
  verifySignature,              // optional (quoteResponse) => { valid, scheme, publicKey, message }
  allowExecutionQuotes: false,  // execution-quote gate; must be exactly true to enable prepareOrder
  timeoutMs: 10000, assetCacheTtlMs: 300000, maxQuoteAgeMs: 120000, maxClockSkewMs: 30000,
});
client.getSupportedAssets();         // { assets: [{ assetId, blockchain, decimals, symbol, ... }], rejectedEntries, mocked, source }
client.previewOrder(order);          // DRY_QUOTE
client.prepareOrder(order);          // EXECUTION_QUOTE (gated)
client.getExecutionStatus(ref);      // EXECUTION_STATUS; ref = EXECUTION_QUOTE (preferred) or { depositAddress, depositMemo? }
```

- **Endpoint:** fixed to `https://1click.chaindefuser.com`. Any other `baseUrl` throws.
- **Labelling:** anything served through an injected `transport` is labelled `mocked: true, source: 'injected-transport'`. Only the built-in `fetch` transport produces `source: 'live-provider'`.
- **Errors:** every failure is an `IntentsError` with a stable `code` (see `runtime/intents/errors.mjs`) and an advisory `retryable` flag. The client itself never retries.

### Order (from the execution coordinator)

The order must contain exactly these keys. Unknown or missing keys are rejected.

| Field | Rule |
|---|---|
| `decisionId` | `[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}` |
| `policyHash` | `0x` followed by 64 lowercase hex characters |
| `winningProposalId` | Integer 0–255 |
| `origin`, `destination` | `{ chain, assetId }`. `assetId` must be an exact `nep141:`/`nep245:` provider id, never a ticker. It must appear in `/v0/tokens`, and the provider's `blockchain` for it must equal `chain`. |
| `depositType` | `ORIGIN_CHAIN` or `INTENTS` |
| `amountIn`, `minAmountOut` | Positive decimal-integer **strings** in base units (no decimals, signs, exponents or leading zeros) |
| `slippageBps` | Integer 0–1000 (the same ceiling as `TradingSafeModule.MAX_SLIPPAGE_BPS`) |
| `recipient` | `{ address, type: 'DESTINATION_CHAIN' \| 'INTENTS' }` |
| `refund` | `{ address, type: 'ORIGIN_CHAIN' \| 'INTENTS' }` |
| `expiresAt` | Canonical ISO-8601 UTC string (`Date#toISOString`). It is sent as the 1Click `deadline` and must be in the future. |

The request is always `swapType: EXACT_INPUT`. The client never adds `appFees`, `referral`, `quoteWaitingTimeMs` or confidential options.

### Normalized quote

Every quote has `funded: false`. A `DRY_QUOTE` additionally has `dry: true`, `deposit: null` and the label "preview only, not funded, not executable".

Each quote contains:

- `order`: `decisionId`, `policyHash`, `winningProposalId`, and `orderDigest` (sha256 of the stable-JSON order).
- `route`: provider chain, `assetId` and `decimals` for each side.
- `amounts`: base-unit strings, plus `*Display` values computed from the provider's `decimals`, never from `*Formatted`.
- `expiry`: the order expiry, the quote deadline (execution quotes only), `timeWhenInactive`, `effectiveExpiresAt = min(order, quote)`, and `quotedAt`.
- `signature`: `verified: true`, scheme, public key, signed message and value.
- `deposit`: address, memo, type, chain, asset and exact amount (execution quotes only).
- `correlationId`.
- `providerPayload`: the unmodified provider JSON, deep-frozen.
- `providerPayloadSha256`: the hash of the raw body.

A quote is returned only if **all** of these hold. Otherwise the call fails closed:

- The provider echo matches every requested field (recipient, refund, assets, amount, deadline, slippage, deposit/recipient/refund types and `dry`).
- The signature verifies.
- `quote.amountIn` equals the order input.
- `quote.amountOut ≥ quote.minAmountOut`.
- `quote.minAmountOut ≥ order.minAmountOut` (BigInt comparison).
- The quote timestamp is neither in the future beyond `maxClockSkewMs` nor older than `maxQuoteAgeMs`.
- For execution quotes, the provider deadline has not passed.

### Status

Status values are the seven documented in the OpenAPI enum:

| Provider status | `phase` | Terminal |
|---|---|---|
| `PENDING_DEPOSIT` | `awaiting_deposit` | no |
| `KNOWN_DEPOSIT_TX` | `deposit_detected` | no |
| `INCOMPLETE_DEPOSIT` | `deposit_incomplete` | no |
| `PROCESSING` | `processing` | no |
| `SUCCESS` | `succeeded` | yes |
| `REFUNDED` | `refunded` | yes |
| `FAILED` | `failed` | yes |

- **Any other status** raises `UNKNOWN_STATUS`; it is never treated as success.
- **Signature check:** the embedded `quoteResponse` must verify. Its `depositAddress` (and memo) must match the reference.
- **Binding check:** when the reference is a prepared quote, the embedded quote must carry the same signature, timestamp and signed request fields.
- **What `SUCCESS` means:** `providerReportedSuccess` is true only for `SUCCESS`. It is provider-reported state, not proof that funds arrived.

## Signature mechanism

Neither the docs page nor the OpenAPI spec publishes the key or the field selection. Both are taken from the official SDK:

- [Verify Quote Signatures](https://docs.near-intents.org/integration/distribution-channels/1click-api/verify-quote-signature) (read 2026-11-11) specifies that the signed message is the Base58-encoded SHA-256 of `json-stable-stringify({ ...quoteRequest, ...quote, timestamp })`.
- The exact field selection, truthiness rules and manager key come from **`@defuse-protocol/one-click-sdk-typescript@0.1.26`** (`src/quote-signature.ts`, ISC, NEAR Foundation). That is the latest release on npm, last modified 2026-09-22. The docs require ≥ 0.1.24 for `verifyQuoteSignature()`.

The verification steps:

1. Build the message as the UTF-8 bytes of `base58(sha256(stableStringify(signedRequest ∪ signedQuote ∪ {timestamp})))`.
2. Verify `signature` (`ed25519:` + base58) against `ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc`.

The client re-implements this using `node:crypto`, plus local base58 and stable-stringify code. It adds **no dependencies**.

**Interoperability test:** the live dry quote in `runtime/test/fixtures/intents/quote-dry.live.json` verifies with the pinned key. Tampering with its recipient, refund, amount, minimum output or timestamp fails verification.

## Observed live behaviour (unauthenticated, 2026-11-11)

| Call | Observation |
|---|---|
| `GET /v0/tokens` | HTTP 200, 229 assets across 39 `blockchain` values. **`aurora` is not among them.** Symbols are not unique (e.g. `USDC` on `near` and on `eth`). One `blockchain` value (`abs`) is absent from the OpenAPI enum, so the client validates the format rather than enum membership. |
| Dry quote, 1 wNEAR → USDT on NEAR | **HTTP 201** (the docs list 200). The response included a provider-added `appFees` entry of 20 bps for the unauthenticated request. The docs state a 25 bps unauthenticated platform fee. |
| Unknown origin asset | 400 `tokenIn is not valid` → `UNSUPPORTED_ROUTE` |
| Amount `1` | 400 `Amount is too low for bridge, try at least 0` → `AMOUNT_TOO_LOW` |
| 1e36 base units | 400 `No liquidity available` → `NO_LIQUIDITY` |
| Invalid recipient | 400 `recipient is not valid` → `PROVIDER_REJECTED` |

## Unresolved compatibility issues and assumptions

1. **Aurora is not a 1Click blockchain, and Intents has no testnet.**
   - The Aurora testnet tokens used by the current Safe round cannot be quoted. Aurora mainnet assets do not appear by name in `/v0/tokens` either.
   - A route from the Aurora Safe would first have to move funds onto a supported chain, or deposit into an Intents account. Neither path exists in this repository.
   - The coordinator must not treat Intents quotes as interchangeable with the Aurora testnet Trisolaris route.
2. **The Safe cannot fund an Intents deposit by itself.** `TradingSafeModule` only calls the fixed exact-input router. Paying a 1Click deposit address would need a new, separately authorized module path. That is out of scope here, and the contracts are not edited.
3. **Signing key provenance.** The manager key comes from the SDK source, not from a published docs page, and there is no documented rotation. It is overridable via `verifySignature`, and provider confirmation is required before production use.
4. **Fields the signature does not cover.** Per the SDK, it excludes `appFees`, `depositMode`, `confidentiality`, `insured`, `sessionId` and `correlationId`. Provider-added `appFees` are preserved in `fees.appFees`, but they are not authenticated.
5. **Status payloads are only partly authenticated.** The OpenAPI status response has no top-level signature. Only the embedded quote is verified. `status`, `swapDetails` and transaction hashes are unauthenticated provider claims. The coordinator must confirm receipt on the destination chain before recording any execution.
6. **Unclassified rejections.** The 400 classification relies on the four messages observed above. Other wording falls back to `PROVIDER_REJECTED`, with the sanitized message preserved. Rate-limit thresholds are undocumented; `Retry-After` is parsed if present.
7. **Scope limits:**
   - Only `EXACT_INPUT`.
   - Only the `ORIGIN_CHAIN` and `INTENTS` deposit types; confidential types are rejected.
   - The client never requests `depositMode: MEMO`, but a provider-returned memo is carried through to status.
   - Dry quotes have no provider deadline, so the order expiry applies.
   - The 2-minute maximum quote age is a Wavefund policy, not a provider rule.
8. **Address formats.** Address validation per chain is left to the provider (`recipient is not valid`). The client checks only for printable characters without whitespace.
9. **Authenticated fees.** Unauthenticated quotes carry the extra fee. A partner JWT (`apiKey`) is required for the partner fee schedule. None is configured.

## Tests

`runtime/test/intents-provider.test.mjs` contains 18 tests, all using injected transport, clock and verifier, with no network. It runs with `npm run test:runtime`.

- **Fixtures:** `runtime/test/fixtures/intents/` (see its README). Execution quotes and statuses are **MOCKED**: synthetic payloads signed at runtime with a throwaway ed25519 key, never returned by 1Click.
- **Mutation check:** 15 scratch mutants, all killed. They were:
  - removing the signature check;
  - removing the minimum-output check;
  - removing the echo binding;
  - removing the execution gate;
  - removing the quote-age check;
  - the success mapping;
  - the chain check;
  - unsorted stable JSON;
  - removing the `amountIn` check;
  - status binding;
  - the deadline check;
  - effective expiry;
  - the mocked label;
  - the unknown-status check;
  - an injected 429 auto-retry.
