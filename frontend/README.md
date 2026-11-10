# Wavefund local dashboard

Single-page Next.js dashboard for the local trading-Safe rehearsal. It reads actual contract snapshots from the local backend; it does not generate balances, receipts or market signals. No wallet connection, browser keys, remote fonts, analytics or hosted publishing.

The visible simulation label is always present. Agent decisions and prices in the local scenario are deterministic fixtures, while Safe/v4/round transactions are actual local EVM calls.

```sh
npm run dev
```

Default backend: `http://127.0.0.1:3001`. Override only with a local HTTP `NEXT_PUBLIC_API_URL`. All addresses and raw decimal balances come from `/api/state`. `/api/demo/start` starts a single scenario; completed/interrupted scenarios require a deliberate CLI reset rather than silently submitting twice.

Run installation, typechecking and builds in the repository's isolated development environment. Frontend binds to `127.0.0.1` by default. The isolated container launcher may explicitly override its internal hostname to `0.0.0.0` while exposing only `127.0.0.1:3000` on the host.

Design uses the green/black palette of the original Wavefund frontend, whose MIT copyright is retained in the root LICENSE. The layout, capital separation and local simulation flow are new. No original source files were modified.
