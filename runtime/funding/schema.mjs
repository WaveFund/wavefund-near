import { createHash } from 'node:crypto';

export class FundingError extends Error {
  constructor(code) { super(code); this.name = 'FundingError'; this.code = code; }
}
export const requireFunding = (condition, code) => { if (!condition) throw new FundingError(code); };
export const clone = value => structuredClone(value);
export function exact(value, keys) {
  requireFunding(value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === [...keys].sort().join(','), 'INVALID_FIELDS');
}
// Funding hashes deliberately do not reuse/change the historical agent JSON digest.
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  requireFunding(value !== undefined && (typeof value !== 'number' || Number.isSafeInteger(value)), 'INVALID_HASH_VALUE');
  return JSON.stringify(value);
}
export const fundingHash = value => `0x${createHash('sha256').update(stable(value)).digest('hex')}`;
export function address(value) {
  requireFunding(typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value) && !/^0x0{40}$/i.test(value), 'INVALID_ADDRESS');
  return value.toLowerCase();
}
export function identifier(value) {
  requireFunding(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value), 'INVALID_ID'); return value;
}
export function amount(value, zero = false) {
  requireFunding(typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value)
    && BigInt(value) < 2n ** 256n && (zero || BigInt(value) > 0n), 'INVALID_AMOUNT'); return value;
}
export function timestamp(value) { requireFunding(Number.isSafeInteger(value) && value > 0, 'INVALID_TIMESTAMP'); return value; }
export function txHash(value) { requireFunding(typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value), 'INVALID_TX_HASH'); return value.toLowerCase(); }
export function asset(value) {
  exact(value, ['chainId', 'assetId', 'token', 'decimals']);
  requireFunding(Number.isSafeInteger(value.chainId) && value.chainId > 0, 'INVALID_CHAIN');
  requireFunding(typeof value.assetId === 'string' && /^nep(141|245):[^\s\x00-\x1f]{1,256}$/.test(value.assetId), 'INVALID_ASSET_ID');
  requireFunding(Number.isInteger(value.decimals) && value.decimals >= 0 && value.decimals <= 36, 'INVALID_DECIMALS');
  return { ...value, token: address(value.token) };
}
export function approvedRoute(input) {
  exact(input, ['routeId', 'enabled', 'liveVerified', 'manager', 'safe', 'source', 'destination', 'refundRecipient',
    'minAmountIn', 'maxAmountIn', 'minAmountOut', 'maxQuoteLifetimeSeconds', 'maxObservationAgeSeconds', 'minimumConfirmations']);
  const route = clone(input);
  identifier(route.routeId);
  requireFunding(typeof route.enabled === 'boolean' && typeof route.liveVerified === 'boolean', 'INVALID_ROUTE_FLAGS');
  requireFunding(!route.enabled || route.liveVerified, 'UNVERIFIED_ROUTE');
  route.manager = address(route.manager); route.safe = address(route.safe); route.refundRecipient = address(route.refundRecipient);
  requireFunding(route.refundRecipient === route.manager, 'REFUND_NOT_MANAGER');
  route.source = asset(route.source); route.destination = asset(route.destination);
  requireFunding(route.destination.chainId === 1313161554, 'DESTINATION_NOT_AURORA_MAINNET');
  requireFunding(route.destination.decimals === 6, 'DESTINATION_DECIMALS_UNSUPPORTED');
  requireFunding(route.source.chainId !== 1313161555 && route.source.chainId !== route.destination.chainId, 'INVALID_SOURCE_NETWORK');
  for (const key of ['minAmountIn', 'maxAmountIn', 'minAmountOut']) amount(route[key]);
  requireFunding(BigInt(route.minAmountIn) <= BigInt(route.maxAmountIn), 'INVALID_AMOUNT_LIMITS');
  for (const key of ['maxQuoteLifetimeSeconds', 'maxObservationAgeSeconds', 'minimumConfirmations']) {
    requireFunding(Number.isSafeInteger(route[key]) && route[key] > 0 && route[key] <= 86400, 'INVALID_ROUTE_LIMIT');
  }
  return route;
}
export function configuration(input) {
  exact(input, ['schemaVersion', 'routes']);
  requireFunding(input.schemaVersion === 1 && Array.isArray(input.routes), 'INVALID_CONFIGURATION');
  const routes = input.routes.map(approvedRoute);
  requireFunding(new Set(routes.map(r => r.routeId)).size === routes.length, 'DUPLICATE_ROUTE');
  return { schemaVersion: 1, routes, configurationHash: fundingHash({ schemaVersion: 1, routes }) };
}
export const FUNDING_STATES = Object.freeze(['quoted', 'dispatching', 'pending', 'delivered', 'refunded', 'needs_review']);
export const unresolved = record => Boolean(record.readiness) || !['delivered', 'refunded'].includes(record.state);
export function fundingRequest(input, config, now) {
  exact(input, ['fundingId', 'routeId', 'configurationHash', 'manager', 'safe', 'source', 'destination', 'amountIn', 'minAmountOut', 'refundRecipient', 'expiresAt']);
  const request = clone(input); identifier(request.fundingId); identifier(request.routeId);
  const route = config.routes.find(r => r.routeId === request.routeId);
  requireFunding(route?.enabled && route.liveVerified, 'ROUTE_UNAVAILABLE');
  requireFunding(request.configurationHash === config.configurationHash, 'CONFIGURATION_CHANGED');
  request.manager = address(request.manager); request.safe = address(request.safe); request.refundRecipient = address(request.refundRecipient);
  requireFunding(request.manager === route.manager && request.safe === route.safe && request.refundRecipient === route.refundRecipient, 'REQUEST_IDENTITY_MISMATCH');
  request.source = asset(request.source); request.destination = asset(request.destination);
  requireFunding(fundingHash(request.source) === fundingHash(route.source) && fundingHash(request.destination) === fundingHash(route.destination), 'REQUEST_ASSET_MISMATCH');
  amount(request.amountIn); amount(request.minAmountOut); timestamp(request.expiresAt);
  requireFunding(BigInt(request.amountIn) >= BigInt(route.minAmountIn) && BigInt(request.amountIn) <= BigInt(route.maxAmountIn)
    && BigInt(request.minAmountOut) >= BigInt(route.minAmountOut), 'REQUEST_AMOUNT_LIMIT');
  requireFunding(request.expiresAt > now && request.expiresAt <= now + route.maxQuoteLifetimeSeconds, 'QUOTE_EXPIRED');
  return request;
}
