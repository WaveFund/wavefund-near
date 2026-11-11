// Funding routes allowed by this client. A route is listed only after ALL of the following were observed live:
//  - both assets in GET /v0/tokens with the stated blockchain, ERC-20 contract and decimals,
//  - a provider-signed dry quote for the exact request shape, verified with the pinned 1Click key,
//  - the Aurora engine's own NEP-141 -> ERC-20 mapping and the ERC-20's code/decimals on Aurora mainnet.
// Evidence: runtime/test/fixtures/intents/live/ (captured 2026-11-11). A completed delivery has NOT been observed.
// The single approved route is Arbitrum One native USDC -> Aurora mainnet Safe. The earlier Ethereum USDC route
// evidence is retained in fixtures as history only; that route is no longer approved here.
export const AURORA_MAINNET_CHAIN_ID = 1313161554;

export const VERIFIED_FUNDING_ROUTES = Object.freeze([
  Object.freeze({
    id: 'arb-usdc-to-aurora-usdc',
    source: Object.freeze({
      chain: 'arb', chainId: 42161,
      assetId: 'nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near',
      tokenAddress: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', decimals: 6,
    }),
    destination: Object.freeze({
      network: 'aurora-mainnet', chainId: AURORA_MAINNET_CHAIN_ID, virtualChainAccount: 'aurora', providerBlockchain: 'near',
      assetId: 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
      tokenAddress: '0x368ebb46aca6b8d0787c96b2b20bd3cc3f2c45f7', decimals: 6,
    }),
    // Live 2026-11-11 15:17 UTC: 1 unit -> "Amount is too low for bridge, try at least 5301". Bridge minimums move;
    // the provider still enforces its current one. This is a local floor, not a guarantee.
    minimumAmountIn: '5301',
    // Delivery has never been observed. Do not mark the shared route liveVerified on this evidence alone.
    deliveryProven: false,
    evidence_status: 'signed Arbitrum dry quotes 2026-11-11 (example destination Safe); no delivery observed',
    evidence: 'fixtures/intents/live/{arb-identity-and-minimum.json,quote-dry-arb-usdc-to-aurora.json}',
  }),
]);

export function findFundingRoute(request) {
  return VERIFIED_FUNDING_ROUTES.find((route) =>
    route.source.chain === request.source.chain && route.source.chainId === request.source.chainId
    && route.source.assetId === request.source.assetId && route.source.tokenAddress === request.source.tokenAddress.toLowerCase()
    && route.destination.chainId === request.destination.chainId && route.destination.virtualChainAccount === request.destination.virtualChainAccount
    && route.destination.assetId === request.destination.assetId && route.destination.tokenAddress === request.destination.tokenAddress.toLowerCase()) ?? null;
}
