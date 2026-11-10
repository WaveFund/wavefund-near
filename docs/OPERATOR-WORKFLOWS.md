# Wavefund operator workflows

Historical local/operator milestone. Current public proofs: [genuine Safe swap round](AURORA-SAFE-ROUND.md) and [real NEAR AI abstention round](AURORA-AGENTS.md). Their dated results supersede the corresponding pending deployment/inference gates below.

This milestone adds a manager console, public research collection, receipt recovery inspection and read-only Aurora monitoring. It does not deploy contracts publicly, sign owner transactions or turn research quotes into a settlement oracle.

## Manager console

Start the existing local demo and open `/manager` from the dashboard. The page reads the Safe's owners, threshold, token balances, module policy, authorization, oracle availability and sponsor reserve. It checks deployed code and the module/engine/tracker/token/market/hook bindings before preparing an action. This checks wiring, not independent bytecode provenance or a security audit.

Choose an action and select **Prepare unsigned transaction**:

- Enable or disable the bound module. Disabling finds the actual Safe linked-list predecessor; disabling does not settle an existing round.
- Set maximum slippage, only with no active round or pending authorization.
- Authorize the next round with exact timing and the current ±5% payout bounds, or revoke pending authorization. These bounds do not cap investment losses.
- Explicitly sponsor forecasting from Safe USDC. This reduces investment capital by the reviewed amount and funds a separate reserve. The batch clears approval, approves the exact amount, funds the reserve and clears approval again. It is not free liquidity.
- Return only unallocated sponsor reserve to the Safe. Active market seed and forecaster deposits are not withdrawable through this action.

The page shows the transaction targets and calldata and downloads unsigned Safe Transaction Builder JSON. The owner preview and actual browser download were verified locally; [screenshot](test-evidence/operator-manager-review.jpg). It sends no signature request or transaction. Owners must review and execute using a supported Safe interface or operator tooling. Hosted Safe UI support on Aurora testnet has not been verified. The five-minute preview expiry is advisory; it is not a cryptographically enforced signature deadline. Reinspect state before signing. Browser-wallet connection is optional and only checks owner membership and network.

One deployed stack supports one Safe. Another manager needs another correctly deployed stack and its own forecasting sponsorship; universal vault onboarding and a multi-tenant factory are outside this v1.

## Public research without an API key

In the isolated environment with read-only internet access:

```sh
npm run research:collect
```

This fetches ETH/USD candles and ticker plus a USDC/USD spot quote from fixed Coinbase public endpoints, then writes `.run/research/latest.json`. It rejects stale/future tickers, malformed/duplicate candles and unfinished candle closes. USDC is not assumed to equal $1. The upstream USDC spot response has no publication timestamp, which is explicitly recorded.

Set `WAVEFUND_MARKET_DATA_FILE=.run/research/latest.json` only when deliberately selecting that research input for agents. Refresh before using it; stale data is rejected. The collector is a one-shot command, not an undisclosed price daemon. The local evaluation price remains a simulation fixture. Real research inputs do not make the simulated investment performance a live trading result.

All output is `external-unverified` with `settlementEligible: false`. It must not update RedStone caches or determine financial payouts. The manager console's **Check research snapshot** reads freshness and provenance without fetching or substituting data automatically.

## Receipt recovery

Use **Audit recorded transactions** in the manager console, or:

```sh
npm run journal:audit
```

Configure `LOCAL_MANIFEST` / `LOCAL_JOURNAL` when using non-default paths. The audit checks the chain, uncached block height, receipt/block hashes, transaction sender/recipient/nonce and actual Safe internal execution events. It distinguishes known confirmations, reverts, unresolved hashes and chain mismatches. It writes a report under `.run/recovery/`; it never edits the journal, retries a broadcast or releases a lock. A prepared action without a known hash requires manual investigation.

A cached-head false alarm was caught in actual integration testing and fixed. RPC and chain reorganization assumptions still apply; this is an operator aid, not consensus verification or automatic recovery.

## Aurora testnet

```sh
npm run aurora:check
```

This uses only the official `https://testnet.aurora.dev` endpoint and read-only RPC methods. It checks chain 1313161555, a recent block and ephemeral TSTORE/TLOAD/MCOPY probes with an invalid-opcode negative control. No signed transaction is sent. An actual full Safe/v4 round, venue fill and gas proof are still required.

After a separately authorized real deployment, create `deployments/aurora-testnet.json` with schemaVersion 1, chainId 1313161555 and the 13 actual stack addresses under `contracts`: safe, stable, asset, oracle, router, poolManager, engine, module, tracker, tokens, registry, hook, market. Do not copy local Anvil addresses into a real deployment manifest or invent placeholders. `script/DeployTradingSafe.s.sol` remains the deployment recipe; it never broadcasts automatically.

Then, with the local API port free:

```sh
npm run monitor:aurora
```

Run the frontend separately. The API stays bound to loopback. Its dashboard and manager console inspect the configured Aurora contracts and prepare unsigned owner actions. Mainnet manifests, duplicate/missing addresses and binding mismatches fail closed. The server has no Aurora signer; `/api/demo/start` is rejected in monitoring mode. No missing model records or signed execution journals are fabricated.

## Verified and still pending

39 runtime tests passed, nine integration checks passed, six scratch mutants were killed, and frontend type checking/production build passed. No Solidity source changed; the preceding 400-test contract baseline was not rerun. [Summary](test-evidence/operator-summary.json), [integration](test-evidence/operator-integration.json), [unit log](test-evidence/operator-unit.log), [mutation results](test-evidence/operator-mutations/summary.json), [actual public research](test-evidence/operator-live-research.json), [actual Aurora probe](test-evidence/operator-aurora-probe.json). The actual public research collector and unsigned Aurora opcode checks passed. Local integration exercises the actual Safe, approval cleanup, sponsorship movements, policy/authorization/revocation, module disable/re-enable, receipt reconciliation and complete local round. The Aurora monitoring interface was additionally tested using an explicitly labelled local-chain data double; this is not a public deployment proof.

Still pending: a real NEAR AI inference run with the user's private key, fresh authenticated settlement prices, public Aurora deployment/funding and a complete signed testnet cycle with real venue liquidity. Hosted publication, Git push, owner signatures and any real funds remain separate user-controlled actions. Independent security review remains necessary before production use.
