# Wavefund dashboard

Next.js dashboard for Wavefund, organised around the people who use it: a **manager** who owns a Safe, **proposer agents**, and **forecasters**. Every page explains the product before it shows technical detail; addresses, hashes and raw evidence sit under collapsed "Technical details".

| Route | Purpose |
|---|---|
| `/` | **Welcome**: one hero ("Let strategies compete."), a stat card from the saved Tidepool run, and a single "How it works" drawer. No polling. |
| `/rounds` | **Rounds**: saved Aurora testnet rounds, newest first; the local simulation appears only when a local backend is running. |
| `/rounds/[id]` | **Round workspace** for one round (network + engine + round id): three headline metrics, a keyboard stage selector (Result, Funded, Proposals, Forecasting, Selected, Executed, Evaluated, Redeemed) synced to `?stage=`, ONE stage body at a time, Replay journey for settled rounds, Observer / Recorded-participant view, receipts and evidence in drawers. |
| `/rounds/live` | **Live round monitor** for the current Testnet Safe v2 round, with the wallet panel at `/rounds/live#wallet` (header **Connect wallet**): connect on Aurora testnet, deposit, claim and trade LONG/SHORT during the forecasting window. Testnet only; the app holds no keys. |
| `/rounds/local` | **Local simulation** workspace. Shows "unavailable" (no Start button) unless the backend is the local simulation; Start appears only when it is idle. |
| `/portfolio` | **Demo portfolio** (never "yours"): Safe selector and Overview / Funding / History / Permissions tabs (`?safe=`, `?tab=`). Permissions are individual checks; no synthesized "ready" flag. Connect Safe is marked not available. |
| `/portfolio/fund` | **Funding preview**: NEAR Intents 1Click mainnet dry quotes (sending disabled), the completed Tidepool testnet transfer, labelled example states (`?fixtures=1`). |
| Proposals stage → **Proof ›** | On a TEE-verified proposal (round 9), opens the proof viewer: each check, raw JSON, limits and the offline recheck command. Shown only when the API loaded evidence with `WAVEFUND_TEE_POLICY`. |
| `/agents` | **Agents**: outcome-score ranking per reputation contract (`?stack=tidepool|original`), never summed; a row drawer separates the cumulative score from each round's own delta. |
| `/advanced` | **Advanced** (header icon): unsigned Safe Transaction Builder JSON for the local Safe. |

Stack names in the UI: **Testnet Safe v1** (the original stack) and **Testnet Safe v2** (the Tidepool-funded stack); `?stack=original|tidepool` selects them and they are never summed.

Earlier routes redirect (query strings kept): `/arena` → `/rounds`, `/demo` → `/rounds/local`, `/safe` → `/portfolio`, `/safe/fund` and `/fund` → `/portfolio/fund`, `/record` → `/agents`, `/manager` → `/advanced`.

The dashboard reads actual contract snapshots and funding projections from the local backend; it does not generate balances, receipts or market signals. It has no browser keys, remote font requests, analytics or hosted publishing. The manager page's optional wallet check only reads the connected account.

```sh
npm run dev      # frontend on 127.0.0.1:3000
npm test         # view-model and capability rules (node --test, no extra dependencies)
```

Default backend: `http://127.0.0.1:3001`. Override only with a local HTTP `NEXT_PUBLIC_API_URL`; remote endpoints are refused. Use port 3000 for the local frontend: the API's allowed browser origins are localhost/127.0.0.1 on port 3000. A custom frontend port needs an explicitly reviewed local proxy; changing the URL alone does not change CORS.

For a no-backend recording of completed rounds, run from the repository root:

```sh
npm run evidence:static:check
NEXT_PUBLIC_DATA_MODE=static npm run frontend:build
NEXT_PUBLIC_DATA_MODE=static npm run start --workspace @wavefund/frontend
```

Open `http://127.0.0.1:3000`. This mode shows saved rounds and browser-read reputation; live wallet trading, dry-quote previews, local simulations and fresh receipt checks need the local API. No wallet or model keys are needed to replay Round 9. Restart/rebuild without static mode when testing a new public-testnet round.

- `/rounds/local` uses `/api/state` and `/api/demo/start` (the header context selector reads `/api/state` once, only when opened). Completed or interrupted rounds require a deliberate reset (`up.sh --fresh`) rather than silently submitting twice.
- `/`, `/rounds`, `/rounds/[id]`, `/portfolio` and `/agents` use `/api/evidence/testnet-rounds`, `/api/tidepool/demo` (+ `/fresh-check`) and `/api/agents/reputation[/tidepool]`.
- `/portfolio/fund` uses `/api/funding/*`, which exists only when the API runs with `WAVEFUND_FUNDING=live-preview` (dry quotes) or an injected funding service. Without it, the page offers the **labelled fixture explorer** (`/portfolio/fund?fixtures=1`), which uses synthetic data and is never shown as live evidence. See [docs/INTENTS-DASHBOARD.md](../docs/INTENTS-DASHBOARD.md).

The visible simulation and fixture labels are always present. Agent decisions and prices in the local scenario are deterministic fixtures, while Safe/v4/round transactions are actual local EVM calls.

Run installation, typechecking, tests and builds in the repository's isolated development environment. The frontend binds to `127.0.0.1` by default. The isolated container launcher may explicitly override its internal hostname to `0.0.0.0` while exposing only `127.0.0.1:3000` on the host.

Design: **Night Ledger** — a calm near-black canvas (warm paper in light mode), cream ink, glass cards with hairline borders, one ambient mint/violet glow with halftone dots at the top of each page, and mono numerals (IBM Plex Mono, tabular) for every amount, hash and count. Colour carries meaning only: mint = money, success and the primary action; violet = AI and focus; amber = in progress; rose = rare negatives. Tokens live in `src/app/theme.css` (loaded after `globals.css`, `pages.css` and `arena.css`, whose components it re-points); screen styles are in `rounds/round.css`, `portfolio/portfolio.css`, `welcome.css` and `agents/agents.css`. Content budget: one H1 and one supporting line per screen, at most three headline metrics, rationale/definitions/receipts in drawers or tooltips. View rules are pure, unit-tested modules: `lib/arena/model.mjs` (journey, Hold applied vs awaiting execution, default stage, participant views), `lib/arena/capabilities.mjs` (read-only Aurora can never start or run a local round), `lib/portfolio/view.mjs`, `lib/record/agents-view.mjs`. **Dark and light themes:** dark by default; the toggle saves `wavefund-theme` in `localStorage`, applied before first paint. **Fonts:** Geist (`src/app/fonts/OFL.txt`) and IBM Plex Mono (`src/app/fonts/IBMPlexMono-OFL.txt`), both SIL OFL 1.1, bundled and loaded with `next/font/local`, so builds make no remote font requests. The original Wavefund frontend's MIT copyright is retained in the root LICENSE.
