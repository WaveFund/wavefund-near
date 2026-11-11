import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateKeyPairSync, sign } from 'node:crypto';
import {
  createIntentsClient, createQuoteSignatureVerifier, quoteMessage, formatUnits, validateOrder,
  IntentsError, ERROR_CODES, EXECUTION_STATUSES, ONE_CLICK_BASE_URL,
} from '../intents/index.mjs';
import { base58Encode } from '../intents/signature.mjs';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/intents/${name}`, import.meta.url), 'utf8'));
const TOKENS = fixture('tokens.live-subset.json');
const LIVE_DRY = fixture('quote-dry.live.json');
const EXEC_TEMPLATE = fixture('execution-quote.mocked.template.json');
const STATUS_TEMPLATE = fixture('status.mocked.template.json');
const USDC_NEAR = 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';
const POLICY = `0x${'ab'.repeat(32)}`;

// Throwaway signer for MOCKED payloads. The real 1Click key is only exercised by the live dry fixture.
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const TEST_PUBLIC_KEY = `ed25519:${base58Encode(Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url'))}`;
const testVerifier = createQuoteSignatureVerifier({ publicKey: TEST_PUBLIC_KEY });
function signWith(payload, key = privateKey) {
  const copy = structuredClone(payload);
  copy.signature = `ed25519:${base58Encode(sign(null, Buffer.from(quoteMessage(copy), 'utf8'), key))}`;
  return copy;
}

const clockAt = (iso) => { let now = Date.parse(iso); return { now: () => now, advance: (ms) => { now += ms; } }; };
const json = (status, body, headers = {}) => ({ status, headers, bodyText: typeof body === 'string' ? body : JSON.stringify(body) });

// Route-based fake transport; records every call so tests can prove what was (not) sent.
function fakeTransport(routes) {
  const calls = [];
  const transport = async (req) => {
    calls.push({ ...req, parsedBody: req.body ? JSON.parse(req.body) : undefined });
    const url = new URL(req.url);
    const handler = routes[`${req.method} ${url.pathname}`];
    if (!handler) throw new Error(`Unexpected request ${req.method} ${url.pathname}`);
    return typeof handler === 'function' ? handler(req, url) : handler;
  };
  transport.calls = calls;
  return transport;
}

function liveDryOrder(overrides = {}) {
  return {
    decisionId: 'round-7:decision-1', policyHash: POLICY, winningProposalId: 1,
    origin: { chain: 'near', assetId: 'nep141:wrap.near' }, destination: { chain: 'near', assetId: 'nep141:usdt.tether-token.near' },
    depositType: 'ORIGIN_CHAIN', amountIn: '1000000000000000000000000', minAmountOut: '3600000', slippageBps: 100,
    recipient: { address: 'your-account.near', type: 'DESTINATION_CHAIN' }, refund: { address: 'your-account.near', type: 'ORIGIN_CHAIN' },
    expiresAt: '2026-11-11T06:23:57.911Z', ...overrides,
  };
}
function execOrder(overrides = {}) {
  const r = EXEC_TEMPLATE.quoteRequest;
  return {
    decisionId: 'round-8:decision-1', policyHash: POLICY, winningProposalId: 2,
    origin: { chain: 'near', assetId: r.originAsset }, destination: { chain: 'near', assetId: r.destinationAsset },
    depositType: r.depositType, amountIn: r.amount, minAmountOut: '950000000000000000', slippageBps: r.slippageTolerance,
    recipient: { address: r.recipient, type: r.recipientType }, refund: { address: r.refundTo, type: r.refundType },
    expiresAt: r.deadline, ...overrides,
  };
}
const LIVE_CLOCK = '2026-11-11T05:54:03.000Z'; // 5 s after the live dry quote's provider timestamp.
const EXEC_CLOCK = '2026-11-11T06:00:10.000Z';

function liveClient(quoteResponse = LIVE_DRY, extra = {}) {
  const transport = fakeTransport({ 'GET /v0/tokens': json(200, TOKENS), 'POST /v0/quote': quoteResponse, ...extra.routes });
  const client = createIntentsClient({ transport, clock: clockAt(LIVE_CLOCK), ...extra.options });
  return { client, transport };
}
function execClient({ quote = signWith(EXEC_TEMPLATE), status, options = {}, clock = clockAt(EXEC_CLOCK) } = {}) {
  const transport = fakeTransport({ 'GET /v0/tokens': json(200, TOKENS), 'POST /v0/quote': json(201, quote), ...(status ? { 'GET /v0/status': status } : {}) });
  const client = createIntentsClient({ transport, clock, verifySignature: testVerifier, allowExecutionQuotes: true, ...options });
  return { client, transport };
}
const rejectsCode = (promise, code) => assert.rejects(promise, (error) => error instanceof IntentsError && error.code === code);

// ------------------------------------------------------------------ signatures

test('real 1Click signature on the live dry fixture verifies with the pinned production key', () => {
  assert.equal(createQuoteSignatureVerifier()(LIVE_DRY).valid, true);
});

test('signature verification fails, without throwing, for tampering, wrong keys and garbage', () => {
  const verify = createQuoteSignatureVerifier();
  for (const mutate of [
    (p) => { p.quoteRequest.recipient = 'attacker.near'; }, (p) => { p.quoteRequest.refundTo = 'attacker.near'; },
    (p) => { p.quote.amountOut = '9999999'; }, (p) => { p.quote.minAmountOut = '1'; }, (p) => { p.quoteRequest.amount = '2'; },
    (p) => { p.timestamp = '2026-11-11T05:53:59.357Z'; }, (p) => { p.signature = 'ed25519:1111'; }, (p) => { p.signature = 'not base58 !'; },
    (p) => { delete p.quote; }, (p) => { p.signature = 42; },
  ]) {
    const payload = structuredClone(LIVE_DRY); mutate(payload);
    assert.equal(verify(payload).valid, false);
  }
  assert.equal(testVerifier(LIVE_DRY).valid, false, 'a different key must not accept the provider signature');
  assert.equal(verify(signWith(LIVE_DRY)).valid, false, 'a self-signed payload must not pass the production key');
  assert.throws(() => createQuoteSignatureVerifier({ publicKey: 'ed25519:abc' }), /32 bytes|base58/);
});

// ------------------------------------------------------------------ dry quotes

test('previewOrder returns a bound, signature-verified dry quote that is never presented as funded', async () => {
  const { client, transport } = liveClient(json(201, LIVE_DRY));
  const quote = await client.previewOrder(liveDryOrder());
  assert.equal(quote.kind, 'DRY_QUOTE'); assert.equal(quote.dry, true); assert.equal(quote.funded, false);
  assert.match(quote.label, /not funded, not executable/); assert.equal(quote.deposit, null);
  assert.equal(quote.mocked, true, 'replayed through an injected transport, so labelled mocked');
  assert.equal(quote.source, 'injected-transport');
  assert.deepEqual(quote.order.decisionId, 'round-7:decision-1'); assert.equal(quote.order.policyHash, POLICY); assert.equal(quote.order.winningProposalId, 1);
  assert.match(quote.order.orderDigest, /^[0-9a-f]{64}$/);
  assert.equal(quote.amounts.amountIn, '1000000000000000000000000'); assert.equal(quote.amounts.amountOut, '3648227');
  assert.equal(quote.amounts.minAmountOut, '3611744'); assert.equal(quote.amounts.orderMinAmountOut, '3600000');
  assert.equal(quote.amounts.amountInDisplay, '1'); assert.equal(quote.amounts.amountOutDisplay, '3.648227');
  assert.deepEqual(quote.route.origin, { chain: 'near', assetId: 'nep141:wrap.near', decimals: 24 });
  assert.equal(quote.signature.verified, true); assert.equal(quote.expiry.quoteDeadline, null);
  assert.equal(quote.expiry.effectiveExpiresAt, '2026-11-11T06:23:57.911Z');
  assert.equal(quote.fees.appFees.length, 1, 'unauthenticated platform fee preserved for review');
  assert.deepEqual(quote.providerPayload, LIVE_DRY);
  assert.ok(Object.isFrozen(quote) && Object.isFrozen(quote.providerPayload.quote));
  const sent = transport.calls.find((c) => c.url.endsWith('/v0/quote')).parsedBody;
  assert.equal(sent.dry, true); assert.equal(sent.swapType, 'EXACT_INPUT'); assert.equal(sent.amount, '1000000000000000000000000');
  assert.equal(sent.appFees, undefined); assert.equal(sent.referral, undefined);
});

test('altered recipient, refund or amount in the provider echo is rejected before use', async () => {
  for (const [field, value] of [['recipient', 'attacker.near'], ['refundTo', 'attacker.near'], ['amount', '2'], ['destinationAsset', 'nep141:eth.bridge.near']]) {
    const tampered = structuredClone(LIVE_DRY); tampered.quoteRequest[field] = value;
    await rejectsCode(liveClient(json(201, tampered)).client.previewOrder(liveDryOrder()), ERROR_CODES.ORDER_MISMATCH);
  }
  // An attacker who re-signs a recipient change with their own key still fails the production key.
  const resigned = signWith({ ...structuredClone(LIVE_DRY), quoteRequest: { ...LIVE_DRY.quoteRequest, recipient: 'attacker.near' } });
  await rejectsCode(liveClient(json(201, resigned)).client.previewOrder(liveDryOrder({ recipient: { address: 'attacker.near', type: 'DESTINATION_CHAIN' } })), ERROR_CODES.SIGNATURE_INVALID);
  const amountOut = structuredClone(LIVE_DRY); amountOut.quote.amountOut = '99999999';
  await rejectsCode(liveClient(json(201, amountOut)).client.previewOrder(liveDryOrder()), ERROR_CODES.SIGNATURE_INVALID);
});

test('validly signed quotes still fail when amounts break the order', async () => {
  const lowMin = signWith({ ...EXEC_TEMPLATE, quoteRequest: { ...EXEC_TEMPLATE.quoteRequest, dry: true }, quote: { ...EXEC_TEMPLATE.quote, minAmountOut: '949999999999999999' } });
  await rejectsCode(execClient({ quote: lowMin }).client.previewOrder(execOrder()), ERROR_CODES.QUOTE_BELOW_MINIMUM);
  const otherInput = signWith({ ...EXEC_TEMPLATE, quoteRequest: { ...EXEC_TEMPLATE.quoteRequest, dry: true }, quote: { ...EXEC_TEMPLATE.quote, amountIn: '1999999999' } });
  await rejectsCode(execClient({ quote: otherInput }).client.previewOrder(execOrder()), ERROR_CODES.ORDER_MISMATCH);
  const incoherent = signWith({ ...EXEC_TEMPLATE, quoteRequest: { ...EXEC_TEMPLATE.quoteRequest, dry: true }, quote: { ...EXEC_TEMPLATE.quote, amountOut: '1' } });
  await rejectsCode(execClient({ quote: incoherent }).client.previewOrder(execOrder()), ERROR_CODES.MALFORMED_RESPONSE);
});

// ------------------------------------------------------------------ expiry

test('expired orders, stale or future quotes and passed execution deadlines are rejected', async () => {
  const { client, transport } = liveClient(json(201, LIVE_DRY));
  await rejectsCode(client.previewOrder(liveDryOrder({ expiresAt: '2026-11-11T05:54:02.999Z' })), ERROR_CODES.ORDER_EXPIRED);
  assert.equal(transport.calls.length, 0, 'expired orders send no HTTP');
  const stale = liveClient(json(201, LIVE_DRY), { options: { clock: clockAt('2026-11-11T05:56:00.000Z') } });
  await rejectsCode(stale.client.previewOrder(liveDryOrder()), ERROR_CODES.QUOTE_EXPIRED);
  const future = liveClient(json(201, LIVE_DRY), { options: { clock: clockAt('2026-11-11T05:53:00.000Z') } });
  await rejectsCode(future.client.previewOrder(liveDryOrder()), ERROR_CODES.MALFORMED_RESPONSE);
  const pastDeadline = signWith({ ...EXEC_TEMPLATE, quote: { ...EXEC_TEMPLATE.quote, deadline: '2026-11-11T06:00:05.000Z' } });
  await rejectsCode(execClient({ quote: pastDeadline }).client.prepareOrder(execOrder()), ERROR_CODES.QUOTE_EXPIRED);
  const earlier = signWith({ ...EXEC_TEMPLATE, quote: { ...EXEC_TEMPLATE.quote, deadline: '2026-11-11T06:10:00.000Z' } });
  const prepared = await execClient({ quote: earlier }).client.prepareOrder(execOrder());
  assert.equal(prepared.expiry.effectiveExpiresAt, '2026-11-11T06:10:00.000Z', 'effective expiry is the earlier of order and quote');
});

// ------------------------------------------------------------------ decimals

test('amounts are exact base-unit integer strings; display uses provider decimals, never floats', async () => {
  for (const amountIn of [1000, '1.5', '01', '-1', '', '0', '1e24', ' 1', '1'.repeat(79)]) {
    assert.throws(() => validateOrder(liveDryOrder({ amountIn }), { now: Date.parse(LIVE_CLOCK) }), (e) => e.code === ERROR_CODES.INVALID_ORDER);
  }
  assert.throws(() => validateOrder(liveDryOrder({ minAmountOut: 3600000 }), { now: Date.parse(LIVE_CLOCK) }), (e) => e.code === ERROR_CODES.INVALID_ORDER);
  assert.equal(formatUnits('1000000000000000000000000', 24), '1');
  assert.equal(formatUnits('1', 24), '0.000000000000000000000001');
  assert.equal(formatUnits('3648227', 6), '3.648227'); assert.equal(formatUnits('5', 0), '5'); assert.equal(formatUnits('0', 18), '0');
  // Minimum comparison is BigInt-exact above 2^53.
  const order = execOrder({ minAmountOut: '956340000000000001' });
  const quote = signWith({ ...EXEC_TEMPLATE, quoteRequest: { ...EXEC_TEMPLATE.quoteRequest, dry: true } });
  await rejectsCode(execClient({ quote }).client.previewOrder(order), ERROR_CODES.QUOTE_BELOW_MINIMUM);
  const ok = await execClient({ quote }).client.previewOrder(execOrder({ minAmountOut: '956340000000000000' }));
  assert.equal(ok.amounts.minAmountOutDisplay, '0.95634'); assert.equal(ok.route.destination.decimals, 18);
});

// ------------------------------------------------------------------ assets and routes

test('assets are resolved by exact identifier and chain, never by ticker', async () => {
  const now = { now: Date.parse(LIVE_CLOCK) };
  assert.throws(() => validateOrder(liveDryOrder({ origin: { chain: 'near', assetId: 'USDC' } }), now), (e) => e.code === ERROR_CODES.INVALID_ORDER);
  assert.throws(() => validateOrder(liveDryOrder({ origin: { chain: 'near', assetId: 'nep141:wrap.near' }, destination: { chain: 'near', assetId: 'nep141:wrap.near' } }), now), (e) => e.code === ERROR_CODES.INVALID_ORDER);
  const assets = await liveClient().client.getSupportedAssets();
  assert.equal(assets.assets.filter((a) => a.symbol === 'USDC').length, 2, 'fixture proves symbols are ambiguous');
  const { client, transport } = liveClient();
  await rejectsCode(client.previewOrder(liveDryOrder({ origin: { chain: 'aurora', assetId: 'nep141:aurora-testnet-usdc.example' } })), ERROR_CODES.UNSUPPORTED_ASSET);
  await rejectsCode(client.previewOrder(liveDryOrder({ destination: { chain: 'near', assetId: 'nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near' } })), ERROR_CODES.ASSET_CHAIN_MISMATCH);
  assert.equal(transport.calls.filter((c) => c.url.endsWith('/v0/quote')).length, 0, 'unsupported assets never reach the quote endpoint');
});

test('provider rejections map to stable codes using the messages observed live', async () => {
  const cases = [
    ['tokenIn is not valid', ERROR_CODES.UNSUPPORTED_ROUTE], ['No liquidity available', ERROR_CODES.NO_LIQUIDITY],
    ['Amount is too low for bridge, try at least 0', ERROR_CODES.AMOUNT_TOO_LOW], ['recipient is not valid', ERROR_CODES.PROVIDER_REJECTED],
  ];
  for (const [message, code] of cases) {
    const { client } = liveClient(json(400, { message, correlationId: 'c-1', timestamp: '2026-11-11T05:55:12.728Z', path: '/v0/quote' }));
    await assert.rejects(client.previewOrder(liveDryOrder()), (e) => e.code === code && e.details.providerMessage === message && e.details.httpStatus === 400);
  }
  const { client } = liveClient(json(400, { message: 'bad\u0000\nthing'.padEnd(500, 'x') }));
  await assert.rejects(client.previewOrder(liveDryOrder()), (e) => e.code === ERROR_CODES.PROVIDER_REJECTED && !/[\u0000\n]/.test(e.message) && e.message.length <= 200);
});

// ------------------------------------------------------------------ malformed responses

test('malformed provider responses fail closed', async () => {
  const bad = [
    json(201, 'not json'), json(201, ''), json(201, []), json(201, { ...LIVE_DRY, signature: undefined }),
    json(201, { ...LIVE_DRY, quote: { ...LIVE_DRY.quote, amountOut: 3648227 } }), json(201, { ...LIVE_DRY, timestamp: 'yesterday' }),
    json(201, { ...LIVE_DRY, correlationId: undefined }),
  ];
  for (const response of bad) await rejectsCode(liveClient(response).client.previewOrder(liveDryOrder()), ERROR_CODES.MALFORMED_RESPONSE);
  await rejectsCode(createIntentsClient({ transport: async () => ({ status: 200 }) }).getSupportedAssets(), ERROR_CODES.MALFORMED_RESPONSE);
  await rejectsCode(createIntentsClient({ transport: async () => json(200, { tokens: TOKENS }) }).getSupportedAssets(), ERROR_CODES.MALFORMED_RESPONSE);
  await rejectsCode(createIntentsClient({ transport: async () => json(200, [TOKENS[0], TOKENS[0]]) }).getSupportedAssets(), ERROR_CODES.MALFORMED_RESPONSE);
  await rejectsCode(createIntentsClient({ transport: async () => json(200, [{ assetId: 'USDC', decimals: 6 }]) }).getSupportedAssets(), ERROR_CODES.MALFORMED_RESPONSE);
  const mixed = await createIntentsClient({ transport: async () => json(200, [...TOKENS, { assetId: 'nep141:x.near', decimals: 1.5, blockchain: 'near', symbol: 'X' }, null]) }).getSupportedAssets();
  assert.equal(mixed.assets.length, TOKENS.length); assert.equal(mixed.rejectedEntries, 2);
  const executionWithoutDeposit = signWith({ ...EXEC_TEMPLATE, quote: { ...EXEC_TEMPLATE.quote, depositAddress: undefined } });
  await rejectsCode(execClient({ quote: executionWithoutDeposit }).client.prepareOrder(execOrder()), ERROR_CODES.MALFORMED_RESPONSE);
});

// ------------------------------------------------------------------ transport failures

test('timeouts abort the request and are reported, never retried', async () => {
  let signal; let attempts = 0;
  const hanging = createIntentsClient({ timeoutMs: 20, transport: (req) => { attempts++; signal = req.signal; return new Promise(() => {}); } });
  await rejectsCode(hanging.getSupportedAssets(), ERROR_CODES.TIMEOUT);
  assert.equal(signal.aborted, true); assert.equal(attempts, 1);
  const aborting = createIntentsClient({ transport: async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); } });
  await rejectsCode(aborting.getSupportedAssets(), ERROR_CODES.TIMEOUT);
  const leaking = createIntentsClient({ apiKey: 'jwt-secret-value', transport: async () => { throw new Error('connect ECONNREFUSED jwt-secret-value'); } });
  await assert.rejects(leaking.getSupportedAssets(), (e) => e.code === ERROR_CODES.TRANSPORT_FAILED && !e.message.includes('jwt-secret-value'));
});

test('rate limits, auth failures and outages map to codes with a single attempt', async () => {
  const limited = fakeTransport({ 'GET /v0/tokens': json(429, { message: 'Too Many Requests' }, { 'Retry-After': '7' }) });
  await assert.rejects(createIntentsClient({ transport: limited }).getSupportedAssets(), (e) => e.code === ERROR_CODES.RATE_LIMITED && e.details.retryAfterSeconds === 7 && e.retryable);
  assert.equal(limited.calls.length, 1, 'no automatic retry');
  await rejectsCode(createIntentsClient({ transport: async () => json(401, '') }).getSupportedAssets(), ERROR_CODES.UNAUTHORIZED);
  await rejectsCode(createIntentsClient({ transport: async () => json(503, '<html>') }).getSupportedAssets(), ERROR_CODES.PROVIDER_UNAVAILABLE);
  await rejectsCode(createIntentsClient({ transport: async () => json(418, '{}') }).getSupportedAssets(), ERROR_CODES.PROVIDER_REJECTED);
});

// ------------------------------------------------------------------ execution quotes (gated, MOCKED)

test('prepareOrder is gated off by default and sends nothing', async () => {
  const transport = fakeTransport({});
  const client = createIntentsClient({ transport, clock: clockAt(EXEC_CLOCK) });
  await rejectsCode(client.prepareOrder(execOrder()), ERROR_CODES.EXECUTION_QUOTES_DISABLED);
  assert.equal(transport.calls.length, 0);
  assert.throws(() => createIntentsClient({ allowExecutionQuotes: 'yes' }), /boolean/);
});

test('MOCKED execution quote: deposit reference returned, still not funded', async () => {
  const { client, transport } = execClient();
  const quote = await client.prepareOrder(execOrder());
  assert.equal(quote.kind, 'EXECUTION_QUOTE'); assert.equal(quote.funded, false); assert.equal(quote.mocked, true);
  assert.match(quote.label, /not funded/);
  assert.deepEqual(quote.deposit, { type: 'INTENTS', address: 'mocked-deposit.example.near', memo: null, chain: 'near', assetId: USDC_NEAR, exactAmount: '2000000000' });
  assert.equal(quote.expiry.quoteDeadline, '2026-11-11T06:30:00.000Z'); assert.equal(quote.expiry.timeWhenInactive, '2026-11-11T06:20:00.000Z');
  assert.equal(transport.calls.find((c) => c.url.endsWith('/v0/quote')).parsedBody.dry, false);
  assert.deepEqual(transport.calls.map((c) => `${c.method} ${new URL(c.url).pathname}`), ['GET /v0/tokens', 'POST /v0/quote']);
});

// ------------------------------------------------------------------ status (MOCKED)

const statusBody = (status, quoteResponse, swapDetails = STATUS_TEMPLATE.swapDetails) => json(200, { ...STATUS_TEMPLATE, status, quoteResponse, swapDetails });

test('every documented execution status is normalized; only SUCCESS reports provider success', async () => {
  assert.deepEqual([...EXECUTION_STATUSES].sort(), ['FAILED', 'INCOMPLETE_DEPOSIT', 'KNOWN_DEPOSIT_TX', 'PENDING_DEPOSIT', 'PROCESSING', 'REFUNDED', 'SUCCESS']);
  const signedQuote = signWith(EXEC_TEMPLATE);
  const expected = {
    PENDING_DEPOSIT: ['awaiting_deposit', false], KNOWN_DEPOSIT_TX: ['deposit_detected', false], INCOMPLETE_DEPOSIT: ['deposit_incomplete', false],
    PROCESSING: ['processing', false], SUCCESS: ['succeeded', true], REFUNDED: ['refunded', true], FAILED: ['failed', true],
  };
  for (const status of EXECUTION_STATUSES) {
    const details = status === 'REFUNDED' ? { ...STATUS_TEMPLATE.swapDetails, refundedAmount: '2000000000', refundReason: 'PARTIAL_DEPOSIT' } : STATUS_TEMPLATE.swapDetails;
    const { client, transport } = execClient({ quote: signedQuote, status: statusBody(status, signedQuote, details) });
    const prepared = await client.prepareOrder(execOrder());
    const result = await client.getExecutionStatus(prepared);
    assert.equal(result.status, status); assert.equal(result.phase, expected[status][0]); assert.equal(result.terminal, expected[status][1]);
    assert.equal(result.providerReportedSuccess, status === 'SUCCESS'); assert.equal(result.mocked, true);
    assert.equal(result.order.decisionId, 'round-8:decision-1'); assert.equal(result.quoteSignatureVerified, true);
    if (status === 'REFUNDED') { assert.equal(result.swap.refundedAmount, '2000000000'); assert.equal(result.swap.refundReason, 'PARTIAL_DEPOSIT'); }
    const statusCall = transport.calls.find((c) => c.url.includes('/v0/status'));
    assert.equal(new URL(statusCall.url).searchParams.get('depositAddress'), 'mocked-deposit.example.near');
  }
});

test('status responses are bound to the prepared quote and fail closed otherwise', async () => {
  const signedQuote = signWith(EXEC_TEMPLATE);
  const cases = [
    [statusBody('COMPLETED', signedQuote), ERROR_CODES.UNKNOWN_STATUS],
    [statusBody('SUCCESS', { ...signedQuote, quote: { ...signedQuote.quote, amountOut: '1' } }), ERROR_CODES.SIGNATURE_INVALID],
    [statusBody('SUCCESS', signWith({ ...EXEC_TEMPLATE, quote: { ...EXEC_TEMPLATE.quote, depositAddress: 'other.example.near' } })), ERROR_CODES.ORDER_MISMATCH],
    [statusBody('SUCCESS', signWith({ ...EXEC_TEMPLATE, timestamp: '2026-11-11T06:00:01.000Z' })), ERROR_CODES.ORDER_MISMATCH],
    [json(200, { status: 'SUCCESS' }), ERROR_CODES.MALFORMED_RESPONSE],
    [statusBody('SUCCESS', signedQuote, { ...STATUS_TEMPLATE.swapDetails, amountOut: 1.5 }), ERROR_CODES.MALFORMED_RESPONSE],
    [json(404, { message: 'Deposit address not found' }), ERROR_CODES.NOT_FOUND],
  ];
  for (const [status, code] of cases) {
    const { client } = execClient({ quote: signedQuote, status });
    const prepared = await client.prepareOrder(execOrder());
    await rejectsCode(client.getExecutionStatus(prepared), code);
  }
  const { client } = execClient({ quote: signedQuote, status: statusBody('PROCESSING', signedQuote) });
  const dry = await execClient({ quote: signWith({ ...EXEC_TEMPLATE, quoteRequest: { ...EXEC_TEMPLATE.quoteRequest, dry: true } }) }).client.previewOrder(execOrder());
  await rejectsCode(client.getExecutionStatus(dry), ERROR_CODES.INVALID_ORDER);
  await rejectsCode(client.getExecutionStatus({ depositAddress: 'mocked-deposit.example.near', extra: 1 }), ERROR_CODES.INVALID_ORDER);
  const byAddress = await client.getExecutionStatus({ depositAddress: 'mocked-deposit.example.near' });
  assert.equal(byAddress.status, 'PROCESSING'); assert.equal(byAddress.order, null, 'raw references carry no order binding');
});

// ------------------------------------------------------------------ boundaries

test('only the allowlisted endpoint is used, credentials stay in headers, and the surface is read/quote only', async () => {
  assert.throws(() => createIntentsClient({ baseUrl: 'https://1click.example.com' }), /allowlisted/);
  assert.throws(() => createIntentsClient({ apiKey: 'has space' }), /API key/);
  const { client, transport } = liveClient(json(201, LIVE_DRY), { options: { apiKey: 'jwt-test-only' } });
  const quote = await client.previewOrder(liveDryOrder());
  for (const call of transport.calls) { assert.ok(call.url.startsWith(`${ONE_CLICK_BASE_URL}/v0/`)); assert.equal(call.headers['X-API-Key'], 'jwt-test-only'); }
  assert.equal(JSON.stringify(quote).includes('jwt-test-only'), false);
  assert.deepEqual(Object.keys(client).sort(), ['getExecutionStatus', 'getSupportedAssets', 'prepareOrder', 'previewOrder']);
  assert.ok(Object.isFrozen(client));
});

test('supported assets are cached per injected clock TTL', async () => {
  const clock = clockAt(LIVE_CLOCK);
  const transport = fakeTransport({ 'GET /v0/tokens': json(200, TOKENS) });
  const client = createIntentsClient({ transport, clock, assetCacheTtlMs: 1000 });
  const first = await client.getSupportedAssets(); await client.getSupportedAssets();
  assert.equal(transport.calls.length, 1); assert.equal(first.mocked, true);
  assert.equal(first.assets.find((a) => a.assetId === 'nep141:wrap.near').decimals, 24);
  clock.advance(1001); await client.getSupportedAssets();
  assert.equal(transport.calls.length, 2);
});
