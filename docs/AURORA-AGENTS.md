# Real NEAR AI agents on Aurora — 10 November 2026

Four real NEAR AI responses completed a public Aurora testnet round using four separate agent wallets. Both proposers recommended cash. Both forecasters reported confidence below the 50% trading gate and abstained. Hold won; the module recorded its unchanged holdings, the tracker settled normally using fresh Supra observations, and both forecasters redeemed their full deposits.

**This proves the real-inference/abstention path.** It does not prove a live model-directed forecasting trade or a model-selected investment swap. The [preceding genuine round](AURORA-SAFE-ROUND.md) separately proves actual v4 trading and an actual Trisolaris investment fill. Do not combine those two experiments into a claim that a model caused that earlier swap.

## Observed result

| Item | Result |
|---|---|
| Network / round | Aurora testnet 1313161555 / round 2 |
| Provider / selected model | NEAR AI / `Qwen/Qwen3.6-35B-A3B-FP8` |
| Requests | Exactly 4; no retry or fallback |
| Token usage | 4,849 input; 1,086 output |
| Estimated inference cost | **$0.00201893**, from reported usage and checked catalog rates; not an independent billing receipt |
| Explicit approval | Four calls, $0.05 budget, public testnet balances and public research only |
| Momentum / Conservative | Both proposed 0% investment asset, with actual separate proposal transactions |
| Quant / Guardian | Independently prompted forecasts; both abstained under the existing confidence/edge gate |
| Winner | Hold existing quantities, 100% investment asset at the snapshot |
| Investment execution | Recorded normally; no swap required |
| Measured return | **−0.0409380382%** on the recorded held portfolio |
| Forecaster redemption | 10 test USDC each; zero forecasting profit/loss |
| Final sponsor reserve | 100.377579 test USDC; seed released, zero deposits outstanding |
| Transactions | 28 confirmations, including wallet preparation |

These are freely minted test assets with no redemption value. All four wallets are controlled by one operator. Separate prompts/mandates and wallets do not establish independent information, separate model families or calibrated forecasting skill. Attestation verification is **not implemented**.

Evidence: [full public report](test-evidence/aurora-agent-round.json), [independent manager inspection](test-evidence/aurora-agents/inspection.json), [validation summary](test-evidence/aurora-agents/summary.json).

## Implementation and boundaries

- `runtime/agents/aurora-plan.mjs`: bounded live inference and revalidation against treasury, round, holdings, evidence and recorded decisions.
- `runtime/agents/supra-observation.mjs`: pure validation/normalization of already authenticated feed metadata before model snapshots.
- `runtime/agents/aurora-chain.mjs`: fixed testnet transport, contract-binding inspection, bounded signing, Safe owner calls and authenticated price updates.
- `scripts/aurora-agent-round.mjs`: one-round lifecycle. Models supply allocations/forecasts, never addresses, calldata, winner or measured return.
- `scripts/run-aurora-agents.py`: exclusive operator lock and durable host journal. Prepared transaction hashes are fsynced and acknowledged before broadcast. Ambiguous broadcasts block continuation.

The inference worker receives the API key but no wallet keys. Signing workers receive dedicated testnet wallet keys but no API key. Model context excludes Safe addresses and keys; the public plan records treasury identity separately. No credentials are copied into container files or command-line arguments. Private `.env.agents` remains remote-disabled; this run used explicit process-local opt-in.

The chosen Qwen mode requests JSON output with thinking disabled, following [NEAR AI's model-specific documentation](https://docs.near.ai/cloud/reasoning-models). Each request retains the 1,800-output-token limit and 20-second timeout. Context is capped at 16,384 bytes and four requests; conservative rate-based reservation stays below $0.05 at the checked rates. This is a client-side estimate, not a provider-enforced billing cap. Check current model availability and rates before another approved run.

## Explicit workflow

Restore pinned dependencies and ABIs in isolated containers. Use the already verified deployment manifest. Do not run this workflow while another operator is signing for the same wallets or Safe.

```sh
python3 scripts/run-aurora-agents.py --phase prepare --artifacts /absolute/path/to/out
python3 scripts/run-aurora-agents.py --phase snapshot --artifacts /absolute/path/to/out
# Only after approving the next four-call budget:
python3 scripts/run-aurora-agents.py --phase plan --run-inference
python3 scripts/run-aurora-agents.py --phase run --artifacts /absolute/path/to/out
```

Default session: `.run/aurora-agents/round2/`. Default role-key file: `secrets/aurora-agent-wallets.json`, owner-only and Git-ignored. Existing role wallets can be reused only for explicitly authorized testnet work. Never use these keys for mainnet.

The completed session must not be reset or replayed. A previous paid request blocks automatic paid retries, including after an invalid response. Starting another session requires a fresh snapshot and explicit budget. Once a timed round starts, the CLI refuses to replay it. Investigate known hashes and contract state before any recovery; this is not a production recovery daemon.

Oracle updates occur at opening, execution and settlement. Both settlement publication times must follow the evaluation deadline. The cache still expires after 120 seconds; this task installs no permanent updater, cloud scheduler or always-on inference worker.

## Frontend/read-only developer integration

Your owned frontend and read-only backend files were not edited. Available data:

| File | Meaning |
|---|---|
| `.run/aurora-agents/round2/plan.json` | Public snapshot, research, proposals, forecasts and validated model records |
| `.run/aurora-agents/round2/complete.json` | Confirmed round result, abstentions, payouts and return |
| `docs/test-evidence/aurora-agent-round.json` | Portable historical proof for another developer without private local files |

The `records` shape is the existing agent-team record shape: name, role, configured provider/model, decision, usage, input/output hashes, timestamp and `attestationVerified: false`.

Expose these through your read-only adapter only with round/treasury identity checks and explicit provenance. Missing files mean unavailable data. Historical evidence must not appear as new live agent activity. Never import the signing CLI into the API or expose wallet-key files. Current API schemas and frontend source remain unchanged.

## Validation

53 Node tests and 6 Python bridge tests passed in network-disabled containers without host credentials. Treasury binding, oracle age, input-size and paid-replay mutants failed as intended; restored code passed. Solidity was unchanged; the preceding 419-test baseline was not rerun. Source/secret scanning and the final branch checkpoint accompany the implementation.

Remaining: validate live model-directed trade behavior when a genuine forecast clears the gate, calibrate confidence/return forecasts, add operator-reviewed continuous oracle maintenance, and integrate the read-only report into the UI. No threshold was lowered to manufacture activity.
