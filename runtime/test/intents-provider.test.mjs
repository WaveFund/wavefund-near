import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateKeyPairSync, sign } from 'node:crypto';
import {
  createIntentsClient, createQuoteSignatureVerifier, quoteMessage, formatUnits, validateFundingRequest,
  IntentsError, ERROR_CODES, EXECUTION_STATUSES, ONE_CLICK_BASE_URL, VERIFIED_FUNDING_ROUTES, AURORA_MAINNET_CHAIN_ID,
} from '../intents/index.mjs';
import { base58Encode } from '../intents/signature.mjs';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFundingVerifiers, createFundingEvidenceArchive, toProviderFundingRequest } from '../intents/index.mjs';
import { fundingHash } from '../funding/index.mjs';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/intents/${name}`, import.meta.url), 'utf8'));
// LIVE evidence (real provider data) vs MOCKED templates are loaded from separate directories.
const LIVE_TOKENS = fixture('live/tokens-subset.json');
const LIVE_ARB_IDENTITY = fixture('live/arb-identity-and-minimum.json');
const LIVE_TOKEN_ENTRIES = [...LIVE_TOKENS.entries, LIVE_ARB_IDENTITY.arbitrumUsdcEntry]; // two live captures combined
const LIVE_ARB = fixture('live/quote-dry-arb-usdc-to-aurora.json'); // EXAMPLE destination Safe, real manager refund
const LIVE_FUNDING_DRY = LIVE_ARB.providerPayload; // the approved Arbitrum route
const LIVE_ETH_DRY = fixture('live/quote-dry-eth-usdc-to-aurora.json'); // historical Ethereum evidence, signature-only
const LIVE_OTHER_DRY = fixture('live/quote-dry-wnear-usdt.json');
const MOCK_EXEC = fixture('mocked/funding-execution-quote.template.json');
const MOCK_STATUS = fixture('mocked/funding-status.template.json');
const ROUTE = VERIFIED_FUNDING_ROUTES[0];

const { privateKey, publicKey } = generateKeyPairSync('ed25519'); // throwaway key for MOCKED payloads only
const TEST_PUBLIC_KEY = `ed25519:${base58Encode(Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url'))}`;
const testVerifier = createQuoteSignatureVerifier({ publicKey: TEST_PUBLIC_KEY });
function signWith(payload, key = privateKey) {
  const copy = structuredClone(payload);
  copy.signature = `ed25519:${base58Encode(sign(null, Buffer.from(quoteMessage(copy), 'utf8'), key))}`;
  return copy;
}
const clockAt = (iso) => { let now = Date.parse(iso); return { now: () => now, advance: (ms) => { now += ms; } }; };
const json = (status, body, headers = {}) => ({ status, headers, bodyText: typeof body === 'string' ? body : JSON.stringify(body) });
function fakeTransport(routes) {
  const calls = [];
  const transport = async (req) => {
    calls.push({ ...req, parsedBody: req.body ? JSON.parse(req.body) : undefined });
    const handler = routes[`${req.method} ${new URL(req.url).pathname}`];
    if (!handler) throw new Error(`Unexpected request ${req.method} ${req.url}`);
    return typeof handler === 'function' ? handler(req) : handler;
  };
  transport.calls = calls;
  return transport;
}

function fundingRequest(fromQuote, overrides = {}) {
  const r = fromQuote.quoteRequest;
  return {
    fundingId: 'manager-1:funding-1',
    source: { chain: ROUTE.source.chain, chainId: ROUTE.source.chainId, assetId: r.originAsset, tokenAddress: ROUTE.source.tokenAddress },
    destination: { chainId: AURORA_MAINNET_CHAIN_ID, virtualChainAccount: r.recipient, assetId: r.destinationAsset, tokenAddress: ROUTE.destination.tokenAddress, safeAddress: r.virtualChainRecipient },
    amountIn: r.amount, minAmountOut: { '10000000': '9800000', '250000000': '247000000' }[r.amount], slippageBps: r.slippageTolerance, refundAddress: r.refundTo, expiresAt: r.deadline, ...overrides,
  };
}
const LIVE_CLOCK = '2026-11-11T15:19:17.000Z'; // ~4.5 s after the live Arbitrum quote's provider timestamp
const MOCK_CLOCK = '2026-11-11T12:00:10.000Z';
const tokens = () => json(200, LIVE_TOKEN_ENTRIES);
function liveClient(quoteResponse = json(201, LIVE_FUNDING_DRY), options = {}) {
  const transport = fakeTransport({ 'GET /v0/tokens': tokens(), 'POST /v0/quote': quoteResponse });
  return { client: createIntentsClient({ transport, clock: clockAt(LIVE_CLOCK), ...options }), transport };
}
function mockClient({ quote = signWith(MOCK_EXEC), status, options = {} } = {}) {
  const transport = fakeTransport({ 'GET /v0/tokens': tokens(), 'POST /v0/quote': json(201, quote), ...(status ? { 'GET /v0/status': status } : {}) });
  return { client: createIntentsClient({ transport, clock: clockAt(MOCK_CLOCK), verifySignature: testVerifier, allowExecutionQuotes: true, ...options }), transport };
}
const asDry = (template) => ({ ...template, quoteRequest: { ...template.quoteRequest, dry: true } });
const rejectsCode = (promise, code) => assert.rejects(promise, (error) => error instanceof IntentsError && error.code === code);

// ------------------------------------------------------------------ live evidence (signature interoperability)

test('LIVE: both captured provider quotes verify with the pinned production 1Click key', () => {
  const verify = createQuoteSignatureVerifier();
  assert.equal(verify(LIVE_FUNDING_DRY).valid, true);
  assert.equal(verify(LIVE_ETH_DRY).valid, true);
  assert.equal(verify(LIVE_OTHER_DRY).valid, true);
});

test('LIVE: the virtual-chain recipient (the Safe) is covered by the provider signature', () => {
  const verify = createQuoteSignatureVerifier();
  for (const mutate of [
    (p) => { p.quoteRequest.virtualChainRecipient = '0x000000000000000000000000000000000000dEaD'; }, (p) => { p.quoteRequest.recipient = 'not-aurora.near'; },
    (p) => { p.quoteRequest.refundTo = '0x000000000000000000000000000000000000dEaD'; }, (p) => { p.quote.minAmountOut = '1'; },
    (p) => { p.quoteRequest.amount = '1'; }, (p) => { p.timestamp = '2026-11-11T10:16:53.883Z'; },
    (p) => { p.signature = 'ed25519:1111'; }, (p) => { delete p.quote; },
  ]) {
    const payload = structuredClone(LIVE_FUNDING_DRY); mutate(payload);
    assert.equal(verify(payload).valid, false);
  }
  // Dry quotes do NOT sign fees, time estimates or appFees (1Click scheme). The client must label them unsigned.
  for (const mutate of [(p) => { p.quote.refundFee = '0'; }, (p) => { p.quote.withdrawFee = '999'; }, (p) => { p.quote.timeEstimate = 1; }, (p) => { p.quoteRequest.appFees = [{ recipient: 'x', fee: 500 }]; }]) {
    const payload = structuredClone(LIVE_FUNDING_DRY); mutate(payload);
    assert.equal(verify(payload).valid, true, 'documented unsigned dry-quote field');
  }
  assert.equal(testVerifier(LIVE_FUNDING_DRY).valid, false);
  assert.equal(verify(signWith(LIVE_FUNDING_DRY)).valid, false, 'self-signed payloads never pass the production key');
});

test('LIVE replay: previewOrder accepts the captured funding quote, bound and never funded', async () => {
  const { client, transport } = liveClient();
  const quote = await client.previewOrder(fundingRequest(LIVE_FUNDING_DRY));
  assert.equal(quote.kind, 'DRY_QUOTE'); assert.equal(quote.purpose, 'funding'); assert.equal(quote.funded, false); assert.equal(quote.deposit, null);
  assert.equal(quote.mocked, true, 'replayed through an injected transport, so still labelled mocked'); assert.equal(quote.source, 'injected-transport');
  assert.equal(quote.funding.routeId, 'arb-usdc-to-aurora-usdc'); assert.equal(quote.route.origin.chainId, 42161); assert.match(quote.funding.requestDigest, /^[0-9a-f]{64}$/);
  assert.equal(quote.route.destination.chainId, 1313161554); assert.equal(quote.route.destination.tokenAddress, '0x368ebb46aca6b8d0787c96b2b20bd3cc3f2c45f7');
  assert.equal(quote.amounts.amountInDisplay, '10'); assert.equal(quote.amounts.minAmountOut, '9899347');
  assert.equal(quote.fees.refundFee, '5300', 'refund fee preserved: refunds are not full-input');
  assert.equal(quote.fees.appFeesSigned, false); assert.equal(quote.fees.feesSigned, false, 'dry-quote fees are unsigned');
  const sent = transport.calls.find((c) => c.url.endsWith('/v0/quote')).parsedBody;
  assert.deepEqual(sent, {
    dry: true, swapType: 'EXACT_INPUT', slippageTolerance: 100, originAsset: ROUTE.source.assetId, depositType: 'ORIGIN_CHAIN',
    destinationAsset: ROUTE.destination.assetId, amount: '10000000', refundTo: '0x37f91aa1e24aafc7b3843e281650aa884a6651e2', refundType: 'ORIGIN_CHAIN',
    recipient: 'aurora', recipientType: 'DESTINATION_CHAIN', virtualChainRecipient: '0xb4c2fbec9d610f9a3a9b843c47b1a8095cec887c', deadline: '2026-11-11T15:49:11.000Z',
  });
  assert.ok(Object.isFrozen(quote.providerPayload.quoteRequest));
});

// ------------------------------------------------------------------ tampering

test('tampered recipient, refund, amount or added redirection in the provider echo is rejected', async () => {
  for (const [field, value] of [['virtualChainRecipient', '0x000000000000000000000000000000000000dEaD'], ['recipient', 'other.near'], ['refundTo', '0x000000000000000000000000000000000000dEaD'], ['amount', '1'], ['destinationAsset', 'nep141:usdt.tether-token.near']]) {
    const tampered = structuredClone(LIVE_FUNDING_DRY); tampered.quoteRequest[field] = value;
    await rejectsCode(liveClient(json(201, tampered)).client.previewOrder(fundingRequest(LIVE_FUNDING_DRY)), ERROR_CODES.ORDER_MISMATCH);
  }
  for (const extra of [{ customRecipientMsg: 'deadbeef' }, { virtualChainRefundRecipient: '0x000000000000000000000000000000000000dEaD' }]) {
    const redirected = signWith({ ...asDry(MOCK_EXEC), quoteRequest: { ...asDry(MOCK_EXEC).quoteRequest, ...extra } });
    await rejectsCode(mockClient({ quote: redirected }).client.previewOrder(fundingRequest(MOCK_EXEC)), ERROR_CODES.ORDER_MISMATCH);
  }
  const amountOut = structuredClone(LIVE_FUNDING_DRY); amountOut.quote.amountOut = '999999999';
  await rejectsCode(liveClient(json(201, amountOut)).client.previewOrder(fundingRequest(LIVE_FUNDING_DRY)), ERROR_CODES.SIGNATURE_INVALID);
  const resigned = signWith(LIVE_FUNDING_DRY); // attacker key
  await rejectsCode(liveClient(json(201, resigned)).client.previewOrder(fundingRequest(LIVE_FUNDING_DRY)), ERROR_CODES.SIGNATURE_INVALID);
});

test('validly signed quotes still fail when amounts break the funding request', async () => {
  const req = fundingRequest(MOCK_EXEC);
  const lowMin = signWith({ ...asDry(MOCK_EXEC), quote: { ...MOCK_EXEC.quote, minAmountOut: '246999999' } });
  await rejectsCode(mockClient({ quote: lowMin }).client.previewOrder(req), ERROR_CODES.QUOTE_BELOW_MINIMUM);
  const otherIn = signWith({ ...asDry(MOCK_EXEC), quote: { ...MOCK_EXEC.quote, amountIn: '249999999' } });
  await rejectsCode(mockClient({ quote: otherIn }).client.previewOrder(req), ERROR_CODES.ORDER_MISMATCH);
  const incoherent = signWith({ ...asDry(MOCK_EXEC), quote: { ...MOCK_EXEC.quote, amountOut: '1' } });
  await rejectsCode(mockClient({ quote: incoherent }).client.previewOrder(req), ERROR_CODES.MALFORMED_RESPONSE);
});

// ------------------------------------------------------------------ expiry

test('expired requests, stale/future quotes and passed execution deadlines are rejected', async () => {
  const { client, transport } = liveClient();
  await rejectsCode(client.previewOrder(fundingRequest(LIVE_FUNDING_DRY, { expiresAt: '2026-11-11T15:19:16.000Z' })), ERROR_CODES.ORDER_EXPIRED);
  assert.equal(transport.calls.length, 0, 'expired requests send no HTTP');
  await rejectsCode(liveClient(json(201, LIVE_FUNDING_DRY), { clock: clockAt('2026-11-11T15:22:00.000Z') }).client.previewOrder(fundingRequest(LIVE_FUNDING_DRY)), ERROR_CODES.QUOTE_EXPIRED);
  await rejectsCode(liveClient(json(201, LIVE_FUNDING_DRY), { clock: clockAt('2026-11-11T15:18:00.000Z') }).client.previewOrder(fundingRequest(LIVE_FUNDING_DRY)), ERROR_CODES.MALFORMED_RESPONSE);
  const past = signWith({ ...MOCK_EXEC, quote: { ...MOCK_EXEC.quote, deadline: '2026-11-11T12:00:05.000Z' } });
  await rejectsCode(mockClient({ quote: past }).client.prepareOrder(fundingRequest(MOCK_EXEC)), ERROR_CODES.QUOTE_EXPIRED);
  const earlier = signWith({ ...MOCK_EXEC, quote: { ...MOCK_EXEC.quote, deadline: '2026-11-11T12:10:00.000Z' } });
  assert.equal((await mockClient({ quote: earlier }).client.prepareOrder(fundingRequest(MOCK_EXEC))).expiry.effectiveExpiresAt, '2026-11-11T12:10:00.000Z');
});

// ------------------------------------------------------------------ request validation, tokens, networks, decimals

test('wrong token, wrong network, tickers and unverified routes are rejected before any HTTP', async () => {
  const now = { now: Date.parse(LIVE_CLOCK) };
  const base = fundingRequest(LIVE_FUNDING_DRY);
  const cases = [
    [{ source: { ...base.source, assetId: 'USDC' } }, ERROR_CODES.INVALID_ORDER],
    [{ source: { ...base.source, tokenAddress: '0xdac17f958d2ee523a2206206994597c13d831ec7' } }, ERROR_CODES.UNSUPPORTED_ROUTE], // USDT contract
    [{ source: { ...base.source, chain: 'eth', chainId: 1 } }, ERROR_CODES.UNSUPPORTED_ROUTE], // Ethereum is no longer approved
    [{ source: { ...base.source, assetId: 'nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near', tokenAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' } }, ERROR_CODES.UNSUPPORTED_ROUTE],
    [{ destination: { ...base.destination, chainId: 1313161555 } }, ERROR_CODES.UNSUPPORTED_ROUTE], // Aurora TESTNET
    [{ destination: { ...base.destination, virtualChainAccount: 'aurora.testnet' } }, ERROR_CODES.UNSUPPORTED_ROUTE],
    [{ destination: { ...base.destination, tokenAddress: '0xb12bfca5a55806aaf64e99521918a4bf0fc40802' } }, ERROR_CODES.UNSUPPORTED_ROUTE],
    [{ destination: { ...base.destination, assetId: 'nep141:aaaaaa20d9e0e2461697782ef11675f668207961.factory.bridge.near' } }, ERROR_CODES.UNSUPPORTED_ROUTE], // "AURORA" symbol token
    [{ destination: { ...base.destination, safeAddress: '0xB4c2fbec9d610F9A3a9b843c47b1A8095ceC887C' } }, ERROR_CODES.INVALID_ORDER], // bad EIP-55
    [{ destination: { ...base.destination, safeAddress: '0x0000000000000000000000000000000000000000' } }, ERROR_CODES.INVALID_ORDER],
    [{ refundAddress: base.destination.safeAddress }, ERROR_CODES.INVALID_ORDER],
    [{ amountIn: '5300' }, ERROR_CODES.AMOUNT_TOO_LOW], // observed Arbitrum bridge minimum 5301
    [{ slippageBps: 1001 }, ERROR_CODES.INVALID_ORDER],
    [{ winningProposalId: 1 }, ERROR_CODES.INVALID_ORDER], // strategy fields are not part of funding
  ];
  for (const [overrides, code] of cases) assert.throws(() => validateFundingRequest({ ...base, ...overrides }, now), (e) => e.code === code, JSON.stringify(overrides));
  assert.equal(validateFundingRequest(base, now).route.id, 'arb-usdc-to-aurora-usdc');
  const { client, transport } = liveClient();
  await rejectsCode(client.previewOrder({ ...base, destination: { ...base.destination, chainId: 1313161555 } }), ERROR_CODES.UNSUPPORTED_ROUTE);
  assert.equal(transport.calls.length, 0);
});

test('provider token list must still match the verified route identity and decimals', async () => {
  const drift = (mutate) => { const entries = structuredClone(LIVE_TOKEN_ENTRIES); mutate(entries); return json(200, entries); };
  const usdcEth = (e) => e.find((x) => x.assetId === ROUTE.source.assetId);
  for (const [response, code] of [
    [drift((e) => { usdcEth(e).contractAddress = '0x0000000000000000000000000000000000000001'; }), ERROR_CODES.ASSET_CHAIN_MISMATCH],
    [drift((e) => { usdcEth(e).decimals = 18; }), ERROR_CODES.ASSET_CHAIN_MISMATCH],
    [drift((e) => { usdcEth(e).blockchain = 'base'; }), ERROR_CODES.ASSET_CHAIN_MISMATCH],
    [drift((e) => { e.splice(e.findIndex((x) => x.assetId === ROUTE.destination.assetId), 1); }), ERROR_CODES.UNSUPPORTED_ASSET],
  ]) {
    const transport = fakeTransport({ 'GET /v0/tokens': response, 'POST /v0/quote': json(201, LIVE_FUNDING_DRY) });
    await rejectsCode(createIntentsClient({ transport, clock: clockAt(LIVE_CLOCK) }).previewOrder(fundingRequest(LIVE_FUNDING_DRY)), code);
    assert.equal(transport.calls.filter((c) => c.url.endsWith('/v0/quote')).length, 0);
  }
  const assets = await liveClient().client.getSupportedAssets();
  assert.equal(assets.assets.filter((a) => a.symbol === 'AURORA').length, 3, 'symbol "AURORA" names a token, not the Aurora chain');
  assert.equal(assets.assets.some((a) => a.blockchain === 'aurora'), false, 'live list has no aurora blockchain');
  assert.ok(assets.assets.some((a) => a.assetId.startsWith('1cs_v1:')), '1cs_v1 asset ids are accepted');
});

test('decimal handling is exact base-unit strings', () => {
  const now = { now: Date.parse(LIVE_CLOCK) };
  for (const amountIn of [250000000, '250.0', '0250000000', '-1', '', '2.5e8', ' 1']) {
    assert.throws(() => validateFundingRequest(fundingRequest(LIVE_FUNDING_DRY, { amountIn }), now), (e) => e.code === ERROR_CODES.INVALID_ORDER);
  }
  assert.equal(formatUnits('250000000', 6), '250'); assert.equal(formatUnits('300001', 6), '0.300001'); assert.equal(formatUnits('1', 24), '0.000000000000000000000001');
});

// ------------------------------------------------------------------ provider errors and transport

test('no liquidity, minimums, unsupported routes and rate limits map to stable codes, one attempt each', async () => {
  for (const [message, code] of [
    ['No liquidity available', ERROR_CODES.NO_LIQUIDITY], ['Amount is too low for bridge, try at least 300001', ERROR_CODES.AMOUNT_TOO_LOW],
    ['tokenOut is not valid', ERROR_CODES.UNSUPPORTED_ROUTE], ['Target virtual chain does not have an eth connector set or recipient account is not a virtual chain account', ERROR_CODES.UNSUPPORTED_ROUTE],
    ['Temporary swap limits: minimum swap amount is $1,000', ERROR_CODES.AMOUNT_TOO_LOW], ['recipient is not valid', ERROR_CODES.PROVIDER_REJECTED],
  ]) {
    await assert.rejects(liveClient(json(400, { message, correlationId: 'c' })).client.previewOrder(fundingRequest(LIVE_FUNDING_DRY)), (e) => e.code === code && e.details.providerMessage === message);
  }
  const limited = fakeTransport({ 'GET /v0/tokens': json(429, { message: 'Too Many Requests' }, { 'Retry-After': '7' }) });
  await assert.rejects(createIntentsClient({ transport: limited }).getSupportedAssets(), (e) => e.code === ERROR_CODES.RATE_LIMITED && e.details.retryAfterSeconds === 7);
  assert.equal(limited.calls.length, 1, 'no automatic retry');
  await rejectsCode(createIntentsClient({ transport: async () => json(401, '') }).getSupportedAssets(), ERROR_CODES.UNAUTHORIZED);
  await rejectsCode(createIntentsClient({ transport: async () => json(503, '<html>') }).getSupportedAssets(), ERROR_CODES.PROVIDER_UNAVAILABLE);
});

test('timeouts and transport failures are reported without leaking credentials or retrying', async () => {
  let signal; let attempts = 0;
  await rejectsCode(createIntentsClient({ timeoutMs: 20, transport: (req) => { attempts++; signal = req.signal; return new Promise(() => {}); } }).getSupportedAssets(), ERROR_CODES.TIMEOUT);
  assert.equal(signal.aborted, true); assert.equal(attempts, 1);
  await rejectsCode(createIntentsClient({ transport: async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); } }).getSupportedAssets(), ERROR_CODES.TIMEOUT);
  await assert.rejects(createIntentsClient({ apiKey: 'jwt-secret', transport: async () => { throw new Error('ECONNRESET jwt-secret'); } }).getSupportedAssets(), (e) => e.code === ERROR_CODES.TRANSPORT_FAILED && !e.message.includes('jwt-secret'));
});

test('malformed responses fail closed', async () => {
  for (const response of [json(201, 'not json'), json(201, ''), json(201, []), json(201, { ...LIVE_FUNDING_DRY, signature: undefined }),
    json(201, { ...LIVE_FUNDING_DRY, quote: { ...LIVE_FUNDING_DRY.quote, minAmountOut: 247473624 } }), json(201, { ...LIVE_FUNDING_DRY, timestamp: 'now' }),
    json(201, { ...LIVE_FUNDING_DRY, quote: { ...LIVE_FUNDING_DRY.quote, refundFee: '0.3' } })]) {
    await rejectsCode(liveClient(response).client.previewOrder(fundingRequest(LIVE_FUNDING_DRY)), ERROR_CODES.MALFORMED_RESPONSE);
  }
  await rejectsCode(createIntentsClient({ transport: async () => json(200, { tokens: [] }) }).getSupportedAssets(), ERROR_CODES.MALFORMED_RESPONSE);
  await rejectsCode(createIntentsClient({ transport: async () => json(200, [LIVE_TOKENS.entries[0], LIVE_TOKENS.entries[0]]) }).getSupportedAssets(), ERROR_CODES.MALFORMED_RESPONSE);
  for (const quote of [{ depositAddress: 'not-evm.near' }, { depositAddress: undefined }, { depositMemo: '123' }]) {
    const bad = signWith({ ...MOCK_EXEC, quote: { ...MOCK_EXEC.quote, ...quote } });
    await rejectsCode(mockClient({ quote: bad }).client.prepareOrder(fundingRequest(MOCK_EXEC)), ERROR_CODES.MALFORMED_RESPONSE);
  }
});

// ------------------------------------------------------------------ execution quotes and status (MOCKED)

test('prepareOrder is gated off by default and sends nothing', async () => {
  const transport = fakeTransport({});
  await rejectsCode(createIntentsClient({ transport, clock: clockAt(MOCK_CLOCK) }).prepareOrder(fundingRequest(MOCK_EXEC)), ERROR_CODES.EXECUTION_QUOTES_DISABLED);
  assert.equal(transport.calls.length, 0);
});

test('MOCKED execution quote carries the source-chain deposit reference and is still not funded', async () => {
  const { client, transport } = mockClient();
  const quote = await client.prepareOrder(fundingRequest(MOCK_EXEC));
  assert.equal(quote.kind, 'EXECUTION_QUOTE'); assert.equal(quote.funded, false); assert.equal(quote.mocked, true); assert.equal(quote.fees.feesSigned, true);
  const feeTampered = signWith(MOCK_EXEC); feeTampered.quote.refundFee = '0';
  await rejectsCode(mockClient({ quote: feeTampered }).client.prepareOrder(fundingRequest(MOCK_EXEC)), ERROR_CODES.SIGNATURE_INVALID);
  assert.deepEqual(quote.deposit, { type: 'ORIGIN_CHAIN', chain: 'arb', chainId: 42161, tokenAddress: ROUTE.source.tokenAddress, address: '0xde90000000000000000000000000000000000001', memo: null, exactAmount: '250000000' });
  assert.equal(transport.calls.find((c) => c.url.endsWith('/v0/quote')).parsedBody.dry, false);
});

const statusBody = (status, quoteResponse, swapDetails = MOCK_STATUS.swapDetails) => json(200, { ...MOCK_STATUS, status, quoteResponse, swapDetails });

test('MOCKED: every documented status normalizes; only SUCCESS is provider-reported success', async () => {
  const signed = signWith(MOCK_EXEC);
  const terminal = { SUCCESS: true, REFUNDED: true, FAILED: true };
  for (const status of EXECUTION_STATUSES) {
    const { client, transport } = mockClient({ quote: signed, status: statusBody(status, signed) });
    const result = await client.getExecutionStatus(await client.prepareOrder(fundingRequest(MOCK_EXEC)));
    assert.equal(result.status, status); assert.equal(result.terminal, Boolean(terminal[status])); assert.equal(result.providerReportedSuccess, status === 'SUCCESS');
    assert.equal(result.funding.fundingId, 'manager-1:funding-1'); assert.equal(result.mocked, true);
    assert.equal(new URL(transport.calls.at(-1).url).searchParams.get('depositAddress'), '0xde90000000000000000000000000000000000001');
  }
});

test('MOCKED: status not bound to the prepared quote fails closed', async () => {
  const signed = signWith(MOCK_EXEC);
  for (const [status, code] of [
    [statusBody('COMPLETED', signed), ERROR_CODES.UNKNOWN_STATUS],
    [statusBody('SUCCESS', { ...signed, quote: { ...signed.quote, amountOut: '1' } }), ERROR_CODES.SIGNATURE_INVALID],
    [statusBody('SUCCESS', signWith({ ...MOCK_EXEC, quote: { ...MOCK_EXEC.quote, depositAddress: '0xde90000000000000000000000000000000000002' } })), ERROR_CODES.ORDER_MISMATCH],
    [statusBody('SUCCESS', signWith({ ...MOCK_EXEC, quoteRequest: { ...MOCK_EXEC.quoteRequest, virtualChainRecipient: '0x000000000000000000000000000000000000dead' } })), ERROR_CODES.ORDER_MISMATCH],
    [json(200, { status: 'SUCCESS' }), ERROR_CODES.MALFORMED_RESPONSE],
    [json(404, { message: 'Deposit address not found' }), ERROR_CODES.NOT_FOUND],
  ]) {
    const { client } = mockClient({ quote: signed, status });
    await rejectsCode(client.getExecutionStatus(await client.prepareOrder(fundingRequest(MOCK_EXEC))), code);
  }
});

test('only the allowlisted endpoint is used and the surface stays quote/read only', async () => {
  assert.throws(() => createIntentsClient({ baseUrl: 'https://1click.example.com' }), /allowlisted/);
  const { client, transport } = liveClient(json(201, LIVE_FUNDING_DRY), { apiKey: 'jwt-test-only' });
  const quote = await client.previewOrder(fundingRequest(LIVE_FUNDING_DRY));
  for (const call of transport.calls) { assert.ok(call.url.startsWith(`${ONE_CLICK_BASE_URL}/v0/`)); assert.equal(call.headers['X-API-Key'], 'jwt-test-only'); }
  assert.equal(JSON.stringify(quote).includes('jwt-test-only'), false);
  assert.deepEqual(Object.keys(client).sort(), ['getExecutionStatus', 'getSupportedAssets', 'prepareOrder', 'previewOrder']);
});

// ------------------------------------------------------------------ shared funding interface: verifyQuote (MOCKED)


const MANAGER = MOCK_EXEC.quoteRequest.refundTo; // the shared schema requires refund recipient === manager
const sharedRequest = (overrides = {}) => ({
  fundingId: 'fund-1', routeId: 'eth-usdc-to-aurora-usdc', configurationHash: `0x${'c'.repeat(64)}`,
  manager: MANAGER, safe: MOCK_EXEC.quoteRequest.virtualChainRecipient,
  source: { chainId: ROUTE.source.chainId, assetId: ROUTE.source.assetId, token: ROUTE.source.tokenAddress, decimals: 6 },
  destination: { chainId: AURORA_MAINNET_CHAIN_ID, assetId: ROUTE.destination.assetId, token: ROUTE.destination.tokenAddress, decimals: 6 },
  amountIn: '250000000', minAmountOut: '247000000', refundRecipient: MANAGER, expiresAt: Date.parse('2026-11-11T12:30:00.000Z') / 1000, ...overrides,
});
function adapterSetup(t, { quote = signWith(MOCK_EXEC), verifierOptions = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'wavefund-intents-evidence-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const archive = createFundingEvidenceArchive(join(dir, 'evidence'));
  const { client } = mockClient({ quote });
  const verifiers = createFundingVerifiers({ client, archive, chainReaders: {}, verifySignature: testVerifier, clock: () => Date.parse(MOCK_CLOCK) / 1000, ...verifierOptions });
  return { client, archive, verifiers, dir };
}

test('shared request maps exactly to the provider request (Unix seconds -> canonical ISO, no strategy fields)', () => {
  const mapped = toProviderFundingRequest(sharedRequest());
  assert.equal(mapped.expiresAt, '2026-11-11T12:30:00.000Z'); assert.equal(mapped.destination.virtualChainAccount, 'aurora');
  assert.equal(mapped.destination.safeAddress, sharedRequest().safe); assert.equal(mapped.refundAddress, MANAGER); assert.equal(mapped.slippageBps, 100);
  assert.throws(() => toProviderFundingRequest(sharedRequest({ expiresAt: '2026-11-11T12:30:00.000Z' })), (e) => e.code === ERROR_CODES.INVALID_ORDER);
  assert.throws(() => toProviderFundingRequest(sharedRequest({ destination: { ...sharedRequest().destination, decimals: 18 } })), (e) => e.code === ERROR_CODES.UNSUPPORTED_ROUTE);
  assert.throws(() => toProviderFundingRequest(sharedRequest({ source: { ...sharedRequest().source, token: '0xdac17f958d2ee523a2206206994597c13d831ec7' } })), (e) => e.code === ERROR_CODES.UNSUPPORTED_ROUTE);
});

test('verifyQuote returns exactly the shared shape, archives the signed quote first, and stays fixture-quality when mocked', async (t) => {
  const { client, verifiers, dir } = adapterSetup(t);
  const providerQuote = await client.prepareOrder(toProviderFundingRequest(sharedRequest()));
  const result = await verifiers.verifyQuote(providerQuote, sharedRequest());
  assert.deepEqual(Object.keys(result).sort(), ['amountIn', 'depositAddress', 'evidenceQuality', 'expiresAt', 'minAmountOut', 'reference', 'requestHash']);
  assert.equal(result.requestHash, fundingHash(sharedRequest())); assert.equal(result.reference, `1click:${MOCK_EXEC.correlationId}`);
  assert.equal(result.depositAddress, MOCK_EXEC.quote.depositAddress); assert.equal(result.minAmountOut, '247473624');
  assert.equal(result.expiresAt, Date.parse('2026-11-11T12:30:00.000Z') / 1000); assert.equal(result.evidenceQuality, 'fixture');
  assert.equal(readdirSync(join(dir, 'evidence')).length, 1, 'signed quote retained before returning');
  assert.deepEqual(await verifiers.verifyQuote(providerQuote, sharedRequest()), result, 'identical retry is idempotent');
});

test('verifyQuote rejects dry, tampered, mismatched, expired and over-slippage quotes', async (t) => {
  const { client, verifiers } = adapterSetup(t);
  const good = await client.prepareOrder(toProviderFundingRequest(sharedRequest()));
  const dry = await adapterSetup(t, { quote: signWith(asDry(MOCK_EXEC)) }).client.previewOrder(toProviderFundingRequest(sharedRequest()));
  await rejectsCode(verifiers.verifyQuote(dry, sharedRequest()), ERROR_CODES.INVALID_ORDER);
  const tampered = structuredClone(good); tampered.providerPayload.quote.minAmountOut = '247473625';
  await rejectsCode(verifiers.verifyQuote(tampered, sharedRequest()), ERROR_CODES.SIGNATURE_INVALID);
  for (const [overrides, code] of [
    [{ safe: '0x000000000000000000000000000000000000dead' }, ERROR_CODES.ORDER_MISMATCH],
    [{ refundRecipient: '0x000000000000000000000000000000000000dead', manager: '0x000000000000000000000000000000000000dead' }, ERROR_CODES.ORDER_MISMATCH],
    [{ amountIn: '250000001' }, ERROR_CODES.ORDER_MISMATCH],
    [{ minAmountOut: '247473625' }, ERROR_CODES.QUOTE_BELOW_MINIMUM],
    [{ expiresAt: Date.parse('2026-11-11T12:29:59.000Z') / 1000 }, ERROR_CODES.ORDER_MISMATCH],
    [{ destination: { ...sharedRequest().destination, chainId: 1313161555 } }, ERROR_CODES.UNSUPPORTED_ROUTE],
  ]) await rejectsCode(verifiers.verifyQuote(good, sharedRequest(overrides)), code);
  const wideSlippage = await adapterSetup(t, { quote: signWith({ ...MOCK_EXEC, quoteRequest: { ...MOCK_EXEC.quoteRequest, slippageTolerance: 300 } }) });
  const wide = await wideSlippage.client.prepareOrder(toProviderFundingRequest(sharedRequest(), { slippageBps: 300 }));
  await rejectsCode(wideSlippage.verifiers.verifyQuote(wide, sharedRequest()), ERROR_CODES.ORDER_MISMATCH);
  const late = adapterSetup(t, { verifierOptions: { clock: () => Date.parse('2026-11-11T12:03:00.000Z') / 1000 } });
  await rejectsCode(late.verifiers.verifyQuote(await late.client.prepareOrder(toProviderFundingRequest(sharedRequest())), sharedRequest()), ERROR_CODES.QUOTE_EXPIRED);
});

test('evidence archive is private and write-once', async (t) => {
  const { client, verifiers, archive } = adapterSetup(t);
  const providerQuote = await client.prepareOrder(toProviderFundingRequest(sharedRequest()));
  await verifiers.verifyQuote(providerQuote, sharedRequest());
  const reference = `1click:${MOCK_EXEC.correlationId}`;
  assert.equal(archive.read(reference).requestHash, fundingHash(sharedRequest()));
  assert.throws(() => archive.retain({ reference, requestHash: `0x${'0'.repeat(64)}`, quote: providerQuote, retainedAt: 1 }), (e) => e.code === ERROR_CODES.EVIDENCE_UNAVAILABLE);
  assert.throws(() => archive.read('1click:unknown'), (e) => e.code === ERROR_CODES.EVIDENCE_UNAVAILABLE);
  assert.throws(() => archive.read('../escape'), (e) => e.code === ERROR_CODES.EVIDENCE_UNAVAILABLE);
});

test('QUOTING_UNAVAILABLE (observed live for EVM origins) maps to a retryable code, never a quote', async () => {
  await assert.rejects(liveClient(json(400, { message: 'Quoting for this pair is not available' })).client.previewOrder(fundingRequest(LIVE_FUNDING_DRY)),
    (e) => e.code === ERROR_CODES.QUOTING_UNAVAILABLE && e.retryable === true);
});

test('LIVE evidence index: every Aurora-bound signed quote re-verifies, with exact signed virtualChainRecipient; delivery unproven', () => {
  const index = fixture('live/signed-aurora-quotes.json');
  assert.equal(index.deliveryProven, false); assert.equal(index.executableQuotesRequested, false); assert.equal(index.fundsMoved, false);
  assert.equal(ROUTE.deliveryProven, false, 'route must stay labelled delivery-unproven');
  const verify = createQuoteSignatureVerifier();
  const funding = index.quotes.filter((q) => q.fundingRouteShape);
  assert.ok(funding.length >= 3);
  for (const q of index.quotes) {
    const payload = { quoteRequest: q.signedRequestFields, quote: q.signedAmounts, timestamp: q.timestamp, signature: q.signature };
    assert.equal(verify(payload).valid, true, q.source); // the index alone is sufficient to re-verify
    assert.equal(quoteMessage(payload), q.signedMessage, q.source);
  }
  for (const q of funding) {
    assert.equal(q.signedRequestFields.originAsset, 'nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near');
    assert.equal(q.signedRequestFields.destinationAsset, 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1');
    assert.equal(q.signedRequestFields.recipient, 'aurora');
    assert.equal(q.signedRequestFields.virtualChainRecipient, '0xb4c2fbec9d610F9A3a9b843c47b1A8095ceC887C');
    const changed = { quoteRequest: { ...q.signedRequestFields, virtualChainRecipient: '0xb4c2fbec9d610f9a3a9b843c47b1a8095cec887c' }, quote: q.signedAmounts, timestamp: q.timestamp, signature: q.signature };
    assert.equal(verify(changed).valid, false, 'the signature binds the exact virtualChainRecipient string, including case');
  }
});

test('executable quotes stay disabled unless explicitly enabled per client', async () => {
  const transport = fakeTransport({});
  const client = createIntentsClient({ transport });
  await rejectsCode(client.prepareOrder(fundingRequest(LIVE_FUNDING_DRY)), ERROR_CODES.EXECUTION_QUOTES_DISABLED);
  assert.equal(transport.calls.length, 0);
});

test('LIVE happy path (13:59 UTC): shared request -> live client dry quote verifies; Safe signed lowercase; executable stays disabled', async () => {
  const { summary, providerPayload } = fixture('live/happy-path-dry-quote.json');
  assert.equal(summary.source, 'live-provider'); assert.equal(summary.mocked, false); assert.equal(summary.funded, false); assert.equal(summary.prepareOrder, 'EXECUTION_QUOTES_DISABLED');
  assert.equal(createQuoteSignatureVerifier()(providerPayload).valid, true, 'real 1Click signature');
  assert.equal(providerPayload.quoteRequest.dry, true); assert.equal(providerPayload.quoteRequest.recipient, 'aurora');
  assert.equal(providerPayload.quoteRequest.virtualChainRecipient, '0xb4c2fbec9d610f9a3a9b843c47b1a8095cec887c');
  assert.equal(providerPayload.quoteRequest.originAsset, 'nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near'); // historical Ethereum origin assert.equal(providerPayload.quoteRequest.destinationAsset, ROUTE.destination.assetId);
  // Historical: the Ethereum route is no longer approved, so this evidence cannot produce a quote any more.
  const ethRequest = { ...fundingRequest(providerPayload, { minAmountOut: summary.amounts.requestMinAmountOut }), source: { chain: 'eth', chainId: 1, assetId: providerPayload.quoteRequest.originAsset, tokenAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' } };
  assert.throws(() => validateFundingRequest(ethRequest, { now: Date.parse(summary.expiry.quotedAt) }), (e) => e.code === ERROR_CODES.UNSUPPORTED_ROUTE);
});

test('LIVE Arbitrum happy path (15:19 UTC): shared request -> live client dry quote verifies; EXAMPLE Safe; executable disabled', async () => {
  const { summary, providerPayload } = LIVE_ARB;
  assert.match(summary.destinationLabel, /EXAMPLE destination/);
  assert.equal(summary.source, 'live-provider'); assert.equal(summary.mocked, false); assert.equal(summary.funded, false); assert.equal(summary.prepareOrder, 'EXECUTION_QUOTES_DISABLED');
  assert.equal(summary.managerChecksumValid, true);
  assert.equal(createQuoteSignatureVerifier()(providerPayload).valid, true, 'real 1Click signature');
  const q = providerPayload.quoteRequest;
  assert.equal(q.dry, true); assert.equal(q.originAsset, 'nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near');
  assert.equal(q.destinationAsset, 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1');
  assert.equal(q.recipient, 'aurora'); assert.equal(q.virtualChainRecipient, '0xb4c2fbec9d610f9a3a9b843c47b1a8095cec887c');
  assert.equal(q.refundTo, '0x37f91aa1e24aafc7b3843e281650aa884a6651e2', 'refund goes to the supplied manager wallet');
  // The shared request recorded with the capture maps to exactly the signed provider request.
  const mapped = toProviderFundingRequest(summary.sharedRequest);
  assert.equal(mapped.source.chain, 'arb'); assert.equal(mapped.source.chainId, 42161);
  const transport = fakeTransport({ 'GET /v0/tokens': tokens(), 'POST /v0/quote': json(201, providerPayload) });
  const replay = await createIntentsClient({ transport, clock: clockAt(summary.expiry.quotedAt) }).previewOrder(mapped);
  assert.equal(replay.mocked, true); assert.deepEqual(replay.amounts, summary.amounts);
});

test('LIVE actual Safe (16:18 UTC): 1 USDC Arbitrum dry quote to 0xe788...5d06 verifies; Safe is Safe 1.4.1 on Aurora; executable disabled', async () => {
  const { summary, providerPayload } = fixture('live/quote-dry-arb-usdc-to-real-safe.json');
  assert.match(summary.destinationLabel, /ACTUAL Wavefund Aurora-mainnet Safe/);
  assert.equal(summary.auroraRpc.chainId, '0x4e454152'); assert.equal(summary.auroraRpc.safeVersion, '1.4.1'); assert.ok(summary.auroraRpc.safeCodeBytes > 0);
  assert.equal(summary.safeChecksumValid, true); assert.equal(summary.managerChecksumValid, true);
  assert.equal(summary.source, 'live-provider'); assert.equal(summary.funded, false); assert.equal(summary.prepareOrder, 'EXECUTION_QUOTES_DISABLED');
  assert.equal(createQuoteSignatureVerifier()(providerPayload).valid, true, 'real 1Click signature');
  const q = providerPayload.quoteRequest;
  assert.equal(q.dry, true); assert.equal(q.amount, '1000000'); assert.equal(q.recipient, 'aurora');
  assert.equal(q.virtualChainRecipient, '0xe7889338fdc4962f5d1280e0e4267a0566e05d06');
  assert.equal(q.refundTo, '0x37f91aa1e24aafc7b3843e281650aa884a6651e2');
  assert.equal(q.originAsset, ROUTE.source.assetId); assert.equal(q.destinationAsset, ROUTE.destination.assetId);
  const transport = fakeTransport({ 'GET /v0/tokens': tokens(), 'POST /v0/quote': json(201, providerPayload) });
  const replay = await createIntentsClient({ transport, clock: clockAt(providerPayload.timestamp) }).previewOrder(toProviderFundingRequest(summary.sharedRequest));
  assert.deepEqual(replay.amounts, summary.amounts); assert.equal(replay.amounts.minAmountOut, '989800');
});
