# Wavefund NEAR: AI strategy rounds on Aurora testnet, funded through NEAR

Wavefund runs a **round**: AI agents propose trading strategies for a Safe, other agents trade LONG/SHORT claims on each proposal in a Uniswap v4 market, the market picks one, a CALL-only Safe module executes it, and a Supra-authenticated price settles the measured return. Proposers earn an outcome point (+1, -1 or 0) in an on-chain reputation contract. Everything public runs on Aurora testnet with **worthless test assets**.

## Summary for judges (14 Nov 2026)

What exists, with where to see it (details and the "do X, see Y" steps are in [Judge path: live testnet evidence](#judge-path-live-testnet-evidence)):

| Claim | Evidence |
|---|---|
| 9 scheduled rounds on the Tidepool-funded stack (**Testnet Safe v2**): 8 completed and published, 1 failed and cancelled (round 4, disclosed) | [SCHEDULE.md](docs/test-evidence/tidepool-rounds/SCHEDULE.md) and each `round<N>/report.json` |
| Round 9 showcase: 4 proposals from 4 different models, each **TEE-verified** (NEAR AI: Intel TDX, NVIDIA GPU, signed response, measurement policy) and bound to its on-chain proposal; 8 forecasters on 8 other models; real AI bets | [round9/report.json](docs/test-evidence/tidepool-rounds/round9/report.json), [tee.json](docs/test-evidence/tidepool-rounds/round9/tee.json), [TEE-VERIFICATION.md](docs/TEE-VERIFICATION.md) |
| Live attack suite: 12 access-control and state-machine attacks, each reverting with its exact named error (12/12) | [ATTACK-SUITE.md](docs/ATTACK-SUITE.md), `node scripts/attack-suite.mjs` |
| Manipulation-resistance probe (round 8): the pool price was pushed up 528 bps after execution; the measured return still followed the oracle | [round8/manipulation-probe.json](docs/test-evidence/tidepool-rounds/round8/manipulation-probe.json) |
| Cross-chain funding with NEAR Intents (Tidepool, community testnet) and a signed official 1Click **mainnet** dry quote | [TIDEPOOL-DEMO.md](docs/TIDEPOOL-DEMO.md) |
| Browser wallet: connect, deposit, claim and trade LONG/SHORT on a live round (test assets only) | `/rounds/live#wallet`; round 9 includes one outside wallet |

Stack naming in prose: **Testnet Safe v1** is the original Aurora testnet stack (`deployments/aurora-testnet.json`); **Testnet Safe v2** is the Tidepool-funded stack (`deployments/aurora-testnet-tidepool.json`, Safe `0x37947266fc1c2b20ffa36869af5dd531f2d80f11`). Their reputation histories are never summed.

**Not claimed:** no real money, no alpha, no audit. Read [Honest limits](#honest-limits) before judging any number below.

**Team starting point:** [Engineer handoff, current blockers and verified evidence](docs/ENGINEER-HANDOFF.md).

**Live NEAR verification, no wallet or AI key:** after installing locked dependencies,
run `node scripts/judge-check.mjs` (about 45 s). It checks live reputation, signed dry quotes,
actual Tidepool funding receipts, final NEAR testnet `execute_intents`, rounds 2-9 against public
receipts, the round 9 TEE proofs (offline), the outside wallet's own transactions and the 12-attack suite.
Each check reports `passed`, `failed` (public data contradicts the claim; exit 1) or `amber`
(network unavailable, not a failed claim).
See [the separate testnet flow and exact scope](docs/TIDEPOOL-DEMO.md).

Solidity implementation targeting Aurora testnet (chain 1313161555). A [genuine public Safe round](docs/AURORA-SAFE-ROUND.md) completed v4 forecasting, an actual Trisolaris swap, Supra-authenticated settlement and forecaster redemption. This is a single-operator rehearsal with freely minted test assets, not an audited or production-approved deployment.

Supra supplies authenticated public-testnet observations without a gateway key. [RedStone access](docs/REDSTONE-PROOF.md) remains an alternative, not a blocker for the completed round. Run the runtime tests with `npm run test:runtime` and the Python bridge tests with `python3 scripts/test-aurora-agent-bridge.py` (counts change as evidence is added, so none is asserted here). The last recorded isolated Solidity regression passed **451 executions across 29 suites**. See [deliberate product testing](docs/PRODUCT-TESTING.md) for scripted LONG/SHORT coverage, real-model limitations and recovery evidence.

[Local full-stack demo](docs/LOCAL-DEMO.md): real local Safe/v4 transactions, a Node orchestration API and a Next.js dashboard. Run `npm run demo:local` after isolated dependency setup. Prices and agents are explicitly simulated.

[Agent layer and private key setup](docs/AGENT-LAYER.md): model proposals, independent forecasts, entry-quote and budget checks. Four approved real NEAR AI calls completed an earlier [public agent round](docs/AURORA-AGENTS.md) on Testnet Safe v1: both forecasters abstained under the confidence gate and Hold settled normally. Genuine model-directed forecasting trades are first shown in round 9 on Testnet Safe v2 (see below).

[Manager console, research collector, receipt recovery and Aurora monitoring](docs/OPERATOR-WORKFLOWS.md). Local owner tools: `http://127.0.0.1:3000/advanced`. Public network monitoring is read-only and requires a real verified deployment manifest.

## Model

Manager-owned Safe assets are independent of forecaster escrow. A manager authorizes exact round timing, payout bounds and averaging window. Forecasters trade conditional claims; the selected allocation executes through a CALL-only module. Proposal 0 means Hold actual quantities. Other proposals specify the investment asset weight in basis points. All eligible Safe capital is available, with no extra mandatory 50% cap.

One instance supports one Safe, a six-decimal stablecoin, an eighteen-decimal investment asset, a fixed direct-pair router and immutable price source. Independently settling Safes require independent collateral and seed. No WAVE share token is issued.

## Judge quickstart: do this, see this

### Fastest path: one command (Docker)

Requirements: a running Docker plus `bash`, `git`, `rsync` and `curl`. No wallet, API key or `.env` file is needed. Startup sends no public-network transactions and makes no paid model calls.

1. Run `bash scripts/docker-demo/up.sh`. The first run takes a few minutes; then open http://127.0.0.1:3000.
2. Open **Rounds → Local simulation** (`/rounds/local`) and press **Run local simulation**. The workspace follows the round live, one stage at a time, through seven steps: funded, proposals, LONG/SHORT forecasting, selection, Safe execution, evaluation and redemption, on a local Anvil chain. This is a **fixture round**: simulated prices and agents, real local contract transactions.
3. On the welcome page press **Explore a round** (or **Rounds → Round 1 · Testnet Safe v2**). It opens on the **Result** recap; **Replay journey** steps through each stage. You'll see:
   - Arbitrum Sepolia test USDC → Tidepool → NEAR testnet settlement → the Aurora testnet Safe (200 sent, 199.48 delivered);
   - four genuine AI proposals and four **scripted** forecaster trades, with Momentum's 75% test ETH selected;
   - the actual Safe swap, a measured −0.6458% return, the forecaster redemptions and the −1 outcome point.
   All of it is saved, independently verified evidence with explorer links. In the **Funded** stage, **View transfer → Re-verify receipts now** re-reads the public receipts.
4. On **Agents**, you'll see separate outcome-reputation histories for Testnet Safe v1 (original) and Testnet Safe v2 (Tidepool-funded), read live from Aurora testnet. They are never summed.
5. Optional: on **Portfolio → Funding → Funding preview** (`/portfolio/fund`), press **Get quote** for a signed official 1Click **mainnet** dry quote. Delivery is unproven and execution disabled.
6. Run `node scripts/judge-check.mjs` (see the top of this README). It is read-only, needs internet, starts no round, makes no paid model call, and signs or moves nothing.

The launcher starts the API with `WAVEFUND_TEE_POLICY=docs/tee-policy.json`, which the read-only evidence API needs to load round 9 (without it `/api/evidence/testnet-rounds` answers 503). Rounds 2-10 are then listed too: see [Judge path: live testnet evidence](#judge-path-live-testnet-evidence).

Stop with `bash scripts/docker-demo/down.sh`. Use `up.sh --fresh` for a new local chain. Details and which panel is fixture, saved evidence or fresh read: [docs/INTENTS-DASHBOARD.md](docs/INTENTS-DASHBOARD.md#judge-path).

### Manual path

To run the read-only API alone (needs the compiled contract artifacts, so after `forge build`; this is what the launcher does): `WAVEFUND_TEE_POLICY=docs/tee-policy.json node runtime/server.mjs` (`npm run dev:api` sets this by default). Check it: `curl -s localhost:3001/api/evidence/testnet-rounds` lists 10 rounds, and 503 `EVIDENCE_INVALID` means the policy variable is missing.

Use a clean isolated development environment. Requirements: Node 22+, Python 3.12+, Foundry 1.5.1 and Solidity 0.8.26. No wallet connection or API key is required for the local fixture demo.

1. Install the official Foundry version manager following [Foundry installation](https://www.getfoundry.sh/introduction/installation), then select the tested toolchain:

   ```sh
   foundryup --install 1.5.1
   forge --version
   anvil --version
   ```

   Expected: both executables are available and report version 1.5.1. If either command is missing, fix the isolated environment's PATH before launching the demo.

2. Restore pinned Solidity sources and npm dependencies with lifecycle scripts disabled:

   ```sh
   python3 scripts/fetch-deps.py
   npm ci --ignore-scripts --no-audit --no-fund
   ```

   Expected: dependencies are available; no credentials are read or transactions submitted. Network access is needed for this setup step.

3. Verify the published runtime and bridge controls:

   ```sh
   npm run test:runtime
   python3 scripts/test-aurora-agent-bridge.py
   python3 scripts/test-aurora-bridge.py
   ```

   Expected: the Node and Python tests pass. The Solidity verification command is below; its last recorded result is 451 executions across 29 suites.

4. With ports 8545, 3001 and 3000 free and no previous `.run/local-demo` journal, start:

   ```sh
   npm run demo:local
   ```

   Open `http://127.0.0.1:3000/rounds/local` and press **Run local simulation**. Expected: proposals, LONG/SHORT trades, selected allocation, local Safe execution, settlement and redemption become visible. This uses simulated prices, investment venue and agent decisions; it does not call NEAR AI or Intents. See [exact reference results and explicit session reset](docs/LOCAL-DEMO.md).

5. Compare the separate [public Aurora Safe evidence](docs/AURORA-SAFE-ROUND.md) and [agent/product evidence](docs/PRODUCT-TESTING.md). These are historical testnet records, not activity created by opening the page. Stop the local launcher with Ctrl+C.

## Solidity verification

Run in the isolated environment after dependency setup:

```sh
python3 scripts/fetch-deps.py
forge test
forge build --skip test --skip script --sizes
forge fmt --check src/safe src/oracle src/PerformanceTracker.sol
```

On memory-limited machines, run every suite sequentially with `python3 scripts/test-shards.py` after dependencies and the compiler are available. This fails if a suite does not actually execute tests.

Run untrusted code in your isolated environment. The development verification uses a network-isolated Docker container and a cached 0.8.26 compiler. Safe 1.4.1 is compiled without IR; Wavefund contracts retain Cancun/viaIR. Test proxies execute the actual Safe artifact, not a permissive Safe imitation.

## Contracts

| Component | Purpose |
|---|---|
| QuantumRound | Forecast escrow, proposal markets, winner selection and redemption |
| ProposalToken / ProposalTokens | Conditional CREDIT/LONG/SHORT clones |
| ProposerRegistry | Registration, fixed one-stablecoin bond and refundable commitments |
| WaveV4ProposalMarket / WaveHook | Pinned v4 trading and final-window probability averaging |
| TradingSafeModule | Safe-approved terms, frozen balances, canonical execution, approvals and postconditions |
| PerformanceTracker | Fixed-portfolio valuation and bounded post-deadline settlement |
| FeedPortfolioOracle | Validates AggregatorV3-format feed prices, freshness and decimal normalization |
| RedstonePortfolioOracle | Permissionless signature-verified USDC/ETH price cache; live gateway access still pending |
| DiaPortfolioOracle | Equivalent validated DIA-format consumer; documented live testnet feed is stale |
| SupraPortfolioOracle | Permissionless authenticated ETH/USD + USDC/USD cache; used in the completed public round |

Detailed flow and custody boundaries: [architecture](docs/ARCHITECTURE.md).

## Units and settlement

Legacy `tEthBps` / `currentTEthBps` selectors refer to the approved investment asset in this version.

Stablecoin/CREDIT use 6 decimals; LONG/SHORT use 18. A raw credit corresponds to 1e12 raw units of each outcome token. Default demo payout return bounds are 0.95–1.05; selection requires a challenger probability average to beat Hold by strictly more than 0.005 (0.5 percentage points). The ±5% payout bounds are not a stop loss.

Entry value uses pretrade balances and accepted entry prices. End value uses actual posttrade quantities valued at accepted end prices. This includes execution fees/slippage but excludes keeper-paid gas. Later owner withdrawals or donations do not alter the recorded strategy return; it is not the Safe's eventual NAV.

The first successful observation inside the configured window settles. Both feed publication times must be after evaluation end, and prices must pass adapter freshness/skew checks. This is bounded observation, not proof of the exact historical deadline price. If the observation window is missed, anyone can invoke the engine's existing delayed emergency path: executed rounds settle at midpoint; unexecuted rounds cancel at par. Users bear this disclosed outage assumption.

## Live integration gates — blocked until verified

- DIA's documented testnet contract had stale ETH/USD and USDC/USD observations in 9 November 2026 RPC checks. It must not be used as a live price source.
- AggregatorV3 compatibility is an ABI format, not evidence that Chainlink operates a suitable Aurora deployment.
- RedStone signature verification now passes local tests and read-only Aurora runtime probes using historical production data. Fresh gateway delivery remains unverified without API access; no historical-data fallback exists.
- The historical forecasting-only proof used an unrestricted test controller. The fresh genuine stack now completes collateralized forecasting and a Safe round; see [public round evidence](docs/AURORA-SAFE-ROUND.md).
- Actual Trisolaris execution is verified for our self-seeded test-token pair. Production asset identity, organic liquidity and production-grade execution remain separate gates.
- Forecasters must verify the instance bytecode and oracle implementation/feed identity; arbitrary manager-supplied oracle contracts are not trustworthy merely because they implement an interface. Oracle inputs must match the approved assets. Nonstandard fee/rebasing tokens are outside v1.

## Deployment

`script/DeployTradingSafe.s.sol` is a recipe for an existing initialized Safe 1.4.1. It does not enable the module or move money. It accepts only local chain 31337 or Aurora testnet. Supply a verified oracle, assets, router, keeper and either a verified PoolManager or explicitly request a separate self-deployed forecast manager. Hook permissions are mined against an actual deployed CREATE2 factory; no assumed global deployer address.

The Safe must subsequently enable the module, authorize terms and supply investment capital. Forecast sponsor seed is funded separately. The module rejects stale oracle data and balance changes before execution; disabling it does not prevent settlement after execution.

Engine administration goes to the Safe. Token-factory and registry role administrators are permanently renounced after setup so the manager cannot add mint/bond controllers. The engine remains the sole controller. The deployment recipe emits all stack addresses; preserve its receipt and verify every binding before accepting funds. No live command or broadcast is performed automatically.

## Attribution

Forecasting code and associated tests derive from https://github.com/advaitrane98/wavefund at commit 8629c21f2c7b93591afbf27c2a858a9008f9350e. Original MIT copyright is retained in LICENSE. New execution/oracle/integration code is identified in docs/BUILD-REPORT.md. Dependency commits/checksums are in docs/dependency-pins.json. Uniswap and RedStone dependencies contain their own per-file licenses; the root MIT license does not relicense them.

## Hackathon baseline and new work

This adapts an existing Wavefund project; reused forecasting contracts are baseline regardless of import date. The upstream reference is listed under Attribution. Local import checkpoint: `f8c0177`. New work includes the Aurora Safe module, valuation/oracle adapters, bounded model orchestration, operator workflows and dashboard. Inspect changes with `git diff f8c0177..HEAD -- src script test runtime frontend scripts`. The completed public cycle is documented separately from local fixtures and the historical mock-controller experiment.

## Current execution and funding model

Manager-owned capital funding through NEAR Intents now has a signed-quote provider, receipt-proof tooling, funding state machine and bounded local one-USDC operator. Real signed dry quotes are verified for the official production 1Click route; delivery on that mainnet route remains unproven and signing is not exposed through HTTP. The local operator requires explicitly supplied trusted capabilities and approval of the exact plan hash. A live Intents route targets mainnet; it cannot fund the existing Aurora testnet deployment. Funding and strategy evidence must retain their real network identities. The existing strategy executor remains the direct Trisolaris path.

Uniswap v4 pools and WaveHook serve forecasting LONG/SHORT claims. The Safe module reads the canonical winner and calls a fixed exact-input investment router with oracle/slippage and balance checks. The local demo retains its prefunded fixture. The public testnet stack uses the existing Trisolaris router with our self-seeded test-token pair; an actual Safe swap is verified.

Managers supply their own investment capital. Forecasters supply separate collateral. A customer, protocol or sponsor must explicitly supply forecasting seed liquidity; that seed can lose money funding rewards and is not the manager's investment return. Operating costs also include transaction gas, model inference, data access and hosting. The demo's $2,000 capital/$100 sponsor reserve are fixtures, not production minimums.

## Agent outcome reputation

[Outcome reputation](docs/AGENT-REPUTATION.md) is additive to the existing trading stack. Only a selected, executed and settled strategy scores: positive return +1, negative -1, flat 0. Counts and points are per proposer address, not lending creditworthiness. Deployment evidence: [Aurora testnet reputation](deployments/aurora-testnet-reputation.json). The genuine eight-agent runner uses `--profile swarm`; the paid inference flag and a fresh budget remain required.

The separate [Tidepool testnet happy path](docs/TIDEPOOL-DEMO.md) (round 1, Testnet Safe v2) completed cross-chain funding, four genuine AI proposals, scripted forecast trades, an actual Safe investment swap, authenticated settlement, redemptions and outcome scoring. It is community testnet execution with worthless tokens, not official mainnet 1Click delivery.

## Attestation and onboarding

[NEAR AI TEE verification](docs/TEE-VERIFICATION.md) is an opt-in, fail-closed hardware, model-signature and proposal-binding path. **Rounds 9 and 10 have attested proposer responses.** Round 10 is a separately labelled happy-path test: four genuine Qwen3.6 proposer calls, four scripted forecasters, Conservative selected at 53.6995% TWAP versus Hold at 50%, a real 0.061496 test ETH → 116.643816 test USDC swap, −0.410717% measured return, all redemptions checked and the selected agent scored −1. See [Round 10 evidence](docs/test-evidence/tidepool-rounds/round10/report.json). Rounds 1-8 were run without it and cannot be attested afterwards. Its four proposer responses were checked as follows (offline recheck below): nonce-bound Intel TDX quote, NVIDIA GPU verdict, configuration and event-log checks, a measurement allowlist, a `provider_tee` signature whose signer matches the attestation, and the on-chain `ProposalCreated` binding. The 8 forecasters are proxied third-party models and are **not** attested.

Trust basis, quoted from `docs/tee-policy.json` and [TEE-VERIFICATION.md](docs/TEE-VERIFICATION.md): `observed-at-2026-11-13-not-independently-reproduced`. The measurements were pinned from NEAR AI's live attestation on 13 Nov 2026. The mrTd half was reproduced from the dstack v0.5.12 release; the mrConfigId half (NEAR AI's app-compose hash) was **not** reproduced because NEAR AI publishes no expected value. We never call this "independently verified".

Role guides are available at `/start/manager`, `/start/forecaster` and `/start/observer`; [scope and wallet test boundary](docs/ONBOARDING-VERIFICATION.md).

## Judge path: live testnet evidence

All steps below are read-only. Start the demo first (`bash scripts/docker-demo/up.sh`, see above) or run the commands directly. No wallet, key or paid call is needed unless stated.

| Do this | See this | Evidence file |
|---|---|---|
| Open **Rounds**, pick a **Testnet Safe v2** round (2-9) | Result recap, then the stages; scripted rounds show forecasters flagged **scripted** | `docs/test-evidence/tidepool-rounds/round<N>/` |
| Open **Round 9 → Proposals**; press **Proof ›** on a proposal | A drawer listing each check (quote, GPU, signature, measurement policy, on-chain binding), raw JSON and limits | `round9/tee.json`, `round9/plan.json` |
| `node scripts/verify-tee.mjs 9 --policy docs/tee-policy.json` | JSON with `"verified": true` and four proposals, each with every check true and `trustBasis` `observed-at-2026-11-13-not-independently-reproduced`; exit code 0. Offline, no key or network. It checks captured material at its captured time, not current revocation | `round9/tee.json`, `docs/tee-policy.json` |
| Open **Round 9 → Forecasting** | 8 forecasters, each on a different model; 3 bought a side, 5 abstained | `round9/report.json` (`decisions`), `round9/independent.json` (`fills`) |
| `node scripts/attack-suite.mjs` | 12 attacks, 12 reverting with the expected named error, at pinned Aurora block 277526129 | [docs/ATTACK-SUITE.md](docs/ATTACK-SUITE.md), `docs/test-evidence/attack-suite.json` |
| Open **Round 8**, read its limitations and the probe | Pool price pushed up (deviation 7 bps to 528 bps) after execution; the module's buy check would have rejected at that price; measured return 1.000105 equals the oracle-recomputed return, while a pool-marked return would have been 1.039273 | `round8/manipulation-probe.json` |
| Open **Round 2** | The +5.39% return is labelled a test-pool artifact (see below) | `round2/report.json` `limitations`, SCHEDULE.md addendum |
| Press **Connect wallet** (header) | `/rounds/live#wallet`: connect on Aurora testnet, deposit, claim and trade LONG/SHORT. Works only during a live round's forecasting window; you need test assets from the team (no faucet) | `docs/ONBOARDING-VERIFICATION.md` |
| `node scripts/judge-check.mjs` | Ten read-only checks, no key, no transaction: live reputation; signed Tidepool dry quote; funding receipts; the NEAR testnet `execute_intents` call (two archival public RPCs, each retried; if both are down it reports `amber`, "network unavailable, not a failed claim", and does not fail the run); round 1 strategy and redemptions; **rounds 2-9**: each saved `independent.json` re-checked against the engine state and every fill (`Bought`) and redemption (`Redeemed`) receipt; **round 9 TEE proofs** rechecked offline against `docs/tee-policy.json`; the **outside wallet's** approve, deposit, claimCredits and buyLong (sender, target, calldata, zero value) plus its `redeemFor` settlement; the **attack suite**, 12 attacks by `eth_call` that must each revert with their named error | script output; `summary` counts passed/failed/amber |

Round 9’s **Selected** tab shows all five final-window TWAPs from the saved `Collapsed` event in `round9/selection.json`. The evidence loader checks the engine, round, transaction/block identity, proposal coverage and strict Hold margin before showing them. These are public RPC receipt observations, not a trustless chain proof. Older rounds without captured selection evidence show averages as unavailable.

### Results: rounds on Testnet Safe v2 (Tidepool-funded)

Source: each `round<N>/report.json` (`completion`) and `reputation.json`. Return is the measured payout factor minus 1. "Point" is the outcome point recorded for the selected proposer (a Hold win scores nobody). Test assets; none of these is evidence of skill.

| Round | Selected | Measured return | Reputation point | Notes |
|---|---|---|---|---|
| 1 | 3 Momentum (75%) | -0.6458% | -1 | Funded through Tidepool; 4 genuine proposals, 4 scripted forecasters (see TIDEPOOL-DEMO.md) |
| 2 | 1 Conservative (5%) | +5.3909% | +1 | **Test-pool artifact**: about +5.40 of the points came from selling test ETH into our un-arbitraged pool above the oracle price; the market move was about -0.01% |
| 3 | 2 Balanced (45%) | +0.4565% | +1 | Pool aligned to the oracle beforehand (disclosed addendum) |
| 4 | none | none | none | **Failed and cancelled**: a public RPC read errored; `abortExpired` cancelled it and refunded all four forecasters; no reputation recorded |
| 5 | 4 HighBeta (95%) | -0.0694% | -1 | Disclosed re-run of round 4's target |
| 6 | 0 Hold | +0.2326% | none | No swap; Hold applied; the figure is the held portfolio's measured return |
| 7 | 0 Hold | +0.1216% | none | 4 genuine AI forecasters, all abstained; no swap |
| 8 | 3 Momentum (75%) | +0.0105% | +1 | Manipulation-resistance probe; point +1 for a return of about +0.01% |
| 9 | 3 Momentum (65%) | -0.0052% | -1 | Showcase round: TEE-verified proposers, 8 AI forecasters, outside wallet |

Pre-registration: [SCHEDULE.md](docs/test-evidence/tidepool-rounds/SCHEDULE.md) fixes the rounds before they ran, including the rule that a failed round is recorded as failed, not silently re-run. Disclosed changes are in its addenda:
- after round 2: pool alignment to the oracle before each later round opens (never while a round is active);
- after round 4: the failure, the renumbering, and a budget correction;
- for round 9: three failed **plan attempts** that spent paid model calls and put nothing on-chain (a hidden-reasoning model rejected by TEE verification after 3 calls; a truncated forecaster response after 7 calls; one failed forecaster after 12 calls). The proposer set was reduced from five to four models and forecaster models that failed or were too slow were replaced. A fourth plan session produced round 9.

### Round 9 showcase

- **Proposers (TEE-verified):** Conservative (Qwen3.6-35B-A3B-FP8), Balanced (Qwen3.8-27B), Momentum (DeepSeek-V4.1-Flash-1017), HighBeta (Qwen3-VL-30B-A3B-Instruct), plus Hold. Each response is bound to its on-chain proposal.
- **Forecasters:** Quant (gpt-4.1-mini), Guardian (claude-haiku-5-5), FeeAnalyst (gpt-4.1), StressAnalyst (grok-4.7), BaseRate (claude-sonnet-5), VolAnalyst (deepseek-v3.2), Regime (gemini-3.1-flash-lite), Skeptic (gemini-2.5-flash-lite). No scripted target.
- **Trade rule** (`chooseValueTrade` in `runtime/agents/policy.mjs`, rule `expected-payout-value-v1`): each forecaster states an expected return per proposal; one LONG is valued at the clamped, scaled payout of that return and one SHORT at 1 minus it; it trades only when that value beats the actual on-chain entry price by at least 3 points (`minEdgeBps` 300). Abstaining is valid.
- **Genuine AI bets** (`round9/independent.json` fills): Quant bought **LONG on Momentum** (proposal 3, the winner); VolAnalyst bought **SHORT on Conservative** (proposal 1); Regime also bought SHORT on Conservative. The other 5 abstained. Each bet was 0.1 credits.
- **Outside browser wallet:** `0xbdd8…77b3` (a throwaway test wallet, not an operator actor) used the web UI and signed its own transactions: approve 1 test USDC → deposit 1 USDC into round 9 → claim 0.1 credits on proposal 1 (Conservative) → **buy LONG** (0.1 credits). Each receipt is checked against the chain in [`round9/outside-wallet.json`](docs/test-evidence/tidepool-rounds/round9/outside-wallet.json). Conservative was not selected, so after settlement the operator's `redeemFor` (tx `0xe69ec099…82be`) returned its 1 USDC principal; the LONG position was in a non-selected world and paid nothing extra.
- **Result:** Momentum 65% won; measured -0.0052%; reputation point -1 (Momentum's cumulative: 3 scored rounds, 1 positive, 2 negative).

### Tracks this project targets

| Track | What supports it |
|---|---|
| AI Swarms (primary) | 4 proposer agents plus 8 forecaster agents on 12 different models, each with its own wallet, competing in one round; trades only on an explicit value rule; on-chain outcome reputation per proposer |
| AI Security | `docs/ATTACK-SUITE.md` (12/12 named reverts); the round 8 manipulation probe; fail-closed TEE verification with mutation tests (`scripts/test-tee-mutations.mjs`); a CALL-only Safe module with oracle and slippage checks |
| Unstoppable DeFi | Funds and rules live in contracts: Safe module, Uniswap v4 markets with a hook, permissionless oracle caches, anyone-can-settle delayed path. Our own deployment of Uniswap v4 contracts on Aurora testnet with a custom hook (WaveHook) recording the final-window TWAP. This is not an official Uniswap deployment on NEAR |
| Privacy & Private AI | Round 9 proposals ran on NEAR AI TEE models (Intel TDX + NVIDIA GPU) with signed responses checked offline. Limits: forecasters are not attested, and we do not claim privacy from the gateway |
| Open Innovation | Funding path through NEAR Intents (Tidepool testnet transfer, signed official 1Click mainnet dry quote), plus the evidence-first UI and offline verifiers |

### Honest limits

- **Test assets only.** All tokens, liquidity and the Safe's capital are worthless; returns are not alpha. The Aurora testnet stack is a single-operator rehearsal, not audited.
- **Forecasters in rounds 2, 3, 5, 6, 8 and 10 were scripted** to a pre-registered target, so those winners reflect the schedule, not forecasting skill. Round 7 had 4 genuine AI forecasters; all abstained. Only round 9 has AI-chosen trades, and its sample is 3 small bets of 0.1 credits.
- **Measured returns are tiny or pool-driven.** Round 2's +5.39% is a test-pool artifact. Rounds 3 onward were aligned to the oracle first, so their returns are near zero.
- **TEE trust basis is observed-pinned**, not independently reproduced (see above). The compose hash (mrConfigId) was **not** independently reproduced. Forecaster calls are unattested.
- **No official NEAR Intents testnet.** Tidepool is a community testnet; delivery on the official mainnet route is unproven and execution is disabled. Funding from Tidepool cannot be confused with mainnet.
- **Wallet trading is testnet-only**, needs team-supplied test assets, and works only inside a live round's forecasting window.
- **Failures are disclosed:** round 4, three round 9 plan attempts and the failed full-AI Round 10 planning attempts. The reproduced duplicate-attestation verifier bug and rotating NVIDIA-key fix are documented in [the Round 10 diagnosis](docs/test-evidence/round10-diagnosis.json) and [schedule](docs/test-evidence/tidepool-rounds/SCHEDULE.md).

## Hosted read-only version (Vercel)

The frontend works with no backend: `NEXT_PUBLIC_DATA_MODE=static`. Completed rounds load from
`frontend/public/evidence/*.json`, generated by `npm run evidence:static` with the same projection and TEE verification
as the API (`npm run evidence:static:check` fails if they are stale). Agent reputation is read live from Aurora testnet's
public RPC in the browser. Live-round trading still needs the operator's API.

## Components by evidence

| NEAR component | Wavefund use | Current evidence |
| --- | --- | --- |
| NEAR AI Cloud inference | Proposal and forecast generation, 12 models in round 9 | `round9/report.json` |
| NEAR AI hardware verification | Nonce-bound quote, NVIDIA verdict, signed response and proposal binding | Round 9 `tee.json`; `scripts/verify-tee.mjs 9` passes offline |
| NEAR Intents (Tidepool community testnet) | Cross-chain funding of the Safe | Round 1 receipts, `scripts/judge-check.mjs` |
| Aurora testnet | Safe, Uniswap v4 markets, WaveHook, oracles, reputation | `deployments/`, rounds 2-9 |
