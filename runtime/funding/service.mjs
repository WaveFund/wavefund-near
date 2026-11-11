import { randomUUID } from 'node:crypto';
import { address, amount, clone, configuration, exact, fundingHash, fundingRequest, identifier, requireFunding as check, timestamp, txHash, unresolved } from './schema.mjs';

// Adapters are trusted server-side capabilities, never HTTP request parameters.
// None of these methods signs, sends, retries, or accepts provider SUCCESS as delivery.
export function createFundingService({ config: input, store, readSnapshot, verifyQuote, verifyDelivery, verifyRefund, clock = () => Math.floor(Date.now() / 1000) }) {
  const config = configuration(input);
  check(store?.transaction && store?.read && typeof readSnapshot === 'function', 'MISSING_FUNDING_CAPABILITY');
  function now() { return timestamp(clock()); }
  function routeFor(record) {
    check(record?.schemaVersion === 1 && record.configurationHash === config.configurationHash, 'CONFIGURATION_CHANGED');
    const request = fundingRequest(record.request, config, record.createdAt);
    check(fundingHash(request) === record.requestHash, 'RECORD_CHANGED');
    const route = config.routes.find(r => r.routeId === request.routeId);
    check(record.quoteHash === fundingHash(record.quote) && record.quote.requestHash === record.requestHash, 'RECORD_CHANGED');
    return route;
  }
  function get(id) { identifier(id); const record = store.read().records[id]; check(record, 'FUNDING_NOT_FOUND'); routeFor(record); return clone(record); }
  async function snapshot(route) {
    const value = clone(await readSnapshot(clone(route)));
    exact(value, ['chainId', 'safe', 'stableToken', 'assetToken', 'stableBalance', 'assetBalance', 'activeRound', 'pendingAuthorization', 'observedAt', 'blockNumber', 'blockHash', 'compatible']);
    check(value.compatible === true && value.chainId === route.destination.chainId && address(value.safe) === route.safe
      && address(value.stableToken) === route.destination.token, 'DEPLOYMENT_MISMATCH');
    address(value.assetToken); amount(value.stableBalance, true); amount(value.assetBalance, true); amount(value.blockNumber, true); txHash(value.blockHash);
    check(typeof value.activeRound === 'boolean' && typeof value.pendingAuthorization === 'boolean', 'INVALID_SNAPSHOT');
    check(!value.activeRound && !value.pendingAuthorization, 'ROUND_ACTIVE');
    check(timestamp(value.observedAt) <= now() && now() - value.observedAt <= route.maxObservationAgeSeconds, 'STALE_SNAPSHOT');
    return value;
  }
  function update(id, revision, mutate) {
    return store.transaction(data => {
      const record = data.records[id]; routeFor(record);
      check(record.revision === revision, 'CONCURRENT_UPDATE'); mutate(record);
      record.revision++; record.updatedAt = now(); return record;
    });
  }
  function review(id, revision, reason) {
    return update(id, revision, record => { record.state = 'needs_review'; record.reviewReason = reason; });
  }
  function sameBalances(a, b) {
    return a.chainId === b.chainId && address(a.safe) === address(b.safe) && address(a.stableToken) === address(b.stableToken)
      && address(a.assetToken) === address(b.assetToken) && a.stableBalance === b.stableBalance && a.assetBalance === b.assetBalance;
  }
  return {
    getConfiguration: () => clone(config),
    get,
    list: () => Object.keys(store.read().records).map(get),
    async createQuoted(requestInput, providerQuote) {
      const createdAt = now(); const request = fundingRequest(requestInput, config, createdAt);
      check(typeof verifyQuote === 'function', 'QUOTE_VERIFIER_UNAVAILABLE');
      const route = config.routes.find(r => r.routeId === request.routeId);
      const quote = clone(await verifyQuote(clone(providerQuote), clone(request)));
      exact(quote, ['requestHash', 'reference', 'depositAddress', 'amountIn', 'minAmountOut', 'expiresAt', 'evidenceQuality']);
      check(quote.requestHash === fundingHash(request), 'QUOTE_BINDING_MISMATCH');
      identifier(quote.reference); quote.depositAddress = address(quote.depositAddress); amount(quote.amountIn); amount(quote.minAmountOut);
      check(quote.amountIn === request.amountIn && BigInt(quote.minAmountOut) >= BigInt(request.minAmountOut), 'QUOTE_AMOUNT_MISMATCH');
      check(quote.evidenceQuality === 'live-verified' || quote.evidenceQuality === 'fixture', 'INVALID_EVIDENCE_QUALITY');
      check(timestamp(quote.expiresAt) <= request.expiresAt && quote.expiresAt > now(), 'QUOTE_EXPIRED');
      const before = await snapshot(route);
      check(now() < quote.expiresAt, 'QUOTE_EXPIRED');
      return store.transaction(data => {
        check(!Object.hasOwn(data.records, request.fundingId), 'DUPLICATE_FUNDING_ID');
        check(!Object.values(data.records).some(r => unresolved(r) && r.request.destination.chainId === route.destination.chainId && address(r.request.safe) === route.safe), 'SAFE_FUNDING_UNRESOLVED');
        const record = { schemaVersion: 1, fundingId: request.fundingId, configurationHash: config.configurationHash,
          request, requestHash: fundingHash(request), quote, quoteHash: fundingHash(quote), before,
          state: 'quoted', revision: 0, createdAt, updatedAt: now(), submission: null, observation: null,
          delivery: null, refund: null, readiness: null, reviewReason: null };
        data.records[request.fundingId] = record; return record;
      });
    },
    // MUST complete durably before presenting a send action to a wallet. No automatic
    // release: a lost browser response may already have caused a broadcast.
    async reserveSubmission(id) {
      const record = get(id); check(record.state === 'quoted', 'SUBMISSION_NOT_ALLOWED');
      const current = await snapshot(routeFor(record));
      check(sameBalances(record.before, current), 'SAFE_BALANCES_CHANGED');
      check(now() < record.quote.expiresAt, 'QUOTE_EXPIRED');
      return update(id, record.revision, r => {
        r.state = 'dispatching'; r.submission = { attemptId: randomUUID(), txHash: null, reservedAt: now() };
      });
    },
    recordSubmitted(id, { attemptId, transactionHash }) {
      const record = get(id); const hash = txHash(transactionHash);
      check(record.submission?.attemptId === attemptId, 'ATTEMPT_MISMATCH');
      if (record.submission.txHash) {
        if (record.submission.txHash !== hash) return review(id, record.revision, 'CONFLICTING_SUBMISSION');
        return record; // Idempotent acknowledgement, never another send.
      }
      check(record.state === 'dispatching', 'SUBMISSION_NOT_ALLOWED');
      return update(id, record.revision, r => { r.submission.txHash = hash; r.state = 'pending'; });
    },
    markBroadcastUnknown(id, attemptId) {
      const record = get(id); check(record.submission?.attemptId === attemptId && record.state === 'dispatching', 'ATTEMPT_MISMATCH');
      return review(id, record.revision, 'BROADCAST_UNKNOWN');
    },
    observeProvider(id, status) {
      const record = get(id); check(['pending', 'needs_review'].includes(record.state), 'OBSERVATION_NOT_ALLOWED');
      check(['PENDING_DEPOSIT', 'KNOWN_DEPOSIT_TX', 'INCOMPLETE_DEPOSIT', 'PROCESSING', 'SUCCESS', 'REFUNDED', 'FAILED'].includes(status), 'UNKNOWN_PROVIDER_STATUS');
      return update(id, record.revision, r => {
        r.observation = { source: 'provider-unverified', status, observedAt: now() };
        if (['REFUNDED', 'FAILED'].includes(status)) { r.state = 'needs_review'; r.reviewReason ??= 'RECEIPT_VERIFICATION_REQUIRED'; }
      });
    },
    async confirmDelivery(id, evidence) {
      const record = get(id); const route = routeFor(record);
      check(record.state === 'pending' && record.submission?.txHash, 'DELIVERY_NOT_ALLOWED');
      check(typeof verifyDelivery === 'function', 'DELIVERY_VERIFIER_UNAVAILABLE');
      let delivery;
      try {
        delivery = clone(await verifyDelivery(clone(evidence), clone(record)));
        exact(delivery, ['requestHash', 'quoteHash', 'sourceTransactionHash', 'transactionHash', 'chainId', 'token', 'recipient', 'amount', 'confirmations', 'observedAt', 'evidenceQuality']);
        check(delivery.requestHash === record.requestHash && delivery.quoteHash === record.quoteHash
          && txHash(delivery.sourceTransactionHash) === record.submission.txHash, 'DELIVERY_BINDING_MISMATCH');
        txHash(delivery.transactionHash);
        check(delivery.chainId === route.destination.chainId && address(delivery.token) === route.destination.token && address(delivery.recipient) === route.safe, 'DELIVERY_IDENTITY_MISMATCH');
        amount(delivery.amount); check(BigInt(delivery.amount) >= BigInt(record.quote.minAmountOut), 'DELIVERY_AMOUNT_TOO_LOW');
        check(Number.isSafeInteger(delivery.confirmations) && delivery.confirmations >= route.minimumConfirmations, 'DELIVERY_NOT_FINAL');
        check(timestamp(delivery.observedAt) <= now() && now() - delivery.observedAt <= route.maxObservationAgeSeconds, 'STALE_DELIVERY');
        check(delivery.evidenceQuality === record.quote.evidenceQuality, 'EVIDENCE_QUALITY_MISMATCH');
        const after = await snapshot(route);
        check(address(after.assetToken) === address(record.before.assetToken)
          && after.assetBalance === record.before.assetBalance
          && BigInt(after.stableBalance) - BigInt(record.before.stableBalance) === BigInt(delivery.amount), 'DELIVERY_BALANCE_CONFLICT');
        return update(id, record.revision, r => { r.delivery = { ...delivery, snapshot: after }; r.state = 'delivered'; });
      } catch (error) {
        // Persist a conservative stop even if the verifier throws unexpectedly.
        review(id, record.revision, 'DELIVERY_EVIDENCE_REQUIRES_REVIEW'); throw error;
      }
    },
    async confirmRefund(id, evidence) {
      const record = get(id); const route = routeFor(record);
      check(['pending', 'needs_review'].includes(record.state) && record.submission?.txHash, 'REFUND_NOT_ALLOWED');
      check(!['CONFLICTING_SUBMISSION', 'BROADCAST_UNKNOWN'].includes(record.reviewReason), 'MANUAL_RECONCILIATION_REQUIRED');
      check(typeof verifyRefund === 'function', 'REFUND_VERIFIER_UNAVAILABLE');
      const refund = clone(await verifyRefund(clone(evidence), clone(record)));
      exact(refund, ['requestHash', 'quoteHash', 'sourceTransactionHash', 'transactionHash', 'chainId', 'token', 'recipient', 'amount', 'confirmations', 'observedAt', 'evidenceQuality']);
      check(refund.requestHash === record.requestHash && refund.quoteHash === record.quoteHash && txHash(refund.sourceTransactionHash) === record.submission.txHash, 'REFUND_BINDING_MISMATCH');
      txHash(refund.transactionHash); amount(refund.amount);
      check(refund.chainId === route.source.chainId && address(refund.token) === route.source.token && address(refund.recipient) === route.refundRecipient, 'REFUND_IDENTITY_MISMATCH');
      check(Number.isSafeInteger(refund.confirmations) && refund.confirmations >= route.minimumConfirmations && refund.evidenceQuality === record.quote.evidenceQuality, 'REFUND_NOT_FINAL');
      check(timestamp(refund.observedAt) <= now() && now() - refund.observedAt <= route.maxObservationAgeSeconds, 'STALE_REFUND');
      return update(id, record.revision, r => {
        r.refund = refund;
        // Fee-net/partial refunds need a human reconciliation; never silently release.
        r.state = refund.amount === record.request.amountIn ? 'refunded' : 'needs_review';
        r.reviewReason = r.state === 'refunded' ? null : 'PARTIAL_REFUND';
      });
    },
    async prepareRound(id, { chainId, safe, expectedBalances }) {
      const record = get(id); const route = routeFor(record);
      check(record.state === 'delivered' && !record.readiness && record.delivery?.evidenceQuality === 'live-verified', 'FUNDING_NOT_READY');
      check(chainId === route.destination.chainId && address(safe) === route.safe, 'ROUND_NETWORK_SAFE_MISMATCH');
      exact(expectedBalances, ['stableBalance', 'assetBalance']); amount(expectedBalances.stableBalance, true); amount(expectedBalances.assetBalance, true);
      const current = await snapshot(route);
      check(sameBalances(record.delivery.snapshot, current) && current.stableBalance === expectedBalances.stableBalance && current.assetBalance === expectedBalances.assetBalance, 'SAFE_BALANCES_CHANGED');
      check(!Object.values(store.read().records).some(r => r.fundingId !== id && unresolved(r) && r.request.destination.chainId === chainId && address(r.request.safe) === route.safe), 'SAFE_FUNDING_UNRESOLVED');
      // Readiness is consumed once. This does not send authorizeRound or bypass
      // the financial contract's own snapshot checks and owner signature.
      return store.transaction(data => {
        const currentRecord = data.records[id]; routeFor(currentRecord);
        check(currentRecord.revision === record.revision && !currentRecord.readiness, 'CONCURRENT_UPDATE');
        check(!Object.values(data.records).some(r => r.fundingId !== id && unresolved(r) && r.request.destination.chainId === chainId && address(r.request.safe) === route.safe), 'SAFE_FUNDING_UNRESOLVED');
        currentRecord.readiness = { chainId, safe: route.safe, snapshot: current, consumedAt: now() };
        currentRecord.revision++; currentRecord.updatedAt = now(); return currentRecord;
      });
    },
  };
}
