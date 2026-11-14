# Onboarding changes and operator boundary

- `/start/manager`, `/start/forecaster`, `/start/observer`: four short steps per role, one existing-route button per step. Missing saved round falls back to the rounds list rather than a dead slug.
- Home adds one role row and a six-cell lifecycle strip using the existing theme.
- Saved rounds link to `/rounds/live#wallet` rather than claiming trading is absent.
- No-live/API-unavailable view still mounts the wallet panel. Wallet/account/chain data are read independently from Aurora; never manufacture a round. Read failures disable actions; trading/redeeming still require on-chain window checks.
- Developer shell commands are moved to compact “For developers” help.
- Real wallet end-to-end: **done in round 9 (13 Nov 2026).** Throwaway wallet `0xbdd8…77b3` used the web UI and signed its own approve, deposit, claimCredits and buyLong; the operator settled it with `redeemFor`. Receipts are in `docs/test-evidence/tidepool-rounds/round9/outside-wallet.json`, re-checked by `node scripts/judge-check.mjs` (check `round9-outside-wallet-receipts`). UI/unit tests alone still do not prove a wallet flow.

No source files in the other hackathon repository were edited or copied.
