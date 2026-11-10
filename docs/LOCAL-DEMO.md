# Local full-stack demo

10 November 2026. This is an Anvil rehearsal, not an Aurora deployment. Safe and Uniswap v4 are real contracts. Tokens, investment venue, prices and agent decisions are explicit simulation fixtures.

## Start and run

Use the isolated development environment with Node 22+, installed npm dependencies, Foundry 1.5.1, Solidity 0.8.26 and the checksum-pinned Solidity dependencies restored. Install dependencies with lifecycle scripts disabled:

```sh
python3 scripts/fetch-deps.py
npm ci --ignore-scripts --no-audit --no-fund
npm run demo:local
```

Open `http://127.0.0.1:3000` and select **Run local round**. The launcher owns a fresh Anvil process on port 8545, deploys the stack, writes `deployments/local.json`, then starts the API on 3001 and frontend on 3000. It refuses an occupied RPC port or an existing session journal. It does not attach to a public network. A cached compiler can be selected with `WAVEFUND_SOLC=/absolute/path/to/solc-0.8.26`.

Press Ctrl+C to stop the launcher and its children. A completed or interrupted round cannot silently run again. To rehearse again, first stop the old launcher, preserve the journal if needed, and deliberately remove its disposable session:

```sh
rm -r .run/local-demo
npm run demo:local
```

This reset removes only the local execution journal. The next launcher creates a fresh in-memory chain. Do not run this command against another project's folders. No wallet connection, gateway key or model-provider credential is needed.

## What the button does

1. Owner Safe authorizes exact round terms; the keeper opens the round.
2. Momentum proposes 100% asset and Conservative proposes 50%. Both register and post refundable bonds.
3. Quant and Guardian each deposit 10 test USDC into forecasting escrow. These are separate from investment funds.
4. Actual v4 trades express initially different views. A clearly labelled fixture update changes the deterministic forecasting actions.
5. Local time advances. The final-window market average selects the canonical winner.
6. The module reads that winner and trades the Safe's eligible balance under its policy. The venue transfers prefunded reserves and charges 0.3%; it does not mint swap proceeds.
7. Local evaluation time advances and the simulated asset price changes from $2,000 to $2,100. The tracker measures the recorded posttrade holdings against entry value.
8. Forecasters redeem only winning-world claims. The dashboard reads balances, scores and transaction receipts from the node.

One round per fresh local session is intentional. The fixture oracle can only be changed by the owner; all fixture writes are restricted to chain 31337. Keys are the public, disposable standard Anvil mnemonic and must never hold real assets.

## Expected reference result

| Item | Result |
|---|---:|
| Safe starting investment capital | 2,000 test USDC |
| Sponsor starting reserve | 100 test USDC |
| Forecaster deposits | 20 test USDC total |
| Winning allocation | Proposal 1, 100% investment asset |
| Safe end holdings | 0 stable + 0.997 test ETH |
| End value at simulated $2,100 | $2,093.70 |
| Recorded return | 1.04685, or +4.685% |
| Quant payout / net profit | 12.448755 / 2.448755 test USDC |
| Guardian payout / net profit | 10.151998 / 0.151998 test USDC |
| Remaining sponsor reserve | 97.399247 test USDC |
| Runtime receipts | 27 successful transactions |

Both forecasters profit in this fixture because sponsor seed funds the net reward. This is not evidence that all participants can profit indefinitely: liquidity sponsorship is an explicit economic cost. The Safe's investment gains never fund forecast redemption.

The UI truncates display precision; raw integer amounts remain available through `/api/state`. A probability-like market score is not a guaranteed return or a binary event probability. The 0.95–1.05 payout bounds are not investment protection.

## API and failure handling

- `GET /api/health`: local simulation marker.
- `GET /api/state`: pinned-block snapshot, amounts as decimal strings, balances, agents, proposals and receipt journal.
- `POST /api/demo/start` with `{}`: starts once asynchronously; concurrent/repeated requests fail. Caller-supplied transaction parameters are rejected.

The API accepts loopback Host headers and only the two localhost frontend origins. Every write checks chain 31337 and an Anvil client. The journal records a prepared nonce before submission. Ambiguous broadcasts stop as unknown; startup refuses automatic replay. Safe owner calls require both successful simulation and the actual indexed `ExecutionSuccess` receipt event.

## Verification and limits

- 400 Foundry tests passed across all 24 Solidity test files, zero failed/skipped.
- Six Node runtime tests passed. Three scratch mutants were killed: RPC restriction, HTTP origin check and indexed Safe event decoding.
- Next.js production build and TypeScript checks passed in isolated Docker.
- A real local RPC scenario completed all stages and 27 successful receipts; dashboard readback verified the separate capital balances and results.
- The one-command launcher was exercised in a fresh isolated container: frontend HTTP 200, start HTTP 202, duplicate start HTTP 409, then 27 successful receipts and the expected measured return.
- Evidence: [summary](test-evidence/local-demo-summary.json), [launcher assertions and full state](test-evidence/local-launcher-e2e.json), [dashboard snapshot](test-evidence/local-demo-state.json), and [all Solidity logs](test-evidence/local-demo-regression/).

This is not yet live AI coordination, fresh RedStone data, an Aurora deployment or a real investment-liquidity integration. RedStone access remains pending. Native NEAR integrations, multi-Safe onboarding, wallet UX, live agent inference, operational recovery and independent security review remain separate work before real funds. Existing production contract logic was not changed by the demo; the base deployment function was only made virtual for the local bootstrap subclass.
