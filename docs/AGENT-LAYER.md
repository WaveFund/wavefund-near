# Wavefund agent layer

**Latest public result:** [four real NEAR AI decisions completed Aurora round 2](AURORA-AGENTS.md). Both forecasters abstained; Hold executed without a swap, settled normally, and both deposits were redeemed. This is distinct from the earlier local/mock and provider-smoke milestones below.

The local round now supports validated model-generated proposals and independent performance forecasts. A NEAR AI Cloud adapter and a local chat-completions adapter are implemented. The original milestone used mocked HTTP; one explicitly approved real provider smoke request has now passed (see the dated section below). The sections below describe the earlier local implementation. Its tests use an explicitly labelled scripted HTTP responder and simulated assets/prices; the dated public result above uses fresh research, authenticated settlement observations and test assets.

## Set up your NEAR AI key

1. Sign in at https://cloud.near.ai. Open **API Keys** and create `Wavefund development`.
2. Check the credits page and hackathon credit availability before purchasing anything. Model availability and charges depend on the selected model.
3. Open the private `.env.agents` file in this repository. It was created with owner-only permissions and is ignored by Git. Put the key into `NEARAI_API_KEY` privately; never paste it into chat or a frontend variable.
4. Copy an available model identifier from the NEAR AI model catalog into `WAVEFUND_AGENT_MODEL`. Do not guess the identifier. Keep `WAVEFUND_ALLOW_REMOTE_INFERENCE=0` while checking configuration.
5. In the isolated development environment, run:

```sh
npm run agents:check
```

This only validates configuration and prints readiness, not the key. It sends no inference request. A valid key's existence is not proof of credits or API access.

When you deliberately want to run paid/provider inference, set `WAVEFUND_ALLOW_REMOTE_INFERENCE=1`. Stop the previous local demo first and follow the explicit disposable journal reset in [LOCAL-DEMO.md](LOCAL-DEMO.md). Then run:

```sh
npm run demo:agents
```

Open the dashboard and press **Run local round**. The launcher rejects incomplete provider configuration before deploying local contracts. The inference key is passed only to the API process, not Forge, Anvil or the Next.js child. No public wallet, public deployment or real trading is enabled.

For a local model instead, use `WAVEFUND_AGENT_MODE=local`, an installed model identifier and a loopback chat-completions endpoint such as `http://127.0.0.1:11434/v1/chat/completions`. The app does not install a model, download weights or silently use a cloud fallback.

## What happens

1. Read one pinned-block snapshot of Safe quantities, current allocation and simulated prices. Create a labelled synthetic history, or validate a manually supplied research file through `WAVEFUND_MARKET_DATA_FILE`.
2. Momentum and Conservative each receive the same evidence and separate mandates. They return a two-asset allocation, short rationale, risks, self-reported confidence and citations.
3. Quant and Guardian independently forecast the signed net return of Hold and both proposed allocations. They see the proposals but not each other's forecasts. Different mandates do not guarantee different answers or independent information.
4. Validate all four answers **before** owner authorization, proposal bonds or forecasting deposits. Reject malformed JSON, unexpected fields, invalid allocations, missing/unknown evidence, incomplete forecast coverage, timeouts and tool calls. There is no fallback, automatic retry or forced winning strategy.
5. Open the local round, submit proposals and verify their actual onchain IDs, authors and allocations match the analysed set. Each forecaster deposits 10 test USDC separately from the Safe's capital.
6. Fetch real v4 quotes for both sides. Convert predicted return into the contract's continuous payout: `clamp((1 + predictedReturn - 0.95) / 0.10, 0, 1)`. A prediction of +2.5% corresponds to a 0.75 LONG payout ratio; this is not a binary win/loss event.
7. Compare expected redemption value of the quoted outcome tokens against their credit cost. Only trade if confidence is at least 50% and estimated edge is strictly greater than 1% of cost. Current size is 2 test USDC; the gate rejects sizes above its 5-USDC local limit. Each forecaster takes at most one trade. No qualifying edge means abstain.
8. The market selects the winner. The existing Safe module executes only that allocation under its contract rules. Models cannot choose the recipient, router, calldata, winner or settlement return.
9. The existing tracker settles using recorded quantities and the explicit evaluation-price fixture. Forecast principal and payouts remain separate from Safe investment returns.

The actual entry quote matters. Predicting a good outcome does not make buying LONG profitable at any price. Self-reported confidence is neither calibrated accuracy nor an onchain guarantee. The gate evaluates payout at a point return forecast; it does not integrate over a return distribution. Because the payout is clipped, this proxy can differ from the true expected payout. Calibrated distributions and backtesting are still required before using real forecasting funds.

## Evidence and boundaries

The journal records validated summaries, forecast tables, risks, evidence identifiers, input/output SHA-256 hashes, token-usage metadata and quote decisions. It does not record hidden model reasoning or the API key. Summaries submitted with proposals are public onchain metadata; do not include private material. Hashes identify recorded inputs/outputs but do not prove which model generated them.

Only the fixed two-asset allocation range 0–10000 bps is supported. There is no extra 50% platform cap. The contract enforces its existing asset/router/round/slippage restrictions; research freshness, model schema, confidence and agent trade-size gates are currently server-side checks, not new onchain policy capabilities.

The public NEAR AI gateway route is fixed. Local endpoints must be HTTP loopback URLs; redirects are rejected. A round allows at most four requests, with 20-second request timeouts and 1,800 output-token limits per request. These are request controls, not a guaranteed dollar spending cap. No remote request is made unless explicitly enabled. Hardware attestation and response-signature verification are not implemented, so no private/attested-inference claim is made.

Research price history is not the settlement oracle. Synthetic history is labelled; manually supplied data is `external-unverified`. No future evaluation price is given to a model. Fresh RedStone data and live historical-data collection remain separate integrations.

## Verification

23 runtime tests passed, all four actual-RPC integration cases passed, and four scratch mutants were caught (allocation, budget, edge and evidence age). Frontend type checking and production build passed. Contracts were unchanged; the preceding contract baseline is 400 passing tests. [Summary](test-evidence/agent-summary.json), [integration evidence](test-evidence/agent-integration.json), [unit log](test-evidence/agent-unit.log) and [mutation results](test-evidence/agent-mutations/summary.json).

Run inside the isolated development environment:

```sh
npm run test:runtime
```

The explicitly opt-in integration script requires a **freshly deployed disposable** Anvil stack and compiled artifacts:

```sh
WAVEFUND_AGENT_INTEGRATION=1 node runtime/test/agent-round.integration.mjs
```

It uses local HTTP test responses, not inference. Cases prove that invalid output submits zero transactions, abstention keeps Hold, a 65% allocation actually executes, and changing the model output selects/executes an 80% allocation. Scratch snapshots keep these cases separate. Evidence is written under `.run/agent-integration/`.

Official protocol references checked 10 November 2026: [NEAR AI quickstart](https://docs.near.ai/cloud/quickstart), [model catalog](https://cloud.near.ai/models), [Ollama chat-completions compatibility](https://docs.ollama.com/api/openai-compatibility). Provider compatibility is verified with HTTP tests; current real-provider availability awaits the user's key and a deliberately authorized call.

## Provider smoke check — 10 November 2026

`npm run agents:smoke` is a dry run and sends no request. To deliberately perform one provider-only check, select a valid model, enable remote inference explicitly, and run `npm run agents:smoke -- --run`. It sends one fresh nonce challenge through the existing bounded provider (20 seconds, 1,800 output-token ceiling, no retry), rejects stale or malformed answers, and never touches a wallet or submits a trade. Output contains only model, validation status and token counts, never credentials or raw provider text. Hardware attestation is not verified.

One explicitly approved real request to `Qwen/Qwen3.6-35B-A3B-FP8` passed: 80 input tokens and 832 output tokens. See [sanitized evidence](test-evidence/live-ai-smoke.json). This establishes provider connectivity and JSON response validation, not a complete live strategy round. The private configuration remains remote-disabled; no always-on inference was enabled.
