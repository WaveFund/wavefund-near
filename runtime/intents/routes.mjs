// Funding routes allowed by this client. A route is listed only after ALL of the following were observed live:
//  - both assets in GET /v0/tokens with the stated blockchain, ERC-20 contract and decimals,
//  - a provider-signed dry quote for the exact request shape, verified with the pinned 1Click key,
//  - the Aurora engine's own NEP-141 -> ERC-20 mapping and the ERC-20's code/decimals on Aurora mainnet.
// Evidence: runtime/test/fixtures/intents/live/ (captured 2026-11-11). A completed delivery has NOT been observed.
export const AURORA_MAINNET_CHAIN_ID = 1313161554;

export const VERIFIED_FUNDING_ROUTES = Object.freeze([
  Object.freeze({
    id: 'eth-usdc-to-aurora-usdc',
    source: Object.freeze({
      chain: 'eth', chainId: 1,
      assetId: 'nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near',
      tokenAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', decimals: 6,
    }),
    destination: Object.freeze({
      network: 'aurora-mainnet', chainId: AURORA_MAINNET_CHAIN_ID, virtualChainAccount: 'aurora', providerBlockchain: 'near',
      assetId: 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
      tokenAddress: '0x368ebb46aca6b8d0787c96b2b20bd3cc3f2c45f7', decimals: 6,
    }),
    // Smallest amount accepted by a live dry quote was above this; "try at least 300001" for smaller ones.
    minimumAmountIn: '300001',
    // Status flags for integration review. Delivery has never been observed, and EVM-origin quoting was
    // unavailable on the 10:42 UTC recheck. Do not mark the shared route liveVerified on this evidence alone.
    deliveryProven: false,
    evidence_status: 'signed dry quotes 2026-11-11 10:09-10:16 UTC; EVM-origin quoting unavailable from 10:42 UTC; no delivery observed',
    evidence: 'fixtures/intents/live/{tokens-subset.json,quote-dry-eth-usdc-to-aurora.json,probes/}',
  }),
]);

export function findFundingRoute(request) {
  return VERIFIED_FUNDING_ROUTES.find((route) =>
    route.source.chain === request.source.chain && route.source.chainId === request.source.chainId
    && route.source.assetId === request.source.assetId && route.source.tokenAddress === request.source.tokenAddress.toLowerCase()
    && route.destination.chainId === request.destination.chainId && route.destination.virtualChainAccount === request.destination.virtualChainAccount
    && route.destination.assetId === request.destination.assetId && route.destination.tokenAddress === request.destination.tokenAddress.toLowerCase()) ?? null;
}
