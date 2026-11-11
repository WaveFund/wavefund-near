# Repository publication check

10 November 2026. Target: `WaveFund/wavefund-near`, authenticated GitHub account `RahulBane08`. Existing commit history and feature branches are preserved; no backdating, squashing or force-pushing is needed.

- Gitleaks 8.30.1 downloaded from the official release; archive SHA-256 verified against its release checksum.
- Complete reachable Git history and a Git-exported tracked snapshot scanned, with redacted reports kept locally.
- One false positive was a public ProposalTokens contract address in local integration evidence. `.gitleaks.toml` permits only that exact line/value/file while retaining all default rules.
- A synthetic GitHub-token negative control outside the repository was detected with the same configuration. It is not a real credential and is not committed.
- 24 ignore assertions cover private environment files, credentials, build/dependency folders, local journals and broadcast outputs while allowing documented templates, frontend source and reviewed evidence.
- No `.env` or `.env.agents`, private key files, installed dependencies, build outputs or raw broadcasts are tracked or present in the reachable commit history. Credential placeholders in `.env.example` templates are intentionally included.

Public Anvil mnemonic/addresses and signed historical oracle fixtures are test data, not production credentials. Keep real keys exclusively in ignored local configuration. Secret scanning reduces risk but does not guarantee that every possible secret format is detected.

Repeat scans with a trusted installation:

```sh
gitleaks git --config .gitleaks.toml --log-opts=--all --ignore-gitleaks-allow --redact=100 .
```

Current implementation status and remaining live-swap requirements are in README and OPERATOR-WORKFLOWS.md. The local demo uses a fixture investment venue. Separately, the public Aurora testnet Safe completed actual Trisolaris swaps with operator-seeded test tokens; see AURORA-SAFE-ROUND.md and PRODUCT-TESTING.md. Production asset routes and live Intents funding remain unverified. Publishing source does not deploy contracts or spend funds.
