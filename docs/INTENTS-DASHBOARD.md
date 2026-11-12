# Funding dashboard and API integration (Developer C)

**Scope:** the dashboard and local API for **funding before a round**:

> manager wallet (supported EVM chain) → NEAR Intents / 1Click → manager-owned Aurora **mainnet** Trading Safe → delivery verification → round readiness, only where a compatible deployment exists.

This is not cross-chain execution of a winning strategy. The existing strategy and forecasting screens, the Trading Safe model, the AI agents, Uniswap v4 forecasting and Trisolaris execution are unchanged. Funding comes before them; it does not replace them.

**Status (2026-11-12, branch `feat/funding-dashboard`, base `71b193b`):** implemented and verified in network-isolated Node 22 containers on scratch copies (results under [Verification](#verification-in-the-isolated-container)). Sending stays disabled. Tidepool testnet funding is shown as a **pending integration** lane: identities only, with no route, quote or live status.

## Network truth

| Purpose | Network | Chain ID |
|---|---|---|
| Funding destination (NEAR Intents) | Aurora mainnet | 1313161554 |
| Verified Wavefund round deployment | Aurora testnet | 1313161555 |
| Strategy Safe / stable token (from `deployments/aurora-testnet.json`, not independently verified) | Aurora testnet | `0x7814…0ad1` / `0x8be4…915c`, 6 decimals |
| Tidepool community funding (pending) | Arbitrum Sepolia → Aurora testnet | 421614 → 1313161555 (announced, not configured) |

NEAR Intents has no testnet. The UI and API therefore:

- never let mainnet funding make the testnet round ready (`roundEligibility` refuses whenever the networks differ, even if a server claims otherwise);
- show the funding Safe as a funding-proof Safe (`wavefundModuleEnabled: false`), not a deployed Wavefund stack;
- show the one verified route as **preview-only** (signed dry quotes exist, no delivery has been observed, and it is not approved for sending);
- show retired and unsupported routes (Ethereum USDC, Base USDC, NEAR-account origin) as unavailable, with reasons;
- keep mainnet funding evidence separate from historical testnet strategy evidence.

The existing frontend network validation (`decodeState`: Anvil 31337 or Aurora testnet monitoring only) is unchanged.

## Funding lanes

`/fund` opens with a **Funding source** selector. The three lanes never share networks, tokens or evidence:

| Lane | Network | What it shows | Status source |
|---|---|---|---|
| **Official 1Click** | Aurora mainnet | Live, signed 1Click dry quotes for the trusted mainnet funding Safe; tracker for funding-service records | The local API's configuration and capabilities |
| **Tidepool community** | Aurora testnet | The strategy Safe, stable token and decimals the strategy needs, beside “Tidepool would deliver: not configured” for source network, recipient, delivered token and status feed | Always **Pending integration** (`laneStatus` forces it, whatever a server reports) |
| **Labelled fixtures** | none | 16 synthetic states with fake addresses | Always **Synthetic** |

Links: `/fund` (official), `/fund?lane=tidepool`, `/fund?fixtures=1`. The Tidepool lane hard-codes no route, asset id, provider URL or token, and shows no quote or deposit address. It warns that Tidepool's test token may differ from the strategy token. Its readiness card never shows a record tracked on another lane. Arbitrum Sepolia is named in the network allowlist but gets **no explorer link** until B confirms one.

## Delivered ≠ strategy ready

The readiness card shows two separate facts side by side:

- **Funding delivered** (`deliverySummary`) comes from the receipts. It is “verified” only for a live, bound, final receipt from the funding service.
- **Strategy ready** (`strategyReadiness`) comes only from A's `FundingRecordV1.readiness`, written once by `prepareRound`. It is never derived from delivery. “Ready to run strategy” needs every one of:
  - a verified live delivery of the **strategy token** to the **strategy Safe** on the **strategy network**;
  - `readiness.chainId`, `readiness.safe` and `readiness.snapshot.{chainId, safe, stableToken}` all equal to the configured strategy identity;
  - `snapshot.compatible === true`, with no active round and no pending authorization;
  - every round prerequisite in the trusted configuration met.

Otherwise the card names each failing check, for example `DELIVERED_TOKEN_NOT_STRATEGY_TOKEN` or `SNAPSHOT_TOKEN_NOT_STRATEGY_TOKEN`. Another token reaching the Safe is therefore never enough, even if a service readiness names the strategy token. Fixture readiness shows as “Readiness evidence · fixture”, never as ready. With today's configuration, mainnet 1Click funding is blocked, because the strategy Safe, token and network are on Aurora testnet.

The strategy identity comes from `deployments/aurora-testnet.json`, read by `fundingReadModelFromEnvironment` and validated by `validateStrategyDeployment`:
- the chain must be 1313161555;
- the Safe, stable token and module addresses must be valid;
- the Safe and stable token must differ.

It is exposed as `config.strategy`. Decimals are 6, because `ProposerRegistry` rejects any other stable. The API projection now also keeps A's `readiness.snapshot` (balances, tokens, compatibility and round flags), with each field validated.

## What was built

| Area | Files |
|---|---|
| Funding read model / projection | `runtime/operator/funding-readonly.mjs` (new) |
| API wiring | `runtime/server.mjs`: one import, one optional dependency, one route branch |
| API tests | `runtime/test/funding-api.test.mjs` |
| UI: “Fund your Trading Safe” | `frontend/src/app/fund/*`, `frontend/src/components/funding/*`, `frontend/src/app/funding.css` |
| UI logic (pure, tested) | `frontend/src/lib/funding/model.mjs` (+ `.d.mts`) |
| Labelled fixtures + loader | `frontend/src/lib/funding/fixtures.mjs`, `loader.ts` |
| UI logic tests | `frontend/test/funding-model.test.mjs` (`npm test --workspace @wavefund/frontend`) |
| App frame and journey tabs | `frontend/src/components/AppShell.tsx` (replaced the earlier `JourneyNav.tsx`) |
| Funding lanes, delivered ≠ ready | `FundingPanels.tsx` (`LaneSelector`, `TidepoolLaneCard`, `ReadinessCard`), `model.mjs` (`laneStatus`, `deliverySummary`, `strategyReadiness`) |
| One-command Docker demo | `scripts/docker-demo/` (Dockerfile, `up.sh`, `down.sh`, README) |
| Local demo usability | `scripts/local-demo.mjs`, `scripts/lib/local-demo-preflight.test.mjs` |
| Screenshot helper | `frontend/scripts/capture-funding-states.mjs` (Playwright, fixture mode, loopback only) |

No dependency, lockfile, root `package.json`, Solidity, `runtime/funding/**`, `runtime/intents/**`, `runtime/agents/**`, manifest or signing script was changed. The frontend workspace gained only a `test` script.

## API

Endpoints exist **only when their capability is configured**. With `WAVEFUND_FUNDING` unset (the default), every `/api/funding/*` path returns 404, and all existing endpoints and responses are unchanged.

| Endpoint | Exposed when | Behaviour |
|---|---|---|
| `GET /api/funding/config` | funding read model configured | Trusted destination Safe, accepted asset, manager/refund wallet, routes, unsupported routes, `strategy` (testnet strategy Safe and stable token, display/binding only), eligibility checks and capabilities |
| `POST /api/funding/preview` | B's dry-quote client available | Body is exactly `{routeId, amountIn}`. The server builds the full shared request from repository configuration and calls B's `previewOrder` (**dry only**). It rejects executable, redirected or under-minimum quotes. Rate limited to one in flight, at least 3 s apart. Never creates a funding record. |
| `GET /api/funding/:id` | A's funding service injected | Whitelisting projection of FundingRecordV1. Invalid values become `null` and are listed in `integrityIssues` |
| `POST /api/funding/submitted` | A's service injected **and** `allowSubmitted: true` (no environment switch) | `{fundingId, attemptId, transactionHash}` → A's `recordSubmitted`. Records a reference only. Repeating the identical hash is acknowledged (A's idempotency); a different hash moves the record to `needs_review` (`CONFLICTING_SUBMISSION`). |
| `POST /api/funding/quote` | **never in this phase** | Executable quotes stay disabled until separately approved |

There is no sign, send, broadcast, retry, cancel or refund route; all return 404. Host/Origin checks, loopback binding and existing access protections apply unchanged. Bodies must be `application/json` and at most 2 KB. Errors are fixed messages with a stable `code` (plus A's or B's `upstreamCode` when it is a bare identifier). Provider, chain and stack text is never reflected. The backend reads no wallet keys and no 1Click API key.

Modes:

- `WAVEFUND_FUNDING=live-preview npm run dev:api`: config from `runtime/funding/approved-routes.json` (A, currently empty), `VERIFIED_FUNDING_ROUTES` (B), `deployments/aurora-mainnet-funding-safe.json` and, for the strategy identity only, `deployments/aurora-testnet.json`. Previews call 1Click for **dry** quotes over the network, through B's built-in transport and pinned signature key.
- Injected (`startServer({ funding: createFundingReadModel({...}) })`): used by tests, and by A once the store and snapshot reader are wired.

## Shared interfaces consumed

Nothing here defines a competing schema or state machine. The UI maps A's states to display buckets only.

- **A (`runtime/funding/schema.mjs`, `service.mjs` at `71b193b`):** FundingRecordV1 field names (`fundingId`, `schemaVersion`, `configurationHash`, `request{routeId, manager, safe, source, destination, amountIn, minAmountOut, refundRecipient, expiresAt}`, `requestHash`, `quote{reference, depositAddress, amountIn, minAmountOut, expiresAt, evidenceQuality}`, `quoteHash`, `submission`, `observation`, `delivery`, `refund`, `readiness`, `state`, `reviewReason`, timestamps), the states `quoted | dispatching | pending | delivered | refunded | needs_review`, and the service methods `getConfiguration`, `get` and `recordSubmitted`. The projection omits `submission.attemptId`, which is a wallet-send capability, and `before`.
- **B (`runtime/intents`):** `VERIFIED_FUNDING_ROUTES`, `toProviderFundingRequest`, `createIntentsClient({ allowExecutionQuotes: false }).previewOrder`. Preview evidence is labelled `live-provider-signed` only when B marks the quote `source: live-provider`, `mocked: false` and its signature verified. Otherwise it is `mocked`.

**Requests to A:** confirm these names and transitions are final; decide whether and how records and `submitted` are exposed once the store and the mainnet snapshot reader are wired; approve or decline the executable-quote endpoint. **Requests to B:** delivery evidence for the route (none observed yet); confirmation of the explorer bases below.

## Display states

`classifyFunding(record, {config, now})` in `model.mjs` is the single source of what the UI may claim.

| FundingRecordV1 | UI bucket | Notes |
|---|---|---|
| no record, dry quote only | Quote preview | “DRY QUOTE · preview only · not executable”; no deposit address exists |
| `quoted` | Awaiting manager action | Sending is disabled. An expired, unsent quote becomes *needs review*: never reuse its deposit address |
| `dispatching` | Submitted · send reserved | “Do not send a second payment” |
| `pending` | Submitted · pending | Provider `SUCCESS` shows as *provider success · not yet verified*, never as delivery |
| `delivered` with consistent evidence | Delivered | **Verified** only if origin is the funding service and evidence is `live-verified`; fixtures read “evidence complete · fixture” |
| `delivered` with inconsistent evidence | Needs review | Wrong recipient, token or network, unbound hashes, too few confirmations, below the signed minimum or mixed quality |
| `refunded` | Refunded | Full amount only; verified under the same rule |
| `needs_review` + `PARTIAL_REFUND` | Partial refund | Shows the actual verified amount and the shortfall |
| `needs_review` + `RECEIPT_VERIFICATION_REQUIRED` + provider `REFUNDED` | Refund pending | Not shown as refunded |
| `needs_review` + `RECEIPT_VERIFICATION_REQUIRED` + provider `FAILED` | Failure | “FAILED does not mean refunded” |
| `needs_review` + `BROADCAST_UNKNOWN` / `CONFLICTING_SUBMISSION` / other | Needs review | Do not pay again; no retry or cancel |
| unknown state, malformed fields, wrong Safe/token/network | Unavailable | Never success, failure or cancellation |
| observation older than the route allows, or no recent update | Stale (modifier) | Warning shown; last snapshot kept |

“Verified” additionally requires all of the following:
- `integrity: "ok"`, `schemaVersion: 1`, and a `request.routeId` present in the configured routes;
- manager, refund recipient and receipt recipient equal the **configured** wallets, not merely each other;
- confirmations at least the stricter of the trusted route policy and the record's own limit. If neither declares a policy, the record goes to review (`CONFIRMATION_POLICY_UNKNOWN`) and is never treated as final.

A's approved route ids must therefore equal B's verified route ids (today `arb-usdc-to-aurora-usdc`). Settled records are not flagged stale just because polling stopped.

Monetary values are rendered from integer strings with BigInt. Missing values show “Unavailable”, never zero. Response text passes through `safeText`, which strips control, zero-width and bidi-override characters and bounds length; React escapes the rest. Explorer links use only allowlisted bases and are shown only for live evidence: Arbitrum One `https://arbiscan.io`, Aurora mainnet `https://explorer.aurora.dev`, Aurora testnet `https://explorer.testnet.aurora.dev`. **Confirm these bases before relying on them.**

## Fixture versus live

- `/fund?fixtures=1`, or the **Labelled fixtures** lane, opens an in-browser fixture explorer labelled “FIXTURE · synthetic data, not live evidence”. Safe, wallet, deposit and transaction values are fake and recognisable (`0x5afe…`, `0xfeed…`, `0xf1f1…`). The fixture strategy Safe is `0x7e57…`, its token `0x57ab…`, and a foreign token is `0x0dd0…`. Only public token identities are real. Fixture records are never labelled `live-verified` and never get explorer links.
- Live mode shows the trusted mainnet funding Safe and real dry quotes. No live funding record can exist yet: production routes are empty and executable quotes are disabled.
- The fixture model lives entirely in the frontend's own files, behind the `FundingLoader` interface, so it can be replaced.

## Verification in the isolated container

Dependencies were installed with `npm ci --ignore-scripts` in `node:22-bookworm-slim`; network was enabled only for that step. Everything below ran with `--network none` on a scratch copy without `.git`, env files or host credentials.

| Check | Result |
|---|---|
| `npm run test:runtime` (all existing tests plus 14 funding-API and 7 preflight tests) | **165 / 165 passed** |
| `npm test --workspace @wavefund/frontend` | **23 / 23 passed** |
| `npm run frontend:typecheck` | passed |
| `npm run frontend:build` | passed; `/fund` 24.1 kB (129 kB first load); `/` and `/manager` unchanged in function |
| Mutation checks (tables below) | **13 / 13** (first round) and **17 / 17** (lanes and readiness) killed; suites green after restore |
| Screenshots (`frontend/scripts/capture-funding-states.mjs`, Playwright 1.65.0 image, fixture mode) | 12 states × desktop/mobile captured to `.run/screenshots` |

Screenshot review caught a real UI bug: the scenario label switched before its record loaded, briefly pairing the new label with the old record. It is fixed; the label now changes together with the record.

```sh
npm run test:runtime
npm test --workspace @wavefund/frontend
npm run frontend:typecheck && npm run frontend:build
node frontend/scripts/capture-funding-states.mjs   # with the frontend running
```

Mutation checks, each applied to a scratch clone; the named test must fail:

| Mutation | Expected failing test |
|---|---|
| Drop the network check in `roundEligibility` | “mainnet funding can never make a testnet round eligible” |
| Compare refund recipient only with the record's manager | “refunds and managers are tied to the configured wallet…” |
| Default the confirmation policy to 1 | “finality uses the stricter trusted confirmation policy…” |
| Skip `evidenceFailures` for `delivered` | “only bound, final, live-verified receipts…” |
| Remove `dry === true` / Safe binding in `projectPreview` | “executable, redirected or under-minimum quotes are discarded” |
| Accept extra preview body keys | “preview rejects caller-supplied identities…” |
| Pass the provider message through `publicFundingError` | “provider and service errors are sanitized…” (an HTTP-layer variant was an equivalent mutant: errors are already fixed text by then) |
| Project `submission.attemptId` | “records come from the funding service…” |
| Treat the trusted-verified gate as always true | “every fixture scenario … is never verified” |
| Ignore missing tools in preflight | “missing forge and anvil fail with actionable guidance…” |
| Use `Number()` in `formatUnits` | “amounts render exactly…” |
| Missing `error` listener on spawned children | “child startup errors reject instead of crashing” |

Lanes and readiness (2026-11-12). Each mutant was applied to a scratch copy, and the named suite failed:

| Mutation | Killed by |
|---|---|
| Drop the delivered-token ≠ strategy-token check | frontend “another token in the Safe … is never ready” |
| Treat delivery without readiness as ready | frontend “delivered is never strategy-ready by itself” |
| Skip the snapshot stable-token check | frontend “another token …” |
| Show fixture readiness as ready | frontend “delivered is never …” |
| Let non-delivered records be ready | frontend “delivered is never …” |
| Skip the readiness Safe check | frontend “another token …” |
| Skip the deployment-compatibility check | frontend “another token …” |
| Treat an unknown pending authorization as clear | frontend “another token …” |
| Ignore the round prerequisites | frontend “another token …” |
| Let Tidepool follow the API status when connected | frontend “funding lanes stay separate …” |
| Allow the strategy network to differ from the round network | frontend “the strategy identity is validated …” |
| Give an unconfirmed explorer a link | frontend “funding lanes stay separate …” |
| Label fixture-quality API configuration as live | frontend “funding lanes stay separate …” |
| Drop `readiness.snapshot` from the projection | runtime “readiness keeps the funding service snapshot …” |
| Skip validation of the snapshot stable token | runtime “readiness keeps …” |
| Stop enforcing the strategy manifest network | runtime “strategy identity comes from the testnet manifest …” |
| Stop exposing the strategy identity | runtime “strategy identity …” |

## Local demo

`npm run demo:local` now checks `forge`, `anvil` and the Next.js binary before starting anything, and reports every missing prerequisite with guidance. It never installs tools. A missing command exits with 127; other child failures keep the child's exit code. Spawn errors become handled rejections. Shutdown stops only processes the launcher started (SIGTERM, then SIGKILL after a grace period). The funding page is available at `/fund`, and the fixture explorer at `/fund?fixtures=1`.

## Open blockers

1. **No reviewed Aurora mainnet Wavefund deployment**: funding can never be round-eligible today.
2. **Route not live-verified**: delivery has never been observed, and production `approved-routes.json` is empty.
3. **Executable quotes and wallet signing**: disabled pending review by A and B.
4. **Tidepool lane**: pending B's read-only interface, A's verified testnet configuration and the schema decision below.

## Proposed shared-schema changes (not implemented; for A)

A's `approvedRoute` currently requires `destination.chainId === 1313161554` (`DESTINATION_NOT_AURORA_MAINNET`), so no Tidepool testnet funding record can exist. Proposal, for A to accept or reject before anyone implements it:

1. **Lane discriminator.** Add `lane` (`"official-1click-mainnet"` or `"tidepool-community-testnet"`) to approved routes and records. Each lane gets its own allowed destination chain: mainnet for official (unchanged), testnet 1313161555 for Tidepool. Keep `official1Click: false` and a testnet-only flag on Tidepool records.
2. **Explicit strategy token.** Add `strategySafe` and `strategyToken` to the route. `prepareRound` would then also require `route.destination.token === strategyToken` and `snapshot.stableToken === strategyToken`. A Tidepool delivery of a different test USDC could then be delivered, but never consumed as readiness. The dashboard already enforces this from `config.strategy` and `readiness.snapshot`.
3. **Delivery shape.** Map B's Tidepool delivery proof onto the existing `delivery` fields (`requestHash`, `quoteHash`, `sourceTransactionHash`, `transactionHash`, `chainId`, `token`, `recipient`, `amount`, `confirmations`, `observedAt`, `evidenceQuality`), so the tracker needs no new state machine.

No field of `FundingRecordV1` was changed. The dashboard only reads the existing `readiness.snapshot`.

## Integration dependencies

- **B (provider):** a read-only Tidepool interface for the local API. It needs:
  - a route descriptor: source and destination chain, asset id, token and decimals, recipient Safe, limits, confirmation policy, and the `liveVerified`/`deliveryProven` flags;
  - a dry-quote preview, like `previewOrder`;
  - delivery verification in the shape above;
  - confirmation of the Arbitrum Sepolia explorer base.
- **A (funding core):**
  - accept or reject the schema proposal;
  - provide a verified testnet route configuration;
  - wire the store so `GET /api/funding/:id` and the optional `submitted` endpoint expose real records;
  - provide a snapshot adapter for the strategy stack.
- **Team decision:** which Safe the Tidepool lane funds.
  - `main` already has a separate token-compatible Tidepool stack (`deployments/aurora-testnet-tidepool.json`: Safe `0x3794…0f11`, stable = Tidepool test USDC `0x38d8…a252`).
  - The original strategy Safe `0x7814…0ad1` uses stable `0x8be4…915c`. A Tidepool delivery into that Safe can never make it ready, by design.
  - This branch reads only the original manifest. Pointing the lane at the Tidepool stack is a configuration change once the team decides.
## End-to-end run in a container

The API server also needs the local-demo (or Aurora-monitor) runtime, so live funding preview runs alongside the full demo. In an isolated container with Node 22, Foundry 1.5.1, restored dependencies and compiled contracts:

```sh
WAVEFUND_CONTAINER=1 WAVEFUND_FUNDING=live-preview npm run demo:local
# publish only 127.0.0.1:3000 (dashboard) and 127.0.0.1:3001 (API) to the host
```

`WAVEFUND_CONTAINER=1` makes the launcher bind the API and dashboard to the container's interfaces (`server.mjs` already gates `0.0.0.0` on the same flag). Anvil stays on loopback.

Verified on 2026-11-12, driven through the real dashboard in Playwright:
- Round 1 completed with 27/27 successful local transactions. “100% asset” won (final-window average 0.852 vs Hold 0.500). The Safe swapped 2,000 test USDC for 0.997 test ETH, with a measured return of +4.685%. Quant redeemed +2.45 and Guardian +0.15 test USDC.
- `/manager` loaded the live module and oracle state.
- `/fund` showed a real provider-signed, signature-verified 1Click dry quote to the trusted mainnet funding Safe (25 USDC → 24.9952, signed minimum 24.745248).

### One command

[`scripts/docker-demo/`](../scripts/docker-demo/README.md) wraps the steps above. It needs only a running Docker and `bash`, `git`, `rsync` and `curl`:

```sh
bash scripts/docker-demo/up.sh          # --fresh for a new chain, --no-funding-preview for no provider requests
bash scripts/docker-demo/down.sh
```

It syncs tracked and new non-ignored files into the git-ignored `.run/docker-demo/workspace`, then installs with lifecycle scripts disabled, fetches checksum-pinned sources and compiles, all in digest-pinned containers. It starts the demo with `WAVEFUND_CONTAINER=1 WAVEFUND_FUNDING=live-preview` and publishes only `127.0.0.1:3000/3001`. No credentials or env files are mounted. The owner of `docs/LOCAL-DEMO.md` may want to link it from there.
