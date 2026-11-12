# Funding dashboard and API integration (Developer C)

**Scope:** the dashboard and local API for **funding before a round**:

> manager wallet (supported EVM chain) → NEAR Intents / 1Click → manager-owned Aurora **mainnet** Trading Safe → delivery verification → round readiness, only where a compatible deployment exists.

This is not cross-chain execution of a winning strategy. The existing strategy and forecasting screens, the Trading Safe model, the AI agents, Uniswap v4 forecasting and Trisolaris execution are unchanged. Funding comes before them; it does not replace them.

**Status (2026-11-12, branch `feat/funding-dashboard`, base `71b193b`):** implemented and verified in network-isolated Node 22 containers on scratch copies (results under [Verification](#verification-in-the-isolated-container)). Sending stays disabled. The completed **Tidepool community-testnet demonstration** (funding → strategy round → outcome → reputation) is shown from saved, independently verified evidence. Official production 1Click delivery remains unproven.

## Judge path

1. **Start the local demo:** run `bash scripts/docker-demo/up.sh` (Docker only) and open http://127.0.0.1:3000. Running it again while the demo is up only reports the URL. Use `--fresh` for a new chain.
2. **Run the local fixture round:** on **Rounds**, press **Run local round**. It uses a local Anvil chain, test assets and scripted agents and prices; the contract transactions are real but local. Its +4.68% is **fixture data, not investment performance**.
3. **Inspect the Tidepool testnet round:** on **Rounds → Past rounds on Aurora testnet**, open **Round 1 · Tidepool testnet stack**. The story strip shows funding → decision → execution → outcome. The **Funding** tab covers Arbitrum Sepolia → Tidepool → NEAR testnet settlement → the Aurora testnet Safe, with the 0.52 bridge cost kept separate.
4. **Open transaction links:** every hash links to `sepolia.arbiscan.io`, `explorer.testnet.aurora.dev` or `testnet.nearblocks.io`. **Re-verify receipts now** runs an optional read-only fresh check through the existing `runtime/tidepool/read-model.mjs`.
5. **Inspect the result, payouts and reputation:**
   - The **Outcome** tab shows −0.6458% (exact factor 0.993541889635073190) as "executed and settled", not as a failure, plus the separate money buckets and the forecaster redemptions (9.934985 / 10.0207 / 10 / 9.981677).
   - **Agents** shows each stack's own −1 for Momentum; the two are never summed.
6. **Optional, official mainnet:** on **Treasury**, keep **NEAR Intents 1Click** selected and press **Get quote** for a signed dry quote. It is a mainnet preview; delivery is unproven and execution disabled.
7. **Run `node scripts/judge-check.mjs`** (after `npm ci --ignore-scripts`):
   - it is read-only and needs internet for the public checks;
   - it does not start a round, call a paid model, sign or move funds.

## Where each value comes from

| Panel | Source | Label in the UI |
|---|---|---|
| Rounds → current round, stats, activity | Local Anvil chain, scripted agents and simulated prices | "Local simulation" |
| Treasury → Fixtures source | In-browser synthetic records with fake addresses | "Fixture" |
| Rounds → past rounds and round detail (7, 8, Tidepool 1) | `docs/test-evidence/*`, validated by the API | "Saved evidence" (verified when recorded) |
| Tidepool funding, swap and NEAR settlement | `deployments/aurora-testnet-tidepool.json` and `docs/test-evidence/tidepool-v1/*` | "Saved evidence" |
| Tidepool relayer status | The Tidepool status saved in the funding proof | "Provider-reported" |
| Re-verify receipts now | Public Arbitrum Sepolia and Aurora testnet RPCs plus the Tidepool status API, read on click | "Fresh read · time" (or unavailable) |
| Agents → both reputation stacks | Shared reputation reader against Aurora testnet, on page load | "Live read" (stale or unavailable shown as such) |
| Treasury → NEAR Intents 1Click | Signed dry quotes from 1Click, mainnet | "Live quotes" (preview only) |

## Network truth

| Purpose | Network | Chain ID |
|---|---|---|
| Funding destination (NEAR Intents) | Aurora mainnet | 1313161554 |
| Verified Wavefund round deployment | Aurora testnet | 1313161555 |
| Strategy Safe / stable token (from `deployments/aurora-testnet.json`, not independently verified) | Aurora testnet | `0x7814…0ad1` / `0x8be4…915c`, 6 decimals |
| Tidepool community testnet (completed demonstration; not an official NEAR Intents testnet) | Arbitrum Sepolia → Aurora testnet, NEAR testnet settlement | 421614 → 1313161555 (Safe `0x3794…0f11`, Tidepool test USDC `0x38d8…a252`, engine `0xba96…4a14`) |

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
| **Tidepool testnet demo** | Aurora testnet | The completed transfer as history: the ladder **Minted test USDC ≠ Bridge delivery (verified) ≠ Strategy round (settled)**, the funding flow with saved, provider-reported and fresh-read labels, the funding → strategy linkage, and a link to the round. No deposit control | Always **Testnet demo · history** (`laneStatus` forces it, whatever a server reports) |
| **Labelled fixtures** | none | 16 synthetic states with fake addresses | Always **Synthetic** |

Links: `/fund` (official), `/fund?lane=tidepool`, `/fund?fixtures=1`.
- The Tidepool source reads its identities and amounts from the reviewed manifest and evidence through `GET /api/tidepool/demo`; nothing is hand-written.
- It is never wired into `FundingRecordV1`, which stays production-mainnet only, and it never feeds mainnet readiness.
- Arbitrum Sepolia links use `sepolia.arbiscan.io`, the explorer named in the verified Tidepool evidence.

## Tidepool testnet demonstration (`GET /api/tidepool/demo`)

`runtime/operator/tidepool-demo.mjs` projects the completed demonstration from `deployments/aurora-testnet-tidepool.json` and `docs/test-evidence/tidepool-v1/` (funding proof, NEAR settlement, capital linkage, swap check, round report).

It rejects evidence that:
- is labelled official 1Click or not testnet-only;
- names a source other than Arbitrum Sepolia, or a destination other than Aurora testnet;
- names a different Safe or token from the manifest;
- disagrees with the manifest's transaction hashes or delivered amount;
- has a NEAR settlement that isn't final or isn't at `verifier.tidepool-sandbox.testnet`;
- names a different engine or capital in the linkage;
- names a different swap.

Values it shows:
- 200 test USDC sent, 199.48 delivered, 0.52 bridge cost;
- NEAR settlement `93tneP…CVYC`;
- swap 149.61 USDC → 0.071692173391461052 test ETH;
- round key `1313161555:0xba96…4a14:1`.

The saved signed quote is re-verified offline with the existing `validateTidepoolQuote` (`runtime/tidepool/client.mjs`) and Tidepool's own signing key (`ed25519:U1Mu…iWY`, which also signed the NEAR settlement). It pays the Safe directly (`recipientType: DESTINATION_CHAIN`, no `virtualChainRecipient`). Nothing is re-requested or re-sent, and no client was rebuilt.

`GET /api/tidepool/demo/fresh-check` re-reads the public receipts on demand through the existing `readTidepoolFundingProof`:
- it is cached for a minute and labelled `fresh-rpc-read` with its timestamp;
- a failure or mismatch is shown as such, and the saved evidence is never relabelled fresh;
- there is no signing, sending, retry or cancel route under `/api/tidepool`;
- `WAVEFUND_TIDEPOOL_DEMO=disabled` removes it.

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

## Outcome reputation (`GET /api/agents/reputation` and `/api/agents/reputation/tidepool`)

There are two separate contract histories: the original stack (`deployments/aurora-testnet-reputation.json`, contract `0xac9c…9488`) and the Tidepool stack (`deployments/aurora-testnet-tidepool-reputation.json`, contract `0xfa71…4e92`), each read with its own pinned manifest. The same Momentum wallet has −1 on each, from different rounds. They are shown side by side and never summed, and there is no combined endpoint.

`runtime/operator/reputation-api.mjs` serves the on-chain `AgentReputation` history of the four trusted proposers (Conservative `0x5613…0345`, Balanced `0xcBF9…0Cb8`, Momentum `0x8B6a…888F`, HighBeta `0x1Ba3…EA0a`).

How it reads:
- It uses the shared `createReputationReader` from `runtime/agents/reputation-readonly.mjs` with `deployments/aurora-testnet-reputation.json`, over a fixed read-only client (`https://testnet.aurora.dev`, no retries, 15 s timeout).
- The reader keeps every check: network, pinned runtime code, engine/tracker bindings, 120 s block freshness, counts and score arithmetic. None of them is duplicated.
- Nothing comes from the request: no RPC URL, contract or agent. Only GET exists under `/api/agents`; there is no signing, execution or retry route.
- Results are cached for 15 s with one shared in-flight read. `WAVEFUND_REPUTATION=disabled` removes the endpoint.

What it returns:
- Every agent has `status: ok` with the reader's integer-string `score`, `samples`, `positive`, `negative`, `flat`, `blockNumber` and `blockTimestamp`.
- A failed read has `status: unavailable`, `reputation: null` and the reader's code. It is never a zero score.

`/record` (journey tab **Record 04**) shows signed **performance points**, the evaluated strategy count and positive/negative/flat outcomes, with five distinct states:
- **Scored**;
- **No evaluated strategies**: 0 points, "no point and no penalty";
- **Unavailable**: no number, "no data · not zero", plus the code;
- **Stale**: the reader's stale block, or a last good snapshot after failed 30 s refreshes;
- **Loading**.

The source footer names Aurora testnet 1313161555, the reputation contract with an explorer link, and the observation block.

The rules panel states:
- only selected, executed and settled non-Hold strategies score: +1 positive, −1 negative, 0 flat;
- unselected proposals get nothing;
- registry selection wins (`ProposerRegistry.roundsWon`) are a separate metric and are not counted;
- this is "Performance reputation", not a lending credit score.

Live read on 2026-11-12, block 277326134: Momentum −1 (1 evaluated, 1 negative). Conservative, Balanced and HighBeta have no evaluated history.

## Published testnet rounds (`GET /api/evidence/testnet-rounds`)

`runtime/operator/round-evidence.mjs` validates and projects `docs/test-evidence/round7-hybrid/` and `round8-swarm/` once at startup.

Validation rules:
- every file must be chain 1313161555, and round ids and winners must agree;
- hashes must be 32-byte hex, amounts integer strings, and payout arithmetic must hold;
- text is bounded and control characters are stripped.

Tampered evidence is rejected. Report/independent disagreements are surfaced in `checks`, not hidden. Invalid evidence answers 503 without stopping the server; `WAVEFUND_EVIDENCE=disabled` removes the endpoint.

The `/record` cards present the rounds as they happened:
- **Round 7, hybrid test:**
  - four genuine NEAR AI proposals (5/45/75/95% ETH, operator-assigned mandates);
  - four forecasters flagged **scripted** that targeted proposal 3;
  - Momentum's 75% ETH selected, with the actual Trisolaris swap (independent balance check passed);
  - measured return **−0.2164%**, forecaster profit/loss (−0.031981, +0.011521, 0, −0.010268 test USDC), and Momentum's recorded **−1** point.
- **Round 8, genuine eight-agent run:**
  - eight genuine AI calls; all four forecasters **abstained** ("No forecast clears confidence and actual entry-cost edge checks");
  - **Hold** won with **no swap**, and every forecaster redeemed the full 10 test USDC;
  - no point was earned; the Hold drift (−0.0416%) is labelled "not scored".
  - It is not described as AI betting.

Both cards list limitations ("no TEE attestation verified", the same model for every call, test assets), scope, the round 8 scope correction, the independent checks, and every transaction with a validated `explorer.testnet.aurora.dev` link.

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
| Performance reputation API | `runtime/operator/reputation-api.mjs`, `runtime/test/reputation-api.test.mjs` |
| Testnet round evidence API | `runtime/operator/round-evidence.mjs`, `runtime/test/round-evidence.test.mjs` |
| Agents (outcome reputation, two stacks) | `frontend/src/app/record/*`, `frontend/src/components/record/RecordParts.tsx`, `frontend/src/lib/record/*`, `frontend/test/record-model.test.mjs` |
| Tidepool demonstration | `runtime/operator/tidepool-demo.mjs`, `runtime/test/tidepool-demo.test.mjs`, `frontend/src/lib/tidepool/*`, `frontend/src/components/tidepool/TidepoolParts.tsx`, `frontend/test/tidepool-model.test.mjs` |
| Round detail (network + engine + round) | `frontend/src/app/rounds/[id]/*`, `frontend/src/components/rounds/RoundEvidence.tsx` |
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
| `npm run test:runtime` (`main` `89d8408` merged; includes the reputation, round-evidence and Tidepool-demo tests) | **222 / 222 passed** |
| `npm test --workspace @wavefund/frontend` | **34 / 34 passed** |
| `npm run frontend:typecheck` | passed |
| `npm run frontend:build` | passed; `/fund` 24.1 kB (129 kB first load); `/` and `/manager` unchanged in function |
| Mutation and guard checks (tables below) | **13 / 13**, **17 / 17**, **19 / 19** and **20 / 20** (Tidepool, round identity, reputation stacks), plus the launcher restart guard; suites green after restore |
| Docker (`check-restart.sh --include-fresh`, then a local round) | A repeated start left the demo intact; `--fresh` replaced only this demo; `down.sh` stopped it. A stale session and a busy port fail without stopping anything. The local round completed 27/27 |
| Read-only checks against the running demo | `/api/tidepool/demo`, the fresh check (verified against public receipts), both reputation stacks and the evidence all return 200; `/api/tidepool/send` and `sign`, `/api/agents/reputation/all` and `POST /api/tidepool/demo` return 404 |
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

Reputation, evidence and Tidepool ladder (2026-11-12). There were 19 mutants in total. The first run found one survivor: “numeric JSON numbers accepted” was covered only together with the score check. A discriminating test was added, and the rerun killed all 19.

| Mutation | Killed by |
|---|---|
| Report a failed read as a zero score | runtime reputation endpoint and frontend board tests |
| Reflect raw error codes | runtime “wrong network, stale blocks and a failing RPC …” |
| Expose POST under `/api/agents` | runtime “only GET exists under /api/agents …” |
| Stop sharing the in-flight read | runtime “the board caches briefly …” |
| Accept an untrusted proposer list | runtime “the board caches briefly …” |
| Remove the evidence hash check / network check / payout arithmetic | runtime “tampered or malformed evidence is rejected …” |
| Stop flagging scripted forecasters | runtime round 7 test and frontend evidence test |
| Treat round 8 as swapped | runtime round evidence tests |
| Drop the minus sign from points | frontend “points, signed amounts and returns …” |
| Accept JSON numbers for counts | frontend “numbers, missing fields … never become zero” |
| Ignore the reader's stale code or a stale snapshot | frontend board and snapshot tests |
| Drop the half in return rounding (−0.0415% instead of −0.0416%) | frontend “points, signed amounts and returns …” |
| Not recognise the Hold winner | frontend evidence test |
| Give invalid hashes explorer links | frontend evidence test |
| Let Tidepool follow the API status / claim delivery connected | frontend Tidepool ladder and lane tests |

Tidepool, round identity and reputation stacks (2026-11-12). There were 20 guard breaks, and each was caught by the named suite:

| Guard broken | Caught by |
|---|---|
| Wrong Safe / wrong token / official-1Click record / mainnet destination / NEAR receiver accepted | runtime "wrong Safe, token, network, route type or NEAR receiver is rejected…" and frontend mixing test |
| Fresh check labelled saved, or a mismatch reported verified | runtime "the fresh check is on demand, labelled fresh…" |
| Plan engine or Safe not checked; duplicate round keys; key without engine | runtime "evidence naming another Safe, engine…" and "identified by network + engine + round id" |
| Scripted forecasters unflagged | runtime and frontend round tests |
| Tidepool reputation path served by the original board; a summed total added | runtime "separate contract histories and are never summed" |
| UI accepts an official-1Click demo, shows saved evidence as fresh, skips the bridge-cost recomputation, unbinds the round identity from its engine, or resolves an ambiguous bare round number | frontend tidepool-model tests |
| Tidepool ladder claims delivery without evidence | frontend ladder test |
| Launcher: the "already running" guard removed | `check-restart.sh` failed ("a second normal start returned non-zero"); it passes again once restored |

## Local demo

`npm run demo:local` now checks `forge`, `anvil` and the Next.js binary before starting anything, and reports every missing prerequisite with guidance. It never installs tools. A missing command exits with 127; other child failures keep the child's exit code. Spawn errors become handled rejections. Shutdown stops only processes the launcher started (SIGTERM, then SIGKILL after a grace period). The funding page is available at `/fund`, and the fixture explorer at `/fund?fixtures=1`.

## Open blockers

1. **No reviewed Aurora mainnet Wavefund deployment**: funding can never be round-eligible today.
2. **Route not live-verified**: delivery has never been observed, and production `approved-routes.json` is empty.
3. **Executable quotes and wallet signing**: disabled until the integrated route is reviewed.

The Tidepool community-testnet funding, NEAR testnet settlement and strategy round are complete and independently verified. Only **official production-mainnet delivery** remains unproven.

## Shared schema

No change is needed. `FundingRecordV1` intentionally supports production mainnet only, and the dashboard keeps that boundary. The completed Tidepool demonstration is shown through a dedicated read-only projection (`tidepool-demo.mjs`), not as funding records. The earlier lane-discriminator proposal is withdrawn for now.

## Integration dependencies

- **Official production 1Click:**
  - delivery evidence for a mainnet route;
  - an approved route in `approved-routes.json`;
  - a connected funding record store for `GET /api/funding/:id`.
  Until then mainnet stays a dry-quote preview.
- **Optional:** a read-only `ProposerRegistry.roundsWon` reader if the team wants on-chain selection wins. Until then, selections appear per round from the evidence, separate from points.
- **Runtime availability:** live reputation and the Tidepool fresh check depend on public RPCs (`testnet.aurora.dev`, `sepolia-rollup.arbitrum.io`) and the Tidepool status API. When they are down, the UI shows "unavailable" or "stale", never zeros and never "fresh".

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
bash scripts/docker-demo/up.sh          # again while running: reports the URL and leaves it alone
bash scripts/docker-demo/up.sh --fresh  # reset only this demo's disposable chain/session
bash scripts/docker-demo/down.sh        # stop only this demo
bash scripts/docker-demo/check-restart.sh --include-fresh   # self-test of the above
```

Behaviour:
- A second normal start never stops a working demo.
- A stale session asks for `--fresh` before anything is stopped.
- A busy port names the process holding it.
- A failed start keeps the stopped container for `docker logs`.
- Files deleted from the repository are removed from the disposable copy, while dependency and compiler caches are kept.
- Anything that looks like a secret (`.env*`, keys, keystores, `secrets/`) is never copied.
- There are no public-network transactions: the local Anvil chain signs and deploys disposable local contracts only, and startup makes no paid model calls.

It syncs tracked and new non-ignored files into the git-ignored `.run/docker-demo/workspace`, then installs with lifecycle scripts disabled, fetches checksum-pinned sources and compiles, all in digest-pinned containers. It starts the demo with `WAVEFUND_CONTAINER=1 WAVEFUND_FUNDING=live-preview` and publishes only `127.0.0.1:3000/3001`. No credentials or env files are mounted. The owner of `docs/LOCAL-DEMO.md` may want to link it from there.
