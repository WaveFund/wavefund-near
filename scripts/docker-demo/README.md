# Docker demo launcher

Runs the complete local Wavefund demo in Docker with one command: a fresh Anvil chain, the Forge deployment, the API on port 3001 and the dashboard on port 3000. Both ports are published on `127.0.0.1` only.

This is a local rehearsal on chain 31337, not an Aurora deployment. It uses the same `scripts/local-demo.mjs` launcher described in [docs/LOCAL-DEMO.md](../../docs/LOCAL-DEMO.md), inside a container.

## Prerequisites

| Requirement | Notes |
|---|---|
| Docker Desktop (macOS/Windows) or Docker Engine (Linux), running | On macOS the CLI in `~/.docker/bin` is found even when it is not on `PATH`. |
| `bash`, `git`, `rsync`, `curl` | Preinstalled on macOS and most Linux distributions. |
| Internet access for the first run | Fetches the pinned base images, npm packages (lifecycle scripts disabled), checksum-pinned Solidity sources and solc 0.8.26. |
| Free ports 3000 and 3001 on 127.0.0.1 | The launcher stops if either is taken. |
| About 2.5 GB of disk | For the images, `node_modules` and compiler cache. |

No wallet, private key, API key, model credential or `.env` file is needed or read.

## Start

From the repository root:

```sh
bash scripts/docker-demo/up.sh
```

The first run takes several minutes, because it installs dependencies and compiles the contracts. Later runs reuse the cache. When the launcher prints `✓ Ready`, open:

- `http://127.0.0.1:3000/rounds/local`: press **Run local simulation** to run a round on the local chain and follow it stage by stage.
- `http://127.0.0.1:3000/rounds`: the completed Aurora testnet rounds (including the Tidepool-funded round), each opening on its result recap with a stage-by-stage replay.
- `http://127.0.0.1:3000/safe`: **My Safe**, and `/safe/fund` to **fund a Safe** with live NEAR Intents 1Click dry quotes. Sending and signing are disabled.
- `http://127.0.0.1:3000/agents`: outcome reputation, read live and read-only from public Aurora testnet, per reputation contract.
- `http://127.0.0.1:3000/advanced`: owner tools (unsigned transactions only).

The API starts with `WAVEFUND_TEE_POLICY=docs/tee-policy.json` so the evidence list includes the TEE-verified round 9; without that variable `/api/evidence/testnet-rounds` returns 503.

Stop the demo with:

```sh
bash scripts/docker-demo/down.sh
```

## Options

| Command | Effect |
|---|---|
| `up.sh` again while the demo runs | Reports the URL and leaves the running demo untouched. It never stops a working demo. |
| `up.sh --fresh` | Resets only this demo's disposable state (its container, local chain journal, local deployment and broadcast) and starts a new chain. Use it to run another round, to load code changes, or after the container stopped. |
| `up.sh --no-funding-preview` | Starts without `/api/funding/*`, so no request goes to NEAR Intents. `/safe/fund` then offers the labelled example states. |
| `up.sh --help` | Prints the usage summary. |

## What it does

1. Checks the prerequisites, the Docker daemon and the two ports.
2. Builds `wavefund-demo:node22-foundry1.5.1` from the digest-pinned `node:22-bookworm-slim` and the official `ghcr.io/foundry-rs/foundry:v1.5.1` binaries.
3. Copies tracked and new non-ignored files into the git-ignored `.run/docker-demo/workspace`. It never copies `.git`, ignored files (including every `.env*`), or `.vscode/` and `.idea/`.
4. Runs `npm ci --ignore-scripts` (only when `package-lock.json` changed), `scripts/fetch-deps.py` and `forge build` in throwaway containers, as your user ID.
5. Starts the `wavefund-demo` container with `WAVEFUND_CONTAINER=1`, which binds the API and dashboard inside the container, and `WAVEFUND_FUNDING=live-preview`, which enables dry quotes only.

The containers mount only the disposable workspace, never the Docker socket or host credentials.

- **No public-network transactions.** The local Anvil chain signs and deploys disposable local contracts only, and startup makes no paid model calls.
- **Outbound requests are public reads only:** 1Click dry quotes on **Get quote**, Aurora testnet reputation reads, and the Tidepool fresh check on **Re-verify receipts now**.
- **Loopback only.** The published ports listen on 127.0.0.1, so other machines on your network cannot reach the demo.
- **No stale code.** Files deleted from the repository are removed from the disposable copy on the next start. Dependency and compiler caches are kept.
- **No secrets copied.** Anything that looks like a secret (`.env*`, keys, keystores, `secrets/`) is never copied.

`bash scripts/docker-demo/check-restart.sh --include-fresh` self-tests the restart behaviour: a repeated start keeps the same container, `--fresh` replaces it, and `down.sh` stops only this demo.

## Troubleshooting

| Message | Fix |
|---|---|
| `Docker is installed but its daemon is not running` | Start Docker Desktop and wait until it reports that it is running. |
| `Port 3000 … is already in use` | Stop the other process, for example a previous `npm run dev` or another launcher. |
| `A previous local session exists … Nothing was stopped.` | Run `bash scripts/docker-demo/up.sh --fresh`. The previous chain lived only in the old container. |
| `The wavefund-demo container is running but not answering yet` | It may still be starting. Wait and retry, check `docker logs wavefund-demo`, or use `--fresh`. Nothing was stopped. |
| `The demo stopped during start-up` | The last 40 log lines are printed above the message. `docker logs wavefund-demo` shows the full log while the container exists. |

To reclaim the disk space completely, stop the demo, then delete `.run/docker-demo/` and the `wavefund-demo` image.
