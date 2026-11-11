// Developer C: funding display-logic tests. Exercises the exact modules the dashboard imports.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AURORA_MAINNET, AURORA_TESTNET, classifyFunding, explorerUrl, formatUnits, parseUnits, percentOf, roundEligibility,
  safeText, validateFundingConfig, validatePreview,
} from '../src/lib/funding/model.mjs';
import { fixtureConfig, fixturePreview, fixtureScenarios } from '../src/lib/funding/fixtures.mjs';

const NOW = 2_000_000_000;
const config = () => { const checked = validateFundingConfig(fixtureConfig(NOW)); assert.equal(checked.ok, true); return checked.config; };
const scenario = (id) => structuredClone(fixtureScenarios(NOW).find((item) => item.id === id).record);
const classify = (record, options = {}) => classifyFunding(record, { config: config(), now: NOW, ...options });
const live = (record) => ({ ...record, origin: 'funding-service', quote: { ...record.quote, evidenceQuality: 'live-verified' },
  ...(record.delivery ? { delivery: { ...record.delivery, evidenceQuality: 'live-verified' } } : {}),
  ...(record.refund ? { refund: { ...record.refund, evidenceQuality: 'live-verified' } } : {}) });

test('amounts render exactly from integer strings, including uint256 maximum', () => {
  const max = (2n ** 256n - 1n).toString();
  assert.equal(formatUnits(max, 6), '115,792,089,237,316,195,423,570,985,008,687,907,853,269,984,665,640,564,039,457,584,007,913,129.639935');
  assert.equal(formatUnits('1', 6), '0.000001');
  assert.equal(formatUnits('1000000', 6), '1');
  assert.equal(formatUnits('24994950', 6), '24.99495');
  assert.equal(formatUnits('1999999', 6, { maxFraction: 2 }), '1.99', 'truncates instead of rounding money up');
  assert.equal(formatUnits('5', 6, { minFraction: 2 }), '0.000005');
  assert.equal(formatUnits('1000000', 6, { minFraction: 2 }), '1.00');
  for (const bad of ['1.5', '-1', 1000000, '', '01', null, undefined, '1e6', ' 1']) assert.equal(formatUnits(bad, 6), null, String(bad));
  assert.equal(formatUnits('1', 37), null);
  assert.equal(percentOf('24994700', '25000000'), '99.97%');
  assert.equal(percentOf('1', '0'), null);
});

test('typed amounts parse to base units without floating point', () => {
  assert.deepEqual(parseUnits('1.5', 6), { ok: true, raw: '1500000' });
  assert.deepEqual(parseUnits('.5', 6), { ok: true, raw: '500000' });
  assert.deepEqual(parseUnits(' 25 ', 6), { ok: true, raw: '25000000' });
  assert.deepEqual(parseUnits('12345678901234567890.123456', 6), { ok: true, raw: '12345678901234567890123456' });
  assert.deepEqual(parseUnits('0.1', 6), { ok: true, raw: '100000' }, 'no 0.1 floating point drift');
  for (const bad of ['0.0000001', '1e6', '-1', '0', '', '.', '1.2.3', '1,000', '0x10', 'NaN', '1'.repeat(70)]) assert.equal(parseUnits(bad, 6).ok, false, bad);
});

test('explorer links use only allowlisted network bases and strict values', () => {
  const hash = `0x${'AB'.repeat(32)}`;
  assert.equal(explorerUrl(42161, 'tx', hash), `https://arbiscan.io/tx/0x${'ab'.repeat(32)}`);
  assert.equal(explorerUrl(AURORA_MAINNET, 'address', `0x${'5afe'.repeat(10)}`), `https://explorer.aurora.dev/address/0x${'5afe'.repeat(10)}`);
  assert.equal(explorerUrl(AURORA_TESTNET, 'tx', hash), `https://explorer.testnet.aurora.dev/tx/0x${'ab'.repeat(32)}`);
  for (const [chain, kind, value] of [[1, 'tx', hash], ['42161', 'tx', hash], [42161, 'tx', 'javascript:alert(1)'], [42161, 'tx', `${hash}/../../evil`], [42161, 'address', '0x0000000000000000000000000000000000000000'], [42161, 'block', hash]]) {
    assert.equal(explorerUrl(chain, kind, value), null, `${chain} ${kind} ${value}`);
  }
});

test('response text is stripped of controls and bidirectional overrides and bounded', () => {
  assert.equal(safeText('\u202eWEIVER_DEEN\u0000 <b>x</b>'), 'WEIVER_DEEN <b>x</b>');
  assert.equal(safeText('a'.repeat(300), 10), `${'a'.repeat(9)}…`);
  assert.equal(safeText(42), null);
  assert.equal(safeText('\u200b\u2066'), null);
});

test('configuration rejects testnet destinations, wrong Safe/token/refund and forces signing off', () => {
  const base = fixtureConfig(NOW);
  assert.equal(validateFundingConfig(base).ok, true);
  const reject = (mutate, pattern) => { const value = structuredClone(base); mutate(value); const checked = validateFundingConfig(value); assert.equal(checked.ok, false); assert.match(checked.error, pattern); };
  reject((c) => { c.destination.chainId = AURORA_TESTNET; }, /no testnet/);
  reject((c) => { c.destination.chainId = 1; }, /Aurora mainnet/);
  reject((c) => { c.destination.safe = 'javascript:alert(1)'; }, /Safe address/);
  reject((c) => { c.destination.decimals = 18; }, /asset/);
  reject((c) => { c.refundRecipient = `0x${'9'.repeat(40)}`; }, /Refunds/);
  reject((c) => { c.manager = c.destination.safe; c.refundRecipient = c.destination.safe; }, /different accounts/);
  reject((c) => { c.routes[0].source.chainId = AURORA_TESTNET; }, /Aurora network as its source/);
  reject((c) => { c.routes[0].destination.token = `0x${'7'.repeat(40)}`; }, /accepted asset/);
  reject((c) => { c.routes[0].minimumAmountIn = '10'; c.routes[0].maximumAmountIn = '9'; }, /amount limits/);
  reject((c) => { delete c.eligibility.roundChainId; }, /round network/);
  const claims = structuredClone(base); claims.capabilities = { ...claims.capabilities, signing: true, broadcast: true, executableQuote: true };
  const checked = validateFundingConfig(claims);
  assert.deepEqual([checked.config.capabilities.signing, checked.config.capabilities.broadcast, checked.config.capabilities.executableQuote], [false, false, false]);
});

test('mainnet funding can never make a testnet round eligible', () => {
  assert.equal(roundEligibility(config()).eligible, false);
  const forged = config();
  forged.eligibility.eligible = true; forged.eligibility.checks = forged.eligibility.checks.map((check) => ({ ...check, ok: true }));
  const result = roundEligibility(forged);
  assert.equal(result.sameNetwork, false); assert.equal(result.eligible, false);
});

test('every fixture scenario maps to its display state and is never verified', () => {
  const expected = {
    'fx-awaiting': 'awaiting-manager', 'fx-dispatching': 'submitted', 'fx-pending': 'submitted', 'fx-provider-success': 'provider-success',
    'fx-delivered': 'delivered', 'fx-refunded': 'refunded', 'fx-partial-refund': 'refund-partial', 'fx-refund-pending': 'refund-pending',
    'fx-failed': 'failed', 'fx-broadcast-unknown': 'needs-review', 'fx-expired': 'needs-review', 'fx-stale': 'submitted',
    'fx-inconsistent': 'needs-review', 'fx-hostile': 'unavailable',
  };
  const scenarios = fixtureScenarios(NOW);
  assert.deepEqual(scenarios.map((item) => item.id).sort(), Object.keys(expected).sort());
  for (const item of scenarios) {
    const display = classify(item.record);
    assert.equal(display.bucket, expected[item.id], item.id);
    assert.equal(display.verified, false, `${item.id} is fixture data`);
    assert.equal(display.evidence, 'fixture', item.id);
    assert.equal(item.record.origin, 'fixture');
  }
});

test('only bound, final, live-verified receipts are shown as verified delivery', () => {
  const good = live(scenario('fx-delivered'));
  const verified = classify(good);
  assert.equal(verified.bucket, 'delivered'); assert.equal(verified.verified, true); assert.equal(verified.title, 'Delivery verified');
  const cases = {
    'status without receipt': (r) => { r.delivery = null; },
    'wrong recipient': (r) => { r.delivery.recipient = r.request.manager; },
    'not final': (r) => { r.delivery.confirmations = 63; },
    'below signed minimum': (r) => { r.delivery.amount = '24749999'; },
    'testnet receipt': (r) => { r.delivery.chainId = AURORA_TESTNET; },
    'wrong token': (r) => { r.delivery.token = r.request.source.token; },
    'unlinked source tx': (r) => { r.delivery.sourceTransactionHash = `0x${'e'.repeat(64)}`; },
    'different request': (r) => { r.delivery.requestHash = `0x${'d'.repeat(64)}`; },
    'mixed evidence quality': (r) => { r.delivery.evidenceQuality = 'fixture'; },
    'missing amount': (r) => { r.delivery.amount = null; },
  };
  for (const [name, mutate] of Object.entries(cases)) {
    const record = structuredClone(good); mutate(record);
    const display = classify(record);
    assert.equal(display.verified, false, name); assert.equal(display.bucket, 'needs-review', name);
  }
  const fixtureOrigin = { ...good, origin: 'fixture' };
  assert.equal(classify(fixtureOrigin).verified, false, 'fixture origin can never be verified');
});

test('records that do not match the configured network, Safe or token are unavailable', () => {
  const good = live(scenario('fx-delivered'));
  for (const mutate of [(r) => { r.request.destination.chainId = AURORA_TESTNET; }, (r) => { r.request.safe = `0x${'9'.repeat(40)}`; }, (r) => { r.request.destination.token = `0x${'8'.repeat(40)}`; }, (r) => { r.request.refundRecipient = `0x${'9'.repeat(40)}`; }]) {
    const record = structuredClone(good); mutate(record);
    const display = classify(record);
    assert.equal(display.bucket, 'unavailable'); assert.equal(display.verified, false); assert.equal(display.doNotPayAgain, true);
  }
});

test('provider SUCCESS is not delivery, FAILED is not a refund, and partial refunds show the real amount', () => {
  const success = classify(live(scenario('fx-provider-success')));
  assert.equal(success.bucket, 'provider-success'); assert.equal(success.verified, false); assert.equal(success.doNotPayAgain, true);
  const failed = classify(live(scenario('fx-failed')));
  assert.equal(failed.bucket, 'failed'); assert.match(failed.detail, /does not mean refunded/);
  const pending = classify(live(scenario('fx-refund-pending')));
  assert.equal(pending.bucket, 'refund-pending'); assert.equal(pending.verified, false);
  const partial = classify(live(scenario('fx-partial-refund')));
  assert.equal(partial.bucket, 'refund-partial'); assert.equal(partial.verified, true);
  assert.match(partial.detail, /24\.9947 of 25/); assert.match(partial.detail, /0\.0053 short/);
  const full = classify(live(scenario('fx-refunded')));
  assert.equal(full.bucket, 'refunded'); assert.equal(full.verified, true);
});

test('unknown broadcasts, dispatching and pending states warn against a second payment', () => {
  for (const id of ['fx-dispatching', 'fx-pending', 'fx-provider-success', 'fx-broadcast-unknown', 'fx-refund-pending', 'fx-failed']) {
    assert.equal(classify(scenario(id)).doNotPayAgain, true, id);
  }
  assert.equal(classify(scenario('fx-awaiting')).doNotPayAgain, false);
  assert.match(classify(scenario('fx-broadcast-unknown')).title, /do not pay again/);
});

test('missing, unknown and stale information is unavailable or stale, never success or cancellation', () => {
  assert.equal(classify(null).bucket, 'unavailable');
  assert.equal(classify('delivered').bucket, 'unavailable');
  const cancelled = { ...scenario('fx-pending'), state: 'cancelled' };
  const display = classify(cancelled);
  assert.equal(display.bucket, 'unavailable'); assert.doesNotMatch(display.title, /cancel/i);
  const stale = classify(scenario('fx-stale'));
  assert.equal(stale.stale, true); assert.ok(stale.warnings.some((warning) => /stale/.test(warning)));
  const lostConnection = classify(scenario('fx-pending'), { receivedAt: NOW - 60 });
  assert.equal(lostConnection.stale, true); assert.ok(lostConnection.warnings.some((warning) => /last confirmed snapshot/.test(warning)));
  const hostile = classify(scenario('fx-hostile'));
  assert.equal(hostile.bucket, 'unavailable'); assert.equal(hostile.verified, false);
});

test('previews must be dry, for the trusted Safe and refund wallet, and internally consistent', () => {
  const c = config();
  const good = fixturePreview(c, 'arb-usdc-to-aurora-usdc', '25000000', NOW);
  const checked = validatePreview(good, c);
  assert.equal(checked.ok, true); assert.equal(checked.preview.evidence, 'fixture'); assert.equal(checked.preview.signatureVerified, false);
  for (const mutate of [(p) => { p.executable = true; }, (p) => { p.kind = 'EXECUTION_QUOTE'; }, (p) => { p.request.safe = `0x${'9'.repeat(40)}`; },
    (p) => { p.request.refundRecipient = `0x${'9'.repeat(40)}`; }, (p) => { p.amounts.amountOut = '1'; }, (p) => { p.amounts.amountIn = '1.5'; }, (p) => { p.expiresAt = 'soon'; }]) {
    const preview = structuredClone(good); mutate(preview);
    assert.equal(validatePreview(preview, c).ok, false);
  }
  const forgedSignature = { ...good, signatureVerified: true };
  assert.equal(validatePreview(forgedSignature, c).preview.signatureVerified, false, 'a fixture can never claim a verified signature');
});

test('refunds and managers are tied to the configured wallet, not just to each other', () => {
  const good = live(scenario('fx-refunded'));
  assert.equal(classify(good).verified, true);
  const other = `0x${'7'.repeat(40)}`;
  const moved = structuredClone(good); moved.request.manager = other; moved.request.refundRecipient = other; moved.refund.recipient = other;
  const display = classify(moved);
  assert.equal(display.bucket, 'unavailable'); assert.equal(display.verified, false); assert.ok(display.issues.includes('REFUND_MISMATCH'));
});

test('finality uses the stricter trusted confirmation policy and never assumes one', async () => {
  const { requiredConfirmations } = await import('../src/lib/funding/model.mjs');
  const good = live(scenario('fx-delivered'));
  const weakRecord = structuredClone(good); weakRecord.route.minimumConfirmations = 1; weakRecord.delivery.confirmations = 63;
  assert.equal(requiredConfirmations(weakRecord, config()), 64, 'config 64 beats record 1');
  assert.equal(classify(weakRecord).verified, false);
  const noPolicy = config(); noPolicy.routes[0].minimumConfirmations = null;
  const unknown = structuredClone(good); unknown.route.minimumConfirmations = null;
  const display = classifyFunding(unknown, { config: noPolicy, now: NOW });
  assert.equal(display.bucket, 'needs-review'); assert.equal(display.verified, false); assert.ok(display.issues.includes('CONFIRMATION_POLICY_UNKNOWN'));
});

test('verification also requires integrity ok, schema version 1 and a configured route', () => {
  const good = live(scenario('fx-delivered'));
  const noIntegrity = structuredClone(good); delete noIntegrity.integrity;
  assert.equal(classify(noIntegrity).verified, false);
  const wrongSchema = { ...structuredClone(good), schemaVersion: 2 };
  assert.equal(classify(wrongSchema).verified, false);
  const unknownRoute = structuredClone(good); unknownRoute.request.routeId = 'eth-usdc-to-aurora-usdc';
  const display = classify(unknownRoute);
  assert.equal(display.bucket, 'unavailable'); assert.ok(display.issues.includes('ROUTE_UNKNOWN'));
});

test('settled records are not flagged stale for lack of polling; destination decimals are pinned', () => {
  const delivered = classify(live(scenario('fx-delivered')), { receivedAt: NOW - 3600 });
  assert.equal(delivered.stale, false); assert.equal(delivered.warnings.length, 0);
  const value = fixtureConfig(NOW); value.routes[0].destination.decimals = 18;
  assert.equal(validateFundingConfig(value).ok, false);
});

test('fixture data is recognisably synthetic and never labelled live', () => {
  const c = fixtureConfig(NOW);
  assert.equal(c.evidence, 'fixture'); assert.equal(c.mode, 'fixture');
  for (const item of fixtureScenarios(NOW)) {
    const text = JSON.stringify(item.record);
    assert.equal(text.includes('live-verified'), false, item.id);
    assert.equal(item.record.quote?.evidenceQuality ?? 'fixture', 'fixture');
  }
  assert.equal(c.destination.safe, `0x${'5afe'.repeat(10)}`);
});
