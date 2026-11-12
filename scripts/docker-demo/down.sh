#!/usr/bin/env bash
# Stops the Docker demo. Its in-memory chain is discarded; the disposable workspace stays for a faster restart.
set -euo pipefail
if [ -x "$HOME/.docker/bin/docker" ]; then PATH="$HOME/.docker/bin:$PATH"; fi
if [ -n "$(docker ps -aq --filter 'name=^wavefund-demo$')" ]; then
  docker rm -f wavefund-demo >/dev/null
  echo "Stopped."
else
  echo "Nothing running."
fi
