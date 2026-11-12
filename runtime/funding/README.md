# Funding core v1

Unsigned, local orchestration for **funding before a round**. No provider, HTTP,
frontend, signing, wallet, transaction broadcaster, or deployed mainnet stack is
bundled here. Production configuration starts with `{schemaVersion:1,routes:[]}`.
Test routes and every receipt in the unit tests are synthetic, including tests of
the `live-verified` branch. They do not demonstrate an actual funding route.

## Interfaces for B and C

Import `createFundingService`, `createFundingStore`, `configuration`, and
`fundingHash` from `runtime/funding/index.mjs`. No additional dependency.

`createFundingStore(privateDirectory)` maintains an owner-only atomic JSON store.
Use a directory under ignored `.run/`, one directory per configured deployment.
Do not make a new store for every HTTP request. No automatic stale-lock clearing.

`createFundingService({config,store,readSnapshot,verifyQuote,verifyDelivery,
verifyRefund,clock})` accepts **trusted server-side adapters**, never capabilities
or verifier results supplied directly by HTTP clients. `clock()` returns integer
Unix seconds. Adapter inputs and outputs are cloned.

Public methods:

| Method | Meaning |
|---|---|
| `getConfiguration()` | Validated routes and canonical configuration hash |
| `get(fundingId)`, `list()` | Records; API owner must sanitize/project for UI |
| `createQuoted(request, providerQuote)` | Verify an executable quote through B's adapter and persist a record; no provider call or transfer |
| `reserveSubmission(fundingId)` | Persist a unique attempt **before** a manager wallet could send; returns attemptId |
| `recordSubmitted(id,{attemptId,transactionHash})` | Persist the known source transaction before any status polling |
| `markBroadcastUnknown(id,attemptId)` | Durable review state; never unlock/resend |
| `observeProvider(id,status)` | Record provider observation; SUCCESS cannot deliver |
| `confirmDelivery(id,evidence)` | Trusted receipt verifier plus finality/identity/amount/balance checks |
| `confirmRefund(id,evidence)` | Record verified refund amount; fee-net/partial refund stays in review |
| `prepareRound(id,{chainId,safe,expectedBalances})` | Consume a live-verified same-network readiness reservation, unsigned |

Do not expose these methods as arbitrary raw HTTP operations. C's preview endpoint
calls B's **dry** quote method separately; previews never create a funding record.
C's executable-quote endpoint remains disabled until integration is approved.
`reserveSubmission` is needed before a wallet send, even if the browser later loses
its response. A timeout is not permission to reserve another attempt.

## Configuration and request

Configuration: `{schemaVersion:1,routes:[route]}`. Exact route fields:

```
routeId, enabled, liveVerified, manager, safe, source, destination,
refundRecipient, minAmountIn, maxAmountIn, minAmountOut,
maxQuoteLifetimeSeconds, maxObservationAgeSeconds, minimumConfirmations
```

Each asset is `{chainId,assetId,token,decimals}`: numeric EVM chain ID, exact
provider asset ID, ERC20 contract address and numeric decimals. The initial scope
is an EVM source ERC20 and Aurora **mainnet** destination, six-decimal stablecoin.
No native-asset funding, NEAR account recipient, INTENTS account deposit, or custom
token route is assumed. Refund recipient must be the configured source manager.
The route's `liveVerified` is a trusted operator configuration decision supported
by B's route evidence, not user input and not on its own a cryptographic proof.

Request fields, all required and exact:

```
fundingId, routeId, configurationHash, manager, safe, source, destination,
amountIn, minAmountOut, refundRecipient, expiresAt
```

Amounts are raw uint256 decimal **strings**. Addresses normalize to lowercase.
Expiry and observation times are integer Unix seconds, unlike B's provider-facing
ISO dates; its adapter must convert strictly. No proposal/winner/round ID belongs
in a funding request. Configuration and request hashes use sorted-key JSON SHA256,
prefixed `0x`. Historical agent `digest(JSON.stringify(...))` is unchanged.

## B's verifier adapter results

`verifyQuote(providerQuote, request)` must independently verify the provider
signature, freshness, echoed exact request, recipient Safe, refund identity,
origin/destination assets, amount and deposit target. Reject dry quotes here.
Return exactly:

```
requestHash, reference, depositAddress, amountIn, minAmountOut, expiresAt,
evidenceQuality
```

`reference` is a bounded local/provider correlation identifier. Evidence quality
is `fixture` or `live-verified`; injected/mocked results must remain `fixture` in
real application wiring. B's existing normalized quote must be adapted; do not
rename B's raw signed payload or alter its signature format to match this core.
Retain full signed quote and fee evidence in B's approved evidence storage before
creating the normalized record. C must display provider fees with their actual
signature/verification limitations, never manufacture a zero fee.

`verifyDelivery(evidence, record)` and `verifyRefund(evidence, record)` return:

```
requestHash, quoteHash, sourceTransactionHash, transactionHash, chainId,
token, recipient, amount, confirmations, observedAt, evidenceQuality
```

The verifier must validate the source deposit receipt (manager, exact ERC20 and
amount, deposit target), provider order linkage, canonical destination/refund
receipt and transaction identity. `quoteHash` is `fundingHash(record.quote)`.
Only a linked **successful canonical receipt** with enough confirmations can
produce this result. An unrelated Transfer or provider SUCCESS is insufficient.
The core additionally checks destination Safe token balance delta exactly against
verified delivery, while requiring unchanged investment-asset quantities. Unexpected
donations, outgoing movements, reorgs or conflicting evidence require review.
This combination is provider-linked receipt verification, not a trustless bridge proof.

## Deployment snapshot adapter / readiness

`readSnapshot(route)` must authenticate RPC chain and verify trusted deployment
configuration, Safe ownership/module enablement, module/engine/tracker/token/router
bindings, required bytecode and supported token decimals. Read a consistent pinned
block. Return exactly:

```
chainId, safe, stableToken, assetToken, stableBalance, assetBalance,
activeRound, pendingAuthorization, observedAt, blockNumber, blockHash, compatible
```

Balance/block numbers are raw integer strings; flags are booleans. Check both the
engine lifecycle and module authorization. `compatible:true` is a trusted adapter
assertion, never a caller-supplied or provider-supplied API boolean.

The exported `createAuroraFundingSnapshotReader({publicClient,manifest,clock})`
now implements a separate **read-only**, Aurora-mainnet-only snapshot adapter. It
does not construct a transport/wallet or change the existing manager reader.
Its manifest requires exactly `schemaVersion`, `chainId`, `contracts`, `codeHashes`,
`safeSingleton`, `safeSingletonCodeHash`. `contracts` and `codeHashes` each require
the 13 keys: safe, stable, asset, module, engine, tracker, oracle, router, market,
tokens, registry, poolManager, hook. Hashes are reviewed runtime-bytecode keccak256
pins, not source hashes or values copied blindly from an untrusted RPC. The Safe
proxy's singleton address and runtime code are additionally checked.

This first adapter supports a Safe 1.4.1 with exactly one configured manager owner
and threshold one, matching the current demo model. It checks both engine and
module round state, module authority, full forecasting/execution bindings and fresh
oracle data. Reads are pinned to one block, whose canonical hash and RPC network
are rechecked after the reads. Wrong code, owner, binding, network, stale data or a
reorg fails closed. It does not attest to arbitrary token proxy implementations,
future upgrades, off-chain verifier security, contract audits or honest RPCs.

**Not wired yet:** no reviewed mainnet manifest/deployment exists here. The existing
manager reader deliberately permits only Anvil and Aurora testnet. This core does
not widen it or pretend a mainnet deployment exists.
Until a separately verified mainnet deployment/manifest and B's verified
route are available, keep production routes empty and wallet send disabled.
Existing local/testnet round preparation stays unchanged; it must not be fed a
mainnet funding record. The new readiness gate must be called by the future funded
mainnet preparation path before any owner authorization is offered.

Readiness consumes a local reservation once and blocks further application funding
for that Safe. This v1 intentionally has **no automatic release/retry/reset API**;
post-round closure and recovery need explicit verified integration, not deleting
journals or interpreting a timeout as cancellation. It is a conservative first-round
integration primitive, not a complete repeated-round mainnet operator.

The financial contracts still enforce their own authorization and snapshot checks.
Local orchestration cannot stop an owner bypassing the application or unsolicited
ERC20 transfers, and is not an on-chain access-control mechanism.

## Record / state

FundingRecordV1 contains `schemaVersion`, `fundingId`, `configurationHash`,
`request`, `requestHash`, `quote`, `quoteHash`, `before`, `state`, `revision`,
`createdAt`, `updatedAt`, `submission`, `observation`, `delivery`, `refund`,
`readiness`, `reviewReason`. Preserve nested provenance when projecting for UI.

States: `quoted → dispatching → pending → delivered`; full verified refund can
lead to `refunded`; ambiguous/conflicting/partial evidence leads to `needs_review`.
Provider failure never means refunded. Expired unsubmitted records stay unresolved
for explicit review rather than being silently recycled. No fees or balances are
expressed as floats. The local store is not tamper-proof against its OS owner,
malicious adapter injection, manual rollback or dishonest RPC infrastructure.

## Bounded first-delivery proof (operator preparation)

The mainnet Safe is a funding-only deployment. It does not have a mainnet
Wavefund trading stack, so the full deployment/round-readiness adapter must not
be faked or weakened to accept it. Production routes stay empty until reviewed.

`demo-plan.mjs` prepares a separately labelled one-off funding proof:

- `fundingDemoRequest` derives the exact manager/Safe/refund and Arbitrum route
  from trusted deployment configuration; fixes input at 1 USDC and request minimum
  at 0.98 USDC, with at most five minutes of quote validity.
- `fundingDemoPreviewInput` uses B's provider mapping at 100 bps slippage.
- `prepareFundingDemoDeposit` accepts a separately authorized executable quote,
  delegates signature/archival checks to B's `verifyQuote`, and constructs only an
  unsigned ERC20 `transfer(depositAddress,1000000)` from the manager on Arbitrum.
  Source balances/nonce/gas estimate must be freshly supplied by a trusted local
  operator. Gas cost is capped at **0.00001 ETH**. The plan expires within 30 seconds
  of that source observation and never grants production round readiness.

The planner performs no network call, transfer, approval or signing. Its tests use
synthetic verifier results to exercise the planning policy, not real signed
executable quotes. Before a real send, an explicit approval, current Safe checks,
fresh source read, ERC20 transfer simulation, and a durable one-attempt signing
journal are still required. Never use a dry quote as an executable quote. B owns
canonical source/delivery/refund receipt readers; the planner does not duplicate
them or infer delivery from an unsigned status flag.

`node scripts/funding-demo-preview.mjs` requests only a dry quote for the deployed
Safe, using no credentials. It must be run in the approved network container.
It does not enable executable quotes. No unsigned plan is an instruction to send
funds until the quoted amount and gas budget are explicitly approved.

## Local bounded funding operator

`createFundingDemoOperator` in `demo-operator.mjs` consumes the existing one-USDC
planner and injected local capabilities. It does not load keys, register an HTTP
route, enable executable quotes or run automatically. Use a separate private
`createFundingStore` directory, never the production funding-service directory.

`preview()` verifies the supplied executable quote and prepares an unsigned plan.
`execute({approvedPlanHash})` re-prepares from fresh trusted source observations;
the operator must explicitly approve that exact plan hash. It reserves one attempt
per destination Safe, simulates the exact transfer, verifies recovered signer and
all signed transaction fields, durably stores signed bytes/hash, then broadcasts
once. Errors retain the attempt for review; there is no resend or automatic retry.
A submitted result means neither delivery nor round readiness. B's existing
receipt verifier/proof builder remains the delivery authority.

These are callable local capabilities, not an installed live signing workflow.
Their tests use a public deterministic test identity, synthetic quote verification
and a fake broadcaster. Mainnet signing/transfer remains disabled until an
operator supplies reviewed capabilities and explicitly approves the exact spend.
