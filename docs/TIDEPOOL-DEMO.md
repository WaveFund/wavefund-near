# Tidepool-funded Wavefund demonstration

This is a separate Aurora testnet deployment. Tidepool's community testnet
relayer and NEAR testnet verifier are used, not official production 1Click
settlement. All tokens and pool liquidity have no real value.

## Judge: verify live public evidence without keys

Use Node 22 and the locked dependencies in an isolated environment with internet:

```sh
npm ci --ignore-scripts
node scripts/judge-check.mjs
```

No wallet or inference key is required. No transaction is signed and no paid
model call is made. The command checks live outcome reputation, a signed Tidepool
dry quote, the actual testnet funding
receipts and historical Safe balance delta, and final NEAR `execute_intents`.
It also labels the saved genuine/scripted agent evidence. Any unavailable required check
is printed as unavailable and the command exits nonzero; it does not invent zero
balances or success. Official mainnet quoting is separate from testnet delivery. Add
`--include-mainnet-quote` to request that optional preview; it is labelled
unavailable if the provider times out and does not block the required testnet
checks. The first combined run passed all seven relevant checks but its optional
mainnet preview timed out; that result is preserved in the evidence.

## Deployment and flow

Use `deployments/aurora-testnet-tidepool.json`, never silently substitute it for
the original manifest. Safe: `0x37947266fc1c2b20ffa36869af5dd531f2d80f11`.
The collateral/investment stable is Tidepool test USDC
`0x38d81431b9f76d9699af7517040d5221d9dea252` (6 decimals).

1. Reuse the genuine Safe/v4/engine/module/tracker implementations. Deploy a new
   token-compatible instance set. Reuse the existing router, PoolManager, test
   ETH and authenticated Supra oracle. No original contract is replaced.
2. Seed a separate Trisolaris investment pool with 80,000 Tidepool test USDC and
   an oracle-priced amount of test ETH. Pair:
   `0x218F2849E4401c194bf9068edf41Fd3a8F643a1b`.
3. Supply 100 test USDC as forecasting seed through the Safe into the engine.
   The Safe's investment USDC balance is zero afterward. This seed is separate
   from manager investment capital.
4. Manager sends exactly 200 test USDC on Arbitrum Sepolia through Tidepool.
   The signed quote uses the Safe directly as recipient, not virtualChainRecipient.
   199.48 test USDC is delivered to the Safe. Both receipts, minimum output,
   historical balance delta and NEAR testnet execution are independently read.
5. Four genuinely prompted NEAR AI agents propose allocation weights using fresh
   public research and the actual funded portfolio. Four SCRIPTED forecasters
   exercise LONG/SHORT trades to select the growth proposal. Scripted forecast
   decisions are explicit fixtures, not evidence of real AI forecasting alpha.
6. The same Safe executes through its constrained module and the actual new
   Trisolaris pool. The oracle floor, slippage policy, cleared approvals and
   balance checks remain unchanged. Supra measures the result; winning-world
   balances redeem. Outcome reputation can then record the selected agent.

## Transfer incident and recovery

The first submissions were rejected by Arbitrum Sepolia because the quoted gas
price fell slightly below the block base fee. This was not a pool/token failure.
Manual review checked the hashes on two RPCs, nonce zero and provider pending
status. Recovery retained nonce zero, the SAME signed quote/deposit and the SAME
200-token amount, with a capped 2x gas-price buffer. Only one nonce-zero transfer
was mined. No fresh funding order was created to resend principal.

Tidepool's destination-hash array contains both NEAR and EVM hashes. The verifier
now selects the unique EVM hash instead of assuming array element zero is Aurora.
Provider SUCCESS alone never proves delivery. Signed bytes stay in the ignored
private operator journal, not public evidence or HTTP responses.

## Operator boundary

`scripts/run-tidepool-deploy.py` is a local stdin credential bridge for explicit
`deploy` and `fund` phases, with fsynced prepared hashes and signer locks. It
blocks another funding attempt even when the first source transaction is
confirmed but delivery remains unresolved. Recovery is a reviewed manual action,
not an automatic retry. Never replay an active timed agent round.

Public funding proof and NEAR settlement are under `docs/test-evidence/tidepool-v1/`.
The existing original deployment and its agent/reputation histories remain intact.

## Completed outcome

Four new genuine AI calls proposed 0%, 40%, 75% and 95% ETH. Scripted trades
selected proposal 3, 75% ETH. The same funded Safe swapped **149.61 test USDC**
for **0.071692173391461052 test ETH** through the declared pool. No policy,
slippage floor, allocation or oracle verification was weakened to make it pass.

Supra measured return factor `0.993541889635073190`, approximately **-0.6458%**.
This starts after funding; the separate 200 -> 199.48 funding fee is not included
in the strategy return. The selected Momentum agent received -1 in this new
engine's reputation instance. Original-engine history is separate.

Each forecaster deposited 10 test USDC and redeemed:

| Actor | Payout |
| --- | --- |
| Quant (LONG) | 9.934985 |
| Guardian (SHORT) | 10.020700 |
| FeeAnalyst (losing-world position) | 10.000000 |
| StressAnalyst (LONG) | 9.981677 |

The existing independent verifier recomputed all four fills, payouts and the
return, and confirmed cleared liabilities and collateral conservation. The
public evidence includes a same-Safe/same-capital linkage from bridge delivery
to the planning snapshot and strategy execution.
