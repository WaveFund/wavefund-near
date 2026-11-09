# RedStone oracle proof — 9 November 2026

**Implemented and tested locally. Fresh live-feed delivery remains blocked on gateway access.** No public deployment, wallet signature, real funds, API-key use or paid request occurred.

## What is proved

| Check | Result |
|---|---|
| Complete contract regression | 391 passed, 0 failed, 0 skipped across 23 files |
| New oracle tests | 21 passed |
| Authentic production signatures |Historical USDC/ETH capture accepted by real upstream 3-of-5 signer policy |
| Aurora testnet and mainnet |Six unsigned eth_call checks passed: authentic diagnostic, tamper rejection and production stale-data rejection on each network |
| Mutation verification |Removing update freshness, removing replay protection, or reducing quorum to 2 each caused its regression test to fail; restored 21-test baseline green |
| New consumer runtime |3,783 bytes |
| Current signed price delivery |NOT proved; exact current SDK endpoint returned 403 without authentication and user has no key yet |

[Regression summary](test-evidence/redstone-summary.json) · [Oracle tests](test-evidence/redstone-regression/RedstoneOracle.t.log) · [Aurora RPC evidence](test-evidence/redstone-aurora-readonly.json) · [Gateway evidence](test-evidence/redstone-gateway-status.json)

## Integration

```text
Gateway signed packages → anyone calls oracle.update() with appended payload
                       → production signer quorum, equal timestamps, age and replay validation
                       → verified USDC/ETH prices stored briefly
                       → existing Safe module / tracker call oracle.read()
```

RedstonePortfolioOracle implements the existing IPortfolioOracle interface. Neither TradingSafeModule nor PerformanceTracker requires a calldata-forwarding change. At deployment, bind this consumer as PORTFOLIO_ORACLE; existing instances have immutable bindings and cannot silently switch oracle.

The consumer fixes feed IDs to USDC/USD and ETH/USD. It is for a matching USDC/ETH investment pair, not arbitrary ERC-20 prices. Primary-prod signer addresses/quorum come from official source pinned at `e1c20caab6ad4652b06e37a89284c9f52a29ad7d`. Source/checksum are recorded in dependency-pins.json; vendor code and licenses are preserved. No handwritten Solidity signature decoder was substituted.

Three distinct authorized signers are required **for each feed**. JSON signer labels and isSignatureValid flags are never trusted. Numeric prices normalize from eight to 18 decimals. Packages must share a timestamp, be nonzero and fresh, and increase the last accepted millisecond timestamp. Reads also fail when the cache expires. Constructor maxAge is bounded to 1–300 seconds; the proof uses 60. Anyone may relay valid data, but there is no owner method to set prices or alter the production signer policy.

The existing tracker was tested settling from this verified cache: entry portfolio worth 2000 USD, one recorded ETH worth 2100 USD at evaluation, measured return 1.05. That integration uses explicitly local signer keys; authenticity under the actual production signer set is covered separately by the real historical capture. The original real-Safe/v4 end-to-end tests also remain green. A full public testnet cycle with current signed prices has NOT run.

## Reproduce locally

Inside the isolated development environment, after dependency restoration:

```sh
forge test --match-path test/RedstoneOracle.t.sol
python3 scripts/redstone-payload.py test/fixtures/redstone-primary-historical.json /tmp/historical.bin
```

The upstream historical fixture contains signatures from 2024. Its test freezes local time explicitly; the production contract rejects that same fixture at current time. Test-only LocalSignerOracle and RedstoneSignatureProbe are not production deployment components.

After compiling the test artifacts, unsigned RPC proof can be repeated with:

```sh
python3 scripts/redstone-aurora-probe.py /tmp/aurora-oracle-proof.json
```

This script uses ephemeral state overrides, not a deployment. The diagnostic probe intentionally checks authenticity WITHOUT freshness so historical signatures can exercise Aurora's cryptographic path. The production adapter is probed separately and must reject stale data. Runtime immutable maxAge is patched to 60 only in the temporary override; no chain storage persists.

## Fresh-data gate

The pinned official SDK uses `x-api-key` and:

```text
https://oracle-gateway.a.redstone.finance/v2/data-packages/latest-by-data-feeds/redstone-primary-prod?dataFeedIds=ETH%2CUSDC
```

Once gateway access exists, configure REDSTONE_GATEWAY_API_KEY privately in the local server environment, never in chat, Git or NEXT_PUBLIC variables. Then:

```sh
python3 scripts/redstone-fetch.py /tmp/current-redstone.json
python3 scripts/redstone-payload.py /tmp/current-redstone.json /tmp/current-redstone.bin
```

Fetch/encode utilities do not broadcast. They select a common ETH/USDC timestamp with at least three candidate packages per feed and deduplicate package signatures. This is a client convenience; onchain validation remains authoritative. Missing key, old data or missing common snapshot fails closed. Historical fixtures are not fallback data.

Before calling the integration live, execute the production consumer against this current payload at the actual chain time, prove the accepted signer quorum and freshness, and recheck public Aurora deployment/gas limits plus real trading-pool execution. API access or a successful HTTP response alone is insufficient. No gateway key was available during this proof.

## Unchanged limitations

The cache authenticates published prices; it does not eliminate provider/signing-key risk, authenticate arbitrary token/feed mappings or turn the tracker's bounded latest-observation policy into an exact historical-price oracle. Owner custody interventions are still measured as the recorded strategy rather than later Safe NAV. Public deployment, investment venue liquidity and the AI/backend/frontend build remain separate work.

Sources: [official RedStone verifier](https://github.com/redstone-finance/redstone-oracles-monorepo/tree/e1c20caab6ad4652b06e37a89284c9f52a29ad7d/packages/evm-connector/contracts), [SDK gateway configuration](https://github.com/redstone-finance/redstone-oracles-monorepo/blob/e1c20caab6ad4652b06e37a89284c9f52a29ad7d/packages/sdk/src/data-services-urls.ts), [SDK request construction](https://github.com/redstone-finance/redstone-oracles-monorepo/blob/e1c20caab6ad4652b06e37a89284c9f52a29ad7d/packages/sdk/src/fetch-data-packages.ts).
