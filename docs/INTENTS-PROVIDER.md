# NEAR Intents funding provider (1Click)

**Scope:** a manager funds their own **Aurora mainnet** Safe through NEAR Intents **before** a Wavefund round. The flow is:

> manager wallet (EVM origin chain) → 1Click → `aurora` virtual chain → Safe on Aurora mainnet (chain 1313161554)

This is not cross-chain execution of winning strategies. The existing Trisolaris strategy executor is unchanged.

**Status (2026-11-11):**

- **B1 (route feasibility):** a route is verified up to a **provider-signed dry quote**. No delivery has been observed, because none is authorized.
- **B2 (provider client):** implemented.
- **B3 (delivery verifier):** implemented.
- **No executable quote was requested.** No deposit, signature or transfer was made.

## B1: route feasibility

### Verified route `eth-usdc-to-aurora-usdc`

| Item | Value | Evidence (`runtime/test/fixtures/intents/live/`) |
|---|---|---|
| Origin chain | Ethereum mainnet (1Click `blockchain: eth`, EVM chain id 1) | `tokens-subset.json` |
| Origin asset id | `nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near` | `tokens-subset.json` |
| Origin ERC-20 | `0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48`, 6 decimals (provider `contractAddress`/`decimals`) | `tokens-subset.json` |
| 1Click destination asset | `nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1` (`blockchain: near`, 6 decimals; NEAR `ft_metadata` reports symbol USDC, 6 decimals) | `tokens-subset.json`, `probes/aurora-usdc-mapping.json` |
| Delivery addressing | `recipient: "aurora"`, `recipientType: DESTINATION_CHAIN`, `virtualChainRecipient: <Safe address>` | `quote-dry-eth-usdc-to-aurora.json` |
| Aurora ERC-20 | `0x368ebb46aca6b8d0787c96b2b20bd3cc3f2c45f7`. This is the Aurora engine's own `get_erc20_from_nep141` result. On Aurora mainnet RPC: chain id `0x4e454152` (1313161554), 5,253 bytes of code, symbol `USDC`, 6 decimals. | `probes/aurora-usdc-mapping.json` |
| Signed dry quote | 250 USDC in → `amountOut` 249.973358 and `minAmountOut` 247.473624 (100 bps slippage), `timeEstimate` 45 s. It verifies against the pinned 1Click key, and that signature **covers** `virtualChainRecipient`, `recipient` and `refundTo`. | `quote-dry-eth-usdc-to-aurora.json` |
| Minimum amount | Smaller amounts are rejected with `Amount is too low for bridge, try at least 300001` (0.300001 USDC). The docs list no USD minimum for Ethereum or NEAR. | `probes/dry-quote-probes.json` (E-min-*) |
| Fees (quoted, unauthenticated) | `appFees` 1 bp (provider-added), `withdrawFee` 0, **`refundFee` 300000 (0.3 USDC)**. A refund therefore returns less than the input. | probes C2, E-min-1000000, F |

### How the route was established

The probes are recorded in `probes/dry-quote-probes.json`. Every one used `dry: true`, and every address was an OpenAPI example address.

| Probe | Request | Result |
|---|---|---|
| A | Direct `1cs_v1:aurora:erc20:0x368e…` destination (a constructed id; it is **not** in `/v0/tokens`) | 400 `tokenOut is not valid` |
| B | NEAR USDC to `aurora` with `customRecipientMsg` = EVM address | 201, signed. **Not used:** the docs mark `customRecipientMsg` "HIGHLY EXPERIMENTAL", and funds can be lost. |
| C | `virtualChainRecipient` + `virtualChainRefundRecipient` | 400 `Virtual chains refunds are only available for near blockchain` |
| C2 / F | `recipient: aurora` + `virtualChainRecipient` | 201, signed and verified. This is the route. |
| C3 | `virtualChainRecipient` with a non-engine NEAR recipient | 400 `Target virtual chain does not have an eth connector set or recipient account is not a virtual chain account`. This shows 1Click treats `aurora` as a virtual-chain account. |
| C4 | EVM address as `recipient` | 400 `recipient is not valid` |
| D | Control route: same origin to a NEAR account | 201, with identical amounts |

### Docs vs. API discrepancy

- The [Supported Chains](https://docs.near-intents.org/resources/chain-support) page lists **Aurora** under EVM networks.
- `GET /v0/tokens` (229 assets, 39 `blockchain` values, captured 2026-11-11) contains **no `aurora` blockchain**.
- The three `AURORA`-symbol entries in the list are the AURORA token on `near`, `eth` and `bsc`, not the Aurora chain.
- The working path is the OpenAPI field `virtualChainRecipient` ("EVM address of a transfer recipient in a virtual chain"). The docs do not describe it further.

### What is NOT established (provider clarification requested)

1. **Completed delivery.** No funded transfer has been made or observed, so delivery of the ERC-20 into a **Safe contract** at the `virtualChainRecipient` address is unproven end to end. The engine mapping only shows which ERC-20 the engine would mint.
2. **Official support.** Is `recipient: aurora` + `virtualChainRecipient` the supported way to reach Aurora mainnet? Is it covered by the same SLA and refund guarantees?
3. **Destination transaction hashes.** For virtual-chain deliveries, which hashes appear in `swapDetails.destinationChainTxHashes`: the Aurora EVM transaction hash, or a NEAR receipt? The delivery verifier links the Aurora receipt only through this list.
4. **Fees.** The docs state a 25 bps unauthenticated fee, but unauthenticated stablecoin quotes showed a 1 bp `appFees` entry. The `refundFee` of 0.3 USDC on this route is not documented.
5. **Signing key.** The manager signing key is published only in SDK source, with no documented rotation (see "Signature mechanism").
6. **Testnet.** Intents has no testnet, and Aurora **testnet** (1313161555) and its test tokens cannot be funded. This route is mainnet-only, and every validation path rejects testnet chain ids.

## B2: provider client (`runtime/intents/`)

```js
import { createIntentsClient, verifyFundingDelivery } from './runtime/intents/index.mjs';
const client = createIntentsClient({ apiKey, transport, clock, verifySignature, allowExecutionQuotes: false, timeoutMs, maxQuoteAgeMs, maxClockSkewMs, assetCacheTtlMs });
client.getSupportedAssets();             // exact assetId / blockchain / decimals / contractAddress; symbols are display-only
client.previewOrder(fundingRequest);     // DRY_QUOTE (purpose: 'funding')
client.prepareOrder(fundingRequest);     // EXECUTION_QUOTE, only with allowExecutionQuotes: true (not used yet)
client.getExecutionStatus(executionQuote | { depositAddress });
```

- **Endpoint:** fixed to `https://1click.chaindefuser.com`.
- **Mocked labelling:** injected transports produce `mocked: true`.
- **Safety properties:**
  - No keys, signing, transfers or retries.
  - No fallback to Trisolaris.
  - No `customRecipientMsg`, `appFees` or `referral` is ever sent. A quote that **adds** `customRecipientMsg` or `virtualChainRefundRecipient` is refused even if it is signed.

### Funding request (PROVISIONAL)

This is a provider-input shape pending Developer A's shared schema. The client has a single validation point, so mapping it to A's schema means changing `validateFundingRequest` only.

```js
{
  fundingId: 'manager-1:funding-1',
  source:      { chain: 'eth', chainId: 1, assetId: 'nep141:eth-0xa0b8…omft.near', tokenAddress: '0xa0b8…eb48' },
  destination: { chainId: 1313161554, virtualChainAccount: 'aurora', assetId: 'nep141:17208628…', tokenAddress: '0x368e…45f7', safeAddress: '0x…' },
  amountIn: '250000000', minAmountOut: '247000000', slippageBps: 100,
  refundAddress: '0x…',      // manager wallet on the ORIGIN chain; must differ from the Safe address
  expiresAt: '2026-…Z',      // canonical ISO; sent as the 1Click deadline
}
```

The client checks each part as follows:

- **Exact keys:** the request must have exactly these keys. Strategy fields such as `winningProposalId` or `policyHash` are rejected.
- **Verified route:** the request must match a **verified route** in `routes.mjs` exactly (chain ids, asset ids, both ERC-20 contracts). The provider token list must still agree on chain, contract and decimals.
- **Addresses:** sent exactly as given. Mixed case must be a valid EIP-55 checksum, and zero addresses are refused.
- **Refund address:** a `refundAddress` equal to the Safe address is refused. It would refund to an address that may not be controllable on the origin chain.
- **Amounts:** decimal-integer base-unit strings, with `amountIn ≥ 300001`.
- **Quote checks** (all must hold):
  - The provider echo matches every requested field.
  - The ed25519 signature verifies.
  - `amountIn` matches the request.
  - `minAmountOut ≥ request minAmountOut`.
  - The quote's age, the request expiry and the execution deadline are all valid.

### Normalized quote, and what is signed

The quote contains `funding` (`fundingId`, `requestDigest`, `routeId`, Safe, refund), `route` (both legs with chain id, asset, ERC-20 and decimals), `amounts`, `fees`, `expiry`, `signature`, `deposit` (execution quotes only: an origin-chain EVM address and the exact amount), `correlationId` and the unmodified `providerPayload`.

What the 1Click signature covers, per the scheme in SDK 0.1.26:

- **Signed in every quote:** amounts, the deadline, `recipient`, `virtualChainRecipient` and `refundTo`.
- **Dry quotes:** `refundFee`, `withdrawFee` and `timeEstimate` are **not** signed (`fees.feesSigned: false`). Execution quotes do sign them.
- **`appFees`:** never signed (`fees.appFeesSigned: false`).

### Status

The seven documented statuses map as follows: `PENDING_DEPOSIT`, `KNOWN_DEPOSIT_TX`, `INCOMPLETE_DEPOSIT` and `PROCESSING` are non-terminal; `SUCCESS`, `REFUNDED` and `FAILED` are terminal. Anything else raises `UNKNOWN_STATUS`.

- **Binding:** the embedded quote must verify. It must also have the same signature, timestamp, deposit address, recipient, `virtualChainRecipient` and refund as the prepared quote.
- **Unsigned parts:** the status itself, its `swapDetails` and its transaction hashes carry no signature.

## B3: delivery verifier (`verifyFundingDelivery`)

The verifier is a pure function with no network I/O. The coordinator supplies receipts read from chain RPCs it trusts, each as `{ txHash, chainId, confirmations, receipt }`, where `receipt` is a standard `eth_getTransactionReceipt` result.

```js
verifyFundingDelivery({ quote, status, statusError, sourceReceipts, destinationReceipts, refundReceipts, verifySignature, minConfirmations });
// → { outcome, evidenceQuality, trustless: false, amounts, checks, reasons, providerStatus }
```

1. **Stored-request integrity.**
   - The stored execution quote's signature is re-verified.
   - The deposit address, amount, Safe (`virtualChainRecipient` plus the `aurora` recipient), refund address and route must all match the signed payload.
   - Any mismatch gives `ambiguous` / `none`.
2. **Status binding.** The status must embed the same signed quote and deposit address. A missing status, or a status error (timeout, rate limit, outage), gives **`ambiguous`**. It never gives `refunded`.
3. **Receipts.** An observation counts only if all of the following hold. Otherwise it is listed as a failed check and not counted.
   - Its chain id is correct (1 for the source, 1313161554 for the destination).
   - The transaction succeeded.
   - It has enough confirmations (defaults: Ethereum 12, Aurora 1; this is a policy choice, and the parameter is configurable).
   - It contains an ERC-20 `Transfer` of the **exact** expected token to the **exact** expected recipient: the deposit address, the Safe or the refund address.
   - The provider status links it (its hash appears in `originChainTxHashes` or `destinationChainTxHashes`).
4. **Outcomes:**

| Situation | Outcome |
|---|---|
| Non-terminal status | `pending` |
| `SUCCESS` without a counted Safe receipt | `pending` (provider claim only) |
| `SUCCESS` with a counted Safe receipt whose amount equals the provider `amountOut` and is ≥ the signed `minAmountOut` | `delivered` |
| `REFUNDED` | `refunded`, with `refunded` taken from the provider's `refundedAmount` (never assumed to be the input), the `refundShortfall` and the quoted `refundFee` |
| `FAILED` | `failed`. The fund location is not established, and it is not a refund. |
| A provider-linked transaction that does not show the expected transfer (wrong token, wrong network, wrong recipient or reverted), delivery and refund both observed, amounts that disagree, or a refund with no amount | `ambiguous` |
| Unlinked transfers to the Safe | Never counted |

5. **Evidence quality:**
   - `none`
   - `provider-claim-only`
   - `provider-linked-one-leg`
   - `provider-linked-both-legs` (verified source **and** outcome receipts)

   `trustless` is always `false`. 1Click supplies the linkage between legs, and the chains only confirm each leg.

## Signature mechanism

The docs ([Verify Quote Signatures](https://docs.near-intents.org/integration/distribution-channels/1click-api/verify-quote-signature)) specify `base58(sha256(json-stable-stringify({...quoteRequest, ...quote, timestamp})))`. The field selection and the manager key `ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc` come from `@defuse-protocol/one-click-sdk-typescript@0.1.26` (the latest release, ISC licence, NEAR Foundation). The client re-implements the scheme with `node:crypto`.

Both live captures verify. Tampering with any signed field fails verification, and the tests pin which fields are unsigned.

## Dependencies

No dependency was added. EIP-55 checksum validation uses `viem`, which is already a root dependency. Optional request to Developer A: add the official SDK as a devDependency, as a second cross-check of signature verification.

## Tests and isolation

- **Tests:**
  - `runtime/test/intents-provider.test.mjs`: 17 tests.
  - `runtime/test/intents-delivery.test.mjs`: 11 tests.
  - Full runtime suite: 88/88.
- **Container:** run in Docker image `node:22.11.0-bookworm-slim` (`node@sha256:f035ba7f…12da`) with `--network none --read-only --cap-drop ALL --security-opt no-new-privileges`, as user `node`, with no host environment variables. Dependencies were installed with `npm ci --ignore-scripts` in a separate, networked step before the tests ran.
- **Mutation check:** 20 mutants, all killed:
  - echo binding;
  - added-redirection refusal;
  - route allowlist;
  - Safe-equals-refund rule;
  - minimum amount;
  - EIP-55 checksum;
  - provider token drift;
  - dry-fee signing label;
  - status error mapped to refunded;
  - counting unlinked receipts;
  - chain id;
  - token;
  - confirmations;
  - stored-quote signature;
  - assumed full refund;
  - `SUCCESS` without a receipt counted as delivered;
  - `FAILED` treated as a refund;
  - the `SUCCESS`-plus-refund conflict;
  - the minimum-output check;
  - status binding.
- **Fixtures:** `fixtures/intents/live/` holds unmodified production captures. `fixtures/intents/mocked/` and every receipt built in the tests are synthetic. See `fixtures/intents/README.md`.
