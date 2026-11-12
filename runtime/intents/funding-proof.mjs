import { ERROR_CODES as E, IntentsError } from './errors.mjs';
import { decodeTransfers } from './delivery.mjs';
import { sameAddress } from './client.mjs';
import { EXPLORER_TX_URL } from './chain-readers.mjs';

// Funding-only proof for ONE delivery: Arbitrum One USDC deposit -> 1Click -> Aurora mainnet Safe.
// Built from the same read-only evidence as verifyDelivery (archived signed quote, live provider status, canonical
// receipts from trusted readers). It changes no state, sends nothing, and claims no Wavefund strategy deployment.
const BALANCE_OF = '0x70a08231';
const TX = /^0x[0-9a-fA-F]{64}$/;

async function balanceAt(reader, token, holder, blockNumber) {
  if (typeof reader?.call !== 'function') return null;
  try {
    const { data } = await reader.call({ to: token, data: `${BALANCE_OF}${holder.slice(2).toLowerCase().padStart(64, '0')}`, blockNumber: BigInt(blockNumber) });
    return typeof data === 'string' && /^0x[0-9a-fA-F]{1,64}$/.test(data) ? BigInt(data).toString() : null;
  } catch { return null; } // historical state may be unavailable on a public RPC; reported as null, never guessed
}

function leg(obs, { token, to, from = null }) {
  let transfers = [];
  try { transfers = decodeTransfers(obs.receipt).filter((t) => t.token === token.toLowerCase() && t.to === to.toLowerCase() && (!from || t.from === from.toLowerCase())); } catch { transfers = []; }
  return {
    // `to` is reported only when a matching Transfer to the expected recipient was actually decoded.
    chainId: obs.chainId, txHash: obs.txHash, token: token.toLowerCase(), to: transfers.length ? to.toLowerCase() : null,
    from: transfers.length === 1 ? transfers[0].from : null,
    amount: transfers.reduce((sum, t) => sum + t.value, 0n).toString(), transferCount: transfers.length,
    blockNumber: obs.blockNumber, blockHash: obs.blockHash, canonical: obs.canonical, confirmations: obs.confirmations, finalized: obs.finalized,
    receiptStatus: obs.receipt.status === '0x1' ? 'success' : 'reverted',
    explorer: EXPLORER_TX_URL[obs.chainId] ? `${EXPLORER_TX_URL[obs.chainId]}${obs.txHash}` : null,
  };
}

export async function buildFundingProof({ verifiers, chainReaders, record, destinationTransactionHash, clock = () => Math.floor(Date.now() / 1000) } = {}) {
  if (typeof verifiers?.inspect !== 'function') throw new Error('verifiers from createFundingVerifiers are required');
  if (typeof destinationTransactionHash !== 'string' || !TX.test(destinationTransactionHash)) throw new IntentsError(E.INVALID_ORDER, 'destinationTransactionHash must be a 32-byte hex hash');
  const { result, sourceObs, outcomeObs, evidenceQuality, status, stored } = await verifiers.inspect({ transactionHash: destinationTransactionHash.toLowerCase() }, record, 'delivery');
  const { request } = record;
  const source = leg(sourceObs, { token: request.source.token, to: stored.deposit.address, from: request.manager });
  const destination = leg(outcomeObs, { token: request.destination.token, to: request.safe });
  const verified = result.outcome === 'delivered' && result.evidenceQuality === 'provider-linked-both-legs';
  const final = verified && source.finalized === true && destination.finalized === true;
  let safeBalance = null;
  if (verified) {
    const reader = chainReaders?.[request.destination.chainId];
    const before = await balanceAt(reader, request.destination.token, request.safe, BigInt(destination.blockNumber) - 1n);
    const after = await balanceAt(reader, request.destination.token, request.safe, BigInt(destination.blockNumber));
    safeBalance = { token: request.destination.token, holder: request.safe, beforeBlock: (BigInt(destination.blockNumber) - 1n).toString(), afterBlock: destination.blockNumber, before, after,
      delta: before !== null && after !== null ? (BigInt(after) - BigInt(before)).toString() : null };
    safeBalance.deltaEqualsDelivery = safeBalance.delta === null ? null : safeBalance.delta === destination.amount; // false if other transfers hit the Safe in that block
  }
  return Object.freeze({
    kind: 'WAVEFUND_FUNDING_PROOF', schemaVersion: 1, generatedAt: clock(),
    scope: 'Funding-only: Arbitrum One USDC -> NEAR Intents (1Click) -> Aurora mainnet Safe. No Wavefund trading module or strategy deployment is claimed.',
    method: 'Provider-linked receipt verification (signed quote + provider status linkage + canonical chain receipts from trusted RPCs). NOT a trustless bridge proof.',
    status: final ? 'verified-final' : verified ? 'verified-not-final' : 'not-verified',
    outcome: result.outcome, providerLinkage: result.evidenceQuality, evidenceQuality,
    funding: { fundingId: record.fundingId, requestHash: record.requestHash, quoteHash: record.quoteHash, reference: record.quote.reference, routeId: request.routeId },
    parties: { manager: request.manager, safe: request.safe, refundRecipient: request.refundRecipient, depositAddress: stored.deposit.address },
    amounts: {
      requestedIn: request.amountIn, sourceDeposited: source.amount, sourceMatchesRequest: source.amount === request.amountIn,
      signedMinOut: record.quote.minAmountOut, providerReportedOut: status.swap.amountOut, deliveredToSafe: destination.amount,
      deliveredAtLeastSignedMin: BigInt(destination.amount) >= BigInt(record.quote.minAmountOut),
      unsignedQuotedFees: { refundFee: stored.fees.refundFee, withdrawFee: stored.fees.withdrawFee, appFees: stored.fees.appFees },
    },
    source: { ...source, managerIsSender: sameAddress(source.from, request.manager) },
    destination: { ...destination, recipientIsSafe: sameAddress(destination.to, request.safe) },
    provider: {
      status: status.status, updatedAt: status.updatedAt, correlationId: status.correlationId, quoteSignature: stored.providerPayload.signature, quoteTimestamp: stored.providerPayload.timestamp,
      linkedOriginTxs: status.swap.originChainTxs, linkedDestinationTxs: status.swap.destinationChainTxs, nearTxHashes: status.swap.nearTxHashes, intentHashes: status.swap.intentHashes,
      reportedSuccessIsNotProof: true,
    },
    safeBalance,
    checks: result.checks, reasons: result.reasons,
  });
}
