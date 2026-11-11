import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fundingHash } from '../funding/schema.mjs';
import { ERROR_CODES as E, IntentsError } from './errors.mjs';
import { createQuoteSignatureVerifier, stableStringify } from './signature.mjs';
import { quoteRequestFor, isObject, sameAddress } from './client.mjs';
import { findFundingRoute } from './routes.mjs';
import { verifyFundingDelivery, DEFAULT_MIN_CONFIRMATIONS } from './delivery.mjs';

// Adapters for Developer A's funding core (runtime/funding/README.md). Trusted server-side capabilities only.
// They verify and archive; they never sign, send, retry or decide strategy.
const fail = (code, message, details) => { throw new IntentsError(code, message, details); };
const MAX_SLIPPAGE_BPS = 1000;
const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const entryHash = ({ reference, requestHash, quote }) => createHash('sha256').update(stableStringify({ reference, requestHash, quote })).digest('hex');

// Shared FundingRequestV1 (Unix-second expiry, lowercase addresses) -> this client's provider-facing request.
// slippageBps is NOT part of the shared schema; the server chooses it, and the signed minAmountOut is what binds.
export function toProviderFundingRequest(request, { slippageBps = 100 } = {}) {
  if (!isObject(request) || !isObject(request.source) || !isObject(request.destination)) fail(E.INVALID_ORDER, 'Shared funding request is malformed');
  if (!Number.isSafeInteger(request.expiresAt) || request.expiresAt <= 0) fail(E.INVALID_ORDER, 'expiresAt must be integer Unix seconds');
  const route = findFundingRoute({
    source: { chain: 'eth', chainId: request.source.chainId, assetId: request.source.assetId, tokenAddress: String(request.source.token) },
    destination: { chainId: request.destination.chainId, virtualChainAccount: 'aurora', assetId: request.destination.assetId, tokenAddress: String(request.destination.token) },
  });
  if (!route || request.source.decimals !== route.source.decimals || request.destination.decimals !== route.destination.decimals) fail(E.UNSUPPORTED_ROUTE, 'Shared request does not match a verified 1Click funding route');
  return {
    fundingId: request.fundingId,
    source: { chain: route.source.chain, chainId: request.source.chainId, assetId: request.source.assetId, tokenAddress: request.source.token },
    destination: { chainId: request.destination.chainId, virtualChainAccount: route.destination.virtualChainAccount, assetId: request.destination.assetId, tokenAddress: request.destination.token, safeAddress: request.safe },
    amountIn: request.amountIn, minAmountOut: request.minAmountOut, slippageBps,
    refundAddress: request.refundRecipient, expiresAt: new Date(request.expiresAt * 1000).toISOString(),
  };
}

// Owner-only, write-once archive of the full signed quote and fee evidence, keyed by the shared `reference`.
export function createFundingEvidenceArchive(directory) {
  const root = resolve(directory); mkdirSync(root, { recursive: true, mode: 0o700 });
  const stat = lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) fail(E.EVIDENCE_UNAVAILABLE, 'Evidence directory must be a private directory');
  const fileFor = (reference) => {
    if (typeof reference !== 'string' || !REFERENCE.test(reference)) fail(E.EVIDENCE_UNAVAILABLE, 'Invalid evidence reference');
    return join(root, `${createHash('sha256').update(reference).digest('hex')}.json`);
  };
  function read(reference) {
    const file = fileFor(reference);
    let raw;
    try {
      const s = lstatSync(file);
      if (!s.isFile() || s.isSymbolicLink() || (s.mode & 0o077) !== 0) fail(E.EVIDENCE_UNAVAILABLE, 'Evidence file permissions are not private');
      raw = readFileSync(file, 'utf8');
    } catch (error) { if (error instanceof IntentsError) throw error; fail(E.EVIDENCE_UNAVAILABLE, 'No archived quote evidence for this reference'); }
    const entry = JSON.parse(raw);
    if (entry?.schemaVersion !== 1 || entry.reference !== reference || !isObject(entry.quote) || entry.entryHash !== entryHash(entry)) {
      fail(E.EVIDENCE_UNAVAILABLE, 'Archived quote evidence is corrupt');
    }
    return entry;
  }
  function retain({ reference, requestHash, quote, retainedAt }) {
    const file = fileFor(reference);
    const entry = { schemaVersion: 1, reference, requestHash, quote: JSON.parse(JSON.stringify(quote)), retainedAt };
    entry.entryHash = entryHash(entry);
    let fd;
    try { fd = openSync(file, 'wx', 0o600); } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const existing = read(reference); // write-once: an identical retry is idempotent, anything else is a conflict
      if (existing.entryHash !== entry.entryHash) fail(E.EVIDENCE_UNAVAILABLE, 'A different quote is already archived under this reference');
      return existing;
    }
    try { writeFileSync(fd, stableStringify(entry)); fsyncSync(fd); } finally { closeSync(fd); }
    return entry;
  }
  return Object.freeze({ retain, read });
}

// viem-compatible public clients keyed by chain id. The adapter authenticates each one's chain id.
async function observe(readers, chainId, hash) {
  const reader = readers?.[chainId];
  if (!reader) fail(E.EVIDENCE_UNAVAILABLE, `No trusted chain reader for chain ${chainId}`);
  try {
    if (Number(await reader.getChainId()) !== chainId) fail(E.EVIDENCE_UNAVAILABLE, `Chain reader for ${chainId} reports a different network`);
    const r = await reader.getTransactionReceipt({ hash });
    const latest = BigInt(await reader.getBlockNumber());
    const block = await reader.getBlock({ blockNumber: BigInt(r.blockNumber) });
    const canonical = typeof block?.hash === 'string' && typeof r.blockHash === 'string' && block.hash.toLowerCase() === r.blockHash.toLowerCase();
    const status = r.status === 'success' || r.status === '0x1' || r.status === 1 ? '0x1' : '0x0';
    return {
      txHash: hash, chainId, canonical,
      confirmations: canonical ? Number(latest - BigInt(r.blockNumber) + 1n) : 0,
      receipt: { transactionHash: r.transactionHash, status, blockNumber: `0x${BigInt(r.blockNumber).toString(16)}`, logs: (r.logs ?? []).map((l) => ({ address: l.address, topics: l.topics, data: l.data })) },
    };
  } catch (error) {
    if (error instanceof IntentsError) throw error;
    fail(E.EVIDENCE_UNAVAILABLE, `Receipt for ${hash} on chain ${chainId} could not be read`); // never interpreted as an outcome
  }
}

export function createFundingVerifiers({
  client, archive, chainReaders, verifySignature, clock = () => Math.floor(Date.now() / 1000),
  maxQuoteAgeSeconds = 120, maxSlippageBps = 100, minConfirmations,
} = {}) {
  if (!client?.getExecutionStatus || !archive?.retain || !archive?.read) throw new Error('client and archive are required');
  if (!Number.isSafeInteger(maxSlippageBps) || maxSlippageBps < 0 || maxSlippageBps > MAX_SLIPPAGE_BPS) throw new Error('maxSlippageBps out of range');
  const productionKey = verifySignature === undefined;
  const verify = verifySignature ?? createQuoteSignatureVerifier();
  const now = () => { const t = clock(); if (!Number.isSafeInteger(t) || t <= 0) throw new Error('clock() must return Unix seconds'); return t; };

  async function verifyQuote(providerQuote, request) {
    const t = now();
    if (!isObject(providerQuote) || providerQuote.kind !== 'EXECUTION_QUOTE' || providerQuote.purpose !== 'funding' || providerQuote.dry !== false) fail(E.INVALID_ORDER, 'Only an executable funding quote from this client can be recorded; dry quotes are rejected');
    const payload = providerQuote.providerPayload;
    if (!isObject(payload) || !isObject(payload.quoteRequest) || !isObject(payload.quote) || payload.quoteRequest.dry !== false) fail(E.MALFORMED_RESPONSE, 'Executable quote has no signed provider payload');
    if (verify(payload)?.valid !== true) fail(E.SIGNATURE_INVALID, 'Provider quote signature did not verify');
    // Exact echo of every field derived from the shared request (slippage is bounded separately).
    const expected = quoteRequestFor(toProviderFundingRequest(request, { slippageBps: payload.quoteRequest.slippageTolerance }), false);
    for (const [key, value] of Object.entries(expected)) {
      if (key === 'slippageTolerance') continue;
      const echoed = payload.quoteRequest[key];
      const same = typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value) ? sameAddress(echoed, value) : echoed === value;
      if (!same) fail(E.ORDER_MISMATCH, `Signed quote does not match the shared request field ${key}`, { field: key });
    }
    const slippage = payload.quoteRequest.slippageTolerance;
    if (!Number.isSafeInteger(slippage) || slippage < 0 || slippage > maxSlippageBps) fail(E.ORDER_MISMATCH, 'Signed slippage tolerance exceeds the configured maximum');
    for (const key of ['customRecipientMsg', 'virtualChainRefundRecipient']) if (payload.quoteRequest[key] !== undefined) fail(E.ORDER_MISMATCH, `Signed quote adds ${key}`);
    const q = payload.quote;
    if (q.amountIn !== request.amountIn || providerQuote.amounts?.amountIn !== q.amountIn) fail(E.ORDER_MISMATCH, 'Quoted input differs from the shared request');
    if (typeof q.minAmountOut !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(q.minAmountOut) || BigInt(q.minAmountOut) < BigInt(request.minAmountOut)) fail(E.QUOTE_BELOW_MINIMUM, 'Signed minimum output is below the shared request minimum');
    if (typeof q.depositAddress !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(q.depositAddress) || !sameAddress(providerQuote.deposit?.address, q.depositAddress)
      || providerQuote.deposit?.chainId !== request.source.chainId || q.depositMemo !== undefined) fail(E.ORDER_MISMATCH, 'Deposit target is not a memo-free EVM address on the source chain');
    if (!sameAddress(providerQuote.funding?.safeAddress, request.safe) || !sameAddress(providerQuote.funding?.refundAddress, request.refundRecipient)) fail(E.ORDER_MISMATCH, 'Normalized quote identity differs from the signed payload');
    const quotedAt = Date.parse(payload.timestamp); const deadline = Date.parse(q.deadline);
    if (!Number.isFinite(quotedAt) || !Number.isFinite(deadline)) fail(E.MALFORMED_RESPONSE, 'Quote timestamps are invalid');
    if (Math.floor(quotedAt / 1000) > t + 30) fail(E.MALFORMED_RESPONSE, 'Quote timestamp is in the future');
    if (t - Math.floor(quotedAt / 1000) > maxQuoteAgeSeconds) fail(E.QUOTE_EXPIRED, 'Quote is older than the allowed age');
    const expiresAt = Math.min(request.expiresAt, Math.floor(deadline / 1000));
    if (expiresAt <= t) fail(E.QUOTE_EXPIRED, 'Quote deadline has passed');
    if (typeof payload.correlationId !== 'string' || !/^[A-Za-z0-9-]{1,100}$/.test(payload.correlationId)) fail(E.MALFORMED_RESPONSE, 'Quote has no usable correlation id');
    const reference = `1click:${payload.correlationId}`;
    const requestHash = fundingHash(request);
    // Live only when the payload came from the built-in live transport AND verified with the pinned production key.
    const evidenceQuality = productionKey && providerQuote.mocked === false && providerQuote.source === 'live-provider' ? 'live-verified' : 'fixture';
    archive.retain({ reference, requestHash, quote: providerQuote, retainedAt: t }); // must succeed before any record exists
    return { requestHash, reference, depositAddress: q.depositAddress.toLowerCase(), amountIn: q.amountIn, minAmountOut: q.minAmountOut, expiresAt, evidenceQuality };
  }

  async function assess(evidence, record, kind) {
    if (!isObject(evidence) || Object.keys(evidence).join() !== 'transactionHash' || !/^0x[0-9a-fA-F]{64}$/.test(evidence.transactionHash)) fail(E.INVALID_ORDER, 'Evidence must be exactly { transactionHash }');
    const sourceTx = record?.submission?.txHash;
    if (typeof sourceTx !== 'string') fail(E.INVALID_ORDER, 'Record has no submitted source transaction');
    const archived = archive.read(record.quote.reference);
    const stored = archived.quote;
    if (archived.requestHash !== record.requestHash || !sameAddress(stored.deposit?.address, record.quote.depositAddress) || stored.amounts.amountIn !== record.quote.amountIn
      || stored.amounts.minAmountOut !== record.quote.minAmountOut || !sameAddress(stored.funding.safeAddress, record.request.safe) || !sameAddress(stored.funding.refundAddress, record.request.refundRecipient)) {
      fail(E.ORDER_MISMATCH, 'Archived signed quote does not match the funding record');
    }
    let status;
    try { status = await client.getExecutionStatus(stored); } catch (error) {
      fail(E.EVIDENCE_UNAVAILABLE, `Provider status unavailable (${error?.code ?? 'error'}); no outcome inferred`);
    }
    const { source, destination } = record.request;
    const sourceObs = await observe(chainReaders, source.chainId, sourceTx);
    const outcomeObs = await observe(chainReaders, kind === 'delivery' ? destination.chainId : source.chainId, evidence.transactionHash.toLowerCase());
    for (const o of [sourceObs, outcomeObs]) if (!o.canonical) fail(E.DELIVERY_NOT_PROVEN, `Receipt ${o.txHash} is not in the canonical chain`);
    const confirmationPolicy = minConfirmations ?? DEFAULT_MIN_CONFIRMATIONS; // Ethereum 12, Aurora 1; the core also enforces route.minimumConfirmations
    const result = verifyFundingDelivery({
      quote: stored, status, verifySignature: verify, minConfirmations: confirmationPolicy, expectedSender: record.request.manager,
      sourceReceipts: [sourceObs], ...(kind === 'delivery' ? { destinationReceipts: [outcomeObs] } : { refundReceipts: [outcomeObs] }),
    });
    const evidenceQuality = record.quote.evidenceQuality === 'live-verified' && productionKey && status.mocked === false && stored.mocked === false ? 'live-verified' : 'fixture';
    return { result, sourceObs, outcomeObs, evidenceQuality };
  }

  async function verifyDelivery(evidence, record) {
    const { result, sourceObs, outcomeObs, evidenceQuality } = await assess(evidence, record, 'delivery');
    if (result.outcome !== 'delivered' || result.evidenceQuality !== 'provider-linked-both-legs') {
      fail(E.DELIVERY_NOT_PROVEN, `Delivery not proven: ${result.outcome} (${result.evidenceQuality}); ${result.reasons.join('; ')}`, { outcome: result.outcome });
    }
    return { requestHash: record.requestHash, quoteHash: fundingHash(record.quote), sourceTransactionHash: sourceObs.txHash, transactionHash: outcomeObs.txHash,
      chainId: record.request.destination.chainId, token: record.request.destination.token, recipient: record.request.safe,
      amount: result.amounts.delivered, confirmations: outcomeObs.confirmations, observedAt: now(), evidenceQuality };
  }

  async function verifyRefund(evidence, record) {
    const { result, sourceObs, outcomeObs, evidenceQuality } = await assess(evidence, record, 'refund');
    if (result.outcome !== 'refunded' || result.amounts.observedRefund === undefined || result.evidenceQuality !== 'provider-linked-both-legs') {
      fail(E.DELIVERY_NOT_PROVEN, `Refund not proven: ${result.outcome} (${result.evidenceQuality}); ${result.reasons.join('; ')}`, { outcome: result.outcome });
    }
    // The ACTUAL observed refund amount; the core sends anything below amountIn to review.
    return { requestHash: record.requestHash, quoteHash: fundingHash(record.quote), sourceTransactionHash: sourceObs.txHash, transactionHash: outcomeObs.txHash,
      chainId: record.request.source.chainId, token: record.request.source.token, recipient: record.request.refundRecipient,
      amount: result.amounts.observedRefund, confirmations: outcomeObs.confirmations, observedAt: now(), evidenceQuality };
  }

  return Object.freeze({ verifyQuote, verifyDelivery, verifyRefund });
}
