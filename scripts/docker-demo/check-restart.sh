#!/usr/bin/env bash
# Self-test for the launcher's restart safety. Starts the demo (or reuses a running one), then runs up.sh again and
# checks that the same container is still running and healthy. With --include-fresh it also checks that --fresh
# replaces the container on purpose and that down.sh stops only this demo.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -x "$HOME/.docker/bin/docker" ]; then PATH="$HOME/.docker/bin:$PATH"; fi
id_of() { local value; if value="$(docker inspect -f '{{.Id}} {{.State.StartedAt}}' wavefund-demo 2>/dev/null)" && [ -n "$value" ]; then echo "$value"; else echo none; fi; }
pass() { echo "PASS $*"; }
fail() { echo "FAIL $*" >&2; exit 1; }

bash "$HERE/up.sh" >/dev/null || bash "$HERE/up.sh" --fresh >/dev/null
before="$(id_of)"; [ "$before" != none ] || fail "demo did not start"
out="$(bash "$HERE/up.sh")" || fail "a second normal start returned non-zero"
after="$(id_of)"
[ "$before" = "$after" ] || fail "a second normal start replaced the running container"
echo "$out" | grep -q "Already running" || fail "a second normal start did not report the running demo"
curl -fs -o /dev/null http://127.0.0.1:3001/api/health || fail "the demo is not healthy after a second start"
pass "repeated start left the working demo intact ($out)"

if [ "${1:-}" = "--include-fresh" ]; then
  bash "$HERE/up.sh" --fresh >/dev/null || fail "--fresh failed"
  [ "$(id_of)" != "$after" ] || fail "--fresh did not replace the container"
  pass "--fresh replaced only this demo's container"
  bash "$HERE/down.sh" | grep -q "Stopped." || fail "down.sh did not stop the demo"
  [ "$(id_of)" = none ] || fail "down.sh left the demo running"
  pass "down.sh stopped this demo"
fi
