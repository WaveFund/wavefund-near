# Genuine Aurora Safe round — 10 November 2026

**Completed:** collateralized QuantumRound selection → actual Safe/Trisolaris AMM swap → Supra-authenticated performance settlement → forecaster redemption. This was a single-operator testnet rehearsal with freely minted test assets, not independent AI coordination or real-money performance.

The [genuine manifest](../deployments/aurora-testnet.json) is separate from the earlier mock-controller experiment. A fresh engine, token factory, registry, market, hook, tracker and module were deployed. Only the generic v4 PoolManager and CREATE2 deployer were reused. Safe uses the verified 1.4.1 singleton.

## Observed money flow

| Item | Actual testnet result |
|---|---|
| Manager funding | Safe received 2,100 test USDC; explicitly supplied 100 to forecasting reserve; retained 2,000 for investment |
| Investment liquidity | Operator seeded 1,000,000 test USDC plus matching test ETH in the existing Trisolaris factory/router |
| Proposal bond | 1 test USDC, returned at collapse |
| Forecast collateral | 10 test USDC deposited separately into QuantumRound |
| Forecast trade | Claimed 10 proposal credits; spent 2 buying LONG through actual v4 pools/WaveHook |
| Selection | Proposal 1, 100% investment asset, beat Hold's final-window probability average |
| Investment execution | 2,000 test USDC → **0.953080948395546500 test ETH**, directly to the Safe |
| Settlement | Return ratio **0.997362966155925669**, or **−0.2637033844%**, including execution fees/slippage and excluding gas |
| Forecaster redemption | **9.622421 test USDC** returned from its 10-token deposit |
| Final reserve | **100.377579 test USDC**; winning seed released, zero deposits outstanding |
| Gas | 51 confirmed transactions consumed **0.00215298972 test ETH** |

Test USDC/test ETH have no redemption value and are not Circle USDC or backed ETH. Applying real prices to their quantities tests valuation plumbing; it does not make the test assets valuable. LP owner, Safe owner, proposer, forecaster and keeper were the same dedicated testnet operator.

## Receipts and checks

- [Round evidence](test-evidence/aurora-safe-round.json): all transaction hashes, publication times, return and payout.
- [Independent manager inspection](test-evidence/aurora-safe-inspection.json): code presence, Safe ownership, enabled module, contract bindings, decimals, balances and usable oracle at inspection time.
- Investment swap: `0xac0e002886b7a28a715c1423f1869ec6762dae9e8badd2dbcd79be47c33bb8af`.
- Settlement: `0xfcacc3047e1635192e658cfb8fd734b868dd35512c66c3b38cfd0a81efdfecf0`.
- Redemption: `0x3df8a15b72e12140bc6575de250e147cdbcdd083ab6e667c29a789291a3cbd47`.

The actual pair's `Swap` event names the Safe recipient. Investment input ended at zero, output matched the event, and Safe-to-router allowance ended at zero. Settlement publication **1794315315** followed evaluation end **1794315313**. This was normal measured settlement, not emergency midpoint settlement. Final reserve plus paid user collateral reconciles to the original 110 forecasting tokens.

## Oracle behavior

`SupraPortfolioOracle` accepts only verifier-authenticated ETH/USD feed **19** and USDC/USD feed **89**. It validates array shapes, positive prices, decimal scaling, millisecond timestamps, freshness, skew and ordering. `read()` rejects expired data and returns the older publication time in seconds. This deployment uses 120-second freshness and 30-second skew limits.

Public testnet REST proof retrieval required no API key. The runner normalizes bare hexadecimal and waits when publication briefly leads Aurora block time; it never relaxes onchain future-time checks. Two setup failures occurred before broadcasting an oracle update. Confirmed setup transactions were not replayed.

The Supra verifier is a proxy: publisher security, governance and service availability remain external trust assumptions. The cache expires without new proofs; no permanent updater is installed by this rehearsal.

## Runbook

Compile pinned sources in the credential-free, network-isolated Solidity container. Include `script/DeployTradingSafe.s.sol` and `script/LocalDemo.s.sol` when building `HookDeployer` and `SafeProxy` artifacts; never broadcast the local-demo script on a public chain.

The public-network Node container needs Node 22 and pinned viem. Copy the authored `scripts/` folder there without env files or wallets. The host bridge supplies the dedicated testnet key through ephemeral stdin, never a container file or command-line argument.

```sh
python3 scripts/run-aurora-safe-round.py \
  --phase deploy \
  --artifacts /absolute/path/to/compiled-out \
  --wallet secrets/aurora-testnet-wallet.json \
  --journal .run/aurora-safe/step-one.jsonl
```

Review setup and manifest, then repeat with `--phase round`. This fixed round-1 rehearsal is **not a perpetual keeper**. Do not rerun against the completed round to start round 2. After interruption, inspect the last prepared hash and receipt first; unresolved broadcasts block resume. Recovery after timed execution/settlement needs operator review, not blind retries. Journals stay Git-ignored.

## Remaining scope

Validation commands, inside the isolated environments:

```sh
python3 scripts/test-shards.py
npm run test:runtime
python3 scripts/test-aurora-bridge.py
```

Next: separately budget-approved, real multi-agent coordination through this stack. This proof adds no OutLayer, NEAR Intents, Rhea, SputnikDAO, TEE attestation or production audit. Investment execution uses Trisolaris; forecasting uses self-deployed Uniswap v4 code, not an official Aurora Uniswap deployment.
