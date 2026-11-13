# Onboarding changes and operator boundary

- `/start/manager`, `/start/forecaster`, `/start/observer`: four short steps per role, one existing-route button per step. Missing saved round falls back to the rounds list rather than a dead slug.
- Home adds one role row and a six-cell lifecycle strip using the existing theme.
- Saved rounds link to `/rounds/live#wallet` rather than claiming trading is absent.
- No-live/API-unavailable view still mounts the wallet panel. Wallet/account/chain data are read independently from Aurora; never manufacture a round. Read failures disable actions; trading/redeeming still require on-chain window checks.
- Developer shell commands are moved to compact “For developers” help.
- Real wallet end-to-end is NOT claimed by UI/unit tests. Claude must fund an isolated throwaway test wallet between rounds; no operator keys are required by Codex. Record approve/deposit/claim/buy and redemption receipts on the next explicitly coordinated test. No public transfer was sent by this branch.

No source files in the other hackathon repository were edited or copied.
