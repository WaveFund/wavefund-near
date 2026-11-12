// Strict validation of the completed Tidepool community-testnet demonstration (read-only API projection). Kept apart
// from the production 1Click funding model: anything that looks official, mainnet or mismatched is rejected, and missing
// values are unavailable rather than zero.
import { AURORA_TESTNET, ARBITRUM_SEPOLIA, isAddress, isIntegerString, isTxHash, safeText } from '../funding/model.mjs';

const NEAR_HASH = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;
const NEAR_ACCOUNT = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const SLUG = /^1313161555-0x[0-9a-f]{40}-\d{1,6}$/;
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const lower = (value) => value.toLowerCase();

// NEAR testnet transactions link only to the explorer named in the verified evidence.
export function nearTestnetTxUrl(hash) {
  return typeof hash === 'string' && NEAR_HASH.test(hash) ? `https://testnet.nearblocks.io/txns/${hash}` : null;
}

export function validateTidepoolDemo(input) {
  const reject = (error) => ({ ok: false, error });
  if (!isObject(input) || input.schemaVersion !== 1 || input.kind !== 'tidepool-community-testnet-demo') return reject('The Tidepool demonstration is missing or uses an unsupported schema.');
  if (input.official1Click !== false || input.testnetOnly !== true) return reject('This is not labelled as a community testnet demonstration, so it was discarded.');
  if (input.networks?.source?.chainId !== ARBITRUM_SEPOLIA || input.networks?.destination?.chainId !== AURORA_TESTNET) return reject('The Tidepool networks must be Arbitrum Sepolia to Aurora testnet.');
  const c = input.contracts ?? {}; const f = input.funding ?? {}; const n = input.nearSettlement ?? {}; const w = input.swap ?? {}; const st = input.strategy ?? {};
  if (![c.safe, c.engine, c.reputation, c.investmentPair, input.token?.address].every(isAddress)) return reject('A Tidepool contract identity is malformed.');
  if (![f.sourceAmount, f.deliveredAmount, f.bridgeCost, w.stableIn, w.assetOut].every(isIntegerString)) return reject('A Tidepool amount is malformed.');
  if ((BigInt(f.sourceAmount) - BigInt(f.deliveredAmount)).toString() !== f.bridgeCost) return reject('The bridge cost does not match the source and delivered amounts.');
  if (![f.sourceTransaction?.hash, f.destinationTransaction?.hash, w.hash].every(isTxHash) || !NEAR_HASH.test(n.hash ?? '') || !NEAR_ACCOUNT.test(n.receiver ?? '')) return reject('A Tidepool transaction reference is malformed.');
  if (typeof st.roundSlug !== 'string' || !SLUG.test(st.roundSlug) || !st.roundSlug.includes(lower(c.engine))) return reject('The strategy round is not identified by network + engine + round id.');
  const q = input.quote ?? {};
  if (q.signatureVerified !== true || q.virtualChainRecipient !== null || !isAddress(q.recipient) || lower(q.recipient) !== lower(c.safe) || typeof q.signer !== 'string' || !/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(q.signer)) {
    return reject('The Tidepool quote is not a verified quote paying the Safe directly.');
  }
  return { ok: true, demo: {
    evidence: input.evidence === 'saved-independently-verified' ? 'saved-independently-verified' : 'unlabelled', official1Click: false,
    method: safeText(input.method, 200), note: safeText(input.note, 240),
    token: { address: lower(input.token.address), symbol: safeText(input.token.symbol, 12) ?? 'USDC', decimals: Number.isInteger(input.token.decimals) ? input.token.decimals : 6, label: safeText(input.token.label, 40) ?? 'Tidepool test USDC' },
    contracts: { safe: lower(c.safe), engine: lower(c.engine), reputation: lower(c.reputation), investmentPair: lower(c.investmentPair) },
    funding: { sourceAmount: f.sourceAmount, deliveredAmount: f.deliveredAmount, bridgeCost: f.bridgeCost,
      sourceTransaction: { hash: lower(f.sourceTransaction.hash), blockNumber: isIntegerString(f.sourceTransaction.blockNumber) ? f.sourceTransaction.blockNumber : null },
      destinationTransaction: { hash: lower(f.destinationTransaction.hash), blockNumber: isIntegerString(f.destinationTransaction.blockNumber) ? f.destinationTransaction.blockNumber : null },
      safeBalance: { before: isIntegerString(f.safeBalance?.before) ? f.safeBalance.before : null, after: isIntegerString(f.safeBalance?.after) ? f.safeBalance.after : null } },
    provider: { name: safeText(input.provider?.name, 60) ?? 'Tidepool community relayer', reportedStatus: safeText(input.provider?.reportedStatus, 20), reportedAt: safeText(input.provider?.reportedAt, 40) },
    nearSettlement: { hash: n.hash, receiver: n.receiver, url: nearTestnetTxUrl(n.hash) },
    quote: { signatureVerified: true, signer: q.signer, recipient: lower(q.recipient), virtualChainRecipient: null },
    strategy: { roundId: safeText(st.roundId, 8), roundSlug: st.roundSlug },
    swap: { hash: lower(w.hash), blockNumber: isIntegerString(w.blockNumber) ? w.blockNumber : null, stableIn: w.stableIn, assetOut: w.assetOut },
  } };
}

// A fresh read is shown only when the API says it actually ran now; otherwise it is unavailable.
export function validateFreshCheck(input) {
  if (!isObject(input) || !Number.isSafeInteger(input.observedAt)) return { status: 'unavailable', code: 'FRESH_CHECK_INVALID', observedAt: null };
  if (input.status === 'verified' && input.evidence === 'fresh-rpc-read' && isIntegerString(input.deliveredAmount)) {
    return { status: 'verified', observedAt: input.observedAt, deliveredAmount: input.deliveredAmount, providerStatus: safeText(input.providerStatus, 20) };
  }
  return { status: input.status === 'mismatch' ? 'mismatch' : 'unavailable', code: typeof input.code === 'string' && /^[A-Z_]{1,40}$/.test(input.code) ? input.code : 'FRESH_CHECK_UNAVAILABLE', observedAt: input.observedAt };
}
