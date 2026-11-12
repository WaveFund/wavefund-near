# Wavefund NEAR — trading Safe contracts v1

**Team starting point:** [Engineer handoff, current blockers and verified evidence](docs/ENGINEER-HANDOFF.md).

**Live NEAR verification, no wallet or AI key:** after installing locked dependencies,
run `node scripts/judge-check.mjs`. It checks live reputation, signed dry quotes,
actual Tidepool funding receipts and final NEAR testnet `execute_intents`.
See [the separate testnet flow and exact scope](docs/TIDEPOOL-DEMO.md).

Solidity implementation targeting Aurora testnet (chain 1313161555). A [genuine public Safe round](docs/AURORA-SAFE-ROUND.md) completed v4 forecasting, an actual Trisolaris swap, Supra-authenticated settlement and forecaster redemption. This is a single-operator rehearsal with freely minted test assets, not an audited or production-approved deployment.

Supra supplies authenticated public-testnet observations without a gateway key. [RedStone access](docs/REDSTONE-PROOF.md) remains an alternative, not a blocker for the completed round. Latest runtime verification: **184 Node tests passed**; the existing six Python bridge tests remain prior evidence and the three new Tidepool bridge tests pass separately. The additive reputation tests also pass against real local settlement contracts. The full isolated Solidity regression passed **451 executions across 29 suites**. See [deliberate product testing](docs/PRODUCT-TESTING.md) for scripted LONG/SHORT coverage, real-model limitations and recovery evidence.

[Local full-stack demo](docs/LOCAL-DEMO.md): real local Safe/v4 transactions, a Node orchestration API and a Next.js dashboard. Run `npm run demo:local` after isolated dependency setup. Prices and agents are explicitly simulated.

[Agent layer and private key setup](docs/AGENT-LAYER.md): model proposals, independent forecasts, entry-quote and budget checks. Four approved real NEAR AI calls completed a [public agent round](docs/AURORA-AGENTS.md). Both forecasters abstained under the confidence gate; Hold settled normally. A live model-directed forecasting trade remains unverified.

[Manager console, research collector, receipt recovery and Aurora monitoring](docs/OPERATOR-WORKFLOWS.md). Local owner tools: `http://127.0.0.1:3000/advanced`. Public network monitoring is read-only and requires a real verified deployment manifest.

## Model

Manager-owned Safe assets are independent of forecaster escrow. A manager authorizes exact round timing, payout bounds and averaging window. Forecasters trade conditional claims; the selected allocation executes through a CALL-only module. Proposal 0 means Hold actual quantities. Other proposals specify the investment asset weight in basis points. All eligible Safe capital is available, with no extra mandatory 50% cap.

One instance supports one Safe, a six-decimal stablecoin, an eighteen-decimal investment asset, a fixed direct-pair router and immutable price source. Independently settling Safes require independent collateral and seed. No WAVE share token is issued.

## Judge quickstart: do this, see this

### Fastest path: one command (Docker)

Requirements: a running Docker plus `bash`, `git`, `rsync` and `curl`. No wallet, API key or `.env` file is needed. Startup sends no public-network transactions and makes no paid model calls.

1. Run `bash scripts/docker-demo/up.sh`. The first run takes a few minutes; then open http://127.0.0.1:3000.
2. Open **Rounds → Local simulation** (`/rounds/local`) and press **Run local simulation**. The workspace follows the round live, one stage at a time, through seven steps: funded, proposals, LONG/SHORT forecasting, selection, Safe execution, evaluation and redemption, on a local Anvil chain. This is a **fixture round**: simulated prices and agents, real local contract transactions.
3. On the welcome page press **Explore a round** (or **Rounds → Round 1 · Tidepool testnet stack**). It opens on the **Result** recap; **Replay journey** steps through each stage. You'll see:
   - Arbitrum Sepolia test USDC → Tidepool → NEAR testnet settlement → the Aurora testnet Safe (200 sent, 199.48 delivered);
   - four genuine AI proposals and four **scripted** forecaster trades, with Momentum's 75% test ETH selected;
   - the actual Safe swap, a measured −0.6458% return, the forecaster redemptions and the −1 outcome point.
   All of it is saved, independently verified evidence with explorer links. In the **Funded** stage, **View transfer → Re-verify receipts now** re-reads the public receipts.
4. On **Agents**, you'll see separate outcome-reputation histories for the original and Tidepool stacks, read live from Aurora testnet. They are never summed.
5. Optional: on **Portfolio → Funding → Funding preview** (`/portfolio/fund`), press **Get quote** for a signed official 1Click **mainnet** dry quote. Delivery is unproven and execution disabled.
6. Run `node scripts/judge-check.mjs` (see the top of this README). It is read-only, needs internet, starts no round, makes no paid model call, and signs or moves nothing.

Stop with `bash scripts/docker-demo/down.sh`. Use `up.sh --fresh` for a new local chain. Details and which panel is fixture, saved evidence or fresh read: [docs/INTENTS-DASHBOARD.md](docs/INTENTS-DASHBOARD.md#judge-path).

### Manual path

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

   Expected current runtime result: 184 Node tests and 6 Python tests pass. The Solidity verification command is below; its current result is 451 executions across 29 suites.

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

The separate [Tidepool testnet happy path](docs/TIDEPOOL-DEMO.md) completed cross-chain funding, four genuine AI proposals, scripted forecast trades, an actual Safe investment swap, authenticated settlement, redemptions and outcome scoring. It is community testnet execution with worthless tokens, not official mainnet 1Click delivery.
