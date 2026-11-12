#!/usr/bin/env bash
# One-command Wavefund local demo in Docker: fresh Anvil chain -> Forge deployment -> API on 3001 ->
# dashboard on 3000, published on 127.0.0.1 only. See scripts/docker-demo/README.md.
#
#   bash scripts/docker-demo/up.sh                       start the full local stack
#   bash scripts/docker-demo/up.sh --fresh               discard the previous disposable session, start a new chain
#   bash scripts/docker-demo/up.sh --no-funding-preview  no NEAR Intents dry quotes (no provider requests)
#   bash scripts/docker-demo/down.sh                     stop
#
# Setup uses the network: pinned npm packages (lifecycle scripts disabled), checksum-pinned Solidity sources and
# the solc 0.8.26 download. No host credentials, wallets, SSH keys or env files are mounted: the containers see a
# copy of tracked and new non-ignored files only. Nothing is signed, funded, pushed or deployed.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HERE="$REPO/scripts/docker-demo"
WORK="$REPO/.run/docker-demo/workspace" # git-ignored, disposable
IMAGE="wavefund-demo:node22-foundry1.5.1"
NAME="wavefund-demo"
PYTHON_IMAGE="python:3.12-slim@sha256:5e2bdb1b0d542d5039cffb8181c65930093949194a65c365dfb1b0fe13a4fa5b"
FRESH=0
FUNDING="live-preview"
for arg in "$@"; do
  case "$arg" in
    --fresh) FRESH=1 ;;
    --no-funding-preview) FUNDING="disabled" ;;
    -h | --help) sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
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

docker rm -f "$NAME" >/dev/null 2>&1 || true
for port in 3000 3001; do
  if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
    die "Port $port on 127.0.0.1 is already in use. Stop that process (another demo or 'npm run dev'?) and retry."
  fi
done

echo "› building image $IMAGE"
docker build -q -t "$IMAGE" "$HERE" >/dev/null

echo "› syncing a disposable copy of the working tree (no .git, env files, editor folders or ignored files)"
mkdir -p "$WORK"
cd "$REPO"
comm -23 <(git ls-files -co --exclude-standard | sort -u) <(git ls-files -d | sort -u) \
  | grep -Ev '^(\.vscode|\.idea)/' | rsync -a --files-from=- ./ "$WORK/"
git ls-files -d | while IFS= read -r file; do rm -f "${WORK:?}/${file:?}"; done
if [ "$FRESH" = 1 ]; then rm -rf "${WORK:?}/.run/local-demo" "${WORK:?}/deployments/local.json" "${WORK:?}/broadcast"; fi
if [ -f "$WORK/.run/local-demo/journal.json" ]; then
  die "A previous disposable session exists and its chain ended with the old container. Re-run with --fresh to start a new one."
fi

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

echo "› starting chain, deployment, API and dashboard (funding: $FUNDING)"
docker run -d --name "$NAME" --user "$(id -u):$(id -g)" -e HOME=/work/.run/home -e WAVEFUND_CONTAINER=1 -e "WAVEFUND_FUNDING=$FUNDING" \
  -p 127.0.0.1:3000:3000 -p 127.0.0.1:3001:3001 -v "$WORK:/work" -w /work "$IMAGE" node scripts/local-demo.mjs >/dev/null
for _ in $(seq 1 240); do
  if curl -fs -o /dev/null http://127.0.0.1:3001/api/health && curl -fs -o /dev/null http://127.0.0.1:3000/; then
    echo "✓ Ready: http://127.0.0.1:3000  (funding: /fund · owner console: /manager · stop: bash scripts/docker-demo/down.sh)"
    exit 0
  fi
  if [ "$(docker inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null)" != "true" ]; then
    docker logs --tail 40 "$NAME" 2>&1 || true
    die "The demo stopped during start-up (logs above)."
  fi
  sleep 2
done
docker logs --tail 40 "$NAME" 2>&1 || true
die "Timed out waiting for the demo (logs above). Stop it with: bash scripts/docker-demo/down.sh"
