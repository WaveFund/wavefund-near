import { createHash } from 'node:crypto';
import { isAddress } from 'viem';
import { ERROR_CODES as E, IntentsError, sanitizeProviderMessage } from './errors.mjs';
import { createQuoteSignatureVerifier, stableStringify } from './signature.mjs';
import { VERIFIED_FUNDING_ROUTES, findFundingRoute } from './routes.mjs';

// Server-side NEAR Intents 1Click client for FUNDING a manager-owned Aurora mainnet Safe before a round.
// It quotes and reads status only: no wallet keys, no signing, no transfers, no retries, no venue fallback.
export const PROVIDER_ID = 'near-intents-1click';
export const ONE_CLICK_BASE_URL = 'https://1click.chaindefuser.com';
export const ALLOWED_BASE_URLS = Object.freeze([ONE_CLICK_BASE_URL]);
export const EXECUTION_STATUSES = Object.freeze(['PENDING_DEPOSIT', 'KNOWN_DEPOSIT_TX', 'INCOMPLETE_DEPOSIT', 'PROCESSING', 'SUCCESS', 'REFUNDED', 'FAILED']);
const STATUS_PHASES = Object.freeze({
  PENDING_DEPOSIT: { phase: 'awaiting_deposit', terminal: false },
  KNOWN_DEPOSIT_TX: { phase: 'deposit_detected', terminal: false },
  INCOMPLETE_DEPOSIT: { phase: 'deposit_incomplete', terminal: false },
  PROCESSING: { phase: 'processing', terminal: false },
  SUCCESS: { phase: 'succeeded', terminal: true },
  REFUNDED: { phase: 'refunded', terminal: true },
  FAILED: { phase: 'failed', terminal: true },
});
// PROVISIONAL provider input. The shared funding schema is owned by Developer A; this is mapped to it once agreed.
const REQUEST_KEYS = ['fundingId', 'source', 'destination', 'amountIn', 'minAmountOut', 'slippageBps', 'refundAddress', 'expiresAt'];
const SOURCE_KEYS = ['chain', 'chainId', 'assetId', 'tokenAddress'];
const DESTINATION_KEYS = ['chainId', 'virtualChainAccount', 'assetId', 'tokenAddress', 'safeAddress'];
const INTEGER = /^(0|[1-9][0-9]{0,77})$/;
const ASSET_ID = /^(nep141|nep245|1cs_v1):[\x21-\x7e]{1,256}$/;
const CHAIN = /^[a-z0-9]{2,32}$/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const PRINTABLE = /^[\x21-\x7e]{1,256}$/;
const MAX_SLIPPAGE_BPS = 1000; // Same ceiling as TradingSafeModule.MAX_SLIPPAGE_BPS.
const LIMITS = Object.freeze({ tokens: 4 * 1024 * 1024, quote: 256 * 1024, status: 256 * 1024 });

const fail = (code, message, details) => { throw new IntentsError(code, message, details); };
export const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
function exactKeys(value, keys, label, code = E.INVALID_ORDER) {
  if (!isObject(value)) fail(code, `${label} must be an object`);
  if (Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) fail(code, `${label} must contain exactly: ${keys.join(', ')}`);
}
export function integerString(value, label, { positive = false, code = E.INVALID_ORDER } = {}) {
  if (typeof value !== 'string' || !INTEGER.test(value)) fail(code, `${label} must be a decimal integer string in base units`);
  if (positive && value === '0') fail(code, `${label} must be positive`);
  return value;
}
export function isoTime(value, label, code) {
  if (typeof value !== 'string') fail(code, `${label} must be an ISO-8601 UTC timestamp`);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== value) fail(code, `${label} must be a canonical ISO-8601 UTC timestamp`);
  return ms;
}
// Returns the address exactly as supplied (1Click echoes it byte-for-byte). Mixed case must be a valid EIP-55 checksum.
function evmAddress(value, label) {
  if (typeof value !== 'string' || !EVM_ADDRESS.test(value)) fail(E.INVALID_ORDER, `${label} must be a 0x-prefixed 20-byte EVM address`);
  const body = value.slice(2);
  if (body !== body.toLowerCase() && body !== body.toUpperCase() && !isAddress(value, { strict: true })) fail(E.INVALID_ORDER, `${label} has an invalid EIP-55 checksum`);
  if (/^0x0{40}$/.test(value)) fail(E.INVALID_ORDER, `${label} must not be the zero address`);
  return value;
}
export const sameAddress = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const item of Object.values(value)) deepFreeze(item); }
  return value;
}
export const sha256Hex = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

// Validates a funding request and binds it to one VERIFIED route. Never touches the network.
export function validateFundingRequest(request, { now = Date.now() } = {}) {
  exactKeys(request, REQUEST_KEYS, 'funding request');
  if (typeof request.fundingId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(request.fundingId)) fail(E.INVALID_ORDER, 'fundingId is invalid');
  exactKeys(request.source, SOURCE_KEYS, 'source');
  exactKeys(request.destination, DESTINATION_KEYS, 'destination');
  const s = request.source; const d = request.destination;
  if (typeof s.chain !== 'string' || !CHAIN.test(s.chain)) fail(E.INVALID_ORDER, 'source.chain must be an explicit provider blockchain identifier');
  for (const [label, value] of [['source.assetId', s.assetId], ['destination.assetId', d.assetId]]) {
    if (typeof value !== 'string' || !ASSET_ID.test(value)) fail(E.INVALID_ORDER, `${label} must be an exact provider asset identifier, never a ticker`);
  }
  if (!Number.isSafeInteger(s.chainId) || !Number.isSafeInteger(d.chainId)) fail(E.INVALID_ORDER, 'source.chainId and destination.chainId must be EVM chain ids');
  const normalized = {
    fundingId: request.fundingId,
    source: { chain: s.chain, chainId: s.chainId, assetId: s.assetId, tokenAddress: evmAddress(s.tokenAddress, 'source.tokenAddress') },
    destination: {
      chainId: d.chainId, virtualChainAccount: d.virtualChainAccount, assetId: d.assetId,
      tokenAddress: evmAddress(d.tokenAddress, 'destination.tokenAddress'), safeAddress: evmAddress(d.safeAddress, 'destination.safeAddress'),
    },
    amountIn: integerString(request.amountIn, 'amountIn', { positive: true }),
    minAmountOut: integerString(request.minAmountOut, 'minAmountOut', { positive: true }),
    slippageBps: request.slippageBps,
    refundAddress: evmAddress(request.refundAddress, 'refundAddress'),
    expiresAt: request.expiresAt,
  };
  if (!Number.isSafeInteger(request.slippageBps) || request.slippageBps < 0 || request.slippageBps > MAX_SLIPPAGE_BPS) fail(E.INVALID_ORDER, `slippageBps must be an integer 0..${MAX_SLIPPAGE_BPS}`);
  if (sameAddress(normalized.destination.safeAddress, normalized.refundAddress)) fail(E.INVALID_ORDER, 'refundAddress is an origin-chain wallet and must differ from the Aurora Safe');
  const route = findFundingRoute(normalized);
  if (!route) fail(E.UNSUPPORTED_ROUTE, 'No verified funding route matches this exact source and destination', { source: normalized.source.assetId, destination: normalized.destination.assetId });
  if (BigInt(normalized.amountIn) < BigInt(route.minimumAmountIn)) fail(E.AMOUNT_TOO_LOW, `amountIn is below the observed bridge minimum ${route.minimumAmountIn}`, { minimumAmountIn: route.minimumAmountIn });
  const expiresAtMs = isoTime(request.expiresAt, 'expiresAt', E.INVALID_ORDER);
  if (expiresAtMs <= now) fail(E.ORDER_EXPIRED, 'Funding request expiry has passed', { expiresAt: request.expiresAt });
  return { request: normalized, route, identity: { fundingId: normalized.fundingId, requestDigest: sha256Hex(stableStringify(normalized)) } };
}

// Exact provider request. Aurora is a NEAR "virtual chain": deliver the NEP-141 to the engine account and
// name the EVM recipient via virtualChainRecipient (signed by 1Click). No customRecipientMsg, appFees or referral.
export function quoteRequestFor(request, dry) {
  return {
    dry, swapType: 'EXACT_INPUT', slippageTolerance: request.slippageBps,
    originAsset: request.source.assetId, depositType: 'ORIGIN_CHAIN', destinationAsset: request.destination.assetId,
    amount: request.amountIn, refundTo: request.refundAddress, refundType: 'ORIGIN_CHAIN',
    recipient: request.destination.virtualChainAccount, recipientType: 'DESTINATION_CHAIN',
    virtualChainRecipient: request.destination.safeAddress, deadline: request.expiresAt,
  };
}

export function formatUnits(amount, decimals) {
  const value = BigInt(amount); const scale = 10n ** BigInt(decimals);
  const whole = value / scale; const fraction = (value % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function defaultTransport() {
  return async function fetchTransport({ method, url, headers, body, signal, maxBytes }) {
    const response = await fetch(url, { method, headers, body, signal, redirect: 'error' });
    if (!response.body) return { status: response.status, headers: response.headers, bodyText: '' };
    const reader = response.body.getReader(); const parts = []; let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.byteLength; if (size > maxBytes) throw new IntentsError(E.MALFORMED_RESPONSE, 'Provider response exceeds size limit');
        parts.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    return { status: response.status, headers: response.headers, bodyText: Buffer.concat(parts).toString('utf8') };
  };
}

function headerValue(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name);
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : null;
}

// Classification of 1Click 400 messages observed live on 2026-11-11 (fixtures/intents/live/probes).
function classifyRejection(message) {
  const text = message ?? '';
  if (/no liquidity/i.test(text)) return E.NO_LIQUIDITY;
  if (/quoting for this pair is not available/i.test(text)) return E.QUOTING_UNAVAILABLE; // observed 2026-11-11 for EVM origins
  if (/too low|minimum swap amount/i.test(text)) return E.AMOUNT_TOO_LOW;
  if (/token(in|out) is not valid|not supported|unsupported|no route|virtual chain/i.test(text)) return E.UNSUPPORTED_ROUTE;
  return E.PROVIDER_REJECTED;
}

export function createIntentsClient({
  baseUrl = ONE_CLICK_BASE_URL,
  apiKey,
  transport,
  clock = { now: () => Date.now() },
  verifySignature,
  timeoutMs = 10000,
  assetCacheTtlMs = 5 * 60 * 1000,
  maxQuoteAgeMs = 2 * 60 * 1000,
  maxClockSkewMs = 30 * 1000,
  allowExecutionQuotes = false,
} = {}) {
  if (!ALLOWED_BASE_URLS.includes(baseUrl)) throw new Error('Intents base URL is not allowlisted');
  if (apiKey !== undefined && (typeof apiKey !== 'string' || !apiKey || /\s/.test(apiKey))) throw new Error('Invalid 1Click API key configuration');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new Error('timeoutMs must be 1..60000');
  if (typeof clock?.now !== 'function') throw new Error('clock.now() is required');
  if (allowExecutionQuotes !== false && allowExecutionQuotes !== true) throw new Error('allowExecutionQuotes must be boolean');
  const injected = transport !== undefined;
  const send = transport ?? defaultTransport();
  if (typeof send !== 'function') throw new Error('transport must be a function');
  const verify = verifySignature ?? createQuoteSignatureVerifier();
  if (typeof verify !== 'function') throw new Error('verifySignature must be a function');
  // Anything served by an injected transport is labelled mocked; only the built-in fetch transport is "live".
  const source = injected ? 'injected-transport' : 'live-provider';
  const mocked = injected;
  let assetCache = null;

  async function request(method, path, { query, body, maxBytes }) {
    const url = new URL(path, baseUrl);
    for (const [key, value] of Object.entries(query ?? {})) if (value !== undefined) url.searchParams.set(key, value);
    const headers = { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(apiKey ? { 'X-API-Key': apiKey } : {}) };
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new IntentsError(E.TIMEOUT, `1Click ${path} timed out after ${timeoutMs} ms`)); }, timeoutMs); });
    let response;
    try {
      response = await Promise.race([send({ method, url: url.toString(), headers, body: body ? JSON.stringify(body) : undefined, signal: controller.signal, maxBytes }), timeout]);
    } catch (error) {
      if (error instanceof IntentsError) throw error;
      if (error?.name === 'AbortError' || error?.name === 'TimeoutError') throw new IntentsError(E.TIMEOUT, `1Click ${path} timed out`);
      throw new IntentsError(E.TRANSPORT_FAILED, `1Click ${path} transport failed`); // No network text or credentials surfaced.
    } finally { clearTimeout(timer); }
    if (!response || !Number.isInteger(response.status) || typeof response.bodyText !== 'string') fail(E.MALFORMED_RESPONSE, 'Transport returned an invalid response object');
    if (response.bodyText.length > maxBytes) fail(E.MALFORMED_RESPONSE, 'Provider response exceeds size limit');
    let payload = null; let parseFailed = false;
    if (response.bodyText) { try { payload = JSON.parse(response.bodyText); } catch { parseFailed = true; } }
    const status = response.status;
    if (status >= 200 && status < 300) {
      if (parseFailed || payload === null) fail(E.MALFORMED_RESPONSE, `1Click ${path} returned non-JSON content`);
      return { payload, bodyText: response.bodyText };
    }
    const providerMessage = sanitizeProviderMessage(isObject(payload) ? payload.message : null);
    const correlationId = isObject(payload) && typeof payload.correlationId === 'string' ? payload.correlationId.slice(0, 100) : null;
    const details = { httpStatus: status, providerMessage, correlationId };
    if (status === 429) {
      const retryAfter = Number.parseInt(headerValue(response.headers, 'retry-after') ?? '', 10);
      fail(E.RATE_LIMITED, '1Click rate limit reached; caller decides whether and when to retry', { ...details, retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : null });
    }
    if (status === 401 || status === 403) fail(E.UNAUTHORIZED, '1Click rejected the API credentials', details);
    if (status === 404) fail(E.NOT_FOUND, '1Click has no record for this reference', details);
    if (status >= 500) fail(E.PROVIDER_UNAVAILABLE, `1Click returned HTTP ${status}`, details);
    if (status === 400) fail(classifyRejection(providerMessage), providerMessage ?? '1Click rejected the request', details);
    fail(E.PROVIDER_REJECTED, `1Click returned HTTP ${status}`, details);
  }

  async function getSupportedAssets() {
    const now = clock.now();
    if (assetCache && now - assetCache.fetchedAtMs < assetCacheTtlMs) return assetCache.value;
    const { payload } = await request('GET', '/v0/tokens', { maxBytes: LIMITS.tokens });
    if (!Array.isArray(payload)) fail(E.MALFORMED_RESPONSE, '1Click token list is not an array');
    const assets = []; const seen = new Set(); let rejectedEntries = 0;
    for (const entry of payload) {
      const valid = isObject(entry) && typeof entry.assetId === 'string' && ASSET_ID.test(entry.assetId)
        && Number.isSafeInteger(entry.decimals) && entry.decimals >= 0 && entry.decimals <= 77
        && typeof entry.blockchain === 'string' && CHAIN.test(entry.blockchain) && typeof entry.symbol === 'string';
      if (!valid) { rejectedEntries++; continue; }
      if (seen.has(entry.assetId)) fail(E.MALFORMED_RESPONSE, 'Duplicate assetId in 1Click token list', { assetId: entry.assetId });
      seen.add(entry.assetId);
      assets.push(Object.freeze({
        assetId: entry.assetId, blockchain: entry.blockchain, decimals: entry.decimals,
        // Symbols are display-only and not unique (e.g. "AURORA" is a token on near/eth/bsc, not the Aurora chain).
        symbol: entry.symbol.slice(0, 32),
        contractAddress: typeof entry.contractAddress === 'string' ? entry.contractAddress : null,
        indicativePriceUsd: typeof entry.price === 'number' && Number.isFinite(entry.price) ? entry.price : null,
        priceUpdatedAt: typeof entry.priceUpdatedAt === 'string' ? entry.priceUpdatedAt : null,
      }));
    }
    if (assets.length === 0) fail(E.MALFORMED_RESPONSE, '1Click token list contained no valid assets');
    const value = Object.freeze({ provider: PROVIDER_ID, source, mocked, fetchedAt: new Date(now).toISOString(), rejectedEntries, assets: Object.freeze(assets) });
    assetCache = { fetchedAtMs: now, value };
    return value;
  }

  // The provider list must still agree with the verified route: chain, decimals and ERC-20 contract identity.
  async function checkRouteAgainstProvider(route) {
    const { assets } = await getSupportedAssets();
    const byId = new Map(assets.map((asset) => [asset.assetId, asset]));
    const sourceAsset = byId.get(route.source.assetId); const destinationAsset = byId.get(route.destination.assetId);
    if (!sourceAsset) fail(E.UNSUPPORTED_ASSET, 'Source asset is no longer in the 1Click supported list', { assetId: route.source.assetId });
    if (!destinationAsset) fail(E.UNSUPPORTED_ASSET, 'Destination asset is no longer in the 1Click supported list', { assetId: route.destination.assetId });
    if (sourceAsset.blockchain !== route.source.chain || !sameAddress(sourceAsset.contractAddress, route.source.tokenAddress)) fail(E.ASSET_CHAIN_MISMATCH, 'Provider source asset no longer matches the verified chain/ERC-20 contract', { assetId: sourceAsset.assetId });
    if (destinationAsset.blockchain !== route.destination.providerBlockchain) fail(E.ASSET_CHAIN_MISMATCH, 'Provider destination asset is not on the expected provider blockchain', { assetId: destinationAsset.assetId });
    if (sourceAsset.decimals !== route.source.decimals || destinationAsset.decimals !== route.destination.decimals) fail(E.ASSET_CHAIN_MISMATCH, 'Provider decimals differ from the verified route');
    return { origin: { chain: sourceAsset.blockchain, chainId: route.source.chainId, assetId: sourceAsset.assetId, tokenAddress: route.source.tokenAddress, decimals: sourceAsset.decimals },
      destination: { network: route.destination.network, chainId: route.destination.chainId, virtualChainAccount: route.destination.virtualChainAccount, assetId: destinationAsset.assetId, tokenAddress: route.destination.tokenAddress, decimals: destinationAsset.decimals } };
  }

  function checkQuoteResponse(payload, expectedRequest) {
    if (!isObject(payload) || !isObject(payload.quoteRequest) || !isObject(payload.quote) || typeof payload.signature !== 'string'
      || typeof payload.timestamp !== 'string' || typeof payload.correlationId !== 'string') fail(E.MALFORMED_RESPONSE, '1Click quote response is missing required fields');
    for (const [key, value] of Object.entries(expectedRequest)) {
      if (payload.quoteRequest[key] !== value) fail(E.ORDER_MISMATCH, `Provider quote does not echo the requested ${key}`, { field: key });
    }
    // Unrequested delivery redirections are refused even though 1Click signs them.
    for (const key of ['customRecipientMsg', 'virtualChainRefundRecipient']) if (payload.quoteRequest[key] !== undefined) fail(E.ORDER_MISMATCH, `Provider quote adds unrequested ${key}`, { field: key });
    const q = payload.quote;
    for (const key of ['amountIn', 'minAmountIn', 'amountOut', 'minAmountOut']) integerString(q[key], `quote.${key}`, { code: E.MALFORMED_RESPONSE });
    if (q.timeEstimate !== undefined && !Number.isFinite(q.timeEstimate)) fail(E.MALFORMED_RESPONSE, 'quote.timeEstimate is invalid');
    for (const key of ['refundFee', 'withdrawFee']) if (q[key] !== undefined) integerString(q[key], `quote.${key}`, { code: E.MALFORMED_RESPONSE });
    return isoTime(payload.timestamp, 'timestamp', E.MALFORMED_RESPONSE);
  }

  async function quote(fundingRequest, dry) {
    const now = clock.now();
    const { request: req, route, identity } = validateFundingRequest(fundingRequest, { now });
    const resolved = await checkRouteAgainstProvider(route);
    const expectedRequest = quoteRequestFor(req, dry);
    const { payload, bodyText } = await request('POST', '/v0/quote', { body: expectedRequest, maxBytes: LIMITS.quote });
    const quotedAtMs = checkQuoteResponse(payload, expectedRequest);
    const verification = verify(payload);
    if (!verification || verification.valid !== true) fail(E.SIGNATURE_INVALID, '1Click quote signature did not verify; quote discarded', { correlationId: payload.correlationId });
    const q = payload.quote;
    if (q.amountIn !== req.amountIn) fail(E.ORDER_MISMATCH, 'Quoted input amount differs from the funding request', { field: 'amountIn' });
    if (BigInt(q.amountOut) < BigInt(q.minAmountOut)) fail(E.MALFORMED_RESPONSE, 'Quoted amountOut is below its own minAmountOut');
    if (BigInt(q.minAmountOut) < BigInt(req.minAmountOut)) fail(E.QUOTE_BELOW_MINIMUM, 'Quoted minimum output is below the funding minimum', { quotedMinAmountOut: q.minAmountOut, requestMinAmountOut: req.minAmountOut });
    const checkNow = clock.now();
    if (quotedAtMs > checkNow + maxClockSkewMs) fail(E.MALFORMED_RESPONSE, 'Quote timestamp is in the future beyond allowed clock skew');
    if (checkNow - quotedAtMs > maxQuoteAgeMs) fail(E.QUOTE_EXPIRED, 'Quote is older than the allowed quote age');
    const requestExpiryMs = Date.parse(req.expiresAt);
    if (requestExpiryMs <= checkNow) fail(E.QUOTE_EXPIRED, 'Funding request expiry passed while quoting');
    let deposit = null; let quoteDeadline = null; let timeWhenInactive = null; let effectiveExpiryMs = requestExpiryMs;
    if (!dry) {
      if (typeof q.depositAddress !== 'string' || !EVM_ADDRESS.test(q.depositAddress)) fail(E.MALFORMED_RESPONSE, 'Execution quote has no valid EVM depositAddress on the source chain');
      if (q.depositMemo !== undefined) fail(E.MALFORMED_RESPONSE, 'An EVM ORIGIN_CHAIN deposit must not require a memo');
      const deadlineMs = isoTime(q.deadline, 'quote.deadline', E.MALFORMED_RESPONSE);
      if (deadlineMs <= checkNow) fail(E.QUOTE_EXPIRED, 'Execution quote deadline has passed');
      quoteDeadline = q.deadline;
      if (q.timeWhenInactive !== undefined) { isoTime(q.timeWhenInactive, 'quote.timeWhenInactive', E.MALFORMED_RESPONSE); timeWhenInactive = q.timeWhenInactive; }
      effectiveExpiryMs = Math.min(requestExpiryMs, deadlineMs);
      deposit = Object.freeze({ type: 'ORIGIN_CHAIN', chain: resolved.origin.chain, chainId: resolved.origin.chainId, tokenAddress: resolved.origin.tokenAddress, address: q.depositAddress, memo: null, exactAmount: q.amountIn });
    }
    return deepFreeze({
      kind: dry ? 'DRY_QUOTE' : 'EXECUTION_QUOTE', purpose: 'funding',
      label: dry ? 'DRY QUOTE: preview only, not funded, not executable' : 'EXECUTION QUOTE: not funded; this client sends no deposit',
      dry, funded: false, provider: PROVIDER_ID, source, mocked,
      funding: { ...identity, routeId: route.id, safeAddress: req.destination.safeAddress, refundAddress: req.refundAddress },
      route: resolved,
      amounts: {
        amountIn: q.amountIn, minAmountIn: q.minAmountIn, amountOut: q.amountOut, minAmountOut: q.minAmountOut, requestMinAmountOut: req.minAmountOut,
        amountInDisplay: formatUnits(q.amountIn, resolved.origin.decimals), amountOutDisplay: formatUnits(q.amountOut, resolved.destination.decimals),
        minAmountOutDisplay: formatUnits(q.minAmountOut, resolved.destination.decimals),
      },
      // refundFee is deducted from refunds: a refund does not return the full input.
      // Per the 1Click signing scheme, dry quotes sign only amounts; refund/withdraw fees are signed for execution quotes only,
      // and appFees are never signed. Unsigned fee values are informational.
      fees: { refundFee: q.refundFee ?? null, withdrawFee: q.withdrawFee ?? null, feesSigned: !dry, appFees: Array.isArray(payload.quoteRequest.appFees) ? payload.quoteRequest.appFees : [], appFeesSigned: false },
      expiry: { requestExpiresAt: req.expiresAt, quoteDeadline, timeWhenInactive, effectiveExpiresAt: new Date(effectiveExpiryMs).toISOString(), quotedAt: payload.timestamp },
      timeEstimateSeconds: Number.isFinite(q.timeEstimate) ? q.timeEstimate : null,
      signature: { verified: true, scheme: verification.scheme ?? 'ed25519', publicKey: verification.publicKey ?? null, signedMessage: verification.message ?? null, value: payload.signature },
      deposit,
      correlationId: payload.correlationId,
      // Unmodified provider payload, required to re-verify the signature or resolve disputes later.
      providerPayload: payload,
      providerPayloadSha256: sha256Hex(bodyText),
    });
  }

  async function previewOrder(fundingRequest) { return quote(fundingRequest, true); }

  async function prepareOrder(fundingRequest) {
    if (!allowExecutionQuotes) fail(E.EXECUTION_QUOTES_DISABLED, 'Execution quotes are disabled; construct the client with allowExecutionQuotes: true');
    return quote(fundingRequest, false);
  }

  // reference: an EXECUTION_QUOTE from prepareOrder (preferred, enables binding checks) or { depositAddress }.
  async function getExecutionStatus(reference) {
    let depositAddress; let bound = null;
    if (isObject(reference) && reference.kind === 'EXECUTION_QUOTE') { depositAddress = reference.deposit?.address; bound = reference; }
    else if (isObject(reference) && reference.kind === 'DRY_QUOTE') fail(E.INVALID_ORDER, 'A dry quote has no execution status; it was never executable');
    else if (isObject(reference)) { exactKeys(reference, ['depositAddress'], 'status reference'); ({ depositAddress } = reference); }
    else fail(E.INVALID_ORDER, 'Status reference must be an execution quote or { depositAddress }');
    if (typeof depositAddress !== 'string' || !PRINTABLE.test(depositAddress)) fail(E.INVALID_ORDER, 'depositAddress is invalid');
    const { payload, bodyText } = await request('GET', '/v0/status', { query: { depositAddress }, maxBytes: LIMITS.status });
    if (!isObject(payload) || typeof payload.status !== 'string' || typeof payload.updatedAt !== 'string' || !isObject(payload.quoteResponse)) fail(E.MALFORMED_RESPONSE, '1Click status response is missing required fields');
    if (!Object.hasOwn(STATUS_PHASES, payload.status)) fail(E.UNKNOWN_STATUS, 'Undocumented 1Click status; treated as unknown, not success', { status: sanitizeProviderMessage(payload.status) });
    isoTime(payload.updatedAt, 'updatedAt', E.MALFORMED_RESPONSE);
    const qr = payload.quoteResponse;
    if (!isObject(qr.quote) || !isObject(qr.quoteRequest)) fail(E.MALFORMED_RESPONSE, 'Status response has no embedded quote');
    const verification = verify(qr);
    if (!verification || verification.valid !== true) fail(E.SIGNATURE_INVALID, 'Embedded quote signature in status did not verify');
    if (!sameAddress(qr.quote.depositAddress, depositAddress)) fail(E.ORDER_MISMATCH, 'Status refers to a different deposit address');
    if (bound) {
      const original = bound.providerPayload;
      if (qr.signature !== original.signature || qr.timestamp !== original.timestamp) fail(E.ORDER_MISMATCH, 'Status embeds a different quote than the prepared one');
      for (const key of ['originAsset', 'destinationAsset', 'amount', 'recipient', 'recipientType', 'virtualChainRecipient', 'refundTo', 'refundType', 'deadline', 'slippageTolerance']) {
        if (qr.quoteRequest[key] !== original.quoteRequest[key]) fail(E.ORDER_MISMATCH, `Status quote differs in ${key}`, { field: key });
      }
    }
    const d = isObject(payload.swapDetails) ? payload.swapDetails : {};
    const optionalInteger = (value, label) => (value === undefined || value === null ? null : integerString(value, label, { code: E.MALFORMED_RESPONSE }));
    const hashes = (list) => (Array.isArray(list) ? list.filter((item) => isObject(item) && typeof item.hash === 'string').map((item) => ({ hash: item.hash, explorerUrl: typeof item.explorerUrl === 'string' ? item.explorerUrl : null })) : []);
    const { phase, terminal } = STATUS_PHASES[payload.status];
    return deepFreeze({
      kind: 'EXECUTION_STATUS', provider: PROVIDER_ID, source, mocked,
      status: payload.status, phase, terminal,
      // Provider-reported state only; use verifyFundingDelivery with chain receipts before treating funds as delivered.
      providerReportedSuccess: payload.status === 'SUCCESS',
      updatedAt: payload.updatedAt,
      deposit: { address: depositAddress },
      funding: bound ? bound.funding : null,
      quoteSignatureVerified: true,
      swap: {
        amountIn: optionalInteger(d.amountIn, 'swapDetails.amountIn'), amountOut: optionalInteger(d.amountOut, 'swapDetails.amountOut'),
        depositedAmount: optionalInteger(d.depositedAmount, 'swapDetails.depositedAmount'), refundedAmount: optionalInteger(d.refundedAmount, 'swapDetails.refundedAmount'),
        refundReason: sanitizeProviderMessage(d.refundReason), slippageBps: Number.isFinite(d.slippage) ? d.slippage : null,
        originChainTxs: hashes(d.originChainTxHashes), destinationChainTxs: hashes(d.destinationChainTxHashes),
        nearTxHashes: Array.isArray(d.nearTxHashes) ? d.nearTxHashes.filter((h) => typeof h === 'string') : [],
        intentHashes: Array.isArray(d.intentHashes) ? d.intentHashes.filter((h) => typeof h === 'string') : [],
      },
      correlationId: typeof payload.correlationId === 'string' ? payload.correlationId : null,
      providerPayload: payload,
      providerPayloadSha256: sha256Hex(bodyText),
    });
  }

  return Object.freeze({ getSupportedAssets, previewOrder, prepareOrder, getExecutionStatus });
}

export { VERIFIED_FUNDING_ROUTES };
