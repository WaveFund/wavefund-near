# Deliberate product testing — 10 November 2026

## Published source boundary — 11 November

The contract scenarios, planner modules and independent read-only verifier are included in this branch. The expanded `scripts/aurora-agent-round.mjs`, `scripts/run-aurora-agents.py` and related bridge-test edits remain **local and unpublished** pending a completed live-agent lifecycle. Commands below describe that local experiment; the published runner still has its preceding interface. The 8-Python-test result describes the local tested workspace, including two unpublished safety additions. These reports preserve both successful fixture execution and the failed model experiment; they do not claim the full runner is ready to adopt.

## Result and scope

The collateral, market, execution and redemption paths now have a deliberate multi-participant rehearsal. Public Aurora **round 3 completed** with four scripted proposers and four scripted forecasters: genuine Uniswap v4 forecasting trades, genuine Safe execution through Trisolaris, authenticated Supra settlement and independently recomputed payouts.

**These participants were fixtures, not real AI or humans.** A separate eight-call NEAR AI experiment (round 4) failed operationally during proposal submission; it is not a successful live-agent round. No qualifying live-model trade has been demonstrated. Earlier round 2 remains the completed real-model abstention experiment.

## Public round 3: deterministic branch coverage

| Item | Observed |
|---|---|
| Proposals | Hold quantities; 10%, 45%, 75%, 95% investment-asset weights |
| Forecast activity | Quant LONG proposal 2 (0.4 test USDC), Guardian SHORT proposal 2 (0.1), FeeAnalyst SHORT proposal 1 (0.1), StressAnalyst LONG proposal 3 (0.1) |
| Winner | Proposal 2, 45% investment asset |
| Actual Safe fill | Sold 0.524194521617550575 test ETH for 1,094.400091 test USDC |
| Execution transaction | `0x6b733e809d96591f554ef9d420f816ddd4448fc688d2d267d2abbd99256e04c3` |
| Measured portfolio return | +1.5406020821% over the test observation period |
| Quant / Guardian payout | 10.103195 / 9.973957 test USDC from 10 each |
| Other two forecasters | 10 each, through unclaimed winning-world principal |
| Ending sponsor reserve | 100.300427 test USDC |
| Closed liabilities | Seed released, zero outstanding deposits, collateral conserved |

The mintable test tokens have no economic value. The investment AMM is operator-seeded and its ratio can diverge from the external ETH oracle. The reported gain can include that artificial price difference: it does **not** demonstrate alpha, profitable AI or organic liquidity.

Sixteen public **read-only contract simulations** rejected the named expected errors: unauthorized keeper, execution before collapse, four overclaims, four impossible minimum-output trades, duplicate execution, premature settlement and four double redemptions. They did not broadcast deliberately reverting transactions.

An independent reader reconstructs each payout from historical winning-world balances, claimed principal and settlement probability, then compares actual Redeemed events. It also checks Bought events against decisions, recalculates portfolio return and reconciles collateral. It does not use previewRedeem as its expected payout.

Evidence: [round 3 report](test-evidence/product-scenarios/round3-fixture.json), [independent reconciliation](test-evidence/product-scenarios/round3-independent.json).

## Separate real-model experiment: round 4

Exactly eight approved calls: four proposer mandates and four separately prompted forecasters, all using Qwen/Qwen3.6-35B-A3B-FP8 through NEAR AI. No retry, substitute response or manufactured confidence.

| Agent | Model allocation / maximum forecast confidence |
|---|---|
| Conservative | 5% asset |
| Balanced | 44.3% asset, matching snapshot Hold weight |
| Momentum | 75% asset |
| HighBeta | 95% asset |
| Quant | 30% maximum confidence |
| Guardian | 20% maximum confidence |
| FeeAnalyst | 1% maximum confidence |
| StressAnalyst | 30% maximum confidence |

Mandate bands intentionally produce distinct candidate allocations; this is constrained strategy generation, not independent discovery of four optimal strategies. Forecasters receive anonymous allocations, not proposer names. A candidate may match Hold's snapshot weight: it is still a target rebalance, while Hold preserves quantities. We reject duplicate challenger weights, not all semantic overlap with Hold.

All forecaster confidences were below the unchanged 50% gate. The plan therefore would abstain, but **the on-chain forecast stage was never reached**: an HTTP RPC failure occurred while estimating HighBeta's proposal. The first three proposals were confirmed; no HighBeta broadcast or forecasting deposit/trade was recorded. Do not relabel saved forecasts as executed bets.

Token usage: 9,663 input / 2,972 output. At the checked catalog rates ($0.17/$1.10 per million), estimated cost **$0.00491191**; not an independent billing receipt. All eight approved requests are consumed; another inference experiment requires a new budget.

Model quality finding: Quant, Guardian and StressAnalyst sometimes overstate ~8–15 basis-point turnover fees as hundreds/thousands of basis points in predicted returns. Schema validity does not prove economic correctness. FeeAnalyst used the order of magnitude more plausibly, but its confidence was still low. No output was rewritten to conceal this. Before another live experiment, add explicit arithmetic examples, deterministic fee accounting and a reviewed plausibility gate; do not lower confidence gates simply to cause bets.

Evidence: [round 4 public model records and operational journal](test-evidence/product-scenarios/round4-model.json). [Independent recovery verification](test-evidence/product-scenarios/round4-independent.json) confirmed cancellation after expiry in transaction `0xe5e9352679851913727c87173f6812089b5cfe8dafea8f126db977e726736fc9`: seed released, zero deposits outstanding, and Safe quantities unchanged at 1,094.400091 test USDC / 0.428886426777995925 test ETH.

## Contract scenarios and regressions

All **432 Solidity test executions across 27 files passed** (zero failed/skipped). The new ProductScenarios suite contributes eight new product scenarios plus five inherited executions, so the increase from 419 is not thirteen new independent scenarios.

| New scenario | Discriminating checks |
|---|---|
| Interior gain and interior loss | Both winning-world LONG/SHORT, independently derived payouts, exact conservation |
| Above +5% / below -5% | Correct saturation to LONG / SHORT respectively |
| Asset-to-stable rebalance | Selected quarter-weight strategy actually sells held asset through the test router |
| Failed execution | Named slippage revert, atomic balances/approvals, expiry cancellation, par redemption |
| Early oracle publication | Named rejection then fresh post-deadline recovery |
| Per-world credit accounting | Separate world entitlement; spent credits do not permit lifetime overclaim |

Local tests use the genuine Safe/v4/module/engine/tracker, but fixture prices and a minting fixed-price investment router. Actual investment-venue evidence is the separate public round.

**60 Node tests and 8 Python bridge safety tests passed** in network-disabled containers. Recovery/fixture controls include no paid-call replay, unresolved broadcasts blocking all phases, exclusive operator locks and explicit live/fixture provenance.

A real orchestration bug was fixed: token quantities are the custody invariant, not marked allocation weight. Price moves can change a mixed portfolio's weight without anyone moving funds. A regression accepts 50% → 50.73% weight drift with identical quantities and rejects a one-unit custody change. Frozen on-chain preparation quantities are checked again before deposits.

Mutation checks used disposable container copies only:

- Reverse LONG/SHORT payout polarity in both preview and redemption: seven product cases fail; restored eight pass.
- Reintroduce marked-weight equality as a custody guard: regression fails; restored seven expanded-planner tests pass.

Logs: [Solidity suites](test-evidence/product-scenarios/solidity/), [runtime](test-evidence/product-scenarios/runtime.log), [mutations](test-evidence/product-scenarios/mutations/summary.json).

## Operator workflow and remaining gates

The expanded profile is `--profile diverse`; fixture generation also requires `--scenario fixture`. Planning fixtures reads no model key. Live planning requires explicit `--run-inference` and current permission. Use a new session directory, prepare actors, snapshot, plan, then run. Never rerun a started timed round as a new run.

For an interrupted **unexecuted** journaled round, `--phase recover-cancel` waits for trading end, collapses, waits past the committed execution deadline, then invokes abortExpired and redeems recorded deposits. It refuses unresolved broadcasts and executed rounds. It verifies unchanged Safe quantities and cleared liabilities. It does not retry inference or make a missed strategy execute late.

Still needed before claiming final-product readiness: robust resumable operator state machine, production liquidity/slippage evaluation, calibrated numerical forecasts, independent human testing, frontend integration by its owning developer, oracle availability monitoring and independent security review. No model attestation, native NEAR Intents, OutLayer, persistent oracle updater or multi-model independence was added.
