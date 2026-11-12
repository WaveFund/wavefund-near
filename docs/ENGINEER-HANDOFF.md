# Current checkpoint — 12 November 2026

**Tidepool update:** a separate token-compatible testnet stack and pool are deployed. Exact 200-test-USDC Arbitrum Sepolia deposit, 199.48 Aurora Safe delivery and final NEAR testnet execute_intents are independently verified. This does not change the original official 1Click mainnet route's unproven-delivery status. See TIDEPOOL-DEMO.md and deployments/aurora-testnet-tidepool.json.

Use [PRODUCT-TESTING.md](PRODUCT-TESTING.md), [AGENT-REPUTATION.md](AGENT-REPUTATION.md) and [INTENTS-PROVIDER.md](INTENTS-PROVIDER.md) for current evidence. The funding provider, state machine, bounded local operator and receipt proof are implemented; mainnet delivery remains unproven. Round seven executed a real AI-proposed rebalance with scripted forecasts. The genuine eight-agent run and additive reputation deployment are documented in the current test report. Dev C's dashboard remains separate pending his release for merge. Native subaccounts, attestation and DAO integration are not implemented.

The snapshot below is preserved as historical context; its counts and pending items are not the latest project status.

# Engineer handoff — 10 November 2026

**Publication boundary:** expanded round-runner/host-bridge edits remain local pending full live-agent validation; use the published planner/tests/verifier, not the experimental CLI workflow.

**Latest testing:** [product test report](PRODUCT-TESTING.md): scripted public round 3 completed four forecasts, LONG/SHORT, an actual Safe asset sale and independently verified payouts; 432 Solidity / 60 Node / 6 published Python tests passed. Two additional Python safety tests belong to the local unpublished runner experiment. The separate eight-call model experiment was interrupted by RPC failure before forecasting; no live model-directed trade is claimed.

**Agent milestone:** [real NEAR AI round 2](AURORA-AGENTS.md) completed with four distinct agent wallets and four model calls (~$0.00202 estimated). Both forecasters abstained; Hold settled and both deposits returned. Frontend/read-only developer-owned files were not edited.

**Latest:** [genuine Aurora Safe round completed](AURORA-SAFE-ROUND.md), with actual Trisolaris execution, authenticated Supra observations and forecaster redemption. Use `deployments/aurora-testnet.json` for that fresh stack. The earlier forecasting-only mock-controller proof remains separate. The completion below supersedes the corresponding pending gates in this historical handoff; The real-agent abstention path is now verified; a live model-directed forecasting trade remains a separate gate.

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
| Solidity | Current saved baseline: 432 passing executions across 27 files, zero failed/skipped. The earlier 419-test milestone and deployed bytecode checks remain historical evidence; test-only additions do not change deployed contracts. |
| Runtime/frontend | Current published baseline: 60 Node tests and 6 Python bridge safety tests passed. Earlier frontend typecheck/build remain valid prior evidence; frontend source was not changed here. Critical oracle, transport, mint and signer-lock mutations failed as intended and restored green. |
| Local lifecycle | Actual local Safe and v4 interactions; investment router, prices and fixture agents are simulated. |
| NEAR AI | Four real Qwen calls and distinct agent wallets completed round 2, including agent proposals, guarded abstentions, Hold execution, measured settlement and principal redemption. No verified attestation or live model-directed trade. |
| Aurora forecasting | Fresh collateralized QuantumRound/v4/WaveHook stack completed the genuine Safe round. Historical unrestricted test-controller proof remains separate. |
| Supra oracle | Authenticated consumer deployed and updated onchain; actual entry and post-deadline settlement observations accepted. Exact feed IDs 19/89, milliseconds/freshness/skew/replay checks tested. |

See [runtime summary](test-evidence/provider-smoke-summary.json), [AI smoke](test-evidence/live-ai-smoke.json), [Supra verification](test-evidence/supra-readonly-verification.json) and [Supra code checks](test-evidence/supra-code-check.json).

## Critical deployment boundary

`deployments/aurora-forecast-proof.json` is **NOT** a complete trading Safe manifest. Its adapter/token factory are bound to an unrestricted test controller. Do not deposit real funds, reuse them as the genuine treasury engine, or rename that manifest to `aurora-testnet.json`. That fresh stack is now recorded in `deployments/aurora-testnet.json`; its bindings and completed cycle were verified. The generic PoolManager was reused after a code-hash check.

Investment capital stays in the manager's Safe. Forecaster collateral and sponsor seed are separate; Safe profits do not fund forecasting redemption. The +/-5% payout bounds are not stop-loss protection.

## Next implementation gate

1. **Completed:** Supra consumer validation, real proof updates and measured settlement. See [round proof](AURORA-SAFE-ROUND.md).
2. **Completed for test assets:** existing Trisolaris factory/router, self-seeded pool, executable quote, actual Safe fill, output/allowance postconditions.
3. **Completed:** genuine Safe/engine/module/tracker wiring, full normal settlement and forecaster redemption. Dedicated testnet wallet/test assets only.
4. **Completed for abstention path:** four-call coordination with explicit $0.05 approval; measured estimate $0.00201893. No additional paid calls are approved automatically. Next verify/calibrate genuine trade decisions and implement reviewed oracle maintenance.

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
