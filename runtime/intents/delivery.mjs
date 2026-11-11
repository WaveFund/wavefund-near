import { createQuoteSignatureVerifier } from './signature.mjs';
import { AURORA_MAINNET_CHAIN_ID, VERIFIED_FUNDING_ROUTES } from './routes.mjs';
import { isObject, sameAddress } from './client.mjs';

// Funding delivery assessment: stored execution quote + provider status + caller-supplied EVM receipts.
// It performs no network I/O. Receipts are read by the coordinator from chain RPCs it trusts.
// Result evidence is NEVER a trustless cross-chain proof: 1Click links the two legs; chains only confirm each leg.
export const OUTCOMES = Object.freeze(['pending', 'delivered', 'refunded', 'failed', 'ambiguous']);
export const EVIDENCE_QUALITY = Object.freeze([
  'none',                                  // nothing usable
  'provider-claim-only',                   // signed-quote-bound 1Click status, no matching chain receipt
  'provider-linked-one-leg',               // provider status plus one provider-linked, verified chain receipt
  'provider-linked-both-legs',             // provider status plus verified, provider-linked source AND outcome receipts
]);
export const ERC20_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
export const DEFAULT_MIN_CONFIRMATIONS = Object.freeze({ 1: 12, [AURORA_MAINNET_CHAIN_ID]: 1 });
const HASH = /^0x[0-9a-fA-F]{64}$/;
const TOPIC = /^0x[0-9a-fA-F]{64}$/;
const DATA = /^0x[0-9a-fA-F]*$/;

function decodeTransfers(receipt) {
  const transfers = [];
  for (const log of receipt.logs) {
    if (!isObject(log) || !Array.isArray(log.topics) || typeof log.address !== 'string' || typeof log.data !== 'string') throw new Error('malformed log');
    if (log.topics[0]?.toLowerCase() !== ERC20_TRANSFER_TOPIC) continue;
    if (log.topics.length !== 3 || !log.topics.every((t) => TOPIC.test(t)) || !DATA.test(log.data) || log.data.length !== 66) throw new Error('malformed Transfer log');
    transfers.push({ token: log.address.toLowerCase(), from: `0x${log.topics[1].slice(26)}`.toLowerCase(), to: `0x${log.topics[2].slice(26)}`.toLowerCase(), value: BigInt(log.data) });
  }
  return transfers;
}

// observation: { txHash, chainId, confirmations, receipt } as returned by eth_getTransactionReceipt plus reader metadata.
function readObservation(observation, { label, expectedChainId, token, to, from = null, minConfirmations, linkedHashes }) {
  const base = { label, txHash: observation?.txHash ?? null, linked: false, amount: 0n, usable: false, issues: [] };
  if (!isObject(observation) || typeof observation.txHash !== 'string' || !HASH.test(observation.txHash)) return { ...base, issues: ['malformed observation'] };
  const r = observation.receipt;
  if (!isObject(r) || typeof r.transactionHash !== 'string' || r.transactionHash.toLowerCase() !== observation.txHash.toLowerCase() || !Array.isArray(r.logs)) return { ...base, issues: ['receipt missing or for another transaction'] };
  base.linked = linkedHashes.has(observation.txHash.toLowerCase());
  if (observation.chainId !== expectedChainId) return { ...base, issues: [`wrong network: chain ${observation.chainId}, expected ${expectedChainId}`] };
  if (r.status !== '0x1') return { ...base, issues: ['transaction reverted or status unknown'] };
  let transfers;
  try { transfers = decodeTransfers(r); } catch (error) { return { ...base, issues: [error.message] }; }
  const relevant = transfers.filter((t) => t.to === to.toLowerCase());
  const tokenMatches = relevant.filter((t) => t.token === token.toLowerCase());
  if (relevant.length && !tokenMatches.length) return { ...base, issues: ['transfer to the expected recipient used the wrong token'] };
  const matching = from ? tokenMatches.filter((t) => t.from === from.toLowerCase()) : tokenMatches;
  if (tokenMatches.length && !matching.length) return { ...base, issues: ['transfer was not sent by the expected manager address'] };
  if (!matching.length) return { ...base, issues: ['no matching ERC-20 transfer to the expected recipient (unrelated transaction)'] };
  const amount = matching.reduce((sum, t) => sum + t.value, 0n);
  const confirmed = Number.isSafeInteger(observation.confirmations) && observation.confirmations >= minConfirmations;
  return { ...base, amount, usable: true, confirmed, issues: confirmed ? [] : [`only ${observation.confirmations} confirmations, need ${minConfirmations}`] };
}

export function verifyFundingDelivery({
  quote, status = null, statusError = null,
  sourceReceipts = [], destinationReceipts = [], refundReceipts = [],
  verifySignature = createQuoteSignatureVerifier(), minConfirmations = DEFAULT_MIN_CONFIRMATIONS,
  expectedSender = null, // when set, a source deposit counts only if the ERC-20 Transfer is from this address (the manager)
} = {}) {
  const checks = []; const reasons = [];
  const check = (name, ok, detail = null) => { checks.push({ name, result: ok ? 'pass' : 'fail', detail }); return ok; };
  const result = (outcome, evidenceQuality, extra = {}) => Object.freeze({
    outcome, evidenceQuality, trustless: false,
    note: 'Provider linkage plus chain receipts is not a trustless cross-chain proof.',
    providerStatus: status?.status ?? null, checks: Object.freeze(checks), reasons: Object.freeze(reasons), ...extra,
  });

  // 1. Stored request integrity: the normalized quote must still match its own signed provider payload.
  const payload = quote?.providerPayload;
  const route = VERIFIED_FUNDING_ROUTES.find((r) => r.id === quote?.funding?.routeId);
  const intact = isObject(quote) && quote.kind === 'EXECUTION_QUOTE' && quote.purpose === 'funding' && isObject(payload) && route
    && check('stored quote signature', verifySignature(payload)?.valid === true)
    && check('deposit address linkage', sameAddress(payload.quote?.depositAddress, quote.deposit?.address))
    && check('amount linkage', payload.quote?.amountIn === quote.amounts?.amountIn && payload.quoteRequest?.amount === quote.amounts?.amountIn)
    && check('recipient linkage', sameAddress(payload.quoteRequest?.virtualChainRecipient, quote.funding?.safeAddress) && payload.quoteRequest?.recipient === route.destination.virtualChainAccount)
    && check('refund linkage', sameAddress(payload.quoteRequest?.refundTo, quote.funding?.refundAddress))
    && check('route linkage', payload.quoteRequest?.originAsset === route.source.assetId && payload.quoteRequest?.destinationAsset === route.destination.assetId);
  if (!intact) {
    if (!checks.some((c) => c.result === 'fail')) check('stored execution quote', false, 'not a verified funding EXECUTION_QUOTE');
    reasons.push('Stored request cannot be trusted; no outcome is inferred');
    return result('ambiguous', 'none');
  }
  const minOut = BigInt(quote.amounts.minAmountOut); const amountIn = BigInt(quote.amounts.amountIn);

  // 2. Provider status must exist and be bound to this exact signed quote. Failures never imply a refund.
  if (statusError || !status) {
    check('provider status available', false, statusError?.code ?? 'no status supplied');
    reasons.push('Provider status unavailable (timeout/API failure); not treated as refunded, failed or delivered');
    return result('ambiguous', 'none');
  }
  const bound = status.kind === 'EXECUTION_STATUS' && status.quoteSignatureVerified === true && sameAddress(status.deposit?.address, quote.deposit.address)
    && status.providerPayload?.quoteResponse?.signature === payload.signature;
  if (!check('status bound to stored quote', bound)) { reasons.push('Status does not belong to this funding quote'); return result('ambiguous', 'none'); }

  const providerHashes = (list) => new Set((list ?? []).map((t) => t.hash.toLowerCase()));
  const originHashes = providerHashes(status.swap.originChainTxs);
  const destinationHashes = providerHashes(status.swap.destinationChainTxs);
  const allHashes = new Set([...originHashes, ...destinationHashes]);
  const confirmationsFor = (chainId) => minConfirmations[chainId] ?? Number.POSITIVE_INFINITY;

  const src = sourceReceipts.map((o) => readObservation(o, { label: 'source deposit', expectedChainId: route.source.chainId, token: route.source.tokenAddress, to: quote.deposit.address, from: expectedSender, minConfirmations: confirmationsFor(route.source.chainId), linkedHashes: originHashes }));
  const dst = destinationReceipts.map((o) => readObservation(o, { label: 'destination delivery', expectedChainId: route.destination.chainId, token: route.destination.tokenAddress, to: quote.funding.safeAddress, minConfirmations: confirmationsFor(route.destination.chainId), linkedHashes: destinationHashes }));
  const ref = refundReceipts.map((o) => readObservation(o, { label: 'refund', expectedChainId: route.source.chainId, token: route.source.tokenAddress, to: quote.funding.refundAddress, minConfirmations: confirmationsFor(route.source.chainId), linkedHashes: allHashes }));
  for (const o of [...src, ...dst, ...ref]) check(`${o.label} ${o.txHash ?? '(invalid)'}`, o.usable && o.linked && o.confirmed, [...o.issues, ...(o.usable && !o.linked ? ['not linked by provider status; not counted'] : [])].join('; ') || null);
  const counted = (list) => list.filter((o) => o.usable && o.linked && o.confirmed);
  const contradicts = (list) => list.some((o) => o.linked && !o.usable); // provider-linked tx that does not show the expected transfer
  const sumOf = (list) => counted(list).reduce((s, o) => s + o.amount, 0n);
  const srcOk = counted(src); const dstOk = counted(dst); const refOk = counted(ref);
  const deposited = srcOk.length ? sumOf(src) : (status.swap.depositedAmount !== null ? BigInt(status.swap.depositedAmount) : null);
  const amounts = (extra = {}) => ({ requestedIn: quote.amounts.amountIn, minAmountOut: quote.amounts.minAmountOut,
    deposited: deposited === null ? null : deposited.toString(), depositedSource: srcOk.length ? 'source-receipt' : (deposited === null ? null : 'provider'), ...extra });
  if (src.some((o) => o.usable && o.linked && o.confirmed) && sumOf(src) < amountIn) reasons.push(`Source deposit ${sumOf(src)} is below the quoted input ${amountIn} (partial deposit)`);
  if (contradicts(src) || contradicts(dst) || contradicts(ref)) {
    reasons.push('A provider-linked transaction does not show the expected transfer (wrong token, network, recipient or reverted)');
    return result('ambiguous', 'provider-claim-only', { amounts: amounts() });
  }

  const s = status.status;
  if (['PENDING_DEPOSIT', 'KNOWN_DEPOSIT_TX', 'INCOMPLETE_DEPOSIT', 'PROCESSING'].includes(s)) {
    if (refOk.length) { reasons.push('Provider says in progress but a linked refund transfer exists'); return result('ambiguous', 'provider-linked-one-leg', { amounts: amounts() }); }
    reasons.push(`Provider status ${s}; delivery not complete`);
    return result('pending', srcOk.length ? 'provider-linked-one-leg' : 'provider-claim-only', { amounts: amounts() });
  }
  if (s === 'SUCCESS') {
    if (refOk.length) { reasons.push('Provider reports SUCCESS but a linked refund transfer exists (conflicting observations)'); return result('ambiguous', 'provider-linked-one-leg', { amounts: amounts() }); }
    const reported = status.swap.amountOut === null ? null : BigInt(status.swap.amountOut);
    if (!dstOk.length) {
      reasons.push('Provider reports SUCCESS; no confirmed, provider-linked Aurora receipt to the Safe yet');
      return result('pending', srcOk.length ? 'provider-linked-one-leg' : 'provider-claim-only', { amounts: amounts({ providerReportedOut: reported?.toString() ?? null }) });
    }
    const delivered = sumOf(dst);
    if (delivered < minOut || (reported !== null && delivered !== reported)) {
      check('delivered amount', false, `delivered ${delivered}, provider reported ${reported}, minimum ${minOut}`);
      reasons.push('Delivered amount conflicts with the provider report or is below the signed minimum');
      return result('ambiguous', 'provider-linked-one-leg', { amounts: amounts({ delivered: delivered.toString(), providerReportedOut: reported?.toString() ?? null }) });
    }
    check('delivered amount', true, `delivered ${delivered} >= minimum ${minOut}`);
    return result('delivered', srcOk.length ? 'provider-linked-both-legs' : 'provider-linked-one-leg', { amounts: amounts({ delivered: delivered.toString(), providerReportedOut: reported?.toString() ?? null }) });
  }
  if (s === 'REFUNDED') {
    if (dstOk.length) { reasons.push('Provider reports REFUNDED but a linked delivery to the Safe exists (conflicting observations)'); return result('ambiguous', 'provider-linked-one-leg', { amounts: amounts() }); }
    const reportedRefund = status.swap.refundedAmount === null ? null : BigInt(status.swap.refundedAmount);
    if (reportedRefund === null) { reasons.push('Provider reports REFUNDED without a refunded amount'); return result('ambiguous', 'provider-claim-only', { amounts: amounts() }); }
    const shortfall = deposited === null ? null : (deposited - reportedRefund).toString();
    const refundAmounts = amounts({ refunded: reportedRefund.toString(), refundShortfall: shortfall, refundReason: status.swap.refundReason, quotedRefundFee: quote.fees.refundFee });
    if (refOk.length) {
      const observed = sumOf(ref);
      if (observed !== reportedRefund) { check('refund amount', false, `observed ${observed}, provider reported ${reportedRefund}`); reasons.push('Observed refund differs from the provider-reported refund'); return result('ambiguous', 'provider-linked-one-leg', { amounts: refundAmounts }); }
      check('refund amount', true, `observed ${observed} equals provider report`);
      refundAmounts.observedRefund = observed.toString();
    }
    if (shortfall !== null && BigInt(shortfall) > 0n) reasons.push(`Refund returned ${reportedRefund} of ${deposited} deposited; ${shortfall} was not returned`);
    const quality = refOk.length ? (srcOk.length ? 'provider-linked-both-legs' : 'provider-linked-one-leg') : (srcOk.length ? 'provider-linked-one-leg' : 'provider-claim-only');
    return result('refunded', quality, { amounts: refundAmounts });
  }
  // FAILED: the provider gives no fund location. Never inferred as refunded.
  reasons.push('Provider reports FAILED; fund location is not established by this status');
  if (refOk.length) reasons.push(`A linked refund transfer of ${sumOf(ref)} was observed`);
  return result('failed', refOk.length || srcOk.length ? 'provider-linked-one-leg' : 'provider-claim-only', { amounts: amounts(refOk.length ? { refundObserved: sumOf(ref).toString() } : {}) });
}
