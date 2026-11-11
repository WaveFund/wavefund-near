// FIXTURE DATA ONLY. Synthetic configuration, quotes and FundingRecordV1-shaped records for the dashboard's
// explicit fixture explorer. Safe, wallet, deposit and transaction values are fake and recognisable (0x5afe…,
// 0xfeed…, 0xf1f1…). Token identities match the public Arbitrum/Aurora USDC contracts so the route reads
// realistically. Nothing here was returned by NEAR Intents or a chain, and nothing claims live evidence.
import { AURORA_MAINNET, AURORA_TESTNET } from './model.mjs';

export const FIXTURE_LABEL = 'FIXTURE · synthetic data, not live evidence';
const SAFE = '0x5afe5afe5afe5afe5afe5afe5afe5afe5afe5afe';
const MANAGER = '0xfeedfeedfeedfeedfeedfeedfeedfeedfeedfeed';
const DEPOSIT = '0xdec0dedec0dedec0dedec0dedec0dedec0dedec0';
const ARB_USDC = '0xaf88d065e77c8cc2239327c5edb3a432268e5831';
const ARB_USDC_ID = 'nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near';
const AURORA_USDC = '0x368ebb46aca6b8d0787c96b2b20bd3cc3f2c45f7';
const AURORA_USDC_ID = 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';
const fake = (pair) => `0x${pair.repeat(32)}`;
const CONFIG_HASH = fake('cc'); const REQUEST_HASH = fake('aa'); const QUOTE_HASH = fake('bb');
const TX_SOURCE = fake('f1'); const TX_DELIVERY = fake('f2'); const TX_REFUND = fake('f3');
const ROUTE_ID = 'arb-usdc-to-aurora-usdc';

export function fixtureConfig(now) {
  return {
    schemaVersion: 1, mode: 'fixture', evidence: 'fixture', configurationHash: CONFIG_HASH,
    destination: { chainId: AURORA_MAINNET, network: 'aurora-mainnet', safe: SAFE, token: AURORA_USDC, assetId: AURORA_USDC_ID, decimals: 6, symbol: 'USDC', safeVersion: '1.4.1', purpose: 'fixture-example-safe', wavefundModuleEnabled: false },
    manager: MANAGER, refundRecipient: MANAGER,
    routes: [{
      routeId: ROUTE_ID, label: 'Arbitrum One · USDC',
      source: { chainId: 42161, assetId: ARB_USDC_ID, token: ARB_USDC, decimals: 6, symbol: 'USDC' },
      destination: { chainId: AURORA_MAINNET, assetId: AURORA_USDC_ID, token: AURORA_USDC, decimals: 6, symbol: 'USDC' },
      minimumAmountIn: '5301', maximumAmountIn: '1000000000000', previewAvailable: true, approvedForFunding: false, deliveryProven: false,
      minimumConfirmations: 64, notes: ['DELIVERY_NOT_OBSERVED', 'NOT_APPROVED_FOR_FUNDING', 'EXECUTABLE_QUOTES_DISABLED'],
    }],
    unsupported: [
      { id: 'eth-usdc-to-aurora-usdc', label: 'Ethereum · USDC', reason: 'Retired. Earlier signed dry quotes are kept as history only; the provider client no longer approves this route.' },
      { id: 'base-usdc-to-aurora-usdc', label: 'Base · USDC', reason: 'Not verified. EVM-origin quoting was intermittently unavailable and no route evidence exists.' },
      { id: 'near-account-to-aurora', label: 'NEAR account · any asset', reason: 'Unsupported in funding schema v1, which accepts only an EVM-chain ERC-20 source.' },
    ],
    eligibility: {
      eligible: false, roundChainId: AURORA_TESTNET,
      checks: [
        { id: 'same-network', ok: false, label: 'Funding destination and round deployment share one network', detail: `Funding lands on Aurora mainnet ${AURORA_MAINNET}; the verified Wavefund round deployment is Aurora testnet ${AURORA_TESTNET}.` },
        { id: 'mainnet-deployment', ok: false, label: 'Reviewed Aurora mainnet Wavefund deployment', detail: 'No reviewed mainnet deployment manifest with pinned code hashes exists yet.' },
        { id: 'module-enabled', ok: false, label: 'Wavefund module enabled on the funding Safe', detail: 'The example Safe has no Wavefund module enabled.' },
        { id: 'route-approved', ok: false, label: 'Live-verified route approved for sending', detail: 'Production funding configuration has no enabled route.' },
        { id: 'delivery-observed', ok: false, label: 'A NEAR Intents delivery has been observed', detail: 'No delivery to Aurora has been observed or authorized.' },
      ],
    },
    capabilities: { preview: true, executableQuote: false, submitted: false, records: true, signing: false, broadcast: false },
    observedAt: now,
  };
}

// Deterministic fixture dry quote. Never signed, never executable.
export function fixturePreview(config, routeId, amountIn, now) {
  const route = config.routes.find((item) => item.routeId === routeId);
  if (!route || !/^[1-9][0-9]{0,30}$/.test(amountIn)) throw new Error('Fixture preview needs a configured route and a positive base-unit amount.');
  const amount = BigInt(amountIn);
  const out = amount - amount * 2n / 10_000n - 1n;
  const amountOut = (out > 0n ? out : 0n).toString();
  return {
    kind: 'DRY_QUOTE', executable: false, funded: false, evidence: 'fixture', signatureVerified: false, routeId,
    request: { amountIn, minAmountOut: (amount * 9_800n / 10_000n).toString(), expiresAt: now + 300, safe: config.destination.safe, refundRecipient: config.refundRecipient },
    amounts: { amountIn, amountOut, minAmountOut: (BigInt(amountOut) * 9_900n / 10_000n).toString() },
    fees: { refundFee: '5300', withdrawFee: '0', appFeeBps: 1, feesSigned: false, appFeesSigned: false },
    quotedAt: now, expiresAt: now + 300, timeEstimateSeconds: 25, correlationId: null, payloadSha256: null,
  };
}

function record(now, fundingId, state, overrides = {}) {
  return {
    origin: 'fixture', schemaVersion: 1, fundingId, configurationHash: CONFIG_HASH, state, revision: 0, createdAt: now - 90, updatedAt: now - 5, reviewReason: null,
    request: {
      routeId: ROUTE_ID, manager: MANAGER, safe: SAFE,
      source: { chainId: 42161, assetId: ARB_USDC_ID, token: ARB_USDC, decimals: 6 },
      destination: { chainId: AURORA_MAINNET, assetId: AURORA_USDC_ID, token: AURORA_USDC, decimals: 6 },
      amountIn: '25000000', minAmountOut: '24500000', refundRecipient: MANAGER, expiresAt: now + 240,
    },
    requestHash: REQUEST_HASH, quoteHash: QUOTE_HASH,
    quote: { reference: 'fixture-quote-0001', depositAddress: DEPOSIT, amountIn: '25000000', minAmountOut: '24750000', expiresAt: now + 200, evidenceQuality: 'fixture' },
    submission: null, observation: null, delivery: null, refund: null, readiness: null,
    route: { minimumConfirmations: 64, maxObservationAgeSeconds: 120 }, observedAt: now, integrity: 'ok', integrityIssues: [],
    ...overrides,
  };
}
const submitted = (now) => ({ reserved: true, txHash: TX_SOURCE, reservedAt: now - 60 });
const observed = (now, status, age = 8) => ({ source: 'provider-unverified', status, observedAt: now - age });
const evidence = (kind, now, amount) => ({
  requestHash: REQUEST_HASH, quoteHash: QUOTE_HASH, sourceTransactionHash: TX_SOURCE,
  transactionHash: kind === 'delivery' ? TX_DELIVERY : TX_REFUND, chainId: kind === 'delivery' ? AURORA_MAINNET : 42161,
  token: kind === 'delivery' ? AURORA_USDC : ARB_USDC, recipient: kind === 'delivery' ? SAFE : MANAGER,
  amount, confirmations: 64, observedAt: now - 20, evidenceQuality: 'fixture',
});

export function fixtureScenarios(now) {
  return [
    { id: 'fx-awaiting', group: 'Progress', label: 'Awaiting manager', description: 'Executable quote recorded; the manager has not sent yet.', record: record(now, 'fx-awaiting', 'quoted') },
    { id: 'fx-dispatching', group: 'Progress', label: 'Send reserved', description: 'A wallet send was reserved before broadcast; no hash recorded yet.', record: record(now, 'fx-dispatching', 'dispatching', { submission: { reserved: true, txHash: null, reservedAt: now - 15 }, updatedAt: now - 15 }) },
    { id: 'fx-pending', group: 'Progress', label: 'Submitted · processing', description: 'Source transaction recorded; the provider is processing.', record: record(now, 'fx-pending', 'pending', { submission: submitted(now), observation: observed(now, 'PROCESSING'), updatedAt: now - 8 }) },
    { id: 'fx-provider-success', group: 'Progress', label: 'Provider SUCCESS', description: 'Provider reports SUCCESS, which is not yet verified delivery.', record: record(now, 'fx-provider-success', 'pending', { submission: submitted(now), observation: observed(now, 'SUCCESS'), updatedAt: now - 8 }) },
    { id: 'fx-delivered', group: 'Outcomes', label: 'Delivered', description: 'Complete delivery evidence for the configured Safe (fixture quality).', record: record(now, 'fx-delivered', 'delivered', { submission: submitted(now), observation: observed(now, 'SUCCESS', 30), delivery: evidence('delivery', now, '24994950'), updatedAt: now - 20 }) },
    { id: 'fx-refunded', group: 'Outcomes', label: 'Full refund', description: 'The full input returned to the manager wallet.', record: record(now, 'fx-refunded', 'refunded', { submission: submitted(now), observation: observed(now, 'REFUNDED', 40), refund: evidence('refund', now, '25000000'), updatedAt: now - 20 }) },
    { id: 'fx-partial-refund', group: 'Outcomes', label: 'Partial refund', description: 'A fee-net refund: the actual verified amount is shown, with the shortfall.', record: record(now, 'fx-partial-refund', 'needs_review', { reviewReason: 'PARTIAL_REFUND', submission: submitted(now), observation: observed(now, 'REFUNDED', 40), refund: evidence('refund', now, '24994700'), updatedAt: now - 20 }) },
    { id: 'fx-refund-pending', group: 'Problems', label: 'Refund pending', description: 'Provider says REFUNDED, but no refund receipt has been verified.', record: record(now, 'fx-refund-pending', 'needs_review', { reviewReason: 'RECEIPT_VERIFICATION_REQUIRED', submission: submitted(now), observation: observed(now, 'REFUNDED'), updatedAt: now - 8 }) },
    { id: 'fx-failed', group: 'Problems', label: 'Failed ≠ refunded', description: 'Provider says FAILED. Funds are not shown as returned.', record: record(now, 'fx-failed', 'needs_review', { reviewReason: 'RECEIPT_VERIFICATION_REQUIRED', submission: submitted(now), observation: observed(now, 'FAILED'), updatedAt: now - 8 }) },
    { id: 'fx-broadcast-unknown', group: 'Problems', label: 'Broadcast unknown', description: 'The browser lost the wallet response. A second payment must never be offered.', record: record(now, 'fx-broadcast-unknown', 'needs_review', { reviewReason: 'BROADCAST_UNKNOWN', submission: { reserved: true, txHash: null, reservedAt: now - 400 }, updatedAt: now - 300 }) },
    { id: 'fx-expired', group: 'Problems', label: 'Quote expired', description: 'The quote expired unsent; the deposit address must not be reused.', record: record(now, 'fx-expired', 'quoted', { quote: { reference: 'fixture-quote-0002', depositAddress: DEPOSIT, amountIn: '25000000', minAmountOut: '24750000', expiresAt: now - 30, evidenceQuality: 'fixture' }, updatedAt: now - 400 }) },
    { id: 'fx-stale', group: 'Problems', label: 'Stale status', description: 'The last provider observation is an hour old.', record: record(now, 'fx-stale', 'pending', { submission: submitted(now), observation: observed(now, 'PROCESSING', 3600), updatedAt: now - 3600 }) },
    { id: 'fx-inconsistent', group: 'Problems', label: 'Bad delivery evidence', description: 'State says delivered, but the receipt recipient is not the Safe.', record: record(now, 'fx-inconsistent', 'delivered', { submission: submitted(now), delivery: { ...evidence('delivery', now, '24994950'), recipient: MANAGER }, updatedAt: now - 20 }) },
    { id: 'fx-hostile', group: 'Problems', label: 'Hostile response', description: 'Malicious strings and a foreign Safe are rendered inert and rejected.', record: record(now, '<img src=x onerror=alert(1)>', 'delivered', {
      reviewReason: '\u202eWEIVER_DEEN', request: { ...record(now, 'x', 'delivered').request, safe: 'javascript:alert(1)' }, submission: submitted(now), delivery: evidence('delivery', now, '24994950'),
      integrity: 'invalid', integrityIssues: ['request.safe', 'fundingId'],
    }) },
  ];
}
