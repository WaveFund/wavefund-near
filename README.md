# Wavefund NEAR — trading Safe contracts v1

**Team starting point:** [Engineer handoff, current blockers and verified evidence](docs/ENGINEER-HANDOFF.md).

Solidity implementation targeting Aurora testnet (chain 1313161555). A [genuine public Safe round](docs/AURORA-SAFE-ROUND.md) completed v4 forecasting, an actual Trisolaris swap, Supra-authenticated settlement and forecaster redemption. This is a single-operator rehearsal with freely minted test assets, not an audited or production-approved deployment.

Supra supplies authenticated public-testnet observations without a gateway key. [RedStone access](docs/REDSTONE-PROOF.md) remains an alternative, not a blocker for the completed round. Current checks: **419 Solidity tests, 45 Node tests and 2 Python safety tests passed**, with zero failures or skips.

[Local full-stack demo](docs/LOCAL-DEMO.md): real local Safe/v4 transactions, a Node orchestration API and a Next.js dashboard. Run `npm run demo:local` after isolated dependency setup. Prices and agents are explicitly simulated.

[Agent layer and private key setup](docs/AGENT-LAYER.md): model proposals, independent forecasts, entry-quote and budget checks. Provider HTTP integration is tested with mocks, and one approved real NEAR AI smoke request passed. Complete live strategy inference remains pending.

[Manager console, research collector, receipt recovery and Aurora monitoring](docs/OPERATOR-WORKFLOWS.md). Local manager console: `http://127.0.0.1:3000/manager`. Public network monitoring is read-only and requires a real verified deployment manifest.

## Model

Manager-owned Safe assets are independent of forecaster escrow. A manager authorizes exact round timing, payout bounds and averaging window. Forecasters trade conditional claims; the selected allocation executes through a CALL-only module. Proposal 0 means Hold actual quantities. Other proposals specify the investment asset weight in basis points. All eligible Safe capital is available, with no extra mandatory 50% cap.

One instance supports one Safe, a six-decimal stablecoin, an eighteen-decimal investment asset, a fixed direct-pair router and immutable price source. Independently settling Safes require independent collateral and seed. No WAVE share token is issued.

## Start

Requirements: Python 3.12+; Foundry 1.5.1 or compatible; Solidity 0.8.26. Fetch source archives without running dependency scripts:

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

Uniswap v4 pools and WaveHook serve forecasting LONG/SHORT claims. The Safe module reads the canonical winner and calls a fixed exact-input investment router with oracle/slippage and balance checks. The local demo retains its prefunded fixture. The public testnet stack uses the existing Trisolaris router with our self-seeded test-token pair; an actual Safe swap is verified.

Managers supply their own investment capital. Forecasters supply separate collateral. A customer, protocol or sponsor must explicitly supply forecasting seed liquidity; that seed can lose money funding rewards and is not the manager's investment return. Operating costs also include transaction gas, model inference, data access and hosting. The demo's $2,000 capital/$100 sponsor reserve are fixtures, not production minimums.
