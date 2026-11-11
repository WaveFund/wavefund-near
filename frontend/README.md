# Wavefund dashboard

Next.js dashboard for the Wavefund journey. Pages:

| Route | Purpose |
|---|---|
| `/fund` | **01 Fund your Trading Safe**: NEAR Intents dry-quote preview into the manager's Aurora **mainnet** Safe, delivery/refund evidence tracker and round readiness. Signing is disabled. |
| `/` | **02 Decide**: local rehearsal / Aurora testnet monitoring of proposals, forecasts, execution and settlement. |
| `/manager` | **03 Manage**: owner-reviewed, unsigned Safe actions. |

The dashboard reads actual contract snapshots and funding projections from the local backend; it does not generate balances, receipts or market signals. It has no browser keys, remote fonts, analytics or hosted publishing. The manager page's optional wallet check only reads the connected account.

```sh
npm run dev      # frontend on 127.0.0.1:3000
npm test         # funding display logic (node --test, no extra dependencies)
```

Default backend: `http://127.0.0.1:3001`. Override only with a local HTTP `NEXT_PUBLIC_API_URL`; remote endpoints are refused.

- `/` uses `/api/state` and `/api/demo/start`. Completed or interrupted scenarios require a deliberate CLI reset rather than silently submitting twice.
- `/fund` uses `/api/funding/*`, which exists only when the API runs with `WAVEFUND_FUNDING=live-preview` (dry quotes) or an injected funding service. Without it, the page offers the **labelled fixture explorer** (`/fund?fixtures=1`), which uses synthetic data and is never shown as live evidence. See [docs/INTENTS-DASHBOARD.md](../docs/INTENTS-DASHBOARD.md).

The visible simulation and fixture labels are always present. Agent decisions and prices in the local scenario are deterministic fixtures, while Safe/v4/round transactions are actual local EVM calls.

Run installation, typechecking, tests and builds in the repository's isolated development environment. The frontend binds to `127.0.0.1` by default. The isolated container launcher may explicitly override its internal hostname to `0.0.0.0` while exposing only `127.0.0.1:3000` on the host.

Design: a dark, crypto-native system in `src/app/globals.css` and `src/app/funding.css`, shared through `components/AppShell.tsx`. It uses glass cards, a mint→cyan→violet gradient and tabular monospace numbers. Network colours: mint = Aurora mainnet / Safe money, violet = Aurora testnet / forecasting, amber = local chain, fixtures and warnings. System fonts only, so the build works offline and makes no remote font requests. The original Wavefund frontend's MIT copyright is retained in the root LICENSE; no original source files were modified.
