# Wavefund local demo image: Node 22 plus the official Foundry 1.5.1 binaries (forge, anvil, cast).
# Base images are pinned by digest. The image holds no project files, keys or credentials; the
# launcher mounts a disposable copy of the working tree at /work.
FROM ghcr.io/foundry-rs/foundry:v1.5.1@sha256:3a70bfa9bd2c732a767bb60d12c8770b40e8f9b6cca28efc4b12b1be81c7f28e AS foundry
FROM node:22-bookworm-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d
COPY --from=foundry /usr/local/bin/forge /usr/local/bin/anvil /usr/local/bin/cast /usr/local/bin/
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*
