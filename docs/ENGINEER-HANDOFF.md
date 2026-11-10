# Engineer handoff — 10 November 2026

Product: **Wavefund**. Target: Aurora testnet, chain **1313161555**. This is a prototype, not an audited or production-approved system. Read this file before changing adapters or using deployed addresses.

## Start here

- [Architecture](ARCHITECTURE.md): capital separation and execution flow.
- [Local setup](LOCAL-DEMO.md): run the full simulated lifecycle in an isolated environment.
- [Agent configuration](AGENT-LAYER.md): API adapter, private settings and one-call smoke test.
- [Operator workflows](OPERATOR-WORKFLOWS.md): manager actions, receipt audit and monitoring.
- [Public forecasting proof](AURORA-TESTNET-PROOF.md): deployed components, transaction hashes and limitations.

Use a feature branch from current `main`. Restore pinned dependencies with install scripts disabled, and run builds/tests in an isolated environment without host credentials. Do not run downloaded repositories or lifecycle scripts on the host.

## Verified current state

| Area | Evidence and limit |
|---|---|
| Solidity | Earlier full baseline: 400 passed, zero failed/skipped. Solidity source was unchanged in the latest increment; that baseline was not rerun. |
| Runtime/frontend | Latest 42 runtime tests, TypeScript checks and production build passed. Nonce-validation mutation failed as intended; restored implementation passed. |
| Local lifecycle | Actual local Safe and v4 interactions; investment router, prices and fixture agents are simulated. |
| NEAR AI | One approved real Qwen/Qwen3.6-35B-A3B-FP8 response challenge passed. No verified attestation or full live model-driven strategy round. |
| Aurora forecasting | Real deployed v4 liquidity, LONG trade, hook observations, final TWAP close and liquidity removal passed using an unrestricted test controller and uncollateralized test credits. |
| Supra oracle | Public testnet REST delivered ETH/USD (19) and USDC/USD (89) proofs. Aurora `eth_call` accepted `verifyOracleProofV2`; corrupted proof reverted with `MerkleProof: invalid multiproof`. No cache write, consumer deployment or settlement was performed. |

See [runtime summary](test-evidence/provider-smoke-summary.json), [AI smoke](test-evidence/live-ai-smoke.json), [Supra verification](test-evidence/supra-readonly-verification.json) and [Supra code checks](test-evidence/supra-code-check.json).

## Critical deployment boundary

`deployments/aurora-forecast-proof.json` is **NOT** a complete trading Safe manifest. Its adapter/token factory are bound to an unrestricted test controller. Do not deposit real funds, reuse them as the genuine treasury engine, or rename that manifest to `aurora-testnet.json`. A genuine public Safe/engine/module/tracker stack requires fresh proper wiring and verification. The generic deployed PoolManager can be considered for reuse after identity and configuration checks.

Investment capital stays in the manager's Safe. Forecaster collateral and sponsor seed are separate; Safe profits do not fund forecasting redemption. The +/-5% payout bounds are not stop-loss protection.

## Next implementation gate

1. Validate a minimal Supra consumer in scratch: exact feed IDs, positive prices, timestamp units, freshness, maximum feed skew, replay rules, decimal scaling, invalid-proof failures and out-of-order updates. Returned timestamps in the successful probe were **milliseconds**, while Solidity `block.timestamp` is seconds. Do not substitute ETH/USDT for ETH/USD or assume USDC is $1.
2. Verify a real investment AMM route for the approved two assets: router/factory identity, token decimals, executable quote, liquidity, slippage and actual Safe receipt/balance changes. Existing local router tests are not a real venue fill.
3. Deploy and verify a fresh genuine Safe/QuantumRound/module/tracker stack with a usable oracle. Run one full round through performance settlement and forecaster redemption. Keep owner review, bounded authority and journal recovery intact.
4. Run complete real-agent coordination separately with an explicit inference budget. Provider configuration is remote-disabled by default; the earlier approval covered only one smoke request.

No private key, API key, real funding, mainnet deployment or paid service use is authorized by this handoff alone. Use dedicated testnet accounts and agree on scope before broadcasting.

## OutLayer evaluation for DevOps

No OutLayer project access is available yet. Request supported testnet ETH/USDC identifiers, deployment/version confirmation, pricing and project authorization before choosing it.

Read-only checks found `eth.bridge.near` unconfigured on `price-oracle.testnet`, no usable cached ETH/USDC prices and subsidy disabled. A configuration getter returned `MethodNotFound` on testnet. `request_price_data` entry exists, but a view call cannot exercise its asynchronous paid path; `ProhibitedInView` is **not** a successful fetch. Mainnet cache reads were also unusable in this observation. Source review does not establish deployed-code equivalence.

The published oracle source may call the consumer after fetch failure, with cached/null data. Its batch timestamp is query-block time; it must not be treated as the underlying source publication time. Check exact assets, missing values, true source/observation age, request nonce, callback identity, ordering and expiry. The signed-price service exposes Ed25519 signatures; verifying them only on a server does not authenticate an onchain cache update.

A native NEAR adapter plus authenticated Aurora callback could populate the existing synchronous oracle interface. XCC is asynchronous, has setup/funding requirements and cannot return a newly fetched price inside the original EVM `read()` call. This integration is evaluated, not implemented.

Evidence: [OutLayer checks](test-evidence/outlayer-readonly-evaluation.json), [method probes](test-evidence/outlayer-method-probes.json), [DIA reads](test-evidence/dia-readonly-check.json). DIA's published demo address returned stale data; a fresh consumer cannot repair a stale publisher. RedStone gateway access remains pending.

## Other integrations and tracks

Rhea, NEAR Intents, SputnikDAO/Trezu and OutLayer are not integrated. Rhea testnet pool reserve reads do not prove a usable quote for our assets. Native Rhea execution needs asynchronous asset movement/completion/refund accounting; current module expects a synchronous exact-input swap. Official NEAR Intents has no testnet verifier deployment. Do not present a locally hosted substitute as its live solver network.

Primary target: AI Swarms; secondary: AI Security & Defense. These are product-fit assessments, not organizer approval. Full real-agent coordination/public Safe lifecycle, investment execution, agent performance scoring, attestation verification and DAO integration remain unfinished. Agent reputation should score measured performance of executed strategies against an agreed benchmark; selection counters alone are not investment performance.

## Credentials and source references

Private env files, wallets, dependencies, build output and raw broadcast directories stay Git-ignored. Each engineer creates private local configuration; only credential-free examples are shared. Do not ask for keys in chat or commit them. Review `.gitignore` and `.gitleaks.toml` before publication.

- Supra: https://docs.supra.com/oracles/data-feeds/pull-oracle
- Supra deployments: https://docs.supra.com/oracles/data-feeds/pull-oracle/networks
- OutLayer: https://price-oracle.outlayer.ai/docs/
- Reviewed OutLayer source tree: `888ae663803209e5689892d671657331852428f8`
- Aurora XCC: https://doc.aurora.dev/crosschain/xcc/aurora-to-near/introduction/
