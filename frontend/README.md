# Wavefund dashboard

Next.js dashboard for the Wavefund journey. Pages:

| Route | Purpose |
|---|---|
| `/` | **Rounds**: the current round, laid out as a governance proposal page. Strategy proposals carry market-support bars; tabs cover forecasters, agent reasoning and on-chain activity; the sidebar has the lifecycle timeline, outcome and details. Below it is a list of the published Aurora testnet rounds. The **Run local round** button starts a local rehearsal. |
| `/rounds/[id]` | **Round detail** for a published testnet round (7, 8): honest framing, proposals, forecaster decisions and P/L, outcome and checks, and every transaction with explorer links, plus a milestone timeline. |
| `/record` | **Agents**: a leaderboard of the four proposers' on-chain **performance reputation** (Aurora testnet, through the shared reader). Signed points, evaluated count and outcomes, with distinct scored, no-history, unavailable and stale states. |
| `/fund` | **Treasury**: the Trading Safe summary and the **Deposit** card. Sources are NEAR Intents 1Click (live preview quotes, deposits disabled), Tidepool testnet (pending integration, identities only) and labelled fixtures (`?fixtures=1`). Transfer status and readiness show "Funding delivered" separately from "Strategy ready". |
| `/manager` | **Admin**: Safe and module checks, owner actions prepared as unsigned Safe Transaction Builder JSON, and maintenance tools. |

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

Design: a neutral light system in `src/app/globals.css` (tokens and components) and `src/app/pages.css` (page layouts). It is shared through `components/AppShell.tsx` and `components/ui.tsx`: Button, Badge, Card, Tabs, Stat, ProgressBar, Timeline, DescriptionList, Notice, EmptyState, Skeleton and SegmentedControl. One ink-blue brand colour is used for actions, links and selection; status colours are used only for status. There are no gradients, glows or blur. The layout follows governance apps: proposal lists with support bars, status timelines and leaderboards. **Icons:** `src/app/icon.svg` is the Wavefund mark used for the browser tab. `favicon.ico` (16/32/48 px) and `apple-icon.png` (180 px) are rendered from it as fallbacks. **Light and dark themes:** without a saved choice the operating-system preference applies; the header toggle saves a choice in `localStorage` under `wavefund-theme`. A small script in `layout.tsx` applies it before first paint, so there is no flash of the other theme. Both themes come from one token set in `globals.css`. System fonts only, so the build works offline and makes no remote font requests. The original Wavefund frontend's MIT copyright is retained in the root LICENSE; no original source files were modified.
