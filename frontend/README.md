# Wavefund dashboard

Next.js dashboard for Wavefund, organised around the people who use it: a **manager** who owns a Safe, **proposer agents**, and **forecasters**. Every page explains the product before it shows technical detail; addresses, hashes and raw evidence sit under collapsed "Technical details".

| Route | Purpose |
|---|---|
| `/` | **Home**: the one-sentence explanation, a three-step "how a round works", where the money sits, role paths (Manage my Safe, Explore & forecast, Watch the demo) and a recap of the completed testnet run. One primary action: **Run local demo**. |
| `/demo` | **Demo**: runs the local simulation and follows it live through the round journey, with a switch to the completed testnet run. |
| `/rounds/[id]` | **Round**: one saved Aurora testnet round as the seven-step journey (Funded, Proposals, Forecasting, Selected, Executed, Evaluated, Redeemed). Each step answers one question; its transactions are under "Technical details". Rounds are addressed by network + engine + round id. |
| `/safe` | **My Safe**: the manager workspace for a configured Safe (Tidepool testnet, local simulation or original testnet): capital, limits and readiness, the latest round and outcome history. Connecting your own Safe is not available yet and is labelled as such. |
| `/safe/fund` | **Fund a Safe**: NEAR Intents 1Click mainnet preview quotes (sending disabled), the completed Tidepool testnet transfer, and labelled example states (`?fixtures=1`). Transfer status and readiness keep "funding delivered" apart from "strategy ready". |
| `/arena` | **Forecast arena**: round cards, how forecasting works (deposit, credits in every world, LONG/SHORT, selection, redemption) and how the winner is chosen. Taking positions is not available from this UI and is labelled as such. |
| `/agents` | **Agents**: outcome reputation per reputation contract (Tidepool stack, original stack), never summed. |
| `/advanced` | **Advanced**: owner tools that prepare unsigned Safe Transaction Builder JSON for the local Safe. Not part of the everyday flow. |

Earlier routes redirect: `/fund` → `/safe/fund`, `/record` → `/agents`, `/manager` → `/advanced` (query strings are kept).

The dashboard reads actual contract snapshots and funding projections from the local backend; it does not generate balances, receipts or market signals. It has no browser keys, remote fonts, analytics or hosted publishing. The manager page's optional wallet check only reads the connected account.

```sh
npm run dev      # frontend on 127.0.0.1:3000
npm test         # funding display logic (node --test, no extra dependencies)
```

Default backend: `http://127.0.0.1:3001`. Override only with a local HTTP `NEXT_PUBLIC_API_URL`; remote endpoints are refused.

- `/demo` and `/` use `/api/state` and `/api/demo/start`. Completed or interrupted rounds require a deliberate reset (`up.sh --fresh`) rather than silently submitting twice.
- `/rounds/[id]`, `/arena`, `/safe` and `/agents` use `/api/evidence/testnet-rounds`, `/api/tidepool/demo` (+ `/fresh-check`) and `/api/agents/reputation[/tidepool]`.
- `/safe/fund` uses `/api/funding/*`, which exists only when the API runs with `WAVEFUND_FUNDING=live-preview` (dry quotes) or an injected funding service. Without it, the page offers the **labelled fixture explorer** (`/safe/fund?fixtures=1`), which uses synthetic data and is never shown as live evidence. See [docs/INTENTS-DASHBOARD.md](../docs/INTENTS-DASHBOARD.md).

The visible simulation and fixture labels are always present. Agent decisions and prices in the local scenario are deterministic fixtures, while Safe/v4/round transactions are actual local EVM calls.

Run installation, typechecking, tests and builds in the repository's isolated development environment. The frontend binds to `127.0.0.1` by default. The isolated container launcher may explicitly override its internal hostname to `0.0.0.0` while exposing only `127.0.0.1:3000` on the host.

Design: a "strategy arena" on a neutral light and dark system. `src/app/globals.css` holds the tokens and shared components, `src/app/pages.css` the funding and admin layouts, and `src/app/arena.css` the journey track, stage sections, strategy cards, LONG/SHORT position board, money buckets and role paths. Colour carries meaning only: each agent keeps one colour (proposers are tiles, forecasters are round), the risk asset has one colour, LONG and SHORT are opposing hues, and status colours mark status. Returns stay in the text colour, so a loss is not an alarm and a gain is not a celebration. Motion follows backend events only (the current step pulses while the backend reports it) and stops under reduced-motion settings. The journey logic lives in `src/lib/arena/model.mjs` and is unit-tested: it never shows a return before evaluation or a payout before settlement, treats Hold as a valid no-swap outcome and keeps a halted round halted. **Icons:** `src/app/icon.svg` is the Wavefund mark used for the browser tab. `favicon.ico` (16/32/48 px) and `apple-icon.png` (180 px) are rendered from it as fallbacks. **Light and dark themes:** without a saved choice the operating-system preference applies; the header toggle saves a choice in `localStorage` under `wavefund-theme`. A small script in `layout.tsx` applies it before first paint. System fonts only, so the build works offline and makes no remote font requests. The original Wavefund frontend's MIT copyright is retained in the root LICENSE; no original source files were modified.
