import { encodeFunctionData, parseAbi } from 'viem';
import { VERIFIED_FUNDING_ROUTES, toProviderFundingRequest } from '../intents/index.mjs';
import { address, amount, clone, exact, fundingHash, identifier, timestamp, requireFunding as check } from './schema.mjs';

export const FUNDING_DEMO_LIMITS = Object.freeze({ amountIn: '1000000', minAmountOut: '980000', maxGasCostWei: '10000000000000', maxQuoteSeconds: 300, maxSourceAgeSeconds: 30 });
const transferAbi = parseAbi(['function transfer(address to,uint256 amount) returns(bool)']);

// Explicit first-delivery demonstration, NOT a production-approved route or a
// mainnet round authorization. Does not change approved-routes.json or move funds.
export function fundingDemoRequest({ manifest, fundingId, expiresAt, now }) {
  identifier(fundingId); timestamp(now); timestamp(expiresAt);
  check(manifest?.purpose === 'mainnet-funding-proof-only' && manifest.chainId === 1313161554
    && manifest.wavefundModuleEnabled === false, 'DEMO_SAFE_CONFIGURATION');
  const route = VERIFIED_FUNDING_ROUTES.find(r => r.id === 'arb-usdc-to-aurora-usdc');
  check(route, 'DEMO_ROUTE_UNAVAILABLE');
  check(expiresAt > now && expiresAt <= now + FUNDING_DEMO_LIMITS.maxQuoteSeconds, 'QUOTE_EXPIRED');
  const manager = address(manifest.manager); const safe = address(manifest.safe);
  check(address(manifest.refundRecipient) === manager && manager !== safe, 'DEMO_REFUND_MISMATCH');
  return { fundingId, routeId: route.id,
    configurationHash: fundingHash({ purpose: 'bounded-first-delivery-proof', manager, safe, routeId: route.id, limits: FUNDING_DEMO_LIMITS }),
    manager, safe, source: { chainId: route.source.chainId, assetId: route.source.assetId, token: route.source.tokenAddress, decimals: route.source.decimals },
    destination: { chainId: route.destination.chainId, assetId: route.destination.assetId, token: route.destination.tokenAddress, decimals: route.destination.decimals },
    amountIn: FUNDING_DEMO_LIMITS.amountIn, minAmountOut: FUNDING_DEMO_LIMITS.minAmountOut, refundRecipient: manager, expiresAt };
}

export function fundingDemoPreviewInput(options) {
  return toProviderFundingRequest(fundingDemoRequest(options), { slippageBps: 100 });
}

// verifyQuote is B's trusted signed-quote/archival capability. No provider request
// is made here. An executable quote must be separately authorized and supplied.
export async function prepareFundingDemoDeposit({ manifest, request: input, providerQuote, verifyQuote, sourceState: stateInput, clock = () => Math.floor(Date.now() / 1000) }) {
  const request = clone(input); const sourceState = clone(stateInput);
  const expected = fundingDemoRequest({ manifest, fundingId: request.fundingId, expiresAt: request.expiresAt, now: timestamp(clock()) });
  check(fundingHash(request) === fundingHash(expected), 'DEMO_REQUEST_CHANGED');
  check(typeof verifyQuote === 'function', 'QUOTE_VERIFIER_UNAVAILABLE');
  const quote = clone(await verifyQuote(clone(providerQuote), clone(request)));
  check(quote.requestHash === fundingHash(request) && quote.evidenceQuality === 'live-verified', 'DEMO_QUOTE_NOT_LIVE');
  check(quote.amountIn === request.amountIn && BigInt(amount(quote.minAmountOut)) >= BigInt(request.minAmountOut), 'DEMO_QUOTE_AMOUNT');
  check(timestamp(quote.expiresAt) <= request.expiresAt && quote.expiresAt > timestamp(clock()), 'QUOTE_EXPIRED');
  identifier(quote.reference); const depositAddress = address(quote.depositAddress);
  exact(sourceState, ['chainId', 'manager', 'token', 'balanceUSDC', 'balanceETH', 'nonce', 'gasLimit', 'gasPrice', 'observedAt']);
  check(sourceState.chainId === request.source.chainId && address(sourceState.manager) === request.manager
    && address(sourceState.token) === request.source.token, 'DEMO_SOURCE_IDENTITY');
  check(Number.isSafeInteger(sourceState.nonce) && sourceState.nonce >= 0, 'DEMO_NONCE_INVALID');
  for (const key of ['balanceUSDC', 'balanceETH']) amount(sourceState[key], true);
  for (const key of ['gasLimit', 'gasPrice']) amount(sourceState[key]);
  check(BigInt(sourceState.gasLimit) >= 21000n, 'DEMO_GAS_INVALID');
  const maximumGasCostWei = BigInt(sourceState.gasLimit) * BigInt(sourceState.gasPrice);
  check(maximumGasCostWei <= BigInt(FUNDING_DEMO_LIMITS.maxGasCostWei), 'DEMO_GAS_CAP');
  check(BigInt(sourceState.balanceUSDC) >= BigInt(request.amountIn) && BigInt(sourceState.balanceETH) >= maximumGasCostWei, 'DEMO_SOURCE_UNFUNDED');
  const now = timestamp(clock()); timestamp(sourceState.observedAt);
  check(sourceState.observedAt <= now && now - sourceState.observedAt <= FUNDING_DEMO_LIMITS.maxSourceAgeSeconds, 'DEMO_SOURCE_STALE');
  const transaction = { chainId: request.source.chainId, from: request.manager, to: request.source.token, value: '0',
    data: encodeFunctionData({ abi: transferAbi, functionName: 'transfer', args: [depositAddress, BigInt(request.amountIn)] }),
    nonce: sourceState.nonce, gas: sourceState.gasLimit, gasPrice: sourceState.gasPrice, type: 'legacy' };
  const plan = { schemaVersion: 1, purpose: 'bounded-first-delivery-proof', fundingId: request.fundingId,
    request, quote, transaction, maximumGasCostWei: String(maximumGasCostWei),
    expiresAt: Math.min(quote.expiresAt, sourceState.observedAt + FUNDING_DEMO_LIMITS.maxSourceAgeSeconds),
    unsignedOnly: true, productionRoundReady: false, deliveryProven: false };
  return { ...plan, planHash: fundingHash(plan) };
}
