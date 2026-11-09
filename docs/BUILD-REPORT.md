# Contracts v1 — build and verification report

9 November 2026. New local repository, branch `feat/trading-safe-v1`. No remote configured; original Wavefund repository unchanged.

## Outcome

**370 Foundry tests passed, zero failed, zero skipped, across all 22 test files.** This includes 256-run fuzz tests, registry invariants at 64 runs × 32 calls and market invariants at 128 runs × 50 calls. The invariant logs show zero unexpected reverts. A separate clean-cache deployment check passed 5 tests. Three targeted source mutants were caught, and the original Safe test baseline returned green after restoration.

This is a local contract prototype targeting Aurora testnet, not a public deployment, audit or verified live integration.

## Implemented

- Manager-owned Safe 1.4.1 execution with fixed assets, router, oracle, engine and tracker; no arbitrary-call/delegatecall interface.
- Owner authorization commits round ID, dates, execution deadline, payout bounds and averaging window. Full eligible capital is available.
- Frozen pre-execution quantities; canonical winner only; Hold retains quantities after price drift.
- Exact-input two-token investment trades; oracle-derived output floor, strict recipient, limited approvals, zero residual allowance and balance postconditions.
- Actual posttrade holdings recorded; USD entry/end valuation includes execution costs and stablecoin depeg, independent of later custody movements.
- Validated feed-format and DIA-format adapters. No arbitrary keeper-supplied performance return.
- Cancellation only before execution after its deadline; executed rounds cannot cancel. Existing delayed midpoint emergency settlement retained and disclosed.
- Deployment role sealing: only engine can control conditional token supply and proposer bonds; neither manager nor setup operator retains factory/registry admin privileges.
- Genuine CREATE2 hook-address mining; complete wiring, Safe engine administration, seed unfunded and module disabled until owner action.

## Reused and changed

Five production files are byte-for-byte identical to upstream commit `8629c21f2c7b93591afbf27c2a858a9008f9350e`: ProposalToken, ProposalTokens, ProposerRegistry, WaveHook and WaveV4ProposalMarket. Their root MIT notice is retained; dependency per-file licenses still apply.

QuantumRound is adapted to immutable module/tracker identity, exact policy preparation, execution deadline and unexecuted-settlement rejection. Additional review fixed emergency midpoint overflow and seed-depth changes during Trading. The WaveBase test fixture loads compiled artifacts instead of embedding repeated large creation code. Old pooled vault/WAVE-share code is not included.

New code: TradingSafeModule, PerformanceTracker, oracle adapters, deployment recipe, shared interfaces and integration tests. Build-only vendor roots produce the actual Safe and external v4 artifacts; they are not part of the deployed money stack.

## Verification environment and evidence

Foundry 1.5.1, Solidity 0.8.26, Cancun, optimizer 200 and viaIR. Upstream Safe 1.4.1 is compiled with a separate non-IR profile because the combined IR build exposes a Yul stack-depth error. No vendor Safe code was modified. Tests deploy its actual compiled source and SafeProxy, and actual v4 PoolManager/hook/market code. Investment router and prices are explicit fixtures.

The local Docker environment has network disabled, dropped capabilities, no host credentials and a scratch work volume. The combined compile exceeded its memory limit; every suite was then executed separately with sparse output selection and the same production compiler settings. No fuzz/invariant settings were reduced. The checked-in runner rejects missing summaries, failures, zero executed tests or skipped tests.

- [Machine-readable summary](test-evidence/summary.json)
- [Clean-cache deployment run](test-evidence/wayfund-clean-build.log)
- [Safe end-to-end run](test-evidence/SafeEndToEnd.t.log)
- [Round accounting and lifecycle](test-evidence/RoundIntegration.t.log)
- [Safe module tests](test-evidence/SafeModule.t.log)
- [Oracle and performance tests](test-evidence/OracleTracker.t.log)
- [Authorization mutant](test-evidence/wayfund-mutant-only-safe.log): removing Safe-only policy authorization causes the expected-revert assertion to fail.
- [Hold mutant](test-evidence/wayfund-mutant-hold-drift.log): reintroducing rebalance during Hold produces the wrong balance (1500000000 versus 1000000000).
- [Slippage mutant](test-evidence/wayfund-mutant-oracle-floor.log): removing the oracle floor causes the expected-revert assertion to fail.
- [Restored baseline](test-evidence/wayfund-mutation-restored.log)

The source dependency-fetch script was also run from an empty scratch directory: all seven checksum-pinned archives restored successfully, with core source bytes matching this workspace.

## Compiled runtime sizes

All production contracts below satisfy the standard 24,576-byte EVM runtime-size ceiling ([EIP-170](https://eips.ethereum.org/EIPS/eip-170)). This does not prove Aurora transaction gas compatibility.

| Contract | Runtime bytes |
|---|---:|
| QuantumRound | 21177 |
| TradingSafeModule | 12175 |
| PerformanceTracker | 3409 |
| WaveHook | 7984 |
| WaveV4ProposalMarket | 20246 |
| ProposalToken | 3454 |
| ProposalTokens | 4229 |
| ProposerRegistry | 5300 |
| FeedPortfolioOracle | 1284 |
| DiaPortfolioOracle | 1666 |

## Deployment gates and remaining assumptions

1. A maintained authentic oracle is still required. The documented DIA testnet feed failed freshness checks; the generic AggregatorV3 adapter does not prove Chainlink availability on Aurora. Signed RedStone integration is not implemented or claimed.
2. Actual Aurora deployment, CREATE2 hook flow, underlying gas limits, authentic investment tokens/pair and real Safe swap/fill remain public-testnet proof gates. Local v4 success and earlier opcode probes are separate evidence.
3. Settlement is the first valid post-deadline observation inside a fixed window, not an exact historical timestamp proof. Price-provider privileges and keeper timing remain relevant.
4. Post-execution valuation is strategy performance, not the Safe's later account NAV after withdrawals/donations. Cancellation refunds original depositors; transferred outcome-token holders do not receive an additional cancellation refund.
5. Forecast participation, seed economics and thin-market manipulation remain product risks. The contracts provide no guaranteed investment performance. Native Rust, frontend, backend/AI agents and cross-chain execution are outside this contracts-only version.

No source code from untrusted repositories was executed on the host. Only trusted formatting and our source-fetch/orchestration utilities ran there; all Solidity execution occurred in the isolated local container. No funds, public transaction, hosted publication, external message or Git push was used.
