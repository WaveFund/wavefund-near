import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateKeyPairSync, sign } from 'node:crypto';
import {
  createIntentsClient, createQuoteSignatureVerifier, quoteMessage, verifyFundingDelivery,
  IntentsError, ERROR_CODES, ERC20_TRANSFER_TOPIC, VERIFIED_FUNDING_ROUTES, AURORA_MAINNET_CHAIN_ID, OUTCOMES, EVIDENCE_QUALITY,
} from '../intents/index.mjs';
import { base58Encode } from '../intents/signature.mjs';

// Everything in this file is MOCKED: signed with a throwaway key, receipts are synthetic.
const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/intents/${name}`, import.meta.url), 'utf8'));
const TOKENS = fixture('live/tokens-subset.json').entries;
const MOCK_EXEC = fixture('mocked/funding-execution-quote.template.json');
const MOCK_STATUS = fixture('mocked/funding-status.template.json');
const ROUTE = VERIFIED_FUNDING_ROUTES[0];
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const verifySignature = createQuoteSignatureVerifier({ publicKey: `ed25519:${base58Encode(Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url'))}` });
const signWith = (payload) => { const c = structuredClone(payload); c.signature = `ed25519:${base58Encode(sign(null, Buffer.from(quoteMessage(c), 'utf8'), privateKey))}`; return c; };
const SIGNED = signWith(MOCK_EXEC);
const DEPOSIT = MOCK_EXEC.quote.depositAddress; const SAFE = MOCK_EXEC.quoteRequest.virtualChainRecipient; const REFUND = MOCK_EXEC.quoteRequest.refundTo;
const SRC_TX = MOCK_STATUS.swapDetails.originChainTxHashes[0].hash; const DST_TX = MOCK_STATUS.swapDetails.destinationChainTxHashes[0].hash;
const REFUND_TX = `0x5${'0'.repeat(62)}2`; const OTHER_TX = `0x9${'0'.repeat(62)}9`;
const ZERO = '0x0000000000000000000000000000000000000000';
const pad = (address) => `0x${address.slice(2).toLowerCase().padStart(64, '0')}`;
const transferLog = (token, from, to, value) => ({ address: token, topics: [ERC20_TRANSFER_TOPIC, pad(from), pad(to)], data: `0x${BigInt(value).toString(16).padStart(64, '0')}` });
const receipt = (txHash, chainId, logs, { status = '0x1', confirmations = 64 } = {}) => ({ txHash, chainId, confirmations, receipt: { transactionHash: txHash, status, blockNumber: '0x1', logs } });
const deposit = (value = '250000000', opts) => receipt(SRC_TX, 1, [transferLog(ROUTE.source.tokenAddress, '0x000000000000000000000000000000000000abcd', DEPOSIT, value)], opts);
const delivery = (value = '249973358', { txHash = DST_TX, chainId = AURORA_MAINNET_CHAIN_ID, token = ROUTE.destination.tokenAddress, to = SAFE, ...opts } = {}) => receipt(txHash, chainId, [transferLog(token, ZERO, to, value)], opts);
const refund = (value) => receipt(REFUND_TX, 1, [transferLog(ROUTE.source.tokenAddress, DEPOSIT, REFUND, value)]);

async function scenario(status, swapDetails = {}) {
  const body = { ...MOCK_STATUS, status, quoteResponse: SIGNED, swapDetails: { ...MOCK_STATUS.swapDetails, ...swapDetails } };
  const routes = { 'GET /v0/tokens': { status: 200, headers: {}, bodyText: JSON.stringify(TOKENS) }, 'POST /v0/quote': { status: 201, headers: {}, bodyText: JSON.stringify(SIGNED) }, 'GET /v0/status': { status: 200, headers: {}, bodyText: JSON.stringify(body) } };
  const client = createIntentsClient({ transport: async (req) => routes[`${req.method} ${new URL(req.url).pathname}`], clock: { now: () => Date.parse('2026-11-11T12:00:10.000Z') }, verifySignature, allowExecutionQuotes: true });
  const r = MOCK_EXEC.quoteRequest;
  const quote = await client.prepareOrder({
    fundingId: 'manager-1:funding-1', source: { chain: 'eth', chainId: 1, assetId: r.originAsset, tokenAddress: ROUTE.source.tokenAddress },
    destination: { chainId: AURORA_MAINNET_CHAIN_ID, virtualChainAccount: 'aurora', assetId: r.destinationAsset, tokenAddress: ROUTE.destination.tokenAddress, safeAddress: SAFE },
    amountIn: r.amount, minAmountOut: '247000000', slippageBps: 100, refundAddress: REFUND, expiresAt: r.deadline,
  });
  return { quote, status: await client.getExecutionStatus(quote) };
}
const verify = (args) => verifyFundingDelivery({ verifySignature, ...args });
const failed = (result) => result.checks.filter((c) => c.result === 'fail').map((c) => c.name);

test('vocabulary is explicit and never claims trustlessness', async () => {
  assert.deepEqual(OUTCOMES, ['pending', 'delivered', 'refunded', 'failed', 'ambiguous']);
  assert.deepEqual(EVIDENCE_QUALITY, ['none', 'provider-claim-only', 'provider-linked-one-leg', 'provider-linked-both-legs']);
  const { quote, status } = await scenario('SUCCESS');
  const result = verify({ quote, status, sourceReceipts: [deposit()], destinationReceipts: [delivery()] });
  assert.equal(result.trustless, false); assert.match(result.note, /not a trustless/);
});

test('delivered: provider SUCCESS plus linked, confirmed deposit and Safe receipts', async () => {
  const { quote, status } = await scenario('SUCCESS');
  const result = verify({ quote, status, sourceReceipts: [deposit()], destinationReceipts: [delivery()] });
  assert.equal(result.outcome, 'delivered'); assert.equal(result.evidenceQuality, 'provider-linked-both-legs');
  assert.equal(result.amounts.delivered, '249973358'); assert.equal(result.amounts.deposited, '250000000'); assert.equal(result.amounts.depositedSource, 'source-receipt');
  assert.deepEqual(failed(result), []);
  const destinationOnly = verify({ quote, status, destinationReceipts: [delivery()] });
  assert.equal(destinationOnly.outcome, 'delivered'); assert.equal(destinationOnly.evidenceQuality, 'provider-linked-one-leg');
});

test('pending delivery: in-progress statuses, SUCCESS without a Safe receipt, and unconfirmed receipts', async () => {
  for (const s of ['PENDING_DEPOSIT', 'KNOWN_DEPOSIT_TX', 'PROCESSING']) {
    const { quote, status } = await scenario(s);
    const result = verify({ quote, status, sourceReceipts: s === 'PENDING_DEPOSIT' ? [] : [deposit()] });
    assert.equal(result.outcome, 'pending', s);
  }
  const { quote, status } = await scenario('SUCCESS');
  const claimOnly = verify({ quote, status });
  assert.equal(claimOnly.outcome, 'pending'); assert.equal(claimOnly.evidenceQuality, 'provider-claim-only'); assert.equal(claimOnly.amounts.providerReportedOut, '249973358');
  const unconfirmed = verify({ quote, status, destinationReceipts: [delivery('249973358', { confirmations: 0 })] });
  assert.equal(unconfirmed.outcome, 'pending'); assert.match(unconfirmed.checks.at(-1).detail, /confirmations/);
});

test('unrelated transfers to the Safe are never counted as delivery', async () => {
  const { quote, status } = await scenario('SUCCESS');
  const unlinked = verify({ quote, status, destinationReceipts: [delivery('249973358', { txHash: OTHER_TX })] });
  assert.equal(unlinked.outcome, 'pending'); assert.match(unlinked.checks.at(-1).detail, /not linked/);
  const unrelatedLinked = verify({ quote, status, destinationReceipts: [receipt(DST_TX, AURORA_MAINNET_CHAIN_ID, [transferLog(ROUTE.destination.tokenAddress, ZERO, '0x000000000000000000000000000000000000dead', '249973358')])] });
  assert.equal(unrelatedLinked.outcome, 'ambiguous', 'provider-linked tx that pays someone else contradicts SUCCESS');
});

test('wrong token, wrong network and reverted receipts make a linked observation ambiguous', async () => {
  const { quote, status } = await scenario('SUCCESS');
  for (const bad of [
    delivery('249973358', { token: '0xb12bfca5a55806aaf64e99521918a4bf0fc40802' }), // bridged USDC.e, not the mapped USDC
    delivery('249973358', { chainId: 1313161555 }), // Aurora TESTNET
    delivery('249973358', { status: '0x0' }),
  ]) {
    const result = verify({ quote, status, destinationReceipts: [bad] });
    assert.equal(result.outcome, 'ambiguous'); assert.notEqual(result.outcome, 'delivered');
  }
  const wrongSourceNetwork = verify({ quote, status, sourceReceipts: [receipt(SRC_TX, 42161, deposit().receipt.logs)], destinationReceipts: [delivery()] });
  assert.equal(wrongSourceNetwork.outcome, 'ambiguous');
  const malformed = verify({ quote, status, destinationReceipts: [{ ...delivery(), receipt: { ...delivery().receipt, logs: [{ address: ROUTE.destination.tokenAddress, topics: [ERC20_TRANSFER_TOPIC], data: '0x' }] } }] });
  assert.equal(malformed.outcome, 'ambiguous');
});

test('delivered amount must match the provider report and the signed minimum', async () => {
  const { quote, status } = await scenario('SUCCESS');
  assert.equal(verify({ quote, status, destinationReceipts: [delivery('249973357')] }).outcome, 'ambiguous');
  const low = await scenario('SUCCESS', { amountOut: '247000000' });
  assert.equal(verify({ quote: low.quote, status: low.status, destinationReceipts: [delivery('247000000')] }).outcome, 'ambiguous', 'below signed minAmountOut 247473624');
});

test('partial refund shows the actual refunded amount and the shortfall', async () => {
  const refundedAmount = '249700000'; // 250 USDC minus the quoted 0.3 USDC refund fee
  const { quote, status } = await scenario('REFUNDED', { refundedAmount, refundReason: 'PARTIAL_DEPOSIT', originChainTxHashes: [{ hash: SRC_TX }, { hash: REFUND_TX }], destinationChainTxHashes: [] });
  const claimOnly = verify({ quote, status });
  assert.equal(claimOnly.outcome, 'refunded'); assert.equal(claimOnly.amounts.refunded, refundedAmount);
  assert.equal(claimOnly.amounts.refundShortfall, '300000'); assert.equal(claimOnly.amounts.depositedSource, 'provider'); assert.equal(claimOnly.amounts.quotedRefundFee, '300000');
  assert.equal(claimOnly.evidenceQuality, 'provider-claim-only');
  const withReceipts = verify({ quote, status, sourceReceipts: [deposit()], refundReceipts: [refund(refundedAmount)] });
  assert.equal(withReceipts.outcome, 'refunded'); assert.equal(withReceipts.evidenceQuality, 'provider-linked-both-legs');
  assert.ok(withReceipts.reasons.some((r) => /300000 was not returned/.test(r)));
  assert.equal(verify({ quote, status, refundReceipts: [refund('250000000')] }).outcome, 'ambiguous', 'observed refund differs from provider report');
  const noAmount = await scenario('REFUNDED', { refundedAmount: undefined });
  assert.equal(verify({ quote: noAmount.quote, status: noAmount.status }).outcome, 'ambiguous', 'refund amount is never assumed');
});

test('partial source deposit stays pending and is reported', async () => {
  const { quote, status } = await scenario('INCOMPLETE_DEPOSIT', { depositedAmount: '100000000' });
  const result = verify({ quote, status, sourceReceipts: [deposit('100000000')] });
  assert.equal(result.outcome, 'pending'); assert.equal(result.amounts.deposited, '100000000');
  assert.ok(result.reasons.some((r) => /partial deposit/.test(r)));
});

test('conflicting observations are ambiguous', async () => {
  const success = await scenario('SUCCESS', { originChainTxHashes: [{ hash: SRC_TX }, { hash: REFUND_TX }] });
  assert.equal(verify({ quote: success.quote, status: success.status, destinationReceipts: [delivery()], refundReceipts: [refund('249700000')] }).outcome, 'ambiguous');
  const refunded = await scenario('REFUNDED', { refundedAmount: '249700000' });
  assert.equal(verify({ quote: refunded.quote, status: refunded.status, destinationReceipts: [delivery()] }).outcome, 'ambiguous');
  const processing = await scenario('PROCESSING', { originChainTxHashes: [{ hash: SRC_TX }, { hash: REFUND_TX }] });
  assert.equal(verify({ quote: processing.quote, status: processing.status, refundReceipts: [refund('249700000')] }).outcome, 'ambiguous');
});

test('timeouts and API failures never become refunded, and FAILED is not a refund', async () => {
  const { quote } = await scenario('PROCESSING');
  for (const statusError of [new IntentsError(ERROR_CODES.TIMEOUT, 'timed out'), new IntentsError(ERROR_CODES.RATE_LIMITED, 'limited'), new IntentsError(ERROR_CODES.PROVIDER_UNAVAILABLE, '503')]) {
    const result = verify({ quote, statusError, refundReceipts: [refund('249700000')], destinationReceipts: [delivery()] });
    assert.equal(result.outcome, 'ambiguous'); assert.equal(result.evidenceQuality, 'none');
    assert.ok(result.reasons.some((r) => /not treated as refunded/.test(r)));
  }
  assert.equal(verify({ quote }).outcome, 'ambiguous');
  const failedStatus = await scenario('FAILED');
  const result = verify({ quote: failedStatus.quote, status: failedStatus.status });
  assert.equal(result.outcome, 'failed'); assert.equal(result.amounts.refunded, undefined);
});

test('tampered stored quotes and foreign statuses are rejected before any outcome', async () => {
  const { quote, status } = await scenario('SUCCESS');
  const tamper = (mutate) => { const copy = structuredClone(quote); mutate(copy); return copy; };
  for (const bad of [
    tamper((q) => { q.deposit.address = '0xde90000000000000000000000000000000000009'; }),
    tamper((q) => { q.funding.safeAddress = '0x000000000000000000000000000000000000dead'; }),
    tamper((q) => { q.amounts.amountIn = '1'; }),
    tamper((q) => { q.providerPayload.quote.amountOut = '1'; }),
    tamper((q) => { q.funding.refundAddress = '0x000000000000000000000000000000000000dead'; }),
    { ...quote, kind: 'DRY_QUOTE' }, null,
  ]) {
    const result = verify({ quote: bad, status, destinationReceipts: [delivery()] });
    assert.equal(result.outcome, 'ambiguous'); assert.equal(result.evidenceQuality, 'none');
  }
  const foreign = structuredClone(status); foreign.providerPayload.quoteResponse.signature = 'ed25519:other';
  assert.equal(verify({ quote, status: foreign, destinationReceipts: [delivery()] }).outcome, 'ambiguous');
  const otherDeposit = structuredClone(status); otherDeposit.deposit.address = '0xde90000000000000000000000000000000000009';
  assert.equal(verify({ quote, status: otherDeposit, destinationReceipts: [delivery()] }).outcome, 'ambiguous');
});
