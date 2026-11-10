# Aurora forecasting runtime proof

10 November 2026. Chain **1313161555**; official RPC `https://testnet.aurora.dev`.

This is a self-deployed Uniswap v4 forecasting-component experiment, not an official Uniswap deployment or a complete Wavefund trading Safe. The proposal adapter is permanently bound to an **unrestricted MockQuantumRound test controller**. Its CREDIT/LONG/SHORT tokens are test claims with no USDC collateral. Never deposit real money or use this controller as treasury authorization. A real Wavefund engine needs a fresh proposal adapter/token factory and production wiring; the generic PoolManager may be reused after verification.

## Deployed components

| Contract | Address |
|---|---|
| PoolManager | `0xfaf156a5a6c36b1b280f64d420869b06e4c98f80` |
| ProposalTokens | `0x67bb278f3ec57188e7b3e2700186cc7fe1667e23` |
| WaveV4ProposalMarket | `0x2dbbcb13841f336c5e84e632ddf4b3670ade2cb3` |
| HookDeployer | `0xcdfe26b5b6d41ff513385aea7217380401240154` |
| WaveHook | `0x6161F5b70641a560eD784F6a038333FE22f2CAc0` |
| Unrestricted test controller | `0x7a2c138d46969cac26f5946cbfb4edfc50da900d` |

Hook permission bits are **2752**. The CREATE2 salt and addresses are in [the dedicated proof manifest](../deployments/aurora-forecast-proof.json). This manifest deliberately differs from the complete Aurora monitoring manifest; do not rename it to `aurora-testnet.json`.

## Verified so far

- PoolManager deployment receipt succeeded; onchain owner and nonempty code checked.
- Tokens, adapter, actual CREATE2 deployer and permission-mined WaveHook deployed successfully. Hook-to-adapter and adapter-to-hook bindings were read back.
- All 111 source files referenced in the cached compiled artifacts matched their metadata keccak256 hashes against the current source tree. Solidity compiler: 0.8.26. See [source check](test-evidence/aurora-compiled-source-check.json).
- The test controller seeded actual v4 liquidity with test complete sets. A real onchain LONG purchase received exactly the quoted `1906610893880149131` raw LONG units, with a 99% quote minimum.
- The market signal moved from `500000000000000000` to `547376157918720426` (50% to approximately 54.74%).

PoolManager deployment transaction: `0x7ae1e1641bdfbefaeb586c6c76d6595a7eadb46610f02454f2766f8458242c01`.

Actual swap transaction: `0x40c2fd86e6e5a6797494ba2c747bd2ef072fd5d78e1e3a254ae1560fd3cbe280`.

[Bootstrap receipts](test-evidence/aurora-forecast-bootstrap.json) contain the other transaction hashes. Final TWAP closure and pool finalization both confirmed. The final probability TWAP was `543033343442837720` (approximately 54.3033%). TWAP close: `0xcc7c4a3a13067e85984b05fe470638f7e16d649b8fb3df7fc790c5b1f79baed9`; liquidity removal: `0x748a72e9e1c3364995e7715cce6f99bae5c9db21fe79236556bc8e0b284b4c7a`. See [trade and closure evidence](test-evidence/aurora-forecast-trade.json). A read-only polling timeout interrupted waiting for the window; the swap was already confirmed. Only the pending permissionless TWAP close and pool finalization were subsequently submitted, without replaying the swap.

## Remaining gates

A full real QuantumRound/Safe/module/tracker deployment, fresh authenticated settlement prices, an actual investment AMM fill, a complete model-driven round and forecaster redemption remain pending. The test-controller trade does not validate financial solvency, oracle quality, Safe permissions or investment execution. No mainnet wallet or assets were used.

One real NEAR AI response challenge also passed separately. It did not generate a strategy or move funds; see [agent-layer details](AGENT-LAYER.md#provider-smoke-check--10-november-2026).

## Verification and next implementation

42 runtime tests, frontend TypeScript checking and Next.js production build passed in the dedicated Docker environment. A scratch mutation removing nonce validation made the new smoke regression fail; restoring it returned the tests to green. No Solidity source changed in this increment; the earlier 400-test contract baseline was not rerun.

Next, deploy a fresh genuine Safe/QuantumRound/module/tracker stack using the existing deployment recipe. The test-controller-bound adapter above cannot become that stack. Verify the investment router separately; fresh authenticated oracle data is still an external gate. The single approved inference smoke request does not authorize continuous paid agent calls.
