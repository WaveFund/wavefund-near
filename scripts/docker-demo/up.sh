#!/usr/bin/env bash
# One-command Wavefund local demo in Docker: fresh Anvil chain -> Forge deployment -> API on 3001 ->
# dashboard on 3000, published on 127.0.0.1 only. See scripts/docker-demo/README.md.
#
#   bash scripts/docker-demo/up.sh                       start; if this demo is already running, report it and leave it
#   bash scripts/docker-demo/up.sh --fresh               reset only this demo's disposable chain/session, then start
#   bash scripts/docker-demo/up.sh --no-funding-preview  no NEAR Intents dry quotes (no provider requests)
#   bash scripts/docker-demo/down.sh                     stop this demo only
#
# No public-network transactions: the local Anvil chain signs and deploys disposable local contracts only, and startup
# makes no paid model calls. Setup downloads pinned packages, checksum-pinned Solidity sources and solc 0.8.26. No host
# credentials, wallets, SSH keys, env files or Docker socket are mounted: the containers see a disposable copy of tracked
# and new non-ignored files, minus anything that looks like a secret.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HERE="$REPO/scripts/docker-demo"
WORK="$REPO/.run/docker-demo/workspace" # git-ignored, disposable
IMAGE="wavefund-demo:node22-foundry1.5.1"
NAME="wavefund-demo"
PYTHON_IMAGE="python:3.12-slim@sha256:5e2bdb1b0d542d5039cffb8181c65930093949194a65c365dfb1b0fe13a4fa5b"
URL="http://127.0.0.1:3000"
FRESH=0
FUNDING="live-preview"
for arg in "$@"; do
  case "$arg" in
    --fresh) FRESH=1 ;;
    --no-funding-preview) FUNDING="disabled" ;;
    -h | --help) sed -n '2,13p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg (see --help)" >&2; exit 2 ;;
  esac
done

die() { echo "✗ $*" >&2; exit 1; }

# Prerequisites. Docker Desktop on macOS installs its CLI in ~/.docker/bin without always adding it to PATH.
if [ -x "$HOME/.docker/bin/docker" ]; then PATH="$HOME/.docker/bin:$PATH"; fi
for tool in docker git rsync curl comm; do
  command -v "$tool" >/dev/null 2>&1 || die "Missing prerequisite: $tool (see scripts/docker-demo/README.md)."
done
docker info >/dev/null 2>&1 || die "Docker is installed but its daemon is not running. Start Docker Desktop (or the docker service) and retry."
git -C "$REPO" rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "Run this from a git checkout of the repository."

healthy() { curl -fs -o /dev/null --max-time 3 http://127.0.0.1:3001/api/health && curl -fs -o /dev/null --max-time 8 "$URL/"; }
state="$(docker inspect -f '{{.State.Status}}' "$NAME" 2>/dev/null || echo missing)"

# Decide before touching anything. A normal second start never stops a working demo.
if [ "$FRESH" = 0 ]; then
  if [ "$state" = "running" ]; then
    if healthy; then
      echo "✓ Already running: $URL  (left untouched · new chain: --fresh · stop: bash scripts/docker-demo/down.sh)"
      exit 0
    fi
    die "The $NAME container is running but not answering yet (it may still be starting). Wait and retry, check 'docker logs $NAME', or restart it with --fresh. Nothing was stopped."
  fi
  if [ -f "$WORK/.run/local-demo/journal.json" ]; then
    die "A previous local session exists and its chain ended with the old container. Run 'bash scripts/docker-demo/up.sh --fresh' to start a new chain. Nothing was stopped."
  fi
fi

port_owner() { command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$1" -sTCP:LISTEN 2>/dev/null | awk 'NR==2 {print $1" (pid "$2")"}' || true; }
port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

# Only this demo's container is ever removed: on --fresh, or when an earlier run of it has already exited.
if [ "$state" != "missing" ]; then
  if [ "$FRESH" = 1 ]; then echo "› --fresh: removing this demo's container ($NAME)"; else echo "› replacing the stopped $NAME container (status: $state)"; fi
  docker rm -f "$NAME" >/dev/null
fi
for port in 3000 3001; do
  for _ in 1 2 3 4 5; do port_busy "$port" || break; sleep 1; done
  if port_busy "$port"; then
    owner="$(port_owner "$port")"
    die "Port $port on 127.0.0.1 is in use${owner:+ by $owner}. Stop that process (for example 'npm run dev' or another launcher) and retry."
  fi
done

echo "› building image $IMAGE"
docker build -q -t "$IMAGE" "$HERE" >/dev/null

echo "› syncing a disposable copy of the working tree (no .git, env files, secrets, editor folders or ignored files)"
mkdir -p "$WORK/.run"
cd "$REPO"
DENY='(^|/)\.env[^/]*$|\.(pem|key|p12|pfx|jks|keystore)$|(^|/)(id_rsa|id_ed25519)$|(^|/)(secrets|credentials|keystores?)/|^\.(vscode|idea|run)/'
NEW="$(mktemp)"; OLD="$(mktemp)"; trap 'rm -f "$NEW" "$OLD"' EXIT
comm -23 <(git ls-files -co --exclude-standard | sort -u) <(git ls-files -d | sort -u) | grep -Ev "$DENY" | sort -u >"$NEW"
rsync -a --files-from="$NEW" ./ "$WORK/"
# Remove source files that no longer exist in the repository, so deleted code cannot survive in the copy. Only source
# folders are scanned; dependency and build caches (node_modules, out, cache, lib, .next, .run) are kept deliberately.
(cd "$WORK" && for dir in runtime frontend/src frontend/test frontend/scripts scripts src script test docs; do
  [ -d "$dir" ] && find "$dir" -type f -not -path '*/node_modules/*' -not -path '*/.next/*'
done) | sort -u >"$OLD"
comm -23 "$OLD" "$NEW" | while IFS= read -r file; do rm -f "${WORK:?}/${file:?}"; done
if [ "$FRESH" = 1 ]; then rm -rf "${WORK:?}/.run/local-demo" "${WORK:?}/deployments/local.json" "${WORK:?}/broadcast"; fi

RUN=(docker run --rm --user "$(id -u):$(id -g)" -e HOME=/work/.run/home -e NPM_CONFIG_UPDATE_NOTIFIER=false -v "$WORK:/work" -w /work)
LOCK="$(git hash-object package-lock.json)"
if [ "$(cat "$WORK/node_modules/.wavefund-lock" 2>/dev/null || true)" != "$LOCK" ]; then
  echo "› npm ci (lifecycle scripts disabled)"
  "${RUN[@]}" "$IMAGE" sh -c 'mkdir -p .run/home && npm ci --ignore-scripts --no-audit --no-fund --loglevel=error'
  echo "$LOCK" >"$WORK/node_modules/.wavefund-lock"
fi
echo "› checksum-pinned Solidity sources"
"${RUN[@]}" "$PYTHON_IMAGE" python3 -I scripts/fetch-deps.py | tail -3
echo "› compiling contracts (the first run downloads solc 0.8.26 and takes a few minutes)"
if ! "${RUN[@]}" "$IMAGE" sh -c 'mkdir -p .run/home && forge build --skip test >.run/forge-build.log 2>&1'; then
  tail -20 "$WORK/.run/forge-build.log" >&2
  die "Contract compilation failed (last lines above; full log: .run/docker-demo/workspace/.run/forge-build.log)."
fi

echo "› starting local chain, local deployment, API and dashboard (funding preview: $FUNDING)"
docker run -d --name "$NAME" --user "$(id -u):$(id -g)" -e HOME=/work/.run/home -e WAVEFUND_CONTAINER=1 -e "WAVEFUND_FUNDING=$FUNDING" -e WAVEFUND_TEE_POLICY=docs/tee-policy.json \
  -p 127.0.0.1:3000:3000 -p 127.0.0.1:3001:3001 -v "$WORK:/work" -w /work "$IMAGE" node scripts/local-demo.mjs >/dev/null
for _ in $(seq 1 240); do
  if healthy; then
    echo "✓ Ready: $URL  (demo: /demo · my Safe: /safe · arena: /arena · agents: /agents · stop: bash scripts/docker-demo/down.sh)"
    exit 0
  fi
  if [ "$(docker inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null)" != "true" ]; then
    docker logs --tail 40 "$NAME" 2>&1 || true
    die "The demo stopped during start-up (logs above; the stopped container is kept for 'docker logs $NAME')."
  fi
  sleep 2
done
docker logs --tail 40 "$NAME" 2>&1 || true
die "Timed out waiting for the demo (logs above). It is still running for inspection; stop it with: bash scripts/docker-demo/down.sh"
