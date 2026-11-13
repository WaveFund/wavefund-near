// Pure-ish building blocks for scripts/judge-check.mjs. Public, read-only: every chain access goes through the
// injected viem-style client or fetch, so tests can drive them with fakes. No keys, no signing, no transactions.
import { parseAbi, decodeEventLog, decodeFunctionData } from 'viem';

/** A claim the public chain contradicts. Reported as `failed` (exit 1). */
export class ClaimMismatch extends Error {
  constructor(message) { super(message); this.code = 'CLAIM_MISMATCH'; }
}
/** The public network could not be read. Reported as `amber`: not a failed claim. */
export class NetworkUnavailable extends Error {
  constructor(message) { super(message); this.code = 'NETWORK_UNAVAILABLE'; }
}
const must = (condition, message) => { if (!condition) throw new ClaimMismatch(message); };
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

export const ENGINE_ABI = parseAbi([
  'event Bought(uint256 indexed roundId, uint256 indexed proposalId, address indexed user, bool isLong, uint256 credits, uint256 tokensOut)',
  'event Redeemed(uint256 indexed roundId, address indexed user, uint256 payout)',
  'function roundStatus(uint256) view returns (uint8)',
  'function winningAllocation(uint256) view returns (uint256, uint16)',
  'function deposit(uint256 roundId, uint256 amount)',
  'function claimCredits(uint256 roundId, uint256 proposalId, uint256 amount)',
  'function buyLong(uint256 roundId, uint256 proposalId, uint256 amount, uint256 minOut)',
]);
const ERC20_ABI = parseAbi(['function approve(address spender, uint256 amount)']);

// Minimal ABIs for the attack suite: only the attacked functions and the expected named errors. Any other revert
// cannot be decoded and therefore fails closed. Signatures copied from src/ (see scripts/attack-suite.mjs).
export const ATTACK_ABIS = {
  TradingSafeModule: parseAbi(['error OnlySafe()', 'error NotExecutable(uint256 roundId)',
    'function authorizeRound(uint256,uint256,uint256,uint256,uint256,uint256,uint256)', 'function execute(uint256,uint256,uint256)']),
  QuantumRound: parseAbi(['error AccessControlUnauthorizedAccount(address account, bytes32 neededRole)',
    'error AlreadyCollapsed(uint256 roundId)', 'error NothingToRedeem()', 'error TradingNotOpen(uint256 roundId)',
    'function openRound(uint256,uint256,uint256,uint256,uint256)', 'function collapse(uint256)', 'function redeem(uint256)',
    'struct Allocation { uint16 tEthBps; }', 'function propose(uint256, Allocation, string)']),
  PerformanceTracker: parseAbi(['error AlreadyObserved(uint256 roundId)', 'function settle(uint256)']),
  AuroraTestToken: parseAbi(['error OnlyOperator()', 'function mint(address,uint256)']),
  AgentReputation: parseAbi(['error AlreadyRecorded(uint256 roundId)', 'error NoAgentWinner(uint256 roundId)', 'function record(uint256)']),
};

function engineEvents(receipt, engine, eventName) {
  return receipt.logs.filter(l => same(l.address, engine)).flatMap(l => {
    try { const e = decodeEventLog({ abi: ENGINE_ABI, data: l.data, topics: l.topics }); return e.eventName === eventName ? [e.args] : []; }
    catch { return []; }
  });
}
const txByLabel = (report, label) => report.confirmedTransactions.find(t => t.label === label);

/**
 * Re-check one saved round (independent.json + report.json) against the public chain: settled status and winner,
 * every forecaster fill (Bought event) and every redemption (Redeemed event with the exact saved payout).
 */
export async function verifySavedRound({ client, engine, chainId, independent, report }) {
  const id = BigInt(independent.roundId);
  must(independent.passed === true, `round ${id}: saved independent check did not pass`);
  must(independent.chainId === chainId, `round ${id}: wrong chain in saved evidence`);
  must(String(report.completion?.roundId) === String(id), `round ${id}: report is for another round`);
  const read = (functionName) => client.readContract({ address: engine, abi: ENGINE_ABI, functionName, args: [id] });
  const [status, winner] = await Promise.all([read('roundStatus'), read('winningAllocation')]);
  must(Number(status) === 3, `round ${id}: not settled on chain (status ${status})`);
  must(String(winner[0]) === String(independent.winner), `round ${id}: on-chain winner ${winner[0]} != saved ${independent.winner}`);
  for (const fill of independent.fills) {
    const receipt = await client.getTransactionReceipt({ hash: fill.hash });
    const bought = engineEvents(receipt, engine, 'Bought');
    must(receipt.status === 'success' && bought.length === 1, `round ${id}: fill ${fill.name} has no single Bought event`);
    const b = bought[0];
    must(b.roundId === id && String(b.proposalId) === String(fill.proposalId) && same(b.user, fill.user) && b.isLong === fill.isLong
      && String(b.credits) === String(fill.credits) && String(b.tokensOut) === String(fill.tokensOut), `round ${id}: fill ${fill.name} differs from chain`);
  }
  for (const p of independent.payouts) {
    must(String(p.derivedPayout) === String(p.actualPayout), `round ${id}: ${p.name} derived payout != actual`);
    const tx = txByLabel(report, `round${id}:${p.external ? 'redeemFor' : 'redeem'}:${p.name}`);
    must(tx, `round ${id}: no redemption receipt for ${p.name}`);
    const receipt = await client.getTransactionReceipt({ hash: tx.hash });
    const redeemed = engineEvents(receipt, engine, 'Redeemed');
    must(receipt.status === 'success' && redeemed.length === 1 && redeemed[0].roundId === id && same(redeemed[0].user, p.address)
      && String(redeemed[0].payout) === String(p.actualPayout), `round ${id}: redemption of ${p.name} differs from chain`);
  }
  return { round: String(id), winner: String(winner[0]), fills: independent.fills.length, redemptions: independent.payouts.length,
    outsideWallets: independent.payouts.filter(p => p.external).length };
}

const STEP_ABI = { approve: ERC20_ABI, deposit: ENGINE_ABI, claimCredits: ENGINE_ABI, buyLong: ENGINE_ABI };

/** Re-check the outside browser wallet's own transactions and its redeemFor settlement. */
export async function verifyOutsideWallet({ client, engine, stable, outside, report, independent }) {
  const wallet = outside.wallet;
  const expected = ['approve', 'deposit', 'claimCredits', 'buyLong'];
  must(JSON.stringify(outside.steps.map(s => s.function)) === JSON.stringify(expected), 'outside wallet: steps are not approve, deposit, claimCredits, buyLong');
  for (const step of outside.steps) {
    const target = step.function === 'approve' ? stable : engine;
    const [receipt, tx] = await Promise.all([client.getTransactionReceipt({ hash: step.transactionHash }), client.getTransaction({ hash: step.transactionHash })]);
    must(receipt.status === 'success' && same(receipt.from, wallet) && same(receipt.to, target) && tx.value === 0n, `outside wallet: ${step.function} receipt mismatch`);
    let call;
    try { call = decodeFunctionData({ abi: STEP_ABI[step.function], data: tx.input }); } catch { call = null; }
    must(call?.functionName === step.function && JSON.stringify(call.args.map(String).map(x => x.toLowerCase())) === JSON.stringify(step.args.map(x => String(x).toLowerCase())),
      `outside wallet: ${step.function} calldata differs from saved args`);
    if (step.function === 'buyLong') {
      const bought = engineEvents(receipt, engine, 'Bought');
      must(bought.length === 1 && same(bought[0].user, wallet) && bought[0].isLong === true, 'outside wallet: buyLong has no Bought event for the wallet');
    }
  }
  const settled = (report.completion?.externalPayouts ?? []).find(x => same(x.address, wallet));
  must(settled, 'outside wallet: no redeemFor settlement in report');
  const receipt = await client.getTransactionReceipt({ hash: settled.transactionHash });
  const redeemed = engineEvents(receipt, engine, 'Redeemed');
  must(receipt.status === 'success' && same(receipt.to, engine) && redeemed.length === 1 && same(redeemed[0].user, wallet)
    && String(redeemed[0].payout) === String(settled.payout), 'outside wallet: redeemFor receipt mismatch');
  const counted = independent.payouts.find(p => p.external && same(p.address, wallet));
  must(counted && String(counted.actualPayout) === String(settled.payout), 'outside wallet: not counted by the independent verifier');
  return { wallet, steps: expected, redeemFor: settled.transactionHash, payout: String(settled.payout), signedBy: 'the wallet itself (receipt.from)' };
}

// Archival nodes are needed: the plain rpc.testnet.near.org cannot return transactions older than a few epochs.
export const NEAR_TESTNET_RPCS = Object.freeze(['https://archival-rpc.testnet.near.org', 'https://archival-rpc.testnet.fastnear.com']);

/**
 * Look a NEAR testnet transaction up on each RPC in turn, `attempts` tries each. Transport errors, timeouts,
 * non-200, rate limits and node errors → try again / next RPC; if every RPC is unreachable → NetworkUnavailable.
 * A transaction an archival node says does not exist, or one that does not match → ClaimMismatch.
 */
export async function fetchNearTx({ hash, signer, rpcs = NEAR_TESTNET_RPCS, attempts = 2, fetchImpl = fetch, timeoutMs = 20000 }) {
  let unknown = 0;
  const tried = [];
  for (const rpc of rpcs) {
    for (let i = 0; i < attempts; i++) {
      tried.push(rpc);
      let body;
      try {
        const r = await fetchImpl(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(timeoutMs),
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tx', params: { tx_hash: hash, sender_account_id: signer, wait_until: 'FINAL' } }) });
        if (!r.ok) continue;
        body = await r.json();
      } catch { continue; }
      if (body?.result) return { rpc, result: body.result, attempts: tried.length };
      if (body?.error?.cause?.name === 'UNKNOWN_TRANSACTION') { unknown++; break; } // definite answer from this node: try the next RPC
    }
  }
  if (unknown > 0) throw new ClaimMismatch(`NEAR transaction not found on ${unknown} archival RPC(s)`);
  throw new NetworkUnavailable(`no public NEAR testnet RPC answered (${tried.length} tries)`);
}

export function checkNearSettlement(result) {
  must(result?.final_execution_status === 'FINAL' && result?.status?.SuccessValue !== undefined
    && result.transaction?.receiver_id === 'verifier.tidepool-sandbox.testnet'
    && result.transaction.actions?.some(a => a.FunctionCall?.method_name === 'execute_intents'), 'NEAR settlement does not match');
  return { network: 'NEAR testnet', provider: 'Tidepool community verifier', transactionHash: result.transaction.hash,
    receiver: result.transaction.receiver_id, method: 'execute_intents', final: true };
}

/** Status for a thrown error: amber for network outages, failed for contradicted claims, otherwise unavailable. */
export function statusOf(error) {
  if (error?.code === 'NETWORK_UNAVAILABLE') return 'amber';
  if (error?.code === 'CLAIM_MISMATCH') return 'failed';
  return 'unavailable';
}
