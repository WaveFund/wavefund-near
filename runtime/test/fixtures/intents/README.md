# NEAR Intents provider fixtures

| File | Provenance |
|---|---|
| `tokens.live-subset.json` | Seven unmodified entries copied from a live `GET https://1click.chaindefuser.com/v0/tokens` response on 2026-11-11 (229 entries in total). It is kept to show that symbols are not unique (two `USDC`, three `ETH`). |
| `quote-dry.live.json` | Unmodified live **dry** quote (`dry: true`) from `POST /v0/quote` on 2026-11-11, unauthenticated. Its request used the docs' placeholder account `your-account.near` and created no deposit address. The signature is the real 1Click manager signature, which the default verifier must accept. |
| `execution-quote.mocked.template.json` | **MOCKED.** A synthetic execution quote shaped by the OpenAPI `QuoteResponse` schema. Tests sign it with a throwaway ed25519 key generated at runtime. It was never returned by 1Click, and no deposit address in it is real. |
| `status.mocked.template.json` | **MOCKED.** A synthetic `GET /v0/status` body (OpenAPI `GetExecutionStatusResponse`). Tests set each documented status and embed a signed mocked quote. |

No fixture contains a key, credential or real deposit address.
