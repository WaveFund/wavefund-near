import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFundingService, createFundingStore, configuration, fundingHash } from './index.mjs';
const addr = n => `0x${String(n).padStart(40, '0')}`;
const hash = n => `0x${String(n).padStart(64, '0')}`;
const route = () => ({ routeId: 'fixture-only-not-a-live-route', enabled: true, liveVerified: true,
  manager: addr(1), safe: addr(2), source: { chainId: 1, assetId: 'nep141:fixture-source.near', token: addr(3), decimals: 6 },
  destination: { chainId: 1313161554, assetId: 'nep141:fixture-destination.near', token: addr(4), decimals: 6 },
  refundRecipient: addr(1), minAmountIn: '100', maxAmountIn: '10000', minAmountOut: '90',
  maxQuoteLifetimeSeconds: 120, maxObservationAgeSeconds: 30, minimumConfirmations: 3 });
function setup(t, quality = 'live-verified') {
  const dir = mkdtempSync(join(tmpdir(), 'wavefund-funding-test-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  let time = 1000; const config = { schemaVersion: 1, routes: [route()] }; const store = createFundingStore(dir);
  const snapshot = { chainId: 1313161554, safe: addr(2), stableToken: addr(4), assetToken: addr(5), stableBalance: '2000', assetBalance: '50',
    activeRound: false, pendingAuthorization: false, observedAt: time, blockNumber: '10', blockHash: hash(9), compatible: true };
  const request = { fundingId: 'fund-1', routeId: config.routes[0].routeId, configurationHash: configuration(config).configurationHash,
    manager: addr(1), safe: addr(2), source: config.routes[0].source, destination: config.routes[0].destination,
    amountIn: '1000', minAmountOut: '900', refundRecipient: addr(1), expiresAt: 1100 };
  const quote = { requestHash: fundingHash(request), reference: 'quote-1', depositAddress: addr(6), amountIn: '1000', minAmountOut: '900', expiresAt: 1090, evidenceQuality: quality };
  const adapters = { readSnapshot: async () => snapshot, verifyQuote: async q => q, verifyDelivery: async evidence => evidence, verifyRefund: async evidence => evidence };
  const build = () => createFundingService({ config, store, ...adapters, clock: () => time });
  const service = build();
  const create = () => service.createQuoted(request, quote);
  const submit = async () => { await create(); const r = await service.reserveSubmission('fund-1'); return service.recordSubmitted('fund-1', { attemptId: r.submission.attemptId, transactionHash: hash(1) }); };
  const proof = () => ({ requestHash: fundingHash(request), quoteHash: fundingHash(quote), sourceTransactionHash: hash(1), transactionHash: hash(2),
    chainId: 1313161554, token: addr(4), recipient: addr(2), amount: '950', confirmations: 3, observedAt: time, evidenceQuality: quality });
  const deliver = async () => { await submit(); snapshot.stableBalance = '2950'; return service.confirmDelivery('fund-1', proof()); };
  return { dir, config, store, request, quote, snapshot, adapters, build, service, create, submit, proof, deliver,
    setTime: value => { time = value; }, prepare: () => service.prepareRound('fund-1', { chainId: 1313161554, safe: addr(2), expectedBalances: { stableBalance: '2950', assetBalance: '50' } }) };
}
const rejects = (operation, code) => assert.rejects(operation, { name: 'FundingError', code });

test('funding config is canonical, independent from historical agent hashes, and fails closed', () => {
  const a = { schemaVersion: 1, routes: [route()] }; const b = { routes: [route()], schemaVersion: 1 };
  assert.equal(configuration(a).configurationHash, configuration(b).configurationHash);
  assert.equal(configuration({ schemaVersion: 1, routes: [] }).routes.length, 0);
  for (const [field, value, code] of [['liveVerified', false, 'UNVERIFIED_ROUTE'], ['refundRecipient', addr(8), 'REFUND_NOT_MANAGER']]) {
    const r = route(); r[field] = value; assert.throws(() => configuration({ schemaVersion: 1, routes: [r] }), { code });
  }
});
test('wrong safe, manager, refund, network, asset, precision and expiry are rejected', async t => {
  const f = setup(t);
  for (const [key, value, code] of [['safe', addr(9), 'REQUEST_IDENTITY_MISMATCH'], ['manager', addr(9), 'REQUEST_IDENTITY_MISMATCH'],
    ['refundRecipient', addr(9), 'REQUEST_IDENTITY_MISMATCH'], ['expiresAt', 1000, 'QUOTE_EXPIRED'], ['amountIn', '10001', 'REQUEST_AMOUNT_LIMIT'], ['amountIn', 1000, 'INVALID_AMOUNT']]) {
    await rejects(() => f.service.createQuoted({ ...f.request, [key]: value }, f.quote), code);
  }
  await rejects(() => f.service.createQuoted({ ...f.request, destination: { ...f.request.destination, chainId: 1313161555 } }, f.quote), 'REQUEST_ASSET_MISMATCH');
  await rejects(() => f.service.createQuoted({ ...f.request, source: { ...f.request.source, token: addr(9) } }, f.quote), 'REQUEST_ASSET_MISMATCH');
  await rejects(() => f.service.createQuoted({ ...f.request, winningProposalId: 0 }, f.quote), 'INVALID_FIELDS');
});
test('quote binding/minimum and post-await expiration are enforced', async t => {
  const f = setup(t);
  await rejects(() => f.service.createQuoted(f.request, { ...f.quote, requestHash: hash(1) }), 'QUOTE_BINDING_MISMATCH');
  await rejects(() => f.service.createQuoted(f.request, { ...f.quote, minAmountOut: '899' }), 'QUOTE_AMOUNT_MISMATCH');
  f.adapters.readSnapshot = async () => { f.setTime(1091); return { ...f.snapshot, observedAt: 1091 }; };
  await rejects(() => f.build().createQuoted(f.request, f.quote), 'QUOTE_EXPIRED');
});
test('one unresolved attempt per safe survives a fresh process/store instance', async t => {
  const f = setup(t); await f.create();
  await rejects(() => f.create(), 'DUPLICATE_FUNDING_ID');
  const request = { ...f.request, fundingId: 'fund-2' }; const quote = { ...f.quote, requestHash: fundingHash(request) };
  await rejects(() => f.build().createQuoted(request, quote), 'SAFE_FUNDING_UNRESOLVED');
  assert.equal(createFundingStore(f.dir).read().records['fund-1'].state, 'quoted');
});
test('submission is durably reserved before wallet action and cannot be repeated', async t => {
  const f = setup(t); await f.create(); const r = await f.service.reserveSubmission('fund-1');
  assert.equal(createFundingStore(f.dir).read().records['fund-1'].state, 'dispatching');
  await rejects(() => f.service.reserveSubmission('fund-1'), 'SUBMISSION_NOT_ALLOWED');
  assert.throws(() => f.service.recordSubmitted('fund-1', { attemptId: 'wrong', transactionHash: hash(1) }), { code: 'ATTEMPT_MISMATCH' });
  const submitted = f.service.recordSubmitted('fund-1', { attemptId: r.submission.attemptId, transactionHash: hash(1) });
  assert.equal(f.service.recordSubmitted('fund-1', { attemptId: r.submission.attemptId, transactionHash: hash(1) }).revision, submitted.revision);
  assert.equal(f.service.recordSubmitted('fund-1', { attemptId: r.submission.attemptId, transactionHash: hash(3) }).state, 'needs_review');
});
test('unknown broadcast permanently blocks another send and round preparation', async t => {
  const f = setup(t); await f.create(); const r = await f.service.reserveSubmission('fund-1');
  assert.equal(f.service.markBroadcastUnknown('fund-1', r.submission.attemptId).reviewReason, 'BROADCAST_UNKNOWN');
  await rejects(() => f.service.reserveSubmission('fund-1'), 'SUBMISSION_NOT_ALLOWED');
  await rejects(f.prepare, 'FUNDING_NOT_READY');
});
test('provider SUCCESS does not prove arrival; failed does not mean refunded', async t => {
  const f = setup(t); await f.submit();
  assert.equal(f.service.observeProvider('fund-1', 'SUCCESS').state, 'pending');
  await rejects(f.prepare, 'FUNDING_NOT_READY');
  assert.equal(f.service.observeProvider('fund-1', 'FAILED').state, 'needs_review');
  assert.equal(f.service.get('fund-1').refund, null);
});
test('verified delivery checks balance delta, consumes same-network readiness once', async t => {
  const f = setup(t); await f.deliver(); const r = await f.prepare();
  assert.equal(r.readiness.chainId, 1313161554); assert.equal(r.delivery.amount, '950');
  await rejects(f.prepare, 'FUNDING_NOT_READY');
  const request = { ...f.request, fundingId: 'fund-2' };
  await rejects(() => f.service.createQuoted(request, { ...f.quote, requestHash: fundingHash(request) }), 'SAFE_FUNDING_UNRESOLVED');
});
test('mainnet funding never authorizes testnet or a different Safe', async t => {
  const f = setup(t); await f.deliver();
  for (const values of [{ chainId: 1313161555, safe: addr(2) }, { chainId: 1313161554, safe: addr(9) }])
    await rejects(() => f.service.prepareRound('fund-1', { ...values, expectedBalances: { stableBalance: '2950', assetBalance: '50' } }), 'ROUND_NETWORK_SAFE_MISMATCH');
});
test('fixture evidence can exercise delivery but cannot make a live round ready', async t => {
  const f = setup(t, 'fixture'); await f.deliver(); await rejects(f.prepare, 'FUNDING_NOT_READY');
});
test('invalid receipt identity, source linkage, amount or finality moves to review', async t => {
  for (const [key, value, code] of [['chainId', 1313161555, 'DELIVERY_IDENTITY_MISMATCH'], ['token', addr(9), 'DELIVERY_IDENTITY_MISMATCH'],
    ['recipient', addr(9), 'DELIVERY_IDENTITY_MISMATCH'], ['sourceTransactionHash', hash(8), 'DELIVERY_BINDING_MISMATCH'],
    ['amount', '899', 'DELIVERY_AMOUNT_TOO_LOW'], ['confirmations', 2, 'DELIVERY_NOT_FINAL'], ['observedAt', 900, 'STALE_DELIVERY']]) {
    const f = setup(t); await f.submit(); f.snapshot.stableBalance = '2950';
    await rejects(() => f.service.confirmDelivery('fund-1', { ...f.proof(), [key]: value }), code);
    assert.equal(f.service.get('fund-1').state, 'needs_review');
  }
});
test('unrelated transfers and custody changes are not accepted as clean delivery', async t => {
  const f = setup(t); await f.submit(); f.snapshot.stableBalance = '2951';
  await rejects(() => f.service.confirmDelivery('fund-1', f.proof()), 'DELIVERY_BALANCE_CONFLICT');
});
test('active round, pending authorization and changed balances block application funding', async t => {
  for (const key of ['activeRound', 'pendingAuthorization']) {
    const f = setup(t); f.snapshot[key] = true; await rejects(f.create, 'ROUND_ACTIVE');
  }
  const f = setup(t); await f.create(); f.snapshot.assetBalance = '51';
  await rejects(() => f.service.reserveSubmission('fund-1'), 'SAFE_BALANCES_CHANGED');
  const g = setup(t); await g.deliver(); g.snapshot.stableBalance = '2951'; await rejects(g.prepare, 'SAFE_BALANCES_CHANGED');
});
test('partial refund is recorded exactly and remains unresolved', async t => {
  const f = setup(t); await f.submit(); const refund = { ...f.proof(), chainId: 1, token: addr(3), recipient: addr(1), amount: '990' };
  const r = await f.service.confirmRefund('fund-1', refund);
  assert.equal(r.state, 'needs_review'); assert.equal(r.refund.amount, '990');
  const full = await f.service.confirmRefund('fund-1', { ...refund, amount: '1000' }); assert.equal(full.state, 'refunded');
});
test('a refund for one hash cannot clear conflicting submissions, even after provider failure', async t => {
  const f = setup(t); const record = await f.submit();
  f.service.recordSubmitted('fund-1', { attemptId: record.submission.attemptId, transactionHash: hash(3) });
  f.service.observeProvider('fund-1', 'FAILED');
  assert.equal(f.service.get('fund-1').reviewReason, 'CONFLICTING_SUBMISSION');
  await rejects(() => f.service.confirmRefund('fund-1', { ...f.proof(), chainId: 1, token: addr(3), recipient: addr(1), amount: '1000' }), 'MANUAL_RECONCILIATION_REQUIRED');
});
test('concurrent submission reservations have exactly one winner', async t => {
  const f = setup(t); await f.create();
  const result = await Promise.allSettled([f.service.reserveSubmission('fund-1'), f.service.reserveSubmission('fund-1')]);
  assert.equal(result.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(result.find(r => r.status === 'rejected').reason.code, 'CONCURRENT_UPDATE');
});
test('store refuses stale lock and changed request payload', async t => {
  const f = setup(t); await f.create(); writeFileSync(join(f.dir, 'funding.lock'), 'stale', { mode: 0o600 });
  assert.throws(() => f.store.transaction(() => null), { code: 'STORE_LOCKED' });
  rmSync(join(f.dir, 'funding.lock'));
  const path = join(f.dir, 'funding.json'); const data = JSON.parse(readFileSync(path, 'utf8'));
  data.records['fund-1'].request.amountIn = '1001'; writeFileSync(path, JSON.stringify(data));
  assert.throws(() => f.service.get('fund-1'), { code: 'RECORD_CHANGED' });
});
