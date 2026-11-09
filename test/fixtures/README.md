# Historical RedStone signature fixture

Source: https://github.com/redstone-finance/redstone-oracles-monorepo/blob/e1c20caab6ad4652b06e37a89284c9f52a29ad7d/packages/protocol/test/primary-prod-data-packages.json

Preserved first three USDC and first three ETH packages from that upstream capture, timestamp 1719856900000 (2024). The source dependency and its licenses are pinned in docs/dependency-pins.json. The binary is regenerated with scripts/redstone-payload.py and is verified against the actual production signer policy in Solidity. It is NOT current price data and is never a live fallback. JSON fields such as isSignatureValid/signerAddress are source metadata, not trusted verification results.

The test-only LocalSignerOracle subclass accepts known local keys for deterministic attack cases; it is not part of production src/. Production RedstonePortfolioOracle retains upstream primary-prod signer authorization and quorum 3.
