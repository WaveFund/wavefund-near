import { createHash } from 'node:crypto';
import { ERROR_CODES as E, IntentsError, sanitizeProviderMessage } from './errors.mjs';
import { createQuoteSignatureVerifier, stableStringify } from './signature.mjs';

// Server-side NEAR Intents 1Click client. It quotes and reads status only.
// It holds no wallet keys, signs nothing, transfers nothing, never retries and never falls back to another venue.
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
const DEPOSIT_TYPES = new Set(['ORIGIN_CHAIN', 'INTENTS']);
const RECIPIENT_TYPES = new Set(['DESTINATION_CHAIN', 'INTENTS']);
const REFUND_TYPES = new Set(['ORIGIN_CHAIN', 'INTENTS']);
const ORDER_KEYS = ['decisionId', 'policyHash', 'winningProposalId', 'origin', 'destination', 'depositType', 'amountIn', 'minAmountOut', 'slippageBps', 'recipient', 'refund', 'expiresAt'];
const INTEGER = /^(0|[1-9][0-9]{0,77})$/;
const ASSET_ID = /^nep(141|245):[\x21-\x7e]{1,256}$/;
const CHAIN = /^[a-z0-9]{2,32}$/;
const ADDRESS = /^[\x21-\x7e]{1,256}$/;
const MAX_SLIPPAGE_BPS = 1000; // Same ceiling as TradingSafeModule.MAX_SLIPPAGE_BPS.
const LIMITS = Object.freeze({ tokens: 4 * 1024 * 1024, quote: 256 * 1024, status: 256 * 1024 });

const fail = (code, message, details) => { throw new IntentsError(code, message, details); };
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
function exactKeys(value, keys, label) {
  if (!isObject(value)) fail(E.INVALID_ORDER, `${label} must be an object`);
  const actual = Object.keys(value).sort().join(','); const expected = [...keys].sort().join(',');
  if (actual !== expected) fail(E.INVALID_ORDER, `${label} must contain exactly: ${keys.join(', ')}`);
}
function integerString(value, label, { positive = false, code = E.INVALID_ORDER } = {}) {
  if (typeof value !== 'string' || !INTEGER.test(value)) fail(code, `${label} must be a decimal integer string in base units`);
  if (positive && value === '0') fail(code, `${label} must be positive`);
  return value;
}
function isoTime(value, label, code) {
  if (typeof value !== 'string') fail(code, `${label} must be an ISO-8601 UTC timestamp`);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== value) fail(code, `${label} must be a canonical ISO-8601 UTC timestamp`);
  return ms;
}
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const item of Object.values(value)) deepFreeze(item); }
  return value;
}
const sha256Hex = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

// Exported for the coordinator and tests. Throws INVALID_ORDER / ORDER_EXPIRED; never touches the network.
export function validateOrder(order, { now = Date.now() } = {}) {
  exactKeys(order, ORDER_KEYS, 'order');
  if (typeof order.decisionId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(order.decisionId)) fail(E.INVALID_ORDER, 'decisionId is invalid');
  if (typeof order.policyHash !== 'string' || !/^0x[0-9a-f]{64}$/.test(order.policyHash)) fail(E.INVALID_ORDER, 'policyHash must be 0x-prefixed lowercase 32-byte hex');
  if (!Number.isSafeInteger(order.winningProposalId) || order.winningProposalId < 0 || order.winningProposalId > 255) fail(E.INVALID_ORDER, 'winningProposalId must be an integer 0..255');
  for (const side of ['origin', 'destination']) {
    exactKeys(order[side], ['chain', 'assetId'], side);
    if (typeof order[side].chain !== 'string' || !CHAIN.test(order[side].chain)) fail(E.INVALID_ORDER, `${side}.chain must be an explicit provider blockchain identifier`);
    if (typeof order[side].assetId !== 'string' || !ASSET_ID.test(order[side].assetId)) fail(E.INVALID_ORDER, `${side}.assetId must be an exact provider asset identifier (nep141:/nep245:), never a ticker`);
  }
  if (order.origin.assetId === order.destination.assetId) fail(E.INVALID_ORDER, 'origin and destination assets must differ');
  if (!DEPOSIT_TYPES.has(order.depositType)) fail(E.INVALID_ORDER, 'depositType must be ORIGIN_CHAIN or INTENTS');
  integerString(order.amountIn, 'amountIn', { positive: true });
  integerString(order.minAmountOut, 'minAmountOut', { positive: true });
  if (!Number.isSafeInteger(order.slippageBps) || order.slippageBps < 0 || order.slippageBps > MAX_SLIPPAGE_BPS) fail(E.INVALID_ORDER, `slippageBps must be an integer 0..${MAX_SLIPPAGE_BPS}`);
  exactKeys(order.recipient, ['address', 'type'], 'recipient');
  exactKeys(order.refund, ['address', 'type'], 'refund');
  if (typeof order.recipient.address !== 'string' || !ADDRESS.test(order.recipient.address) || !RECIPIENT_TYPES.has(order.recipient.type)) fail(E.INVALID_ORDER, 'recipient must have an address and type DESTINATION_CHAIN or INTENTS');
  if (typeof order.refund.address !== 'string' || !ADDRESS.test(order.refund.address) || !REFUND_TYPES.has(order.refund.type)) fail(E.INVALID_ORDER, 'refund must have an address and type ORIGIN_CHAIN or INTENTS');
  const expiresAtMs = isoTime(order.expiresAt, 'expiresAt', E.INVALID_ORDER);
  if (expiresAtMs <= now) fail(E.ORDER_EXPIRED, 'Order expiry has passed', { expiresAt: order.expiresAt });
  const identity = { decisionId: order.decisionId, policyHash: order.policyHash, winningProposalId: order.winningProposalId };
  return { ...identity, orderDigest: sha256Hex(stableStringify(order)) };
}

// Exact provider request derived from the order. No ticker lookup, no defaults for money-relevant fields.
function quoteRequestFor(order, dry) {
  return {
    dry, swapType: 'EXACT_INPUT', slippageTolerance: order.slippageBps,
    originAsset: order.origin.assetId, depositType: order.depositType, destinationAsset: order.destination.assetId,
    amount: order.amountIn, refundTo: order.refund.address, refundType: order.refund.type,
    recipient: order.recipient.address, recipientType: order.recipient.type, deadline: order.expiresAt,
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

// Classification of documented/observed 1Click 400 messages (observed live 2026-11-11, see docs/INTENTS-PROVIDER.md).
function classifyRejection(message) {
  const text = message ?? '';
  if (/no liquidity/i.test(text)) return E.NO_LIQUIDITY;
  if (/too low/i.test(text)) return E.AMOUNT_TOO_LOW;
  if (/token(in|out) is not valid|not supported|unsupported|no route/i.test(text)) return E.UNSUPPORTED_ROUTE;
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
  if (apiKey !== undefined && (typeof apiKey !== 'string' || !apiKey || /[\s]/.test(apiKey))) throw new Error('Invalid 1Click API key configuration');
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
      throw new IntentsError(E.TRANSPORT_FAILED, `1Click ${path} transport failed`); // No network/SDK text or credentials surfaced.
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
        // Symbols are display-only and not unique (e.g. several USDC entries); never use them to select an asset.
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

  async function resolveRoute(order) {
    const { assets } = await getSupportedAssets();
    const byId = new Map(assets.map((asset) => [asset.assetId, asset]));
    const resolved = {};
    for (const side of ['origin', 'destination']) {
      const asset = byId.get(order[side].assetId);
      if (!asset) fail(E.UNSUPPORTED_ASSET, `${side} asset is not in the 1Click supported list`, { assetId: order[side].assetId });
      if (asset.blockchain !== order[side].chain) fail(E.ASSET_CHAIN_MISMATCH, `${side} asset belongs to ${asset.blockchain}, not ${order[side].chain}`, { assetId: asset.assetId });
      resolved[side] = { chain: asset.blockchain, assetId: asset.assetId, decimals: asset.decimals };
    }
    return resolved;
  }

  function checkQuoteResponse(payload, expectedRequest) {
    if (!isObject(payload) || !isObject(payload.quoteRequest) || !isObject(payload.quote) || typeof payload.signature !== 'string'
      || typeof payload.timestamp !== 'string' || typeof payload.correlationId !== 'string') fail(E.MALFORMED_RESPONSE, '1Click quote response is missing required fields');
    for (const [key, value] of Object.entries(expectedRequest)) {
      if (payload.quoteRequest[key] !== value) fail(E.ORDER_MISMATCH, `Provider quote does not echo the requested ${key}`, { field: key });
    }
    const q = payload.quote;
    for (const key of ['amountIn', 'minAmountIn', 'amountOut', 'minAmountOut']) integerString(q[key], `quote.${key}`, { code: E.MALFORMED_RESPONSE });
    if (!Number.isFinite(q.timeEstimate) && q.timeEstimate !== undefined) fail(E.MALFORMED_RESPONSE, 'quote.timeEstimate is invalid');
    for (const key of ['refundFee', 'withdrawFee']) if (q[key] !== undefined) integerString(q[key], `quote.${key}`, { code: E.MALFORMED_RESPONSE });
    const quotedAtMs = isoTime(payload.timestamp, 'timestamp', E.MALFORMED_RESPONSE);
    return quotedAtMs;
  }

  async function quote(order, dry) {
    const now = clock.now();
    const identity = validateOrder(order, { now });
    const route = await resolveRoute(order);
    const expectedRequest = quoteRequestFor(order, dry);
    const { payload, bodyText } = await request('POST', '/v0/quote', { body: expectedRequest, maxBytes: LIMITS.quote });
    const quotedAtMs = checkQuoteResponse(payload, expectedRequest);
    const verification = verify(payload);
    if (!verification || verification.valid !== true) fail(E.SIGNATURE_INVALID, '1Click quote signature did not verify; quote discarded', { correlationId: payload.correlationId });
    const q = payload.quote;
    if (q.amountIn !== order.amountIn) fail(E.ORDER_MISMATCH, 'Quoted input amount differs from the order', { field: 'amountIn' });
    if (BigInt(q.amountOut) < BigInt(q.minAmountOut)) fail(E.MALFORMED_RESPONSE, 'Quoted amountOut is below its own minAmountOut');
    if (BigInt(q.minAmountOut) < BigInt(order.minAmountOut)) fail(E.QUOTE_BELOW_MINIMUM, 'Quoted minimum output is below the order minimum', { quotedMinAmountOut: q.minAmountOut, orderMinAmountOut: order.minAmountOut });
    const checkNow = clock.now();
    if (quotedAtMs > checkNow + maxClockSkewMs) fail(E.MALFORMED_RESPONSE, 'Quote timestamp is in the future beyond allowed clock skew');
    if (checkNow - quotedAtMs > maxQuoteAgeMs) fail(E.QUOTE_EXPIRED, 'Quote is older than the allowed quote age');
    const orderExpiryMs = Date.parse(order.expiresAt);
    if (orderExpiryMs <= checkNow) fail(E.QUOTE_EXPIRED, 'Order expiry passed while quoting');
    let deposit = null; let quoteDeadline = null; let timeWhenInactive = null; let effectiveExpiryMs = orderExpiryMs;
    if (!dry) {
      if (typeof q.depositAddress !== 'string' || !ADDRESS.test(q.depositAddress)) fail(E.MALFORMED_RESPONSE, 'Execution quote has no valid depositAddress');
      if (q.depositMemo !== undefined && (typeof q.depositMemo !== 'string' || !q.depositMemo || q.depositMemo.length > 256)) fail(E.MALFORMED_RESPONSE, 'Execution quote depositMemo is invalid');
      const deadlineMs = isoTime(q.deadline, 'quote.deadline', E.MALFORMED_RESPONSE);
      if (deadlineMs <= checkNow) fail(E.QUOTE_EXPIRED, 'Execution quote deadline has passed');
      quoteDeadline = q.deadline;
      if (q.timeWhenInactive !== undefined) { isoTime(q.timeWhenInactive, 'quote.timeWhenInactive', E.MALFORMED_RESPONSE); timeWhenInactive = q.timeWhenInactive; }
      effectiveExpiryMs = Math.min(orderExpiryMs, deadlineMs);
      deposit = Object.freeze({ type: order.depositType, address: q.depositAddress, memo: q.depositMemo ?? null, chain: route.origin.chain, assetId: route.origin.assetId, exactAmount: q.amountIn });
    }
    return deepFreeze({
      kind: dry ? 'DRY_QUOTE' : 'EXECUTION_QUOTE',
      label: dry ? 'DRY QUOTE: preview only, not funded, not executable' : 'EXECUTION QUOTE: not funded; this client sends no deposit',
      dry, funded: false, provider: PROVIDER_ID, source, mocked,
      order: identity,
      route,
      amounts: {
        amountIn: q.amountIn, minAmountIn: q.minAmountIn, amountOut: q.amountOut, minAmountOut: q.minAmountOut,
        orderMinAmountOut: order.minAmountOut,
        amountInDisplay: formatUnits(q.amountIn, route.origin.decimals), amountOutDisplay: formatUnits(q.amountOut, route.destination.decimals),
        minAmountOutDisplay: formatUnits(q.minAmountOut, route.destination.decimals),
      },
      fees: { refundFee: q.refundFee ?? null, withdrawFee: q.withdrawFee ?? null, appFees: Array.isArray(payload.quoteRequest.appFees) ? payload.quoteRequest.appFees : [] },
      expiry: { orderExpiresAt: order.expiresAt, quoteDeadline, timeWhenInactive, effectiveExpiresAt: new Date(effectiveExpiryMs).toISOString(), quotedAt: payload.timestamp },
      timeEstimateSeconds: Number.isFinite(q.timeEstimate) ? q.timeEstimate : null,
      signature: { verified: true, scheme: verification.scheme ?? 'ed25519', publicKey: verification.publicKey ?? null, signedMessage: verification.message ?? null, value: payload.signature },
      deposit,
      correlationId: payload.correlationId,
      // Unmodified provider payload, required to re-verify the signature or resolve disputes later.
      providerPayload: payload,
      providerPayloadSha256: sha256Hex(bodyText),
    });
  }

  async function previewOrder(order) { return quote(order, true); }

  async function prepareOrder(order) {
    if (!allowExecutionQuotes) fail(E.EXECUTION_QUOTES_DISABLED, 'Execution quotes are disabled; construct the client with allowExecutionQuotes: true');
    return quote(order, false);
  }

  // reference: an EXECUTION_QUOTE from prepareOrder (preferred, enables binding checks) or { depositAddress, depositMemo? }.
  async function getExecutionStatus(reference) {
    let depositAddress; let depositMemo; let bound = null;
    if (isObject(reference) && reference.kind === 'EXECUTION_QUOTE') {
      depositAddress = reference.deposit?.address; depositMemo = reference.deposit?.memo ?? undefined; bound = reference;
    } else if (isObject(reference) && reference.kind === 'DRY_QUOTE') {
      fail(E.INVALID_ORDER, 'A dry quote has no execution status; it was never executable');
    } else if (isObject(reference)) {
      exactKeys(reference, Object.hasOwn(reference, 'depositMemo') ? ['depositAddress', 'depositMemo'] : ['depositAddress'], 'status reference');
      ({ depositAddress, depositMemo } = reference);
    } else fail(E.INVALID_ORDER, 'Status reference must be an execution quote or { depositAddress }');
    if (typeof depositAddress !== 'string' || !ADDRESS.test(depositAddress)) fail(E.INVALID_ORDER, 'depositAddress is invalid');
    if (depositMemo !== undefined && (typeof depositMemo !== 'string' || !depositMemo || depositMemo.length > 256)) fail(E.INVALID_ORDER, 'depositMemo is invalid');
    const { payload, bodyText } = await request('GET', '/v0/status', { query: { depositAddress, depositMemo }, maxBytes: LIMITS.status });
    if (!isObject(payload) || typeof payload.status !== 'string' || typeof payload.updatedAt !== 'string' || !isObject(payload.quoteResponse)) fail(E.MALFORMED_RESPONSE, '1Click status response is missing required fields');
    if (!Object.hasOwn(STATUS_PHASES, payload.status)) fail(E.UNKNOWN_STATUS, 'Undocumented 1Click status; treated as unknown, not success', { status: sanitizeProviderMessage(payload.status) });
    isoTime(payload.updatedAt, 'updatedAt', E.MALFORMED_RESPONSE);
    const qr = payload.quoteResponse;
    if (!isObject(qr.quote) || !isObject(qr.quoteRequest)) fail(E.MALFORMED_RESPONSE, 'Status response has no embedded quote');
    const verification = verify(qr);
    if (!verification || verification.valid !== true) fail(E.SIGNATURE_INVALID, 'Embedded quote signature in status did not verify');
    if (qr.quote.depositAddress !== depositAddress || (depositMemo !== undefined && qr.quote.depositMemo !== depositMemo)) fail(E.ORDER_MISMATCH, 'Status refers to a different deposit address');
    if (bound) {
      // Same signed quote as the one we prepared: signature and every signed request field must be identical.
      const original = bound.providerPayload;
      if (qr.signature !== original.signature || qr.timestamp !== original.timestamp) fail(E.ORDER_MISMATCH, 'Status embeds a different quote than the prepared one');
      for (const key of ['originAsset', 'destinationAsset', 'amount', 'recipient', 'recipientType', 'refundTo', 'refundType', 'deadline', 'slippageTolerance']) {
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
      // Provider-reported state only. The coordinator must confirm receipt of funds on the destination chain itself.
      providerReportedSuccess: payload.status === 'SUCCESS',
      updatedAt: payload.updatedAt,
      deposit: { address: depositAddress, memo: depositMemo ?? null },
      order: bound ? bound.order : null,
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
