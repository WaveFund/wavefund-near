// Developer C: funding API / read-model tests. Provider responses are injected fixtures; no network is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../server.mjs';
import { createFundingReadModel, fundingReadModelFromEnvironment, projectFundingRecord, validateFundingSafe, validateStrategyDeployment } from '../operator/funding-readonly.mjs';
import { configuration, createFundingService, createFundingStore, fundingHash } from '../funding/index.mjs';
import { IntentsError, VERIFIED_FUNDING_ROUTES, toProviderFundingRequest, validateFundingRequest } from '../intents/index.mjs';

const MANIFEST = JSON.parse(readFileSync(new URL('../../deployments/aurora-mainnet-funding-safe.json', import.meta.url), 'utf8'));
const TESTNET = JSON.parse(readFileSync(new URL('../../deployments/aurora-testnet.json', import.meta.url), 'utf8'));
const APPROVED = configuration(JSON.parse(readFileSync(new URL('../funding/approved-routes.json', import.meta.url), 'utf8')));
const ROUTE = VERIFIED_FUNDING_ROUTES[0];
const hash = (n) => `0x${String(n).padStart(64, '0')}`;
const runtime = () => ({ state: async () => ({ stage: 'idle' }), start: () => {}, close: async () => {} });

function dryQuote(request, overrides = {}) {
  return {
    kind: 'DRY_QUOTE', purpose: 'funding', dry: true, funded: false, provider: 'near-intents-1click', source: 'injected-transport', mocked: true,
    funding: { fundingId: request.fundingId, routeId: request.routeId, safeAddress: request.safe, refundAddress: request.refundRecipient },
    amounts: { amountIn: request.amountIn, minAmountIn: request.amountIn, amountOut: (BigInt(request.amountIn) - 202n).toString(), minAmountOut: (BigInt(request.amountIn) * 99n / 100n).toString(), requestMinAmountOut: request.minAmountOut },
    fees: { refundFee: '5300', withdrawFee: '0', feesSigned: false, appFees: [{ recipient: 'fixture', fee: 1 }], appFeesSigned: false },
    expiry: { requestExpiresAt: new Date(request.expiresAt * 1000).toISOString(), quoteDeadline: null, timeWhenInactive: null, effectiveExpiresAt: new Date(request.expiresAt * 1000).toISOString(), quotedAt: new Date().toISOString() },
    timeEstimateSeconds: 25, signature: { verified: true }, deposit: null, correlationId: '4fd9b16f-c6f0-44a9-ba3c-af5ce2978239', providerPayloadSha256: 'ab'.repeat(32),
    ...overrides,
  };
}
function model(overrides = {}) {
  let ms = 0;
  return createFundingReadModel({ mode: 'injected', approved: APPROVED, verifiedRoutes: VERIFIED_FUNDING_ROUTES, fundingSafe: MANIFEST,
    previewOrder: async (request) => dryQuote(request), nowMs: () => (ms += 10_000), ...overrides });
}
async function withServer(port, funding, run) {
  const app = await startServer({ port, runtime: runtime(), funding });
  try { await run((path, init = {}) => fetch(`http://127.0.0.1:${port}${path}`, init)); } finally { await app.close(); }
}
const post = (body, type = 'application/json') => ({ method: 'POST', headers: { 'Content-Type': type }, body: typeof body === 'string' ? body : JSON.stringify(body) });

test('funding endpoints are absent unless configured; existing endpoints are unchanged', async () => {
  assert.equal(await fundingReadModelFromEnvironment({}), null);
  assert.equal(await fundingReadModelFromEnvironment({ WAVEFUND_FUNDING: 'disabled' }), null);
  await assert.rejects(fundingReadModelFromEnvironment({ WAVEFUND_FUNDING: 'mainnet-send' }), /WAVEFUND_FUNDING/);
  await withServer(19241, null, async (call) => {
    assert.equal((await call('/api/funding/config')).status, 404);
    assert.equal((await call('/api/funding/preview', post({ routeId: ROUTE.id, amountIn: '1000000' }))).status, 404);
    assert.deepEqual(await (await call('/api/state')).json(), { stage: 'idle' });
    assert.equal((await call('/api/demo/start', post('{}'))).status, 202);
  });
});

test('config uses the trusted mainnet Safe, keeps testnet rounds separate and disables sending', () => {
  const config = model().config();
  assert.equal(config.destination.chainId, 1313161554);
  assert.equal(config.destination.safe, MANIFEST.safe.toLowerCase());
  assert.equal(config.refundRecipient, MANIFEST.manager.toLowerCase());
  assert.equal(config.destination.token, ROUTE.destination.tokenAddress);
  assert.equal(config.eligibility.roundChainId, 1313161555);
  assert.equal(config.eligibility.eligible, false);
  assert.equal(config.eligibility.checks.find((check) => check.id === 'same-network').ok, false);
  assert.deepEqual({ ...config.capabilities, preview: undefined }, { preview: undefined, executableQuote: false, submitted: false, records: false, signing: false, broadcast: false });
  assert.equal(config.routes[0].approvedForFunding, false);
  assert.ok(config.routes[0].notes.includes('DELIVERY_NOT_OBSERVED'));
  assert.ok(config.unsupported.every((route) => typeof route.reason === 'string' && route.reason.length > 0));
});

test('wrong Safe, manager, refund, network and route configuration fail closed', () => {
  assert.throws(() => validateFundingSafe({ ...MANIFEST, chainId: 1313161555 }), /Aurora mainnet/);
  assert.throws(() => validateFundingSafe({ ...MANIFEST, refundRecipient: MANIFEST.safe }), /refund recipient/);
  assert.throws(() => validateFundingSafe({ ...MANIFEST, manager: MANIFEST.safe, refundRecipient: MANIFEST.safe }), /must differ/);
  assert.throws(() => validateFundingSafe({ ...MANIFEST, safe: '0x0000000000000000000000000000000000000000' }), /invalid safe/);
  const testnetRoute = { ...ROUTE, destination: { ...ROUTE.destination, chainId: 1313161555 } };
  assert.throws(() => model({ verifiedRoutes: [testnetRoute] }), /Aurora mainnet/);
  const testnetSource = { ...ROUTE, source: { ...ROUTE.source, chainId: 1313161555 } };
  assert.throws(() => model({ verifiedRoutes: [testnetSource] }), /source network/);
  const foreign = configuration({ schemaVersion: 1, routes: [{ routeId: 'other-safe', enabled: false, liveVerified: false, manager: MANIFEST.manager, safe: `0x${'7'.repeat(40)}`,
    source: { chainId: 42161, assetId: ROUTE.source.assetId, token: ROUTE.source.tokenAddress, decimals: 6 },
    destination: { chainId: 1313161554, assetId: ROUTE.destination.assetId, token: ROUTE.destination.tokenAddress, decimals: 6 },
    refundRecipient: MANIFEST.manager, minAmountIn: '5301', maxAmountIn: '1000000', minAmountOut: '1', maxQuoteLifetimeSeconds: 300, maxObservationAgeSeconds: 60, minimumConfirmations: 64 }] });
  assert.throws(() => model({ approved: foreign }), /differs from the funding Safe/);
});

test('preview builds its request only from trusted configuration, and B accepts that request', async () => {
  const seen = [];
  await withServer(19242, model({ previewOrder: async (request) => { seen.push(request); return dryQuote(request); } }), async (call) => {
    const response = await call('/api/funding/preview', post({ routeId: ROUTE.id, amountIn: '1000000' }));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.kind, 'DRY_QUOTE'); assert.equal(body.executable, false); assert.equal(body.funded, false);
    assert.equal(body.evidence, 'mocked', 'injected provider responses are never labelled live');
    assert.equal(body.amounts.minAmountOut, '990000'); assert.equal(body.fees.appFeeBps, 1); assert.equal(body.fees.feesSigned, false);
  });
  assert.equal(seen.length, 1);
  const [request] = seen;
  assert.equal(request.safe, MANIFEST.safe.toLowerCase());
  assert.equal(request.refundRecipient, MANIFEST.manager.toLowerCase());
  assert.equal(request.minAmountOut, '980000');
  assert.equal(request.destination.chainId, 1313161554);
  assert.doesNotThrow(() => validateFundingRequest(toProviderFundingRequest(request, { slippageBps: 100 })));
});

test('preview rejects caller-supplied identities, malformed amounts and oversized bodies before quoting', async () => {
  let calls = 0;
  await withServer(19243, model({ previewOrder: async (request) => { calls++; return dryQuote(request); } }), async (call) => {
    const cases = [
      [{ routeId: ROUTE.id, amountIn: '1000000', safe: `0x${'1'.repeat(40)}` }, 400, 'INVALID_REQUEST'],
      [{ routeId: ROUTE.id, amountIn: '1000000', providerUrl: 'https://evil.example' }, 400, 'INVALID_REQUEST'],
      [{ routeId: ROUTE.id, amountIn: '1000000', destination: { chainId: 1313161555 } }, 400, 'INVALID_REQUEST'],
      [{ routeId: 'eth-usdc-to-aurora-usdc', amountIn: '1000000' }, 400, 'ROUTE_UNAVAILABLE'],
      [{ routeId: ROUTE.id, amountIn: '1.5' }, 400, 'INVALID_AMOUNT'],
      [{ routeId: ROUTE.id, amountIn: 1000000 }, 400, 'INVALID_AMOUNT'],
      [{ routeId: ROUTE.id, amountIn: '-1' }, 400, 'INVALID_AMOUNT'],
      [{ routeId: ROUTE.id, amountIn: '5300' }, 400, 'AMOUNT_TOO_LOW'],
      [{ routeId: ROUTE.id, amountIn: '1000000000001' }, 400, 'AMOUNT_TOO_HIGH'],
    ];
    for (const [body, status, code] of cases) {
      const response = await call('/api/funding/preview', post(body));
      assert.equal(response.status, status, JSON.stringify(body));
      assert.equal((await response.json()).code, code);
    }
    assert.equal((await call('/api/funding/preview', post('{"routeId":', 'application/json'))).status, 400);
    assert.equal((await call('/api/funding/preview', post({ routeId: ROUTE.id, amountIn: '1000000' }, 'text/plain'))).status, 415);
    assert.equal((await call('/api/funding/preview', post(JSON.stringify({ routeId: ROUTE.id, amountIn: '1000000', pad: 'x'.repeat(3000) })))).status, 413);
  });
  assert.equal(calls, 0);
});

test('executable, redirected or under-minimum quotes are discarded', async () => {
  const mutate = (change) => model({ previewOrder: async (request) => change(dryQuote(request), request) });
  for (const change of [
    (quote) => ({ ...quote, kind: 'EXECUTION_QUOTE', dry: false, deposit: { address: `0x${'d'.repeat(40)}` } }),
    (quote) => ({ ...quote, funding: { ...quote.funding, safeAddress: `0x${'9'.repeat(40)}` } }),
    (quote) => ({ ...quote, funding: { ...quote.funding, refundAddress: `0x${'9'.repeat(40)}` } }),
    (quote, request) => ({ ...quote, amounts: { ...quote.amounts, minAmountOut: (BigInt(request.minAmountOut) - 1n).toString() } }),
    (quote) => ({ ...quote, amounts: { ...quote.amounts, amountIn: '1' } }),
  ]) {
    await assert.rejects(mutate(change).preview({ routeId: ROUTE.id, amountIn: '1000000' }), { code: 'PREVIEW_MISMATCH', status: 502 });
  }
});

test('provider and service errors are sanitized and never reflected', async () => {
  const cases = [
    [new IntentsError('PROVIDER_REJECTED', '<script>alert(1)</script> token=secret-value'), 502, 'PROVIDER_ERROR'],
    [new IntentsError('QUOTING_UNAVAILABLE', 'Quoting for this pair is not available <img src=x>'), 503, 'QUOTING_UNAVAILABLE'],
    [new IntentsError('SIGNATURE_INVALID', 'bad signature'), 502, 'SIGNATURE_INVALID'],
    [new Error('ECONNRESET /Users/someone/.env.agents'), 503, 'FUNDING_SERVICE_ERROR'],
  ];
  let index = 0;
  await withServer(19244, model({ previewOrder: async () => { throw cases[index][0]; } }), async (call) => {
    for (; index < cases.length; index++) {
      const response = await call('/api/funding/preview', post({ routeId: ROUTE.id, amountIn: '1000000' }));
      const text = await response.text();
      assert.equal(response.status, cases[index][1]);
      assert.equal(JSON.parse(text).code, cases[index][2]);
      for (const leaked of ['<script>', 'secret-value', '<img', '.env', 'ECONNRESET', 'bad signature']) assert.equal(text.includes(leaked), false, leaked);
    }
  });
});

test('dry-quote previews are rate limited', async () => {
  let ms = 1_000_000;
  const funding = model({ nowMs: () => ms });
  await funding.preview({ routeId: ROUTE.id, amountIn: '1000000' });
  ms += 500;
  await assert.rejects(funding.preview({ routeId: ROUTE.id, amountIn: '1000000' }), { code: 'PREVIEW_RATE_LIMITED', status: 429 });
  ms += 5000;
  await funding.preview({ routeId: ROUTE.id, amountIn: '1000000' });
});

test('no executable-quote, signing, broadcast, retry, cancel or disabled submission route exists', async () => {
  let previews = 0;
  await withServer(19245, model({ previewOrder: async (request) => { previews++; return dryQuote(request); } }), async (call) => {
    for (const path of ['/api/funding/quote', '/api/funding/sign', '/api/funding/send', '/api/funding/broadcast', '/api/funding/execute', '/api/funding/retry', '/api/funding/cancel', '/api/funding/submitted', '/api/funding/refund']) {
      assert.equal((await call(path, post({ routeId: ROUTE.id, amountIn: '1000000' }))).status, 404, path);
    }
    assert.equal((await call('/api/funding/quote')).status, 404);
    assert.equal((await call('/api/funding/fund-1')).status, 404, 'records stay hidden without a funding service');
  });
  assert.equal(previews, 0);
});

test('funding endpoints keep the existing Origin protection', async () => {
  await withServer(19246, model(), async (call) => {
    assert.equal((await call('/api/funding/config', { headers: { Origin: 'https://evil.example' } })).status, 403);
    const allowed = await call('/api/funding/config', { headers: { Origin: 'http://127.0.0.1:3000' } });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://127.0.0.1:3000');
  });
});

function fundingService(t) {
  const dir = mkdtempSync(join(tmpdir(), 'wavefund-funding-api-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const time = 2_000_000_000;
  const route = { routeId: 'fixture-route-not-live', enabled: true, liveVerified: true, manager: MANIFEST.manager, safe: MANIFEST.safe,
    source: { chainId: 42161, assetId: ROUTE.source.assetId, token: ROUTE.source.tokenAddress, decimals: 6 },
    destination: { chainId: 1313161554, assetId: ROUTE.destination.assetId, token: ROUTE.destination.tokenAddress, decimals: 6 },
    refundRecipient: MANIFEST.manager, minAmountIn: '5301', maxAmountIn: '1000000000', minAmountOut: '1', maxQuoteLifetimeSeconds: 300, maxObservationAgeSeconds: 60, minimumConfirmations: 64 };
  const config = { schemaVersion: 1, routes: [route] }; const approved = configuration(config);
  const snapshot = { chainId: 1313161554, safe: MANIFEST.safe, stableToken: ROUTE.destination.tokenAddress, assetToken: `0x${'5'.repeat(40)}`, stableBalance: '0', assetBalance: '0',
    activeRound: false, pendingAuthorization: false, observedAt: time, blockNumber: '10', blockHash: hash(9), compatible: true };
  const service = createFundingService({ config, store: createFundingStore(dir), readSnapshot: async () => snapshot, verifyQuote: async (quote) => quote, clock: () => time });
  const request = { fundingId: 'fund-1', routeId: route.routeId, configurationHash: approved.configurationHash, manager: MANIFEST.manager.toLowerCase(), safe: MANIFEST.safe.toLowerCase(),
    source: approved.routes[0].source, destination: approved.routes[0].destination, amountIn: '1000000', minAmountOut: '980000', refundRecipient: MANIFEST.manager.toLowerCase(), expiresAt: time + 200 };
  const quote = { requestHash: fundingHash(request), reference: 'fixture-quote-1', depositAddress: `0x${'d'.repeat(40)}`, amountIn: '1000000', minAmountOut: '990000', expiresAt: time + 100, evidenceQuality: 'fixture' };
  return { service, approved, request, quote };
}

test('records come from the funding service; repeated submitted references are idempotent and conflicts need review', async (t) => {
  const f = fundingService(t);
  await f.service.createQuoted(f.request, f.quote);
  const { submission: { attemptId } } = await f.service.reserveSubmission('fund-1');
  const funding = model({ approved: f.approved, service: f.service, allowSubmitted: true });
  assert.equal(funding.config().capabilities.records, true);
  await withServer(19247, funding, async (call) => {
    const first = await (await call('/api/funding/submitted', post({ fundingId: 'fund-1', attemptId, transactionHash: hash(1) }))).json();
    assert.equal(first.state, 'pending'); assert.equal(first.submission.txHash, hash(1));
    const repeat = await (await call('/api/funding/submitted', post({ fundingId: 'fund-1', attemptId, transactionHash: hash(1) }))).json();
    assert.equal(repeat.revision, first.revision, 'identical reference is acknowledged, never re-sent');
    const conflict = await (await call('/api/funding/submitted', post({ fundingId: 'fund-1', attemptId, transactionHash: hash(2) }))).json();
    assert.equal(conflict.state, 'needs_review'); assert.equal(conflict.reviewReason, 'CONFLICTING_SUBMISSION');
    const wrongAttempt = await call('/api/funding/submitted', post({ fundingId: 'fund-1', attemptId: 'not-the-attempt', transactionHash: hash(1) }));
    assert.equal(wrongAttempt.status, 409);
    const record = await call('/api/funding/fund-1');
    const text = await record.text(); const body = JSON.parse(text);
    assert.equal(body.origin, 'funding-service'); assert.equal(body.integrity, 'ok'); assert.equal(body.submission.reserved, true);
    assert.equal(body.route.minimumConfirmations, 64); assert.equal(text.includes(attemptId), false, 'attempt capability is not projected');
    assert.equal((await call('/api/funding/unknown-funding')).status, 404);
    assert.equal((await call('/api/funding/%3Cscript%3E')).status, 404);
  });
});

test('malformed or hostile record values are nulled and flagged instead of displayed', () => {
  const projected = projectFundingRecord({
    schemaVersion: 1, fundingId: 'fund-x', state: 'delivered<script>', reviewReason: '<img src=x onerror=alert(1)>',
    request: { routeId: 'r', manager: 'javascript:alert(1)', safe: `0x${'2'.repeat(40)}`, source: {}, destination: { chainId: 1313161554 }, amountIn: '1e6', minAmountOut: '1', refundRecipient: `0x${'1'.repeat(40)}`, expiresAt: 5 },
    quote: { evidenceQuality: 'verified' },
    delivery: { recipient: '0xZZ', amount: '12.5', evidenceQuality: 'live-verified', confirmations: -1, transactionHash: 'not-a-hash' },
  }, { origin: 'funding-service', observedAt: 10 });
  assert.equal(projected.integrity, 'invalid');
  for (const value of [projected.state, projected.reviewReason, projected.request.manager, projected.request.amountIn, projected.quote.evidenceQuality,
    projected.delivery.recipient, projected.delivery.amount, projected.delivery.confirmations, projected.delivery.transactionHash]) assert.equal(value, null);
  const text = JSON.stringify(projected);
  for (const leaked of ['<script>', '<img', 'javascript:']) assert.equal(text.includes(leaked), false);
  assert.equal(projectFundingRecord('nope', { origin: 'fixture', observedAt: 1 }).integrity, 'invalid');
});

test('strategy identity comes from the testnet manifest, is validated, and never replaces the funding destination', async () => {
  const config = model({ strategyDeployment: TESTNET }).config();
  assert.deepEqual(config.strategy, { chainId: 1313161555, safe: TESTNET.contracts.safe.toLowerCase(), token: TESTNET.contracts.stable.toLowerCase(), decimals: 6, symbol: 'USDC', source: 'deployments/aurora-testnet.json' });
  assert.equal(config.destination.chainId, 1313161554);
  assert.equal(config.destination.safe, MANIFEST.safe.toLowerCase());
  assert.notEqual(config.destination.token, config.strategy.token, 'the mainnet accepted asset is not the testnet strategy token');
  assert.equal(model().config().strategy, null, 'no manifest, no strategy identity');
  assert.throws(() => validateStrategyDeployment({ ...TESTNET, chainId: 1313161554 }), /Aurora testnet/);
  assert.throws(() => validateStrategyDeployment({ ...TESTNET, contracts: { ...TESTNET.contracts, stable: 'javascript:alert(1)' } }), /invalid strategy stable/);
  assert.throws(() => validateStrategyDeployment({ ...TESTNET, contracts: { ...TESTNET.contracts, safe: undefined } }), /invalid strategy safe/);
  assert.throws(() => validateStrategyDeployment({ ...TESTNET, contracts: { ...TESTNET.contracts, stable: TESTNET.contracts.safe } }), /must differ/);
  assert.throws(() => model({ strategyDeployment: { ...TESTNET, schemaVersion: 2 } }), /strategy manifest/);
  const live = await fundingReadModelFromEnvironment({ WAVEFUND_FUNDING: 'live-preview' });
  assert.equal(live.config().strategy.safe, TESTNET.contracts.safe.toLowerCase());
  assert.equal(live.config().strategy.token, TESTNET.contracts.stable.toLowerCase());
});

test('readiness keeps the funding service snapshot it was checked against; malformed snapshots are flagged', () => {
  const snapshot = { chainId: 1313161555, safe: `0x${'7'.repeat(40)}`, stableToken: `0x${'8'.repeat(40)}`, assetToken: `0x${'9'.repeat(40)}`, stableBalance: '950', assetBalance: '0',
    activeRound: false, pendingAuthorization: false, observedAt: 9, blockNumber: '12', blockHash: hash(1), compatible: true };
  const readiness = { chainId: 1313161555, safe: snapshot.safe, snapshot, consumedAt: 10 };
  const projected = projectFundingRecord({ schemaVersion: 1, fundingId: 'fund-r', state: 'delivered', readiness }, { origin: 'funding-service', observedAt: 11 });
  assert.deepEqual(projected.readiness, { chainId: 1313161555, safe: snapshot.safe, consumedAt: 10,
    snapshot: { chainId: 1313161555, safe: snapshot.safe, stableToken: snapshot.stableToken, assetToken: snapshot.assetToken, stableBalance: '950', assetBalance: '0', compatible: true, activeRound: false, pendingAuthorization: false, observedAt: 9, blockNumber: '12' } });
  assert.equal(projected.integrityIssues.some((issue) => issue.startsWith('readiness')), false);
  const bad = projectFundingRecord({ schemaVersion: 1, fundingId: 'fund-r', state: 'delivered', readiness: { ...readiness, snapshot: { ...snapshot, stableToken: '0xnope', compatible: 'yes' } } }, { origin: 'funding-service', observedAt: 11 });
  assert.equal(bad.integrity, 'invalid');
  assert.equal(bad.readiness.snapshot.stableToken, null);
  assert.equal(bad.readiness.snapshot.compatible, null);
  assert.ok(bad.integrityIssues.includes('readiness.snapshot.stableToken') && bad.integrityIssues.includes('readiness.snapshot.compatible'));
  const missing = projectFundingRecord({ schemaVersion: 1, fundingId: 'fund-r', state: 'delivered', readiness: { chainId: 1313161555, safe: snapshot.safe, consumedAt: 10 } }, { origin: 'funding-service', observedAt: 11 });
  assert.ok(missing.integrityIssues.includes('readiness.snapshot'));
});
