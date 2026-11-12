import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

// Developer C funding projection: a read model between Developer A's funding service / Developer B's
// dry-quote client and the local HTTP API. It never signs, broadcasts, retries, cancels or moves funds,
// never reads wallet keys, and never accepts a destination, Safe, asset or provider URL from HTTP callers.
// Field names follow A's FundingRecordV1 (runtime/funding/schema.mjs); this module defines no state machine.

export const AURORA_MAINNET_CHAIN_ID = 1313161554;
export const AURORA_TESTNET_CHAIN_ID = 1313161555;
export const PREVIEW_LIFETIME_SECONDS = 300;
export const PREVIEW_MIN_OUT_BPS = 9800n;
export const PREVIEW_MIN_INTERVAL_MS = 3000;

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const INTEGER = /^(0|[1-9][0-9]{0,77})$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const ASSET_ID = /^nep(141|245):[\x21-\x7e]{1,256}$/;
const CORRELATION = /^[A-Za-z0-9-]{1,100}$/;
const VERSION = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const STATES = new Set(['quoted', 'dispatching', 'pending', 'delivered', 'refunded', 'needs_review']);
const OBSERVATIONS = new Set(['PENDING_DEPOSIT', 'KNOWN_DEPOSIT_TX', 'INCOMPLETE_DEPOSIT', 'PROCESSING', 'SUCCESS', 'REFUNDED', 'FAILED']);
const EVIDENCE_QUALITY = new Set(['live-verified', 'fixture']);
const KNOWN_SYMBOLS = Object.freeze({
  '0xaf88d065e77c8cc2239327c5edb3a432268e5831': 'USDC', // Arbitrum One native USDC (B's verified route identity)
  '0x368ebb46aca6b8d0787c96b2b20bd3cc3f2c45f7': 'USDC', // Aurora mainnet bridged NEP-141 USDC (B's verified route identity)
});
const SOURCE_NETWORKS = Object.freeze({ 42161: 'Arbitrum One', 1: 'Ethereum' });

// Informational only: routes that are deliberately NOT selectable. Each reason is a documented fact.
export const UNSUPPORTED_ROUTES = Object.freeze([
  Object.freeze({ id: 'eth-usdc-to-aurora-usdc', label: 'Ethereum · USDC', reason: 'Retired. Earlier signed dry quotes are kept as history only; the provider client no longer approves this route.' }),
  Object.freeze({ id: 'base-usdc-to-aurora-usdc', label: 'Base · USDC', reason: 'Not verified. EVM-origin quoting was intermittently unavailable and no route evidence exists.' }),
  Object.freeze({ id: 'near-account-to-aurora', label: 'NEAR account · any asset', reason: 'Unsupported in funding schema v1, which accepts only an EVM-chain ERC-20 source.' }),
]);

// Fixed public messages. Provider, chain and service error text is never reflected to callers.
const MESSAGES = Object.freeze({
  INVALID_JSON: 'The request body must be a small JSON object.',
  UNSUPPORTED_MEDIA_TYPE: 'Send the request body as application/json.',
  BODY_TOO_LARGE: 'The request body is too large.',
  INVALID_REQUEST: 'The request does not match the accepted fields for this endpoint.',
  ROUTE_UNAVAILABLE: 'That funding route is not available.',
  INVALID_AMOUNT: 'Enter a positive whole number of base units.',
  AMOUNT_TOO_LOW: 'The amount is below the observed bridge minimum for this route.',
  AMOUNT_TOO_HIGH: 'The amount is above the preview limit for this route.',
  PREVIEW_UNAVAILABLE: 'Dry-quote preview is not connected.',
  PREVIEW_RATE_LIMITED: 'A dry quote was requested moments ago. Wait a few seconds and try again.',
  QUOTING_UNAVAILABLE: 'NEAR Intents is not quoting this route right now. Nothing was created or sent.',
  PROVIDER_ERROR: 'The quote provider rejected the dry quote. Nothing was created or sent.',
  SIGNATURE_INVALID: 'The provider signature did not verify, so the quote was discarded.',
  PREVIEW_MISMATCH: 'The returned quote did not match the trusted request, so it was discarded.',
  RECORDS_UNAVAILABLE: 'The funding record service is not connected.',
  FUNDING_NOT_FOUND: 'No funding record exists with that id.',
  SUBMISSION_REJECTED: 'The funding service did not accept that transaction reference.',
  FUNDING_SERVICE_ERROR: 'The funding service could not complete the request.',
});
const PROVIDER_UNAVAILABLE_CODES = new Set(['QUOTING_UNAVAILABLE', 'NO_LIQUIDITY', 'PROVIDER_UNAVAILABLE', 'RATE_LIMITED', 'TIMEOUT', 'TRANSPORT_FAILED', 'UNSUPPORTED_ASSET', 'ASSET_CHAIN_MISMATCH']);

export class FundingApiError extends Error {
  constructor(code, status = 400, upstreamCode = null) {
    super(MESSAGES[code] ?? MESSAGES.FUNDING_SERVICE_ERROR);
    this.name = 'FundingApiError';
    this.code = Object.hasOwn(MESSAGES, code) ? code : 'FUNDING_SERVICE_ERROR';
    this.status = status;
    this.upstreamCode = typeof upstreamCode === 'string' && CODE.test(upstreamCode) ? upstreamCode : null;
  }
  toJSON() { return { error: this.message, code: this.code, ...(this.upstreamCode ? { upstreamCode: this.upstreamCode } : {}) }; }
}
const fail = (code, status, upstreamCode) => { throw new FundingApiError(code, status, upstreamCode); };

export function publicFundingError(error) {
  if (error instanceof FundingApiError) return error;
  if (error?.name === 'IntentsError') {
    if (error.code === 'AMOUNT_TOO_LOW') return new FundingApiError('AMOUNT_TOO_LOW', 400, error.code);
    if (error.code === 'SIGNATURE_INVALID') return new FundingApiError('SIGNATURE_INVALID', 502, error.code);
    if (PROVIDER_UNAVAILABLE_CODES.has(error.code)) return new FundingApiError('QUOTING_UNAVAILABLE', 503, error.code);
    return new FundingApiError('PROVIDER_ERROR', 502, error.code);
  }
  if (error?.name === 'FundingError') {
    if (error.code === 'FUNDING_NOT_FOUND' || error.code === 'INVALID_ID') return new FundingApiError('FUNDING_NOT_FOUND', 404, error.code);
    return new FundingApiError('SUBMISSION_REJECTED', 409, error.code);
  }
  return new FundingApiError('FUNDING_SERVICE_ERROR', 503);
}

const lower = (value) => value.toLowerCase();
const isAddress = (value) => typeof value === 'string' && ADDRESS.test(value) && !/^0x0{40}$/i.test(value);
const isInteger = (value) => typeof value === 'string' && INTEGER.test(value) && BigInt(value) < 2n ** 256n;
const isTimestamp = (value) => Number.isSafeInteger(value) && value > 0;
const exactKeys = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');

function requireConfig(condition, message) { if (!condition) throw new Error(`Funding configuration rejected: ${message}`); }

// deployments/aurora-mainnet-funding-safe.json, re-validated. It is a funding-proof Safe, not a Wavefund stack.
export function validateFundingSafe(input) {
  requireConfig(input?.schemaVersion === 1, 'unsupported Safe manifest schema');
  requireConfig(input.chainId === AURORA_MAINNET_CHAIN_ID, 'funding Safe must be on Aurora mainnet 1313161554');
  for (const key of ['safe', 'manager', 'refundRecipient']) requireConfig(isAddress(input[key]), `invalid ${key}`);
  const safe = lower(input.safe); const manager = lower(input.manager); const refundRecipient = lower(input.refundRecipient);
  requireConfig(refundRecipient === manager, 'refund recipient must be the manager wallet');
  requireConfig(safe !== manager, 'Safe and manager wallet must differ');
  return Object.freeze({
    chainId: AURORA_MAINNET_CHAIN_ID, safe, manager, refundRecipient,
    safeVersion: typeof input.safeVersion === 'string' && VERSION.test(input.safeVersion) ? input.safeVersion : null,
    purpose: input.purpose === 'mainnet-funding-proof-only' ? input.purpose : null,
    wavefundModuleEnabled: input.wavefundModuleEnabled === true,
    intentsDeliveryProven: input.intentsDeliveryProven === true,
  });
}

// deployments/aurora-testnet.json, re-validated: the strategy stack whose Safe and stable token a round uses.
// Readiness can only ever be shown for this Safe and token. The manifest is not independently verified.
export const STRATEGY_TOKEN_DECIMALS = 6; // ProposerRegistry's constructor rejects any strategy stable that does not use 6 decimals.
export function validateStrategyDeployment(input, source = 'deployments/aurora-testnet.json') {
  requireConfig(input?.schemaVersion === 1, 'unsupported strategy manifest schema');
  requireConfig(input.chainId === AURORA_TESTNET_CHAIN_ID, 'the strategy deployment in this build must be Aurora testnet 1313161555');
  const contracts = input.contracts ?? {};
  for (const key of ['safe', 'stable', 'module']) requireConfig(isAddress(contracts[key]), `invalid strategy ${key}`);
  requireConfig(lower(contracts.safe) !== lower(contracts.stable), 'strategy Safe and stable token must differ');
  return Object.freeze({
    chainId: AURORA_TESTNET_CHAIN_ID, safe: lower(contracts.safe), token: lower(contracts.stable), module: lower(contracts.module),
    decimals: STRATEGY_TOKEN_DECIMALS, symbol: 'USDC', source: typeof source === 'string' && /^[\w./-]{1,120}$/.test(source) ? source : null,
  });
}

function validateVerifiedRoute(route) {
  requireConfig(typeof route?.id === 'string' && IDENTIFIER.test(route.id), 'invalid verified route id');
  const { source, destination } = route;
  requireConfig(Number.isSafeInteger(source?.chainId) && source.chainId !== AURORA_TESTNET_CHAIN_ID && source.chainId !== AURORA_MAINNET_CHAIN_ID, 'invalid source network');
  requireConfig(destination?.chainId === AURORA_MAINNET_CHAIN_ID, 'route destination must be Aurora mainnet');
  for (const asset of [source, destination]) {
    requireConfig(typeof asset.assetId === 'string' && ASSET_ID.test(asset.assetId), 'invalid asset id');
    requireConfig(isAddress(asset.tokenAddress), 'invalid token address');
    requireConfig(Number.isInteger(asset.decimals) && asset.decimals >= 0 && asset.decimals <= 36, 'invalid decimals');
  }
  requireConfig(isInteger(route.minimumAmountIn) && BigInt(route.minimumAmountIn) > 0n, 'invalid route minimum');
  return route;
}

const assetView = (asset) => ({
  chainId: asset.chainId, assetId: asset.assetId, token: lower(asset.tokenAddress ?? asset.token), decimals: asset.decimals,
  symbol: KNOWN_SYMBOLS[lower(asset.tokenAddress ?? asset.token)] ?? null,
});

export function createFundingReadModel({
  mode, approved, verifiedRoutes, fundingSafe, strategyDeployment = null, previewOrder = null, service = null, allowSubmitted = false,
  clock = () => Math.floor(Date.now() / 1000), nowMs = () => Date.now(),
}) {
  requireConfig(['live-preview', 'injected'].includes(mode), 'unknown funding mode');
  requireConfig(approved && Array.isArray(approved.routes) && typeof approved.configurationHash === 'string' && HASH.test(approved.configurationHash), 'approved routes must come from the funding core configuration()');
  requireConfig(Array.isArray(verifiedRoutes) && verifiedRoutes.length > 0, 'no verified provider routes');
  requireConfig(previewOrder === null || typeof previewOrder === 'function', 'previewOrder must be a function');
  requireConfig(service === null || (typeof service.get === 'function' && typeof service.getConfiguration === 'function'), 'invalid funding service');
  requireConfig(!allowSubmitted || typeof service?.recordSubmitted === 'function', 'submission recording requires the funding service');
  requireConfig(service === null || service.getConfiguration().configurationHash === approved.configurationHash, 'funding service uses a different configuration');
  const safe = validateFundingSafe(fundingSafe);
  const strategy = strategyDeployment === null ? null : validateStrategyDeployment(strategyDeployment);
  const routes = verifiedRoutes.map(validateVerifiedRoute);
  for (const route of approved.routes) {
    requireConfig(route.destination.chainId === AURORA_MAINNET_CHAIN_ID, 'approved route destination must be Aurora mainnet');
    requireConfig(lower(route.safe) === safe.safe && lower(route.manager) === safe.manager, 'approved route Safe/manager differs from the funding Safe manifest');
  }
  const capabilities = Object.freeze({
    preview: previewOrder !== null, executableQuote: false, submitted: Boolean(allowSubmitted && service), records: service !== null, signing: false, broadcast: false,
  });
  let previewInFlight = false; let lastPreviewAt = 0;

  function approvedFor(routeId) { return approved.routes.find((route) => route.routeId === routeId) ?? null; }
  function previewMaximum(route) {
    const approvedRoute = approvedFor(route.id);
    return approvedRoute?.maxAmountIn ?? (10n ** BigInt(route.source.decimals) * 1_000_000n).toString();
  }
  function routeView(route) {
    const approvedRoute = approvedFor(route.id);
    const approvedForFunding = Boolean(approvedRoute?.enabled && approvedRoute?.liveVerified);
    const notes = [];
    if (route.deliveryProven !== true) notes.push('DELIVERY_NOT_OBSERVED');
    if (!approvedForFunding) notes.push('NOT_APPROVED_FOR_FUNDING');
    if (!capabilities.executableQuote) notes.push('EXECUTABLE_QUOTES_DISABLED');
    return {
      routeId: route.id,
      label: `${SOURCE_NETWORKS[route.source.chainId] ?? `Chain ${route.source.chainId}`} · ${KNOWN_SYMBOLS[lower(route.source.tokenAddress)] ?? 'token'}`,
      source: assetView(route.source), destination: assetView(route.destination),
      minimumAmountIn: route.minimumAmountIn, maximumAmountIn: previewMaximum(route),
      previewAvailable: capabilities.preview, approvedForFunding, deliveryProven: route.deliveryProven === true,
      minimumConfirmations: approvedRoute?.minimumConfirmations ?? null, notes,
    };
  }

  function eligibility() {
    const anyApproved = approved.routes.some((route) => route.enabled && route.liveVerified);
    const anyDelivery = safe.intentsDeliveryProven || routes.some((route) => route.deliveryProven === true);
    // There is no reviewed Aurora mainnet Wavefund deployment manifest in this checkout. The verified
    // strategy deployment is Aurora testnet, so mainnet funding can never make that round ready.
    const checks = [
      { id: 'same-network', ok: false, label: 'Funding destination and round deployment share one network', detail: `Funding lands on Aurora mainnet ${AURORA_MAINNET_CHAIN_ID}; the verified Wavefund round deployment is Aurora testnet ${AURORA_TESTNET_CHAIN_ID}.` },
      { id: 'mainnet-deployment', ok: false, label: 'Reviewed Aurora mainnet Wavefund deployment', detail: 'No reviewed mainnet deployment manifest with pinned code hashes exists yet.' },
      { id: 'module-enabled', ok: safe.wavefundModuleEnabled, label: 'Wavefund module enabled on the funding Safe', detail: safe.wavefundModuleEnabled ? 'Enabled according to the trusted manifest.' : 'The funding Safe is a proof Safe; no Wavefund module is enabled.' },
      { id: 'route-approved', ok: anyApproved, label: 'Live-verified route approved for sending', detail: anyApproved ? 'At least one route is enabled in production configuration.' : 'Production funding configuration has no enabled route.' },
      { id: 'delivery-observed', ok: anyDelivery, label: 'A NEAR Intents delivery has been observed', detail: anyDelivery ? 'Delivery evidence is recorded.' : 'No delivery to Aurora has been observed or authorized.' },
    ];
    return { eligible: checks.every((check) => check.ok), roundChainId: AURORA_TESTNET_CHAIN_ID, checks };
  }

  function config() {
    return {
      schemaVersion: 1, mode, evidence: 'live', configurationHash: approved.configurationHash,
      destination: { chainId: safe.chainId, network: 'aurora-mainnet', safe: safe.safe, safeVersion: safe.safeVersion, purpose: safe.purpose, wavefundModuleEnabled: safe.wavefundModuleEnabled, ...pickDestinationAsset() },
      manager: safe.manager, refundRecipient: safe.refundRecipient,
      routes: routes.map(routeView), unsupported: UNSUPPORTED_ROUTES.map((route) => ({ ...route })),
      // Identity of the strategy stack a round runs on. Display/binding only: it is never a funding destination.
      strategy: strategy ? { chainId: strategy.chainId, safe: strategy.safe, token: strategy.token, decimals: strategy.decimals, symbol: strategy.symbol, source: strategy.source } : null,
      eligibility: eligibility(), capabilities: { ...capabilities }, observedAt: clock(),
    };
  }
  function pickDestinationAsset() {
    const destination = assetView(routes[0].destination);
    return { token: destination.token, assetId: destination.assetId, decimals: destination.decimals, symbol: destination.symbol };
  }

  async function preview(body) {
    if (!capabilities.preview) fail('PREVIEW_UNAVAILABLE', 404);
    if (!exactKeys(body, ['routeId', 'amountIn'])) fail('INVALID_REQUEST', 400);
    const route = typeof body.routeId === 'string' ? routes.find((item) => item.id === body.routeId) : null;
    if (!route) fail('ROUTE_UNAVAILABLE', 400);
    if (route.source.decimals !== route.destination.decimals) fail('ROUTE_UNAVAILABLE', 400);
    if (!isInteger(body.amountIn) || body.amountIn === '0') fail('INVALID_AMOUNT', 400);
    const amountIn = BigInt(body.amountIn);
    if (amountIn < BigInt(route.minimumAmountIn)) fail('AMOUNT_TOO_LOW', 400);
    if (amountIn > BigInt(previewMaximum(route))) fail('AMOUNT_TOO_HIGH', 400);
    if (previewInFlight || nowMs() - lastPreviewAt < PREVIEW_MIN_INTERVAL_MS) fail('PREVIEW_RATE_LIMITED', 429);
    previewInFlight = true; lastPreviewAt = nowMs();
    try {
      const now = clock();
      // Every identity comes from trusted configuration; the caller supplies only route id and amount.
      const request = {
        fundingId: `preview-${randomUUID()}`, routeId: route.id, configurationHash: approved.configurationHash,
        manager: safe.manager, safe: safe.safe,
        source: { chainId: route.source.chainId, assetId: route.source.assetId, token: lower(route.source.tokenAddress), decimals: route.source.decimals },
        destination: { chainId: route.destination.chainId, assetId: route.destination.assetId, token: lower(route.destination.tokenAddress), decimals: route.destination.decimals },
        amountIn: amountIn.toString(), minAmountOut: (amountIn * PREVIEW_MIN_OUT_BPS / 10_000n).toString(),
        refundRecipient: safe.refundRecipient, expiresAt: now + PREVIEW_LIFETIME_SECONDS,
      };
      let quote;
      try { quote = await previewOrder(structuredClone(request)); } catch (error) { throw publicFundingError(error); }
      return projectPreview(quote, request);
    } finally { previewInFlight = false; }
  }

  function projectPreview(quote, request) {
    const amounts = quote?.amounts; const funding = quote?.funding;
    const valid = quote?.kind === 'DRY_QUOTE' && quote.dry === true && quote.funded === false && quote.deposit == null
      && funding && isAddress(funding.safeAddress) && lower(funding.safeAddress) === request.safe
      && isAddress(funding.refundAddress) && lower(funding.refundAddress) === request.refundRecipient
      && amounts && amounts.amountIn === request.amountIn && isInteger(amounts.amountOut) && isInteger(amounts.minAmountOut)
      && BigInt(amounts.minAmountOut) >= BigInt(request.minAmountOut) && BigInt(amounts.amountOut) >= BigInt(amounts.minAmountOut);
    if (!valid) fail('PREVIEW_MISMATCH', 502);
    const live = quote.mocked === false && quote.source === 'live-provider' && quote.signature?.verified === true;
    const fees = quote.fees ?? {};
    const appFees = Array.isArray(fees.appFees) ? fees.appFees : [];
    const appFeeBps = appFees.every((fee) => Number.isSafeInteger(fee?.fee) && fee.fee >= 0 && fee.fee <= 10_000)
      ? appFees.reduce((sum, fee) => sum + fee.fee, 0) : null;
    const seconds = (iso) => { const ms = typeof iso === 'string' ? Date.parse(iso) : NaN; return Number.isFinite(ms) ? Math.floor(ms / 1000) : null; };
    const effective = seconds(quote.expiry?.effectiveExpiresAt);
    return {
      kind: 'DRY_QUOTE', executable: false, funded: false,
      evidence: live ? 'live-provider-signed' : 'mocked', signatureVerified: quote.signature?.verified === true,
      routeId: request.routeId,
      request: { amountIn: request.amountIn, minAmountOut: request.minAmountOut, expiresAt: request.expiresAt, safe: request.safe, refundRecipient: request.refundRecipient },
      amounts: { amountIn: amounts.amountIn, amountOut: amounts.amountOut, minAmountOut: amounts.minAmountOut },
      fees: {
        refundFee: isInteger(fees.refundFee) ? fees.refundFee : null, withdrawFee: isInteger(fees.withdrawFee) ? fees.withdrawFee : null,
        appFeeBps, feesSigned: fees.feesSigned === true, appFeesSigned: fees.appFeesSigned === true,
      },
      quotedAt: seconds(quote.expiry?.quotedAt), expiresAt: effective !== null ? Math.min(effective, request.expiresAt) : request.expiresAt,
      timeEstimateSeconds: Number.isSafeInteger(quote.timeEstimateSeconds) && quote.timeEstimateSeconds >= 0 ? quote.timeEstimateSeconds : null,
      correlationId: typeof quote.correlationId === 'string' && CORRELATION.test(quote.correlationId) ? quote.correlationId : null,
      payloadSha256: typeof quote.providerPayloadSha256 === 'string' && HEX64.test(quote.providerPayloadSha256) ? quote.providerPayloadSha256 : null,
    };
  }

  function routeLimits(routeId) {
    const route = typeof routeId === 'string' ? service.getConfiguration().routes.find((item) => item.routeId === routeId) : null;
    return { minimumConfirmations: route?.minimumConfirmations ?? null, maxObservationAgeSeconds: route?.maxObservationAgeSeconds ?? null };
  }

  function get(id) {
    if (!capabilities.records) fail('RECORDS_UNAVAILABLE', 404);
    if (typeof id !== 'string' || !IDENTIFIER.test(id)) fail('FUNDING_NOT_FOUND', 404);
    let record;
    try { record = service.get(id); } catch (error) { throw publicFundingError(error); }
    return projectFundingRecord(record, { origin: 'funding-service', route: routeLimits(record?.request?.routeId), observedAt: clock() });
  }

  function submitted(body) {
    if (!capabilities.submitted) fail('RECORDS_UNAVAILABLE', 404);
    if (!exactKeys(body, ['fundingId', 'attemptId', 'transactionHash'])) fail('INVALID_REQUEST', 400);
    if (typeof body.fundingId !== 'string' || !IDENTIFIER.test(body.fundingId) || typeof body.attemptId !== 'string' || !IDENTIFIER.test(body.attemptId)
      || typeof body.transactionHash !== 'string' || !HASH.test(body.transactionHash)) fail('INVALID_REQUEST', 400);
    let record;
    // Records a reference only: A's service makes a repeated identical hash idempotent and a different hash needs_review.
    try { record = service.recordSubmitted(body.fundingId, { attemptId: body.attemptId, transactionHash: body.transactionHash }); } catch (error) { throw publicFundingError(error); }
    return projectFundingRecord(record, { origin: 'funding-service', route: routeLimits(record?.request?.routeId), observedAt: clock() });
  }

  return { mode, capabilities, config, preview, get, submitted };
}

// Bounded JSON body reader for funding endpoints; never echoes parser messages.
export async function readFundingJson(request, limit = 2048) {
  const type = String(request.headers['content-type'] ?? '');
  if (!/^application\/json(\s*;\s*charset=utf-8)?$/i.test(type)) fail('UNSUPPORTED_MEDIA_TYPE', 415);
  const parts = []; let size = 0;
  for await (const chunk of request) { size += chunk.length; if (size > limit) fail('BODY_TOO_LARGE', 413); parts.push(chunk); }
  let value;
  try { value = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { fail('INVALID_JSON', 400); }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_JSON', 400);
  return value;
}

export const FUNDING_RECORD_PATH = /^\/api\/funding\/([A-Za-z0-9][A-Za-z0-9_.:-]{0,127})$/;
const RESERVED_PATHS = new Set(['config', 'preview', 'quote', 'submitted']);

// Routes only endpoints whose underlying capability is present. There is deliberately no quote,
// sign, send, broadcast, retry or cancel route; those fall through to 404.
export async function handleFundingRequest(funding, request, url, send) {
  if (!funding) return send(404, { error: 'Not found' });
  try {
    const path = url.pathname;
    if (request.method === 'GET' && path === '/api/funding/config') return send(200, funding.config());
    if (request.method === 'POST' && path === '/api/funding/preview' && funding.capabilities.preview) return send(200, await funding.preview(await readFundingJson(request)));
    if (request.method === 'POST' && path === '/api/funding/submitted' && funding.capabilities.submitted) return send(200, funding.submitted(await readFundingJson(request)));
    const match = FUNDING_RECORD_PATH.exec(path);
    if (request.method === 'GET' && match && !RESERVED_PATHS.has(match[1]) && funding.capabilities.records) return send(200, funding.get(match[1]));
    return send(404, { error: 'Not found' });
  } catch (error) {
    const publicError = publicFundingError(error);
    return send(publicError.status, publicError.toJSON());
  }
}

// Whitelisting projection of A's FundingRecordV1. Invalid values become null and are listed as integrity issues;
// the UI must then show the record as unavailable/needs review, never verified.
export function projectFundingRecord(record, { origin, route = {}, observedAt }) {
  const issues = [];
  const take = (value, test, label) => {
    if (value === null || value === undefined) return null;
    if (test(value)) return typeof value === 'string' && ADDRESS.test(value) ? lower(value) : value;
    issues.push(label); return null;
  };
  const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const asset = (value, label) => {
    if (!isObject(value)) { issues.push(label); return null; }
    return {
      chainId: take(value.chainId, (v) => Number.isSafeInteger(v) && v > 0, `${label}.chainId`),
      assetId: take(value.assetId, (v) => typeof v === 'string' && ASSET_ID.test(v), `${label}.assetId`),
      token: take(value.token, isAddress, `${label}.token`),
      decimals: take(value.decimals, (v) => Number.isInteger(v) && v >= 0 && v <= 36, `${label}.decimals`),
    };
  };
  const evidence = (value, label) => {
    if (value === null || value === undefined) return null;
    if (!isObject(value)) { issues.push(label); return null; }
    return {
      requestHash: take(value.requestHash, (v) => typeof v === 'string' && HASH.test(v), `${label}.requestHash`),
      quoteHash: take(value.quoteHash, (v) => typeof v === 'string' && HASH.test(v), `${label}.quoteHash`),
      sourceTransactionHash: take(value.sourceTransactionHash, (v) => typeof v === 'string' && HASH.test(v), `${label}.sourceTransactionHash`),
      transactionHash: take(value.transactionHash, (v) => typeof v === 'string' && HASH.test(v), `${label}.transactionHash`),
      chainId: take(value.chainId, (v) => Number.isSafeInteger(v) && v > 0, `${label}.chainId`),
      token: take(value.token, isAddress, `${label}.token`),
      recipient: take(value.recipient, isAddress, `${label}.recipient`),
      amount: take(value.amount, isInteger, `${label}.amount`),
      confirmations: take(value.confirmations, (v) => Number.isSafeInteger(v) && v >= 0, `${label}.confirmations`),
      observedAt: take(value.observedAt, isTimestamp, `${label}.observedAt`),
      evidenceQuality: take(value.evidenceQuality, (v) => EVIDENCE_QUALITY.has(v), `${label}.evidenceQuality`),
    };
  };
  if (!isObject(record)) return { origin, schemaVersion: null, fundingId: null, state: null, integrity: 'invalid', integrityIssues: ['record'], observedAt };
  const request = isObject(record.request) ? {
    routeId: take(record.request.routeId, (v) => typeof v === 'string' && IDENTIFIER.test(v), 'request.routeId'),
    manager: take(record.request.manager, isAddress, 'request.manager'),
    safe: take(record.request.safe, isAddress, 'request.safe'),
    source: asset(record.request.source, 'request.source'),
    destination: asset(record.request.destination, 'request.destination'),
    amountIn: take(record.request.amountIn, isInteger, 'request.amountIn'),
    minAmountOut: take(record.request.minAmountOut, isInteger, 'request.minAmountOut'),
    refundRecipient: take(record.request.refundRecipient, isAddress, 'request.refundRecipient'),
    expiresAt: take(record.request.expiresAt, isTimestamp, 'request.expiresAt'),
  } : (issues.push('request'), null);
  const quote = isObject(record.quote) ? {
    reference: take(record.quote.reference, (v) => typeof v === 'string' && IDENTIFIER.test(v), 'quote.reference'),
    depositAddress: take(record.quote.depositAddress, isAddress, 'quote.depositAddress'),
    amountIn: take(record.quote.amountIn, isInteger, 'quote.amountIn'),
    minAmountOut: take(record.quote.minAmountOut, isInteger, 'quote.minAmountOut'),
    expiresAt: take(record.quote.expiresAt, isTimestamp, 'quote.expiresAt'),
    evidenceQuality: take(record.quote.evidenceQuality, (v) => EVIDENCE_QUALITY.has(v), 'quote.evidenceQuality'),
  } : (issues.push('quote'), null);
  const submission = record.submission == null ? null : isObject(record.submission) ? {
    // attemptId is a send-correlation capability for the wallet path; it is not projected for display.
    reserved: typeof record.submission.attemptId === 'string',
    txHash: take(record.submission.txHash, (v) => typeof v === 'string' && HASH.test(v), 'submission.txHash'),
    reservedAt: take(record.submission.reservedAt, isTimestamp, 'submission.reservedAt'),
  } : (issues.push('submission'), null);
  const observation = record.observation == null ? null : isObject(record.observation) ? {
    source: take(record.observation.source, (v) => v === 'provider-unverified', 'observation.source'),
    status: take(record.observation.status, (v) => OBSERVATIONS.has(v), 'observation.status'),
    observedAt: take(record.observation.observedAt, isTimestamp, 'observation.observedAt'),
  } : (issues.push('observation'), null);
  // A's prepareRound readiness, including the snapshot it was checked against, so the UI can bind readiness
  // to the strategy network, Safe and stable token instead of inferring it from delivery.
  const readinessSnapshot = (value) => {
    if (!isObject(value)) { issues.push('readiness.snapshot'); return null; }
    const flag = (key) => take(value[key], (v) => typeof v === 'boolean', `readiness.snapshot.${key}`);
    return {
      chainId: take(value.chainId, (v) => Number.isSafeInteger(v) && v > 0, 'readiness.snapshot.chainId'),
      safe: take(value.safe, isAddress, 'readiness.snapshot.safe'),
      stableToken: take(value.stableToken, isAddress, 'readiness.snapshot.stableToken'),
      assetToken: take(value.assetToken, isAddress, 'readiness.snapshot.assetToken'),
      stableBalance: take(value.stableBalance, isInteger, 'readiness.snapshot.stableBalance'),
      assetBalance: take(value.assetBalance, isInteger, 'readiness.snapshot.assetBalance'),
      compatible: flag('compatible'), activeRound: flag('activeRound'), pendingAuthorization: flag('pendingAuthorization'),
      observedAt: take(value.observedAt, isTimestamp, 'readiness.snapshot.observedAt'),
      blockNumber: take(value.blockNumber, isInteger, 'readiness.snapshot.blockNumber'),
    };
  };
  const readiness = record.readiness == null ? null : isObject(record.readiness) ? {
    chainId: take(record.readiness.chainId, (v) => Number.isSafeInteger(v) && v > 0, 'readiness.chainId'),
    safe: take(record.readiness.safe, isAddress, 'readiness.safe'),
    consumedAt: take(record.readiness.consumedAt, isTimestamp, 'readiness.consumedAt'),
    snapshot: readinessSnapshot(record.readiness.snapshot),
  } : (issues.push('readiness'), null);
  return {
    origin, schemaVersion: take(record.schemaVersion, (v) => v === 1, 'schemaVersion'),
    fundingId: take(record.fundingId, (v) => typeof v === 'string' && IDENTIFIER.test(v), 'fundingId'),
    configurationHash: take(record.configurationHash, (v) => typeof v === 'string' && HASH.test(v), 'configurationHash'),
    state: take(record.state, (v) => STATES.has(v), 'state'),
    revision: take(record.revision, (v) => Number.isSafeInteger(v) && v >= 0, 'revision'),
    createdAt: take(record.createdAt, isTimestamp, 'createdAt'), updatedAt: take(record.updatedAt, isTimestamp, 'updatedAt'),
    reviewReason: take(record.reviewReason, (v) => typeof v === 'string' && CODE.test(v), 'reviewReason'),
    request, requestHash: take(record.requestHash, (v) => typeof v === 'string' && HASH.test(v), 'requestHash'),
    quote, quoteHash: take(record.quoteHash, (v) => typeof v === 'string' && HASH.test(v), 'quoteHash'),
    submission, observation, delivery: evidence(record.delivery, 'delivery'), refund: evidence(record.refund, 'refund'), readiness,
    route: {
      minimumConfirmations: Number.isSafeInteger(route.minimumConfirmations) && route.minimumConfirmations > 0 ? route.minimumConfirmations : null,
      maxObservationAgeSeconds: Number.isSafeInteger(route.maxObservationAgeSeconds) && route.maxObservationAgeSeconds > 0 ? route.maxObservationAgeSeconds : null,
    },
    observedAt, integrity: issues.length ? 'invalid' : 'ok', integrityIssues: issues,
  };
}

// WAVEFUND_FUNDING unset/"disabled": no funding endpoints. "live-preview": dry quotes through B's client
// against fixed, repository-reviewed configuration files. No API key, wallet or private key is read.
export async function fundingReadModelFromEnvironment(env = process.env) {
  const mode = (env.WAVEFUND_FUNDING ?? '').trim();
  if (!mode || mode === 'disabled') return null;
  if (mode !== 'live-preview') throw new Error('WAVEFUND_FUNDING must be unset, "disabled" or "live-preview"');
  const [{ configuration }, intents] = await Promise.all([import('../funding/index.mjs'), import('../intents/index.mjs')]);
  const approved = configuration(JSON.parse(await readFile('runtime/funding/approved-routes.json', 'utf8')));
  const fundingSafe = JSON.parse(await readFile('deployments/aurora-mainnet-funding-safe.json', 'utf8'));
  const strategyDeployment = JSON.parse(await readFile('deployments/aurora-testnet.json', 'utf8'));
  const client = intents.createIntentsClient({ allowExecutionQuotes: false });
  return createFundingReadModel({
    mode: 'live-preview', approved, verifiedRoutes: intents.VERIFIED_FUNDING_ROUTES, fundingSafe, strategyDeployment,
    previewOrder: (request) => client.previewOrder(intents.toProviderFundingRequest(request, { slippageBps: 100 })),
  });
}
