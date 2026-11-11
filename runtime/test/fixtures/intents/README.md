# NEAR Intents provider fixtures

Live evidence and mocked data are kept in separate directories. Nothing in `mocked/` was ever returned by 1Click or by a chain.

## `live/`: captured from production services on 2026-11-11, read-only and unauthenticated

| File | What it is |
|---|---|
| `tokens-subset.json` | Unmodified entries from `GET https://1click.chaindefuser.com/v0/tokens`, plus a summary of that response: 229 entries, 39 blockchains, no `aurora`, and the asset-id prefix counts. It includes three unrelated `AURORA`-symbol tokens, which show that symbols are not identity. |
| `quote-dry-eth-usdc-to-aurora.json` | Unmodified **dry** quote (`dry: true`) for the funding shape: Ethereum USDC → NEAR USDC delivered to the `aurora` virtual chain, with `virtualChainRecipient` set to an EVM address. It carries the real 1Click signature. Both addresses are OpenAPI example addresses, not Wavefund wallets or Safes. No deposit address was created. |
| `quote-dry-wnear-usdt.json` | An earlier unmodified dry quote (wNEAR → USDT). It is kept only as a second real-signature interoperability vector. |
| `probes/dry-quote-probes.json` | Every dry probe request and response used to establish route availability: invalid tokens, a direct Aurora id, virtual-chain variants, minimum amounts and a control route. |
| `probes/aurora-usdc-mapping.json` | Read-only views: NEAR `ft_metadata` for the NEP-141, the Aurora engine `get_erc20_from_nep141` mapping, and the ERC-20 chain id, code size, decimals and symbol on Aurora mainnet RPC. |

## `mocked/`: synthetic, MOCKED

| File | What it is |
|---|---|
| `funding-execution-quote.template.json` | An execution-quote shape following the OpenAPI `QuoteResponse` schema. Tests sign it at runtime with a throwaway ed25519 key. Its deposit, Safe and refund addresses are fake. |
| `funding-status.template.json` | A `GET /v0/status` body shape. Tests set each status and embed the signed mocked quote. Its transaction hashes are fake. |

EVM receipts for the delivery tests are built inside `intents-delivery.test.mjs` and are equally mocked. No fixture contains a key, credential or real deposit address.
