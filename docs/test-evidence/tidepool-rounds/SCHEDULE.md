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

## Addendum after round 2 (written before round 3 ran)

Round 2 (Conservative, 5% test ETH) measured **+5.39%**, but almost all of it came from our test pool, not
the market. The investment pool is a private test pool with no arbitrage traders, so it still priced test ETH
near its seeding level (~2074.6 USDC) while the Supra oracle had real ETH at ~1922.4. Selling 0.0668 test ETH
into it paid ~7.9% above the oracle; the market move over the 30-minute window was about −0.5% on ETH, i.e.
roughly −0.03% on the 5% ETH that remained. Round 2's result is published with this explanation.

From round 3 on, one disclosed maintenance step is added **before each round opens**: the operator aligns the
test pool to the authenticated oracle price, the way an arbitrage trader would on a public market (minting
test ETH or using test USDC, within 0.25% of the oracle). It never runs while a round is active, and it does
not change the schedule, the oracle, slippage limits or confidence gates.

## Addendum after round 4 (written before round 5 ran)

Round 4 (scripted target 4 · HighBeta) **failed**: a public Aurora testnet RPC request errored while the
operator waited for trading to close, and the runner stopped before selection/execution. Following the rule
above it was not resumed silently: the existing recovery phase collapsed it, cancelled it after the execution
deadline (`abortExpired`, tx `0xbe011db1242d61d4d962de0b81d03ddb18d8c1b23cfa56ac316c05b2660086ec`) and refunded
all four forecasters; the Safe's balances were identical before and after. No reputation is recorded.
The runner now retries idempotent reads (never broadcasts).

Remaining schedule, renumbered and otherwise unchanged:

| Round | Scripted forecasters back | Purpose |
|---|---|---|
| 5 | 4 · HighBeta (95%) | Disclosed re-run of the failed round 4 target |
| 6 | 0 · Hold | Hold applied, no swap, no reputation score |
| 7 | 3 · Momentum (75%) | Momentum's second sample |
| 8 | none · genuine AI forecasters | Real AI forecasting attempt |
| 9 | 3 · Momentum (75%) + manipulation-resistance probe | Measured return must follow the oracle |

**Budget correction (same day, before round 5 ran):** the round-4 re-run costs four extra model calls, which
would exceed the 28-call approval. The standalone Momentum round is dropped; the probe round still gives
Momentum its second sample. Final order: **5 HighBeta (re-run) · 6 Hold · 7 genuine AI forecasters (8 calls)
· 8 Momentum + manipulation-resistance probe.** Total model calls: 28.

## Round 9 — pre-registered showcase (written before it ran, 2026-11-13)

- Profile `swarm2`: 5 genuine AI proposers on 5 different NEAR-hosted models, each call **TEE-verified**
  (`--tee`, policy `docs/tee-policy.json`, trust basis observed-pinned) and bound to its on-chain proposal; plus Hold.
- 8 genuine AI forecasters on 8 different models (6 families). **No scripted target.** Each forecaster states an
  expected return per proposal; it trades only when the implied LONG/SHORT value beats the on-chain quote by
  ≥ 3 points (`chooseValueTrade`, `minEdgeBps` 300). Abstaining is a valid outcome.
- One outside wallet (not an operator actor) buys **0.1 credits LONG on proposal 1** through the web UI during the
  forecasting window, from a 1 test USDC deposit, and is settled with `redeemFor` if it has not redeemed itself.
- Evaluation window 1800 s. Pool aligned to the oracle before opening. 13 paid model calls.
- Whatever wins, loses or abstains is published as measured. A failure is recorded, not silently re-run.

**Round 9 change (before anything went on-chain):** the first plan attempt stopped at its 3rd paid call
(`TEE_COMPLETION_INVALID`): `z-ai/glm-5.3-flash` always returns hidden reasoning, which TEE verification rejects.
3 paid calls were spent; no round was opened. Under the no-retry rule that plan session is closed. The proposer set
becomes 4 TEE-verified models (Conservative Qwen3.6, Balanced Qwen3.8, Momentum DeepSeek-V4.1-Flash, HighBeta
Qwen3-VL), 12 paid calls, everything else as pre-registered above. Proposal 1 (outside-wallet LONG) is still Conservative.
**Second plan attempt (still nothing on-chain):** all 4 TEE-verified proposer calls and 2 forecaster calls succeeded;
the 7th call (`google/gemini-2.5-flash`) returned truncated JSON after spending its budget on hidden reasoning.
7 paid calls spent, session closed. Three forecaster models that failed or were too slow on a full-size test prompt
were replaced (FeeAnalyst gpt-4.1, StressAnalyst grok-4.7, Skeptic kimi-k3); per-call limit 90 s. The design above is unchanged.
**Third plan attempt (nothing on-chain):** 11 of 12 calls succeeded, including all 4 TEE-verified proposers;
the 12th (`moonshotai/kimi-k3`) failed. 12 paid calls spent, session closed. Skeptic moves to
`google/gemini-2.5-flash-lite`; forecasters are 8 distinct models across 5 families. Design otherwise unchanged.

## Round 10 — full AI follow-up, pre-registered 14 November 2026

- Existing Tidepool-funded Safe/engine; next round 10 (round 9 settled, no outstanding deposits).
- Same tested swarm2 roster: four genuine TEE proposer calls and eight genuine, unattested forecaster calls; 12 calls maximum, no automatic paid retries or forced trades.
- Forecasting: 600 seconds, final TWAP window: 90 seconds. Evaluation: 600 seconds after trading closes. Return bounds remain 0.95–1.05, strict selection margin remains 0.005, trade edge remains 300 bps.
- No scripted target, no pool manipulation, no positive-return target, no new outside-wallet activity claimed. Align the private pool to the authenticated oracle before planning/execution; disclose alignment. Publish Hold, abstention, losses or failure unchanged.
- Fresh public TEE preflight: all four model attestations passed, model measurements unchanged. Gateway configuration changed; added the cryptographically checked observed gateway configuration and refreshed public NVIDIA keys after Rahul explicitly approved the trust-policy update. Preserve the observed-pinned/source-not-independently-reproduced limitation and historical verification entries.
- User authorizes the new full test and confirms sole operation. No new mainnet funding or bridge transfer. Primary API key selected; no silent key rotation or restart of a partially spent plan.

**Round 10 attempt outcome (before the round opened):** preparation (27 confirmed transactions), pool alignment (4 confirmed transactions) and snapshot completed. Three paid model requests were attempted; Conservative and Balanced returned verified TEE responses. The Momentum/DeepSeek third response failed the final TEE response-verification summary (`TEE_RESPONSE_REJECTED`). The sanitized failure does not retain the exact signature/attestation subcheck. Plan stopped with no automatic retry or backup-key rotation; no round was authorized/opened and no Safe investment strategy executed. Failed-call token usage is unavailable, not zero. See `../round10-preflight-failure.json`. Round 9 remains the last completed round.

**Round 10 diagnostic attempt B, explicitly requested 14 November:** the first attempt's exact failing response check was not retained. Add and test a fail-closed diagnostic capture before another attempt. Fresh alignment and research snapshot; reuse already funded/registered agent wallets (no repeated preparation). Same 12-model roster, 600s forecasting, 600s evaluation, 90s TWAP, no scripted target/manipulation/forced trades. At most 12 logical calls; configured backup keys only on explicit HTTP401/402/429. Preserve and report failed signature type/hash/signer checks plus replayable proof material; never weaken verification to make a run pass. Keep the first failure disclosed. This diagnostic attempt is separately journalled and must not replay the failed plan.

**Diagnostic attempt B preflight stopped:** the first logical inference intent failed GPU verification before a completion request could be sent. A free, intercepted no-completion probe reproduced the issue: NVIDIA HTTP200 JWT used a key absent from the policy; the verdict verified with that key from the official NVIDIA JWKS. This is signing-key rotation, not a credit rejection. Rahul explicitly approved the single current NVIDIA key addition; model/gateway measurements and historical keys remain unchanged. The bridge also had a `KeyError` while trying to save a failed plan as if it were a successful plan; fixed and regression-tested without hiding the original error. See `../round10-gpu-preflight.json`.

**Diagnostic continuation C:** same fixed terms and 12-model roster, fresh pool alignment/research, reused funded wallets. Retain both GPU-preflight and final-response failure material. Attempt B sent zero completion requests; no failed plan is reused. Continue only with current verified policy and stop on any failed proof; no forced winner or performance target.
