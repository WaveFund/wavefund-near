# Agent outcome reputation, version 1

`AgentReputation` is an additive contract. Existing Safe, module, engine, tracker,
market, collateral and payouts remain unchanged. It binds once to an existing
engine and its configured performance tracker; no admin can replace that pair.

Anyone may record an executed, settled non-Hold round once. The contract reads
the selected proposer and the tracker's authenticated observation directly:

| Actual marked portfolio return | Points |
| --- | --- |
| Positive | +1 |
| Negative | -1 |
| Exactly flat | 0 |

`statistics(agent)` exposes sample, positive, negative and flat counts;
`score(agent)` is positives minus negatives. Selection alone earns nothing.
Unexecuted, cancelled, unobserved and Hold rounds do not score. Losing proposals
are untested strategies and earn no performance point. Permissionless recording
also permits backfilling historical rounds with valid tracker observations.

This is absolute performance, not outperformance versus Hold, calibrated alpha,
a Sybil-resistant identity or a lending credit score. Tiny and large gains get
the same point. Address changes reset history; repeated short tests are not proof
of investing skill. Existing `ProposerRegistry.roundsWon` still means selections.

Deploy additively using `script/DeployAgentReputation.s.sol`, providing
`REPUTATION_ENGINE` and `REPUTATION_TRACKER`. The script permits only local chain
31337 or Aurora testnet 1313161555. No deployment address is assumed or invented.
Round seven has been backfilled: the selected Momentum proposer now has one
evaluated strategy, one negative result and an on-chain score of -1. The additive contract is now deployed at
`0xac9c56f1c032f74a9e84703602894315df2d9488` on Aurora testnet; historical
recording evidence is tracked in `deployments/aurora-testnet-reputation.json`.

# Genuine eight-agent runner

`--profile swarm` reuses the existing diverse planner: four real proposer calls,
then four real forecaster calls, with the enriched Coinbase/Kraken research.
It keeps the same actors/wallets, policy, entry-cost and confidence gates.
Literal prompts and input/output hashes are retained without changing historical
hash formats. Calls are bounded at eight, $0.10, no retries. The operator must
use `--run-inference` and obtain a fresh spending authorization before running.
The tests inject a deterministic provider; they do not establish genuine forecasts.
Hold and abstention remain valid outcomes, with no forced proposal winner or swap.
