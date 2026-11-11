# What Wavefund's agents actually know

## Sources and checks

| Input | Source | What it supports / does not establish |
|---|---|---|
| Completed five-minute ETH/USD candle closes, approximately one hour | Coinbase Exchange candles | Observed return, maximum drawdown and largest step; excludes unfinished candles and future evaluation prices |
| Latest ETH/USD trade | Coinbase Exchange ticker | Timestamp checked; a last trade is not an executable Aurora quote |
| USDC/USD spot | Coinbase price API | Observed stablecoin deviation; no publisher timestamp is supplied |
| ETH/USD 24-hour open, high, low, last and ETH volume | Coinbase Exchange statistics | Longer market context; retrieval timestamp only |
| Best bid/ask and spread | Coinbase level-one orderbook | Timestamp checked when supplied; CEX spread is not Trisolaris slippage or pool depth |
| Independent ETH/USD last trade and 24-hour ETH volume | Kraken ticker | Cross-exchange comparison; retrieval time only, not a quorum or authenticated oracle |
| Stable/asset quantities and current weight | Testnet Safe balance reads and verified prices | Current test portfolio; tokens are mintable fixtures, not backed investment assets |
| Exposure intervals | Explicit operator-assigned strategy mandates | Controlled strategy diversity, not discoveries that an allocation is optimal |
| Turnover and approximate 30 bps swap-fee arithmetic | Deterministic policy helpers | Reference cost model; gas and actual slippage remain unknown until venue simulation |

Raw price schemas/ranges are validated. Missing or malformed optional inputs are
labelled unavailable, never zero. Research snapshots expire after five minutes.
Every enriched observation includes its URL and retrieval/publication-time meaning.
Input integrity hashes detect later changes; hashes do not authenticate an exchange.

API references:
- [Coinbase statistics](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-stats)
- [Coinbase orderbook](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-book)
- [Kraken ticker](https://docs.kraken.com/api-reference/market-data/get-ticker-information)

## Who forms the thesis?

Four separately prompted calls to the **same** NEAR AI model choose weights within
declared Conservative, Balanced, Momentum and HighBeta exposure mandates. They
receive the same source facts, portfolio and policy; they produce short rationales,
risks, confidence and evidence IDs. The manager supplies the risk mandate. The model
supplies a recommendation within it. It is not autonomous news research or four
independent model families. A rationale is model output, not a verified causal proof.

The hybrid test records each literal system prompt and public context in
`records[].input`, with input/output hashes. No wallet key or future settlement
price is sent to the model. Existing historical agent digest formatting is unchanged.

## Forecasters and this test

The ordinary live forecasters are separately prompted Quant and Guardian calls.
They estimate net returns for every proposal; the deterministic trader checks their
confidence and actual v4 entry prices. Round 6 completed with genuine abstention.

**The hybrid execution test uses four scripted forecasters.** Their preset views
and confidence deliberately exercise LONG/SHORT trading and non-Hold selection.
Those numbers are not AI-generated forecasts or theses derived from the sources.
They receive the research context for a reproducible trace, but their decisions are
fixtures. The saved plan labels their provider `test-fixture`, separately from the
four `near-ai` proposer records. Do not describe this as unbiased AI-market consensus.

## What is reliable enough to claim?

This is a defensible, reproducible hackathon integration demo. It is **not evidence
of reliable investment performance**. A three-minute evaluation is a compressed
test lifecycle; hour/day observations do not establish a predictable three-minute
return. Model confidence is uncalibrated, and an LLM can overstate what its sources
prove. An actual Aurora quote can still fail the unchanged slippage guard even when
two exchanges agree on ETH/USD. The testnet investment pool is operator-seeded.

Settlement uses verified Supra oracle data and onchain accounting, never the LLM's
forecast, research API responses, or scripted expected returns. A product-level
performance claim would need held-out historical/live evaluation, forecast
calibration, comparisons with simple baselines, realistic liquidity/costs and
independent security review. None is established by this integration test alone.
