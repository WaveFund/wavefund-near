import { readFile } from 'node:fs/promises';

// Developer C: read-only projection of the completed Tidepool community-testnet demonstration
// (Arbitrum Sepolia test USDC -> Tidepool -> Aurora testnet Trading Safe -> strategy round). Tidepool is a community
// relayer, not an official NEAR Intents testnet, and this projection is kept apart from the production 1Click funding
// read model: it never becomes a FundingRecordV1 and never feeds mainnet readiness. All values come from the reviewed
// manifest and saved evidence; an optional fresh check re-reads public receipts through the existing
// runtime/tidepool/read-model.mjs and is labelled separately. No signing, sending, retry or cancellation exists here.

export const TIDEPOOL_DEMO_PATH = '/api/tidepool/demo';
export const TIDEPOOL_FRESH_PATH = '/api/tidepool/demo/fresh-check';
const ROOT = new URL('../../', import.meta.url);
const AURORA_TESTNET = 1313161555;
const ARBITRUM_SEPOLIA = 421614;
const NEAR_RECEIVER = 'verifier.tidepool-sandbox.testnet';
const FILES = Object.freeze({
  manifest: 'deployments/aurora-testnet-tidepool.json', funding: 'docs/test-evidence/tidepool-v1/funding-proof.json',
  near: 'docs/test-evidence/tidepool-v1/near-settlement.json', capital: 'docs/test-evidence/tidepool-v1/capital-linkage.json',
  swap: 'docs/test-evidence/tidepool-v1/swap-independent.json', round: 'docs/test-evidence/tidepool-v1/happy-path.json',
});

const HASH = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const UINT = /^(0|[1-9][0-9]{0,77})$/;
const NEAR_HASH = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;
const NEAR_ACCOUNT = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
class TidepoolDemoError extends Error {}
const check = (condition, message) => { if (!condition) throw new TidepoolDemoError(`Tidepool demo evidence rejected: ${message}`); };
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const uint = (value, label) => { check(typeof value === 'string' && UINT.test(value), `${label} must be an unsigned integer string`); return value; };
const hash = (value, label) => { check(typeof value === 'string' && HASH.test(value), `${label} must be a 32-byte hash`); return value.toLowerCase(); };
const address = (value, label) => { check(typeof value === 'string' && ADDRESS.test(value) && !/^0x0{40}$/i.test(value), `${label} must be an address`); return value.toLowerCase(); };

export function projectTidepoolDemo({ manifest, funding, near, capital, swap, round }) {
  check(isObject(manifest) && manifest.chainId === AURORA_TESTNET && manifest.integrations?.fundingProvider === 'tidepool-community-testnet', 'the manifest is not the Tidepool Aurora testnet stack');
  const safe = address(manifest.contracts?.safe, 'Safe'); const token = address(manifest.contracts?.stable, 'Tidepool USDC');
  const engine = address(manifest.contracts?.engine, 'engine');
  // The funding proof must be the testnet community route into this exact Safe and token. It is never official 1Click.
  check(isObject(funding) && funding.testnetOnly === true && funding.official1Click === false && funding.deliveryProven === true, 'the funding proof is not a delivered community-testnet transfer');
  check(funding.source?.chainId === ARBITRUM_SEPOLIA && manifest.funding?.sourceChainId === ARBITRUM_SEPOLIA, 'the source network is not Arbitrum Sepolia');
  check(funding.destination?.chainId === AURORA_TESTNET && manifest.funding?.destinationChainId === AURORA_TESTNET, 'the destination network is not Aurora testnet');
  check(same(funding.destination?.safe, safe), 'the transfer went to a different Safe');
  check(same(funding.token, token), 'the transfer used a different token');
  const sourceTx = hash(funding.source.transactionHash, 'source transaction'); const destinationTx = hash(funding.destination.transactionHash, 'destination transaction');
  check(same(manifest.funding?.sourceTransactionHash, sourceTx) && same(manifest.funding?.destinationTransactionHash, destinationTx), 'the manifest and funding proof name different transactions');
  const sourceAmount = uint(funding.source.amount, 'source amount'); const delivered = uint(funding.destination.amount, 'delivered amount');
  check(manifest.funding?.deliveredAmount === delivered, 'the manifest and funding proof disagree on the delivered amount');
  check(BigInt(delivered) <= BigInt(sourceAmount) && BigInt(delivered) >= BigInt(uint(funding.minAmountOut, 'minimum out')), 'the delivered amount is outside the quoted bounds');
  check(funding.safeBalance?.before === '0' && funding.safeBalance?.delta === delivered && funding.safeBalance?.after === delivered, 'the Safe balance delta does not match the delivery');
  // Native NEAR testnet settlement reported for this transfer, and its saved final transaction.
  check(isObject(near) && near.final_execution_status === 'FINAL' && isObject(near.transaction) && near.transaction.receiver_id === NEAR_RECEIVER, 'the NEAR settlement is not a final transaction to the Tidepool verifier');
  const nearHash = near.transaction.hash; check(typeof nearHash === 'string' && NEAR_HASH.test(nearHash), 'the NEAR settlement hash is malformed');
  const reported = Array.isArray(funding.status?.swapDetails?.destinationChainTxHashes) ? funding.status.swapDetails.destinationChainTxHashes.map((item) => (typeof item === 'string' ? item : item?.hash)) : [];
  check(reported.includes(nearHash) && reported.some((item) => same(item, destinationTx)), 'the provider did not link the NEAR settlement and the Aurora delivery');
  check(typeof near.transaction.signer_id === 'string' && NEAR_ACCOUNT.test(near.transaction.signer_id), 'the NEAR signer is malformed');
  // The delivered capital is the capital the strategy round prepared and executed.
  check(isObject(capital) && capital.chainId === AURORA_TESTNET && same(capital.safe, safe) && same(capital.engine, engine) && capital.fundedAmount === delivered && capital.sameSafeAndCapital === true, 'the strategy round did not use this Safe and capital');
  const swapTx = hash(capital.executionHash, 'execution hash');
  check(same(manifest.demonstration?.investmentSwapTransactionHash, swapTx), 'the manifest names a different swap');
  check(isObject(swap) && swap.chainId === AURORA_TESTNET && same(swap.safe, safe) && swap.passed === true, 'the swap balance check names a different Safe or did not pass');
  const stableBefore = uint(swap.tokens?.stable?.before, 'stable before'); const stableAfter = uint(swap.tokens?.stable?.after, 'stable after');
  const assetAfter = uint(swap.tokens?.asset?.after, 'asset after');
  check(stableBefore === delivered && BigInt(stableAfter) < BigInt(stableBefore), 'the swap did not start from the delivered capital');
  check(isObject(round?.completion) && round.completion.chainId === AURORA_TESTNET && round.completion.roundId === capital.roundId, 'the round report does not match the capital linkage');
  const roundId = capital.roundId;
  return {
    schemaVersion: 1, kind: 'tidepool-community-testnet-demo', official1Click: false, testnetOnly: true,
    evidence: 'saved-independently-verified', method: typeof funding.method === 'string' ? funding.method.slice(0, 200) : null,
    note: 'Tidepool is a community relayer into Aurora testnet, not an official NEAR Intents testnet. Test tokens have no value.',
    networks: { source: { chainId: ARBITRUM_SEPOLIA, name: 'Arbitrum Sepolia' }, destination: { chainId: AURORA_TESTNET, name: 'Aurora testnet' }, settlement: { name: 'NEAR testnet' } },
    token: { address: token, symbol: 'USDC', decimals: 6, label: 'Tidepool test USDC' },
    contracts: { safe, engine, reputation: address(manifest.contracts?.reputation, 'reputation'), investmentPair: address(manifest.integrations?.investmentPair, 'investment pair') },
    funding: {
      sourceAmount, deliveredAmount: delivered, bridgeCost: (BigInt(sourceAmount) - BigInt(delivered)).toString(), minAmountOut: funding.minAmountOut,
      sourceTransaction: { hash: sourceTx, blockNumber: uint(funding.source.blockNumber, 'source block') },
      destinationTransaction: { hash: destinationTx, blockNumber: uint(funding.destination.blockNumber, 'destination block') },
      safeBalance: { before: funding.safeBalance.before, after: funding.safeBalance.after },
    },
    provider: { name: 'Tidepool community relayer', reportedStatus: typeof funding.status?.status === 'string' ? funding.status.status.slice(0, 20) : null,
      reportedAt: typeof funding.status?.updatedAt === 'string' ? funding.status.updatedAt.slice(0, 40) : null, providerReported: true },
    nearSettlement: { hash: nearHash, receiver: NEAR_RECEIVER, signer: near.transaction.signer_id, status: 'FINAL' },
    strategy: { roundId, roundKey: `${AURORA_TESTNET}:${engine}:${roundId}`, roundSlug: `${AURORA_TESTNET}-${engine}-${roundId}`, preparedStableAmount: uint(capital.preparedStableAmount, 'prepared stable') },
    swap: { hash: swapTx, blockNumber: uint(swap.blockNumber, 'swap block'), stableIn: (BigInt(stableBefore) - BigInt(stableAfter)).toString(), stableAfter, assetOut: assetAfter, slippageBps: swap.slippageBps },
    observedAt: null,
  };
}

const defaultRead = async (path) => JSON.parse(await readFile(new URL(path, ROOT), 'utf8'));

export async function loadTidepoolDemo({ read = defaultRead } = {}) {
  const files = {};
  for (const [role, path] of Object.entries(FILES)) files[role] = await read(path);
  return { demo: Object.freeze(projectTidepoolDemo(files)), funding: files.funding };
}

// The fresh check re-reads the public source/destination receipts, provider status and Safe balance through the existing
// read-model. It runs only when called (an explicit button), is cached for a minute and shares one in-flight read.
export function createTidepoolDemo({ demo, funding, freshRead = null, clock = () => Math.floor(Date.now() / 1000), nowMs = () => Date.now(), cacheMs = 60_000 }) {
  let cached = null; let cachedAt = 0; let inFlight = null;
  async function run() {
    if (typeof freshRead !== 'function') return { status: 'unavailable', code: 'FRESH_CHECK_DISABLED', observedAt: clock() };
    try {
      const proof = await freshRead({ response: funding.status.quoteResponse, sourceHash: funding.source.transactionHash });
      const matches = proof?.deliveryProven === true && same(proof?.destination?.safe, demo.contracts.safe) && same(proof?.token, demo.token.address)
        && proof?.destination?.amount === demo.funding.deliveredAmount && same(proof?.destination?.transactionHash, demo.funding.destinationTransaction.hash);
      return matches
        ? { status: 'verified', evidence: 'fresh-rpc-read', observedAt: clock(), deliveredAmount: proof.destination.amount, destinationBlock: String(proof.destination.blockNumber),
          safeBalanceDelta: typeof proof.safeBalance?.delta === 'string' ? proof.safeBalance.delta : null, providerStatus: typeof proof.status?.status === 'string' ? proof.status.status.slice(0, 20) : null }
        : { status: 'mismatch', code: 'FRESH_CHECK_MISMATCH', observedAt: clock() };
    } catch { return { status: 'unavailable', code: 'FRESH_CHECK_UNAVAILABLE', observedAt: clock() }; }
  }
  return {
    read: () => demo,
    async fresh() {
      if (cached && nowMs() - cachedAt < cacheMs) return cached;
      if (!inFlight) inFlight = run().then((value) => { cached = value; cachedAt = nowMs(); return value; }).finally(() => { inFlight = null; });
      return inFlight;
    },
  };
}

// WAVEFUND_TIDEPOOL_DEMO=disabled removes the endpoints. Invalid evidence keeps the server running and answers 503.
export async function tidepoolDemoFromEnvironment(env = process.env, options = {}) {
  if ((env.WAVEFUND_TIDEPOOL_DEMO ?? '').trim() === 'disabled') return null;
  try {
    const { demo, funding } = await loadTidepoolDemo(options);
    const freshRead = options.freshRead !== undefined ? options.freshRead : async (input) => (await import('../tidepool/read-model.mjs')).readTidepoolFundingProof(input);
    return createTidepoolDemo({ demo, funding, freshRead });
  } catch {
    return { read: () => { throw new TidepoolDemoError('invalid'); }, fresh: async () => ({ status: 'unavailable', code: 'EVIDENCE_INVALID' }) };
  }
}

// GET only: the saved demonstration and an on-demand fresh check. No signing, sending, retry or cancellation routes.
export async function handleTidepoolDemoRequest(demo, request, url, send) {
  if (!demo || request.method !== 'GET') return send(404, { error: 'Not found' });
  try {
    if (url.pathname === TIDEPOOL_DEMO_PATH) return send(200, demo.read());
    if (url.pathname === TIDEPOOL_FRESH_PATH) return send(200, await demo.fresh());
    return send(404, { error: 'Not found' });
  } catch { return send(503, { error: 'The Tidepool demonstration evidence failed validation.', code: 'EVIDENCE_INVALID' }); }
}
