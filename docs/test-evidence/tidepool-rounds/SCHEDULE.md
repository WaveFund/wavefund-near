# Pre-registered round schedule — Tidepool testnet stack

Written and committed **before** any of these rounds ran (see this file's git commit time).
It fixes, in advance, which proposal the four **scripted** forecasters back in each round.
Selection is therefore driven by this schedule, not by forecasting skill. The proposals stay genuine
NEAR AI calls, and the swaps, oracle prices, measured returns, payouts and reputation are real
contract results on Aurora testnet with test assets.

Stack: `deployments/aurora-testnet-tidepool.json` (Safe `0x37947266fc1c2b20ffa36869af5dd531f2d80f11`).
Round 1 is the completed Tidepool happy path (Momentum, −0.6458%, −1) and is not repeated.

| Round | Scripted forecasters back | Evaluation window | Purpose |
|---|---|---|---|
| 2 | 1 · Conservative (0% test ETH) | 30 min | Sell ETH to cash; near-flat outcome expected |
| 3 | 2 · Balanced (40%) | 30 min | Second agent scored |
| 4 | 4 · HighBeta (95%) | 30 min | Highest ETH exposure |
| 5 | 0 · Hold | 30 min | Hold applied, no swap, no reputation score |
| 6 | 3 · Momentum (75%) | 30 min | Momentum's second sample on this stack |
| 7 | none · genuine AI forecasters (8 calls) | 30 min | Real AI forecasting attempt; abstaining is a valid result |
| 8 | 3 · Momentum (75%) + manipulation-resistance probe | 30 min | Operator pumps the pool price after execution; the measured return must still follow the oracle |

Rules fixed in advance:
- No change to the oracle, pool policy, confidence gates or slippage limits to force an outcome.
- A round that fails is recorded as failed; it is not silently re-run.
- Positive, negative and flat outcomes are all reported as measured.
- Paid model calls: at most 4 per scripted round and 8 for round 7 (28 total), cap USD 0.50.
