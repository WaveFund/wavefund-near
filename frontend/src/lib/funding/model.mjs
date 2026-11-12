// Pure funding display logic shared by the dashboard and `node --test`. No dependencies, no floats for money.
// State names come from Developer A's FundingRecordV1. This module only maps them to display buckets.

export const AURORA_MAINNET = 1313161554;
export const AURORA_TESTNET = 1313161555;
export const ARBITRUM_SEPOLIA = 421614;

// Allowlisted, network-specific explorers. Unknown networks never get a link. A null explorer names the
// network without linking anywhere. Arbitrum Sepolia uses the explorer named in the verified Tidepool evidence.
export const NETWORKS = Object.freeze({
  42161: Object.freeze({ chainId: 42161, name: 'Arbitrum One', short: 'Arbitrum', explorer: 'https://arbiscan.io', testnet: false }),
  [ARBITRUM_SEPOLIA]: Object.freeze({ chainId: ARBITRUM_SEPOLIA, name: 'Arbitrum Sepolia', short: 'Arb Sepolia', explorer: 'https://sepolia.arbiscan.io', testnet: true }),
  [AURORA_MAINNET]: Object.freeze({ chainId: AURORA_MAINNET, name: 'Aurora mainnet', short: 'Aurora', explorer: 'https://explorer.aurora.dev', testnet: false }),
  [AURORA_TESTNET]: Object.freeze({ chainId: AURORA_TESTNET, name: 'Aurora testnet', short: 'Aurora testnet', explorer: 'https://explorer.testnet.aurora.dev', testnet: true }),
});

const INTEGER = /^(0|[1-9][0-9]{0,77})$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
// C0/C1 controls, zero-width characters and bidirectional overrides that can disguise text.
const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g;

export const isIntegerString = (value) => typeof value === 'string' && INTEGER.test(value);
export const isAddress = (value) => typeof value === 'string' && ADDRESS.test(value) && !/^0x0{40}$/i.test(value);
export const isTxHash = (value) => typeof value === 'string' && HASH.test(value);
const lower = (value) => (typeof value === 'string' ? value.toLowerCase() : null);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isTime = (value) => Number.isSafeInteger(value) && value > 0;

export function network(chainId) {
  return Number.isSafeInteger(chainId) && Object.hasOwn(NETWORKS, chainId) ? NETWORKS[chainId] : null;
}
export function networkName(chainId) {
  return network(chainId)?.name ?? (Number.isSafeInteger(chainId) ? `Unsupported network ${chainId}` : 'Unknown network');
}

// Exact decimal rendering from an integer string. Truncates (never rounds up) when maxFraction is set.
export function formatUnits(raw, decimals, { maxFraction, minFraction = 0, group = true } = {}) {
  if (!isIntegerString(raw) || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null;
  const value = BigInt(raw); const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const keep = Math.max(0, Math.min(decimals, Number.isInteger(maxFraction) ? maxFraction : decimals));
  let fraction = (value % scale).toString().padStart(decimals, '0').slice(0, keep).replace(/0+$/, '');
  const minimum = Math.min(keep, Math.max(0, minFraction));
  if (fraction.length < minimum) fraction = fraction.padEnd(minimum, '0');
  const wholeText = group ? whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',') : whole.toString();
  return fraction ? `${wholeText}.${fraction}` : wholeText;
}

// Parses user input such as "12.5" into base units without floating point.
export function parseUnits(text, decimals) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) return { ok: false, error: 'This asset has no valid precision.' };
  const value = typeof text === 'string' ? text.trim() : '';
  if (!value) return { ok: false, error: 'Enter an amount.' };
  if (value === '.' || !/^\d*(\.\d*)?$/.test(value)) return { ok: false, error: 'Use digits and at most one decimal point.' };
  const [whole = '', fraction = ''] = value.split('.');
  if (fraction.length > decimals) return { ok: false, error: `Use at most ${decimals} decimal places.` };
  if (whole.replace(/^0+/, '').length > 60) return { ok: false, error: 'That amount is too large.' };
  const raw = (BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0')).toString();
  if (raw === '0') return { ok: false, error: 'Enter an amount greater than zero.' };
  return { ok: true, raw };
}

export function compareRaw(a, b) {
  if (!isIntegerString(a) || !isIntegerString(b)) return null;
  const x = BigInt(a); const y = BigInt(b);
  return x === y ? 0 : x < y ? -1 : 1;
}

// part / whole as a percentage string with two decimals, computed with integers.
export function percentOf(part, whole) {
  if (!isIntegerString(part) || !isIntegerString(whole) || whole === '0') return null;
  const basis = BigInt(part) * 10_000n / BigInt(whole);
  return `${basis / 100n}.${(basis % 100n).toString().padStart(2, '0')}%`;
}

export function safeText(value, max = 200) {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(UNSAFE_TEXT, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

export function shortHex(value, head = 6, tail = 4) {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]+$/.test(value)) return 'Unavailable';
  return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function explorerUrl(chainId, kind, value) {
  const item = network(chainId);
  if (!item || typeof item.explorer !== 'string') return null;
  if (kind === 'tx' && isTxHash(value)) return `${item.explorer}/tx/${value.toLowerCase()}`;
  if (kind === 'address' && isAddress(value)) return `${item.explorer}/address/${value.toLowerCase()}`;
  return null;
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return 'Unavailable';
  if (seconds <= 0) return 'Expired';
  const total = Math.floor(seconds); const h = Math.floor(total / 3600); const m = Math.floor((total % 3600) / 60); const s = total % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
}

export function formatAge(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return 'time unavailable';
  if (seconds < 60) return `${Math.floor(seconds)}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h ago`;
  return `${Math.floor(seconds / 86_400)} d ago`;
}

// ---------------------------------------------------------------- configuration

function normalizeAsset(asset) {
  if (!isObject(asset) || !Number.isSafeInteger(asset.chainId) || !isAddress(asset.token) || !Number.isInteger(asset.decimals) || asset.decimals < 0 || asset.decimals > 36) return null;
  return { chainId: asset.chainId, assetId: safeText(asset.assetId, 300), token: asset.token.toLowerCase(), decimals: asset.decimals, symbol: safeText(asset.symbol, 12) };
}

// Rejects any configuration that could send mainnet funds toward a testnet round or an untrusted recipient.
export function validateFundingConfig(input) {
  const reject = (error) => ({ ok: false, error });
  if (!isObject(input) || input.schemaVersion !== 1) return reject('The funding configuration is missing or uses an unsupported schema.');
  const destination = input.destination;
  if (!isObject(destination)) return reject('The funding destination is missing.');
  if (destination.chainId === AURORA_TESTNET) return reject('The funding destination is Aurora testnet. NEAR Intents has no testnet, so this configuration is rejected.');
  if (destination.chainId !== AURORA_MAINNET) return reject(`The funding destination must be Aurora mainnet (${AURORA_MAINNET}).`);
  if (!isAddress(destination.safe)) return reject('The destination Safe address is invalid.');
  if (!isAddress(destination.token) || destination.decimals !== 6) return reject('The accepted destination asset is invalid.');
  if (!isAddress(input.manager) || lower(input.refundRecipient) !== lower(input.manager)) return reject('Refunds must return to the configured manager wallet.');
  if (lower(input.manager) === lower(destination.safe)) return reject('The manager wallet and the Safe must be different accounts.');
  const roundChainId = input.eligibility?.roundChainId;
  if (!Number.isSafeInteger(roundChainId)) return reject('The round network is not declared.');
  if (!Array.isArray(input.routes)) return reject('The route list is missing.');
  const routes = [];
  for (const route of input.routes) {
    const source = normalizeAsset(route?.source); const target = normalizeAsset(route?.destination);
    if (typeof route?.routeId !== 'string' || !source || !target) return reject('A configured route is malformed.');
    if (source.chainId === AURORA_TESTNET || source.chainId === AURORA_MAINNET) return reject('A route uses an Aurora network as its source.');
    if (target.chainId !== AURORA_MAINNET || target.token !== lower(destination.token) || target.decimals !== 6) return reject('A route does not deliver the accepted asset on Aurora mainnet.');
    if (!isIntegerString(route.minimumAmountIn) || !isIntegerString(route.maximumAmountIn) || compareRaw(route.minimumAmountIn, route.maximumAmountIn) === 1) return reject('A route has invalid amount limits.');
    routes.push({
      routeId: safeText(route.routeId, 128), label: safeText(route.label, 60) ?? `${networkName(source.chainId)} route`, source, destination: target,
      minimumAmountIn: route.minimumAmountIn, maximumAmountIn: route.maximumAmountIn,
      previewAvailable: route.previewAvailable === true, approvedForFunding: route.approvedForFunding === true, deliveryProven: route.deliveryProven === true,
      minimumConfirmations: Number.isSafeInteger(route.minimumConfirmations) && route.minimumConfirmations > 0 ? route.minimumConfirmations : null,
      notes: Array.isArray(route.notes) ? route.notes.filter((note) => typeof note === 'string' && CODE.test(note)) : [],
    });
  }
  const checks = Array.isArray(input.eligibility?.checks) ? input.eligibility.checks.filter(isObject).map((check) => ({
    id: safeText(check.id, 40) ?? 'check', ok: check.ok === true, label: safeText(check.label, 120) ?? 'Unnamed check', detail: safeText(check.detail, 240) ?? '',
  })) : [];
  const capabilities = isObject(input.capabilities) ? input.capabilities : {};
  // Strategy stack identity (the Safe and stable token a round uses). Absent → readiness can never be shown.
  let strategy = null;
  if (input.strategy !== undefined && input.strategy !== null) {
    const s = input.strategy;
    if (!isObject(s) || ![AURORA_MAINNET, AURORA_TESTNET].includes(s.chainId) || !isAddress(s.safe) || !isAddress(s.token) || lower(s.safe) === lower(s.token)
      || !Number.isInteger(s.decimals) || s.decimals < 0 || s.decimals > 36) return reject('The strategy deployment identity is malformed.');
    if (s.chainId !== roundChainId) return reject('The strategy deployment and the round network disagree.');
    strategy = { chainId: s.chainId, safe: s.safe.toLowerCase(), token: s.token.toLowerCase(), decimals: s.decimals, symbol: safeText(s.symbol, 12), source: safeText(s.source, 120) };
  }
  return {
    ok: true,
    config: {
      schemaVersion: 1, mode: safeText(input.mode, 24) ?? 'unknown', evidence: input.evidence === 'live' ? 'live' : 'fixture',
      configurationHash: isTxHash(input.configurationHash) ? input.configurationHash : null,
      destination: {
        chainId: AURORA_MAINNET, safe: destination.safe.toLowerCase(), token: destination.token.toLowerCase(), decimals: 6,
        assetId: safeText(destination.assetId, 300), symbol: safeText(destination.symbol, 12) ?? 'USDC', safeVersion: safeText(destination.safeVersion, 12),
        purpose: safeText(destination.purpose, 60), wavefundModuleEnabled: destination.wavefundModuleEnabled === true,
      },
      manager: input.manager.toLowerCase(), refundRecipient: input.refundRecipient.toLowerCase(), routes,
      unsupported: Array.isArray(input.unsupported) ? input.unsupported.filter(isObject).map((route) => ({ id: safeText(route.id, 64) ?? 'route', label: safeText(route.label, 60) ?? 'Route', reason: safeText(route.reason, 240) ?? 'Unavailable.' })) : [],
      strategy,
      eligibility: { eligible: input.eligibility.eligible === true, roundChainId, checks },
      // Signing and broadcasting stay off in this phase even if a server claims otherwise.
      capabilities: { preview: capabilities.preview === true, executableQuote: false, submitted: capabilities.submitted === true, records: capabilities.records === true, signing: false, broadcast: false },
      observedAt: isTime(input.observedAt) ? input.observedAt : null,
    },
  };
}

// Defense in depth: funding on one network can never make a round on another network ready.
export function roundEligibility(config) {
  const sameNetwork = config.destination.chainId === config.eligibility.roundChainId;
  const checks = config.eligibility.checks;
  return { eligible: sameNetwork && config.eligibility.eligible === true && checks.length > 0 && checks.every((check) => check.ok), sameNetwork, checks };
}

// ---------------------------------------------------------------- dry-quote previews

export function validatePreview(input, config) {
  const reject = (error) => ({ ok: false, error });
  if (!isObject(input) || input.kind !== 'DRY_QUOTE' || input.executable !== false) return reject('The preview is not a dry quote, so it was discarded.');
  const amounts = input.amounts; const request = input.request;
  if (!isObject(amounts) || !isObject(request)) return reject('The preview is incomplete.');
  for (const key of ['amountIn', 'amountOut', 'minAmountOut']) if (!isIntegerString(amounts[key])) return reject('The preview amounts are malformed.');
  if (compareRaw(amounts.amountOut, amounts.minAmountOut) === -1) return reject('The preview promises less than its own minimum.');
  if (lower(request.safe) !== config.destination.safe || lower(request.refundRecipient) !== config.refundRecipient) return reject('The preview names a different Safe or refund wallet, so it was discarded.');
  if (amounts.amountIn !== request.amountIn) return reject('The preview amount differs from the request.');
  if (!isTime(input.expiresAt)) return reject('The preview has no expiry.');
  const fees = isObject(input.fees) ? input.fees : {};
  return {
    ok: true,
    preview: {
      kind: 'DRY_QUOTE', executable: false, routeId: safeText(input.routeId, 128),
      evidence: input.evidence === 'live-provider-signed' ? 'live-provider-signed' : input.evidence === 'mocked' ? 'mocked' : 'fixture',
      signatureVerified: input.signatureVerified === true && input.evidence === 'live-provider-signed',
      amounts: { amountIn: amounts.amountIn, amountOut: amounts.amountOut, minAmountOut: amounts.minAmountOut },
      requestMinAmountOut: isIntegerString(request.minAmountOut) ? request.minAmountOut : null,
      fees: {
        refundFee: isIntegerString(fees.refundFee) ? fees.refundFee : null, withdrawFee: isIntegerString(fees.withdrawFee) ? fees.withdrawFee : null,
        appFeeBps: Number.isSafeInteger(fees.appFeeBps) && fees.appFeeBps >= 0 && fees.appFeeBps <= 10_000 ? fees.appFeeBps : null,
        feesSigned: fees.feesSigned === true, appFeesSigned: fees.appFeesSigned === true,
      },
      quotedAt: isTime(input.quotedAt) ? input.quotedAt : null, expiresAt: input.expiresAt,
      timeEstimateSeconds: Number.isSafeInteger(input.timeEstimateSeconds) && input.timeEstimateSeconds >= 0 ? input.timeEstimateSeconds : null,
      correlationId: typeof input.correlationId === 'string' && /^[A-Za-z0-9-]{1,100}$/.test(input.correlationId) ? input.correlationId : null,
      payloadSha256: typeof input.payloadSha256 === 'string' && /^[0-9a-f]{64}$/.test(input.payloadSha256) ? input.payloadSha256 : null,
    },
  };
}

// ---------------------------------------------------------------- funding records

export const REVIEW_REASONS = Object.freeze({
  BROADCAST_UNKNOWN: 'The wallet may or may not have broadcast the deposit. An operator must reconcile it on-chain before anything else happens.',
  CONFLICTING_SUBMISSION: 'Two different transaction references were recorded for one attempt. An operator must reconcile them.',
  RECEIPT_VERIFICATION_REQUIRED: 'The provider reported an outcome, but no verified receipt exists yet.',
  DELIVERY_EVIDENCE_REQUIRES_REVIEW: 'Delivery evidence could not be verified and needs an operator.',
  PARTIAL_REFUND: 'The verified refund is smaller than the amount sent, typically fee-net. An operator must reconcile the difference.',
});
export function reviewReasonText(code) {
  return typeof code === 'string' && Object.hasOwn(REVIEW_REASONS, code) ? REVIEW_REASONS[code] : 'The funding service flagged this record for manual review.';
}

// Required confirmations: the stricter of the trusted configuration and the record's own route limit.
// Returns null when neither declares one, so finality can never be assumed from a missing policy.
export function requiredConfirmations(record, config) {
  const routeId = record?.request?.routeId;
  const route = typeof routeId === 'string' ? config.routes.find((item) => item.routeId === routeId) : null;
  const fromConfig = Number.isSafeInteger(route?.minimumConfirmations) && route.minimumConfirmations > 0 ? route.minimumConfirmations : null;
  const own = record?.route?.minimumConfirmations;
  const fromRecord = Number.isSafeInteger(own) && own > 0 ? own : null;
  if (fromConfig === null && fromRecord === null) return null;
  return Math.max(fromConfig ?? 0, fromRecord ?? 0);
}

// Returns the reasons a delivery/refund receipt cannot be trusted for this record; [] means internally consistent.
export function evidenceFailures(kind, record, config) {
  const item = record[kind]; const request = record.request ?? {}; const failures = [];
  if (!isObject(item)) return [`${kind.toUpperCase()}_MISSING`];
  const delivery = kind === 'delivery';
  if (!isTxHash(item.transactionHash)) failures.push('TRANSACTION_MISSING');
  if (!isTxHash(item.sourceTransactionHash) || lower(item.sourceTransactionHash) !== lower(record.submission?.txHash)) failures.push('SOURCE_TRANSACTION_NOT_LINKED');
  if (!isTxHash(item.requestHash) || item.requestHash !== record.requestHash) failures.push('REQUEST_NOT_BOUND');
  if (!isTxHash(item.quoteHash) || item.quoteHash !== record.quoteHash) failures.push('QUOTE_NOT_BOUND');
  const asset = delivery ? request.destination : request.source;
  if (!Number.isSafeInteger(item.chainId) || item.chainId !== asset?.chainId || (delivery && item.chainId !== AURORA_MAINNET)) failures.push('WRONG_NETWORK');
  if (!isAddress(item.token) || lower(item.token) !== lower(asset?.token)) failures.push('WRONG_TOKEN');
  const recipient = delivery ? request.safe : request.refundRecipient;
  const configured = delivery ? config.destination.safe : config.refundRecipient;
  if (!isAddress(item.recipient) || lower(item.recipient) !== lower(recipient) || lower(item.recipient) !== configured) failures.push('WRONG_RECIPIENT');
  if (!isIntegerString(item.amount) || item.amount === '0') failures.push('AMOUNT_MISSING');
  else if (delivery && (!isIntegerString(record.quote?.minAmountOut) || compareRaw(item.amount, record.quote.minAmountOut) === -1)) failures.push('BELOW_MINIMUM');
  else if (!delivery && (!isIntegerString(request.amountIn) || compareRaw(item.amount, request.amountIn) === 1)) failures.push('REFUND_EXCEEDS_INPUT');
  const minimum = requiredConfirmations(record, config);
  if (minimum === null) failures.push('CONFIRMATION_POLICY_UNKNOWN');
  else if (!Number.isSafeInteger(item.confirmations) || item.confirmations < minimum) failures.push('NOT_FINAL');
  if (!['live-verified', 'fixture'].includes(item.evidenceQuality) || item.evidenceQuality !== record.quote?.evidenceQuality) failures.push('EVIDENCE_QUALITY_MISMATCH');
  if (!isTime(item.observedAt)) failures.push('OBSERVATION_TIME_MISSING');
  return failures;
}

const TERMINAL = new Set(['delivered', 'refunded']);

// Maps a FundingRecordV1 projection to what the dashboard may claim. "verified" is only ever true for
// origin funding-service, live-verified evidence that is internally consistent and bound to this record.
export function classifyFunding(record, { config, now, receivedAt = now }) {
  const base = { verified: false, evidence: 'none', doNotPayAgain: false, stale: false, lastObservedAt: null, step: 0, halted: false, warnings: [], issues: [] };
  if (!isObject(record)) return { ...base, bucket: 'unavailable', tone: 'muted', title: 'Funding status unavailable', detail: 'No funding information could be read. Missing information is never treated as zero or as success.' };
  const state = typeof record.state === 'string' ? record.state : null;
  const fixture = record.origin === 'fixture' || record.quote?.evidenceQuality !== 'live-verified';
  // Only a schema-valid, integrity-checked funding-service record with live-verified evidence can ever be "verified".
  const trustworthy = !fixture && record.origin === 'funding-service' && record.integrity === 'ok' && record.schemaVersion === 1;
  const evidence = record.origin === 'fixture' ? 'fixture' : record.quote?.evidenceQuality === 'live-verified' ? 'live' : 'fixture';
  const issues = Array.isArray(record.integrityIssues) ? record.integrityIssues.filter((issue) => typeof issue === 'string').map((issue) => safeText(issue, 60)).filter(Boolean) : [];
  const moneyMayMove = state !== 'quoted';
  const request = isObject(record.request) ? record.request : null;
  if (!request) issues.push('request');
  else {
    if (request.destination?.chainId !== AURORA_MAINNET) issues.push('NETWORK_MISMATCH');
    if (lower(request.safe) !== config.destination.safe) issues.push('SAFE_MISMATCH');
    if (lower(request.destination?.token) !== config.destination.token) issues.push('TOKEN_MISMATCH');
    if (!request.manager || lower(request.refundRecipient) !== lower(request.manager)
      || lower(request.manager) !== config.manager || lower(request.refundRecipient) !== config.refundRecipient) issues.push('REFUND_MISMATCH');
    if (typeof request.routeId !== 'string' || !config.routes.some((route) => route.routeId === request.routeId)) issues.push('ROUTE_UNKNOWN');
  }
  const observedTimes = [record.updatedAt, record.observation?.observedAt].filter(isTime);
  const lastObservedAt = observedTimes.length ? Math.max(...observedTimes) : null;
  const ownMaxAge = record.route?.maxObservationAgeSeconds;
  const maxAge = Number.isSafeInteger(ownMaxAge) && ownMaxAge > 0 ? ownMaxAge : 300;
  const staleObservation = !TERMINAL.has(state) && lastObservedAt !== null && now - lastObservedAt > maxAge;
  // Settled records are not polled, so an old fetch time does not make them stale.
  const staleConnection = !TERMINAL.has(state) && now - receivedAt > 30;
  const common = { ...base, evidence, lastObservedAt, stale: staleObservation || staleConnection, issues };
  if (staleConnection) common.warnings.push('The dashboard has not received an update recently. Showing the last confirmed snapshot.');
  else if (staleObservation) common.warnings.push('The latest observation is older than this route allows. Treat the status as stale.');

  if (record.integrity === 'invalid' || issues.length) {
    return { ...common, bucket: 'unavailable', tone: 'danger', title: 'Funding information failed validation', doNotPayAgain: moneyMayMove,
      detail: 'Some fields were missing, malformed or did not match the configured Safe, asset and network. Nothing here is shown as verified.' };
  }
  const amount = (raw, decimals) => formatUnits(raw, decimals) ?? 'an unavailable amount';
  const sourceDecimals = request.source?.decimals; const destinationDecimals = request.destination?.decimals;
  switch (state) {
    case 'quoted': {
      if (isTime(record.quote?.expiresAt) && now >= record.quote.expiresAt) {
        return { ...common, bucket: 'needs-review', tone: 'warning', title: 'Quote expired before sending', halted: true, step: 1,
          detail: 'Do not send to this quote’s deposit address. An expired, unsent record stays open for explicit review instead of being reused.' };
      }
      return { ...common, bucket: 'awaiting-manager', tone: 'neutral', title: 'Awaiting manager action', step: 1,
        detail: `Executable quote recorded. The manager would send exactly ${amount(request.amountIn, sourceDecimals)} from their wallet before expiry. Sending is disabled in this build.` };
    }
    case 'dispatching':
      return { ...common, bucket: 'submitted', tone: 'progress', title: 'Send reserved · hash not recorded', step: 2, doNotPayAgain: true,
        detail: 'A wallet send was reserved. It may already be broadcast, so a second payment must never be made from this screen.' };
    case 'pending': {
      if (!isTxHash(record.submission?.txHash)) return { ...common, bucket: 'needs-review', tone: 'warning', title: 'Pending without a source transaction', doNotPayAgain: true, step: 2, detail: 'The record is pending but has no recorded source transaction. Needs operator review.' };
      const status = record.observation?.status ?? null;
      if (status === 'SUCCESS') {
        return { ...common, bucket: 'provider-success', tone: 'progress', title: 'Provider reports success · not yet verified', step: 3, doNotPayAgain: true,
          detail: 'NEAR Intents reports SUCCESS. That alone is not delivery: the Aurora receipt, recipient, amount and confirmations must still be verified.' };
      }
      const step = status === 'PROCESSING' ? 3 : 2;
      if (status === 'INCOMPLETE_DEPOSIT') common.warnings.push('The provider reports an incomplete deposit. Do not top up from this screen; an operator must review.');
      return { ...common, bucket: 'submitted', tone: 'progress', title: status === 'PROCESSING' ? 'Submitted · provider processing' : 'Submitted · waiting for the provider', step, doNotPayAgain: true,
        detail: 'The source transaction is recorded. Delivery is only shown after a verified Aurora receipt.' };
    }
    case 'delivered': {
      const failures = evidenceFailures('delivery', record, config);
      if (failures.length) return { ...common, issues: failures, bucket: 'needs-review', tone: 'danger', title: 'Delivery reported · evidence inconsistent', doNotPayAgain: true, step: 3, halted: true,
        detail: 'The record says delivered, but its receipt evidence is incomplete or does not match this Safe, asset or quote. It is not shown as verified.' };
      const verified = trustworthy && record.delivery.evidenceQuality === 'live-verified';
      return { ...common, bucket: 'delivered', tone: 'success', verified, step: 4, doNotPayAgain: true,
        title: verified ? 'Delivery verified' : 'Delivery evidence complete · fixture',
        detail: `${amount(record.delivery.amount, destinationDecimals)} reached the Safe on Aurora mainnet with ${record.delivery.confirmations} confirmations.${verified ? '' : ' This is fixture data, not live evidence.'}` };
    }
    case 'refunded': {
      const failures = evidenceFailures('refund', record, config);
      if (failures.length) return { ...common, issues: failures, bucket: 'needs-review', tone: 'danger', title: 'Refund reported · evidence inconsistent', doNotPayAgain: true, halted: true, step: 2,
        detail: 'The record says refunded, but the refund receipt is incomplete or inconsistent. It is not shown as refunded.' };
      const full = record.refund.amount === request.amountIn;
      const verified = trustworthy && record.refund.evidenceQuality === 'live-verified';
      return { ...common, bucket: full ? 'refunded' : 'refund-partial', tone: full ? 'neutral' : 'warning', verified, doNotPayAgain: true, halted: true, step: 2,
        title: full ? (verified ? 'Full refund verified' : 'Full refund evidence · fixture') : 'Partial refund recorded',
        detail: `${amount(record.refund.amount, sourceDecimals)} of ${amount(request.amountIn, sourceDecimals)} returned to the manager wallet on ${networkName(request.source?.chainId)}.` };
    }
    case 'needs_review': {
      const reason = record.reviewReason;
      const status = record.observation?.status ?? null;
      if (reason === 'PARTIAL_REFUND' && record.refund) {
        const failures = evidenceFailures('refund', record, config);
        if (!failures.length) {
          const verified = trustworthy && record.refund.evidenceQuality === 'live-verified';
          const shortfall = isIntegerString(request.amountIn) ? (BigInt(request.amountIn) - BigInt(record.refund.amount)).toString() : null;
          return { ...common, bucket: 'refund-partial', tone: 'warning', verified, doNotPayAgain: true, halted: true, step: 2,
            title: verified ? 'Partial refund verified' : 'Partial refund evidence · fixture',
            detail: `Only ${amount(record.refund.amount, sourceDecimals)} of ${amount(request.amountIn, sourceDecimals)} came back${shortfall ? ` (${amount(shortfall, sourceDecimals)} short)` : ''}. ${REVIEW_REASONS.PARTIAL_REFUND}` };
        }
        return { ...common, issues: failures, bucket: 'needs-review', tone: 'danger', title: 'Refund evidence inconsistent', doNotPayAgain: true, halted: true, step: 2, detail: reviewReasonText(reason) };
      }
      if (reason === 'RECEIPT_VERIFICATION_REQUIRED' && status === 'REFUNDED') {
        return { ...common, bucket: 'refund-pending', tone: 'warning', title: 'Refund reported · not yet verified', doNotPayAgain: true, halted: true, step: 2,
          detail: 'The provider says the deposit is being refunded. Funds are not shown as returned until a refund receipt to the manager wallet is verified.' };
      }
      if (reason === 'RECEIPT_VERIFICATION_REQUIRED' && status === 'FAILED') {
        return { ...common, bucket: 'failed', tone: 'danger', title: 'Provider reports failure · not a refund', doNotPayAgain: true, halted: true, step: 2,
          detail: 'FAILED does not mean refunded. Funds may still be held by the provider until a refund receipt is verified.' };
      }
      return { ...common, bucket: 'needs-review', tone: reason === 'BROADCAST_UNKNOWN' || reason === 'CONFLICTING_SUBMISSION' ? 'danger' : 'warning', doNotPayAgain: true, halted: true, step: 2,
        title: reason === 'BROADCAST_UNKNOWN' ? 'Broadcast unknown · do not pay again' : 'Needs review', detail: reviewReasonText(reason) };
    }
    default:
      return { ...common, bucket: 'unavailable', tone: 'muted', title: 'Funding status unavailable', doNotPayAgain: true,
        detail: 'The record has an unknown or missing state. It is not treated as success, failure or cancellation.' };
  }
}

export const BUCKET_LABELS = Object.freeze({
  'awaiting-manager': 'Awaiting manager', submitted: 'Submitted · pending', 'provider-success': 'Provider success · unverified',
  delivered: 'Delivered', 'refund-pending': 'Refund pending', refunded: 'Refunded', 'refund-partial': 'Partial refund',
  failed: 'Failed', 'needs-review': 'Needs review', unavailable: 'Unavailable',
});

// ---------------------------------------------------------------- funding lanes

// Three separate funding lanes. Networks, tokens and evidence from one lane are never shown in another.
export const LANE_ORDER = Object.freeze(['official', 'tidepool', 'fixtures']);
export const FUNDING_LANES = Object.freeze({
  official: Object.freeze({ id: 'official', kind: 'official', title: 'Official 1Click', provider: 'NEAR Intents 1Click', chainId: AURORA_MAINNET, network: 'Aurora mainnet', assets: 'Real assets · dry quotes only' }),
  tidepool: Object.freeze({ id: 'tidepool', kind: 'community', title: 'Tidepool testnet demo', provider: 'Community testnet relayer (not official NEAR Intents)', chainId: AURORA_TESTNET, network: 'Aurora testnet', assets: 'Worthless test assets' }),
  fixtures: Object.freeze({ id: 'fixtures', kind: 'fixture', title: 'Labelled fixtures', provider: 'Synthetic, in-browser', chainId: null, network: 'No network', assets: 'Fake values' }),
});

export function laneFromSearch(search) {
  const params = new URLSearchParams(typeof search === 'string' ? search : '');
  if (params.get('fixtures') === '1' || params.get('lane') === 'fixtures') return 'fixtures';
  if (params.get('lane') === 'tidepool') return 'tidepool';
  return 'official';
}

// Tidepool is shown as a completed community-testnet demonstration from saved evidence, whatever any server reports.
// It is history, not a live route: no quote, deposit or send exists for it, and it never feeds mainnet readiness.
export function laneStatus(id, { source = null, phase = null, config = null } = {}) {
  if (id === 'tidepool') return { tone: 'neutral', label: 'Testnet demo · history', detail: 'A completed Tidepool testnet transfer and strategy round, shown from saved evidence. No live route; sending is disabled.' };
  if (id === 'fixtures') return { tone: 'fixture', label: 'Synthetic', detail: 'Every funding state with fake values. Never live evidence.' };
  if (id !== 'official') return { tone: 'muted', label: 'Unknown', detail: 'Unknown funding lane.' };
  if (source !== 'api') return { tone: 'muted', label: 'Not connected', detail: 'Select to connect to the local funding API.' };
  if (phase === 'connecting') return { tone: 'neutral', label: 'Checking', detail: 'Checking the local funding API.' };
  if (phase === 'unavailable') return { tone: 'muted', label: 'API offline', detail: 'The local funding API is not available.' };
  if (phase !== 'ready' || !config) return { tone: 'danger', label: 'Rejected', detail: 'The funding configuration was rejected.' };
  if (config.evidence !== 'live') return { tone: 'fixture', label: 'Fixture config', detail: 'The API reports fixture-quality configuration.' };
  if (config.capabilities.preview) return { tone: 'live', label: 'Live dry quotes', detail: 'Signed 1Click dry quotes for the trusted Safe. Sending is disabled.' };
  if (config.capabilities.records) return { tone: 'live', label: 'Service records', detail: 'Funding service records. Sending is disabled.' };
  return { tone: 'neutral', label: 'Read-only', detail: 'Configuration only.' };
}

// Three separate facts for the completed Tidepool demonstration. A minted wallet balance is never shown as delivery, and
// delivery is never shown as strategy readiness: the round is its own saved record. Without validated evidence every
// step is unavailable rather than assumed.
export function tidepoolLadder(demo = null) {
  const saved = demo && demo.evidence === 'saved-independently-verified' && demo.official1Click === false;
  return [
    { id: 'minted', title: 'Minted test USDC', detail: 'Tidepool minted test USDC to wallets. A wallet balance is not a bridge delivery.', owner: 'Tidepool', state: 'not-tracked', label: 'Not tracked here' },
    { id: 'delivered', title: 'Bridge delivery', detail: saved ? 'Arbitrum Sepolia to the Aurora testnet Safe, proven by linked canonical receipts.' : 'No validated delivery evidence.', owner: 'Saved evidence', state: saved ? 'saved-verified' : 'unavailable', label: saved ? 'Verified when recorded' : 'Unavailable' },
    { id: 'round', title: 'Strategy round', detail: saved ? 'The same Safe and capital ran a separate strategy round, which settled.' : 'No validated round evidence.', owner: 'Saved evidence', state: saved ? 'saved-settled' : 'unavailable', label: saved ? 'Settled' : 'Unavailable' },
  ];
}

// ---------------------------------------------------------------- delivered ≠ strategy ready

// What the receipts say about the funds, independent of whether a strategy may use them.
export function deliverySummary(display) {
  if (!display) return { state: 'none', tone: 'muted', label: 'No funding record', detail: 'Nothing has been sent from this dashboard.' };
  switch (display.bucket) {
    case 'delivered': return display.verified
      ? { state: 'verified', tone: 'success', label: 'Delivered · verified', detail: 'A bound, final receipt shows the funds in the Safe.' }
      : { state: 'fixture', tone: 'fixture', label: 'Delivered · fixture', detail: 'Complete receipt evidence, but fixture data, not live.' };
    case 'submitted':
    case 'provider-success': return { state: 'in-transit', tone: 'progress', label: 'In transit', detail: 'No verified receipt yet. Provider status alone is not delivery.' };
    case 'awaiting-manager': return { state: 'not-sent', tone: 'neutral', label: 'Not sent', detail: 'The manager has not sent funds.' };
    case 'refunded':
    case 'refund-partial':
    case 'refund-pending': return { state: 'refund', tone: 'warning', label: 'Not delivered · refund path', detail: 'Funds are on the refund path, not in the Safe.' };
    default: return { state: 'unconfirmed', tone: 'danger', label: 'Not confirmed', detail: 'Delivery cannot be confirmed from this record.' };
  }
}

export const READINESS_FAILURES = Object.freeze({
  STRATEGY_UNKNOWN: 'No strategy deployment identity is configured.',
  DELIVERY_NETWORK_NOT_STRATEGY_NETWORK: 'Funds were delivered on a different network from the strategy deployment.',
  DELIVERY_SAFE_NOT_STRATEGY_SAFE: 'Funds reached a different Safe from the strategy Safe.',
  DELIVERED_TOKEN_NOT_STRATEGY_TOKEN: 'The delivered token is not the strategy’s stable token.',
  READINESS_NETWORK_MISMATCH: 'The service readiness names a different network.',
  READINESS_SAFE_MISMATCH: 'The service readiness names a different Safe.',
  READINESS_TIME_MISSING: 'The service readiness has no consumption time.',
  READINESS_SNAPSHOT_MISSING: 'The service readiness has no deployment snapshot.',
  SNAPSHOT_TOKEN_NOT_STRATEGY_TOKEN: 'The readiness snapshot checked a different stable token.',
  DEPLOYMENT_NOT_COMPATIBLE: 'The readiness snapshot does not report a compatible deployment.',
  ROUND_BUSY: 'A round is active or an authorization is pending.',
  PREREQUISITES_INCOMPLETE: 'Round prerequisites in the trusted configuration are not all met.',
});

// "Ready to run strategy" is never derived from delivery. It needs Developer A's FundingRecordV1.readiness
// (written once by prepareRound) bound to the configured strategy network, Safe and stable token, plus a
// verified live delivery of that same token to that same Safe. Another token reaching the Safe is never enough.
export function strategyReadiness(record, display, config) {
  const result = (state, tone, label, detail, failures = []) => ({ state, tone, label, detail, failures, ready: state === 'ready' });
  const strategy = config?.strategy ?? null;
  if (!strategy) return result('unknown', 'muted', 'Strategy not configured', 'No strategy deployment identity is configured, so readiness is never shown.', ['STRATEGY_UNKNOWN']);
  const view = isObject(record) ? record : null;
  if (!view || !display || display.bucket !== 'delivered') {
    return result('not-delivered', 'muted', 'Not ready', 'Funds must first be delivered, then confirmed ready by the funding service.');
  }
  const failures = [];
  const delivery = isObject(view.delivery) ? view.delivery : {};
  if (delivery.chainId !== strategy.chainId) failures.push('DELIVERY_NETWORK_NOT_STRATEGY_NETWORK');
  if (lower(delivery.recipient) !== strategy.safe) failures.push('DELIVERY_SAFE_NOT_STRATEGY_SAFE');
  if (lower(delivery.token) !== strategy.token) failures.push('DELIVERED_TOKEN_NOT_STRATEGY_TOKEN');
  const readiness = isObject(view.readiness) ? view.readiness : null;
  if (!readiness) {
    if (failures.length) return result('blocked', 'danger', 'Not usable by the strategy', `${READINESS_FAILURES[failures[0]]} Delivery alone never makes a Safe ready.`, failures);
    return result('awaiting-service', 'warning', 'Awaiting funding service', 'Funds arrived. Only the funding service can confirm readiness, after re-checking the Safe, token and balances.');
  }
  if (readiness.chainId !== strategy.chainId) failures.push('READINESS_NETWORK_MISMATCH');
  if (lower(readiness.safe) !== strategy.safe) failures.push('READINESS_SAFE_MISMATCH');
  if (!isTime(readiness.consumedAt)) failures.push('READINESS_TIME_MISSING');
  const snapshot = isObject(readiness.snapshot) ? readiness.snapshot : null;
  if (!snapshot) failures.push('READINESS_SNAPSHOT_MISSING');
  else {
    if (snapshot.chainId !== strategy.chainId) failures.push('READINESS_NETWORK_MISMATCH');
    if (lower(snapshot.safe) !== strategy.safe) failures.push('READINESS_SAFE_MISMATCH');
    if (lower(snapshot.stableToken) !== strategy.token) failures.push('SNAPSHOT_TOKEN_NOT_STRATEGY_TOKEN');
    if (snapshot.compatible !== true) failures.push('DEPLOYMENT_NOT_COMPATIBLE');
    if (snapshot.activeRound !== false || snapshot.pendingAuthorization !== false) failures.push('ROUND_BUSY');
  }
  if (!roundEligibility(config).eligible) failures.push('PREREQUISITES_INCOMPLETE');
  if (failures.length) {
    return result('rejected', 'danger', 'Readiness rejected', 'The funding service reported readiness, but it does not match the strategy deployment, so it is not shown as ready.', [...new Set(failures)]);
  }
  if (!display.verified) return result('fixture', 'fixture', 'Readiness evidence · fixture', 'Readiness evidence is complete, but it is fixture data. A fixture is never ready to run a strategy.');
  return result('ready', 'success', 'Ready to run strategy', 'Verified delivery of the strategy token to the strategy Safe, and the funding service confirmed readiness for this Safe.');
}
