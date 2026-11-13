# Live attack suite

Twelve attacks against the deployed Tidepool stack on Aurora testnet. Each is an `eth_call` (no keys, no
transactions) pinned to one block (**277526129**). An attack passes only if it reverts with the exact named custom
error below, decoded from the contract ABI. A call that succeeds, or reverts with any other error, fails the suite.

| Attack | Contract guard | Observed revert |
|---|---|---|
| Non-owner authorizes a round | Only the Safe may call `authorizeRound` | `OnlySafe` |
| Re-execute settled round 8 | `execute` needs a collapsed, unexecuted round | `NotExecutable` |
| Execute cancelled round 4 | Same check; cancelled rounds never run | `NotExecutable` |
| Non-keeper opens a round | `openRound` needs KEEPER_ROLE | `AccessControlUnauthorizedAccount` |
| Settle round 8 performance again | One observation per round | `AlreadyObserved` |
| Collapse settled round 8 | Only a trading round can collapse | `AlreadyCollapsed` |
| Redeem round 8 twice | Paid forecasters are marked redeemed | `NothingToRedeem` |
| Reputation for Hold round 6 | A Hold win has no agent to score | `NoAgentWinner` |
| Reputation for Hold round 7 | Same | `NoAgentWinner` |
| Reputation for round 8 twice | Each round records once | `AlreadyRecorded` |
| Stranger mints test tokens | Only the operator may mint | `OnlyOperator` |
| Propose into settled round 8 | Proposals only while trading is open | `TradingNotOpen` |

Run it: `node scripts/attack-suite.mjs` (exits non-zero on any mismatch; rewrites
`docs/test-evidence/attack-suite.json`). Offline logic tests: `runtime/test/attack-suite.test.mjs`.

Scope: these are access-control and state-machine guards, checked against historical rounds, so the results do
not depend on whether a round is live. They show the guards hold for those inputs, not that the contracts are
free of other flaws. The stable token (`Tidepool Testnet USDC`) is a different contract that reverts with a
plain string, so the mint attack targets the test ETH token, which uses `OnlyOperator`.
