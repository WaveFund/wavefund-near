import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { encodeEventTopics, encodeAbiParameters, encodeFunctionData, encodeErrorResult, parseAbiParameters } from 'viem';
import { ENGINE_ABI, ATTACK_ABIS, verifySavedRound, verifyOutsideWallet, fetchNearTx, checkNearSettlement, statusOf, NEAR_TESTNET_RPCS } from './judge-checks.mjs';
import { buildAttacks } from '../attack-suite.mjs';

const load = async p => JSON.parse(await readFile(new URL(`../../${p}`, import.meta.url), 'utf8'));
const DIR = 'docs/test-evidence/tidepool-rounds/round9';
const manifest = await load('deployments/aurora-testnet-tidepool.json');
const ENGINE = manifest.contracts.engine; const STABLE = manifest.contracts.stable;
const clone = x => JSON.parse(JSON.stringify(x));

const bought = (b) => ({ address: ENGINE, topics: encodeEventTopics({ abi: ENGINE_ABI, eventName: 'Bought', args: { roundId: BigInt(b.roundId), proposalId: BigInt(b.proposalId), user: b.user } }),
  data: encodeAbiParameters(parseAbiParameters('bool, uint256, uint256'), [b.isLong, BigInt(b.credits), BigInt(b.tokensOut)]) });
const redeemed = (roundId, user, payout) => ({ address: ENGINE, topics: encodeEventTopics({ abi: ENGINE_ABI, eventName: 'Redeemed', args: { roundId: BigInt(roundId), user } }),
  data: encodeAbiParameters(parseAbiParameters('uint256'), [BigInt(payout)]) });

/** A fake public chain that agrees with the saved round-9 evidence; `tweak` lets a test make it disagree. */
async function fakeChain(tweak = {}) {
  const [independent, report, outside] = await Promise.all(['independent', 'report', 'outside-wallet'].map(f => load(`${DIR}/${f}.json`)));
  const receipts = new Map(); const txs = new Map();
  for (const f of independent.fills) receipts.set(f.hash, { status: 'success', logs: [bought(f)] });
  for (const p of independent.payouts) {
    const tx = report.confirmedTransactions.find(t => t.label === `round9:${p.external ? 'redeemFor' : 'redeem'}:${p.name}`);
    receipts.set(tx.hash, { status: 'success', to: ENGINE, logs: [redeemed(9, p.address, p.actualPayout)] });
  }
  const abi = { approve: ['function approve(address,uint256)'] };
  for (const s of outside.steps) {
    const target = s.function === 'approve' ? STABLE : ENGINE;
    const fnAbi = s.function === 'approve' ? (await import('viem')).parseAbi(abi.approve) : ENGINE_ABI;
    const args = s.function === 'approve' ? [s.args[0], BigInt(s.args[1])] : s.args.map(BigInt);
    const logs = s.function === 'buyLong' ? [bought({ roundId: 9, proposalId: 1, user: outside.wallet, isLong: true, credits: 100000, tokensOut: 1 })] : [];
    receipts.set(s.transactionHash, { status: 'success', from: outside.wallet, to: target, logs });
    txs.set(s.transactionHash, { value: 0n, input: encodeFunctionData({ abi: fnAbi, functionName: s.function, args }) });
  }
  const state = { roundStatus: 3, winningAllocation: [BigInt(independent.winner), 6500] };
  tweak.chain?.({ receipts, txs, state, independent, report, outside });
  const client = {
    readContract: async ({ functionName }) => state[functionName],
    getTransactionReceipt: async ({ hash }) => receipts.get(hash) ?? (() => { throw Error('no receipt'); })(),
    getTransaction: async ({ hash }) => txs.get(hash),
  };
  return { client, independent, report, outside };
}
const savedArgs = (c) => ({ client: c.client, engine: ENGINE, chainId: 1313161555, independent: c.independent, report: c.report });
const walletArgs = (c) => ({ client: c.client, engine: ENGINE, stable: STABLE, outside: c.outside, report: c.report, independent: c.independent });
const mismatch = { code: 'CLAIM_MISMATCH' };

test('saved round 9 passes against a chain that agrees with it', async () => {
  const r = await verifySavedRound(savedArgs(await fakeChain()));
  assert.deepEqual(r, { round: '9', winner: '3', fills: 3, redemptions: 9, outsideWallets: 1 });
});
test('saved round fails when the chain says the round is not settled', async () => {
  await assert.rejects(verifySavedRound(savedArgs(await fakeChain({ chain: ({ state }) => { state.roundStatus = 2; } }))), { ...mismatch, message: /not settled/ });
});
test('saved round fails when the on-chain winner differs', async () => {
  await assert.rejects(verifySavedRound(savedArgs(await fakeChain({ chain: ({ state }) => { state.winningAllocation = [0n, 0]; } }))), { ...mismatch, message: /on-chain winner 0 != saved 3/ });
});
test('saved round fails when a fill on chain bought different credits', async () => {
  await assert.rejects(verifySavedRound(savedArgs(await fakeChain({ chain: ({ receipts, independent }) => {
    const f = independent.fills[0]; receipts.set(f.hash, { status: 'success', logs: [bought({ ...f, credits: BigInt(f.credits) + 1n })] });
  } }))), { ...mismatch, message: /fill Quant differs/ });
});
test('saved round fails when a redemption paid a different amount', async () => {
  await assert.rejects(verifySavedRound(savedArgs(await fakeChain({ chain: ({ receipts, independent, report }) => {
    const p = independent.payouts[0]; const tx = report.confirmedTransactions.find(t => t.label === 'round9:redeem:Quant');
    receipts.set(tx.hash, { status: 'success', logs: [redeemed(9, p.address, BigInt(p.actualPayout) - 1n)] });
  } }))), { ...mismatch, message: /redemption of Quant differs/ });
});
test('saved round fails when a redemption receipt is missing from the report', async () => {
  const c = await fakeChain(); c.report = clone(c.report);
  c.report.confirmedTransactions = c.report.confirmedTransactions.filter(t => t.label !== 'round9:redeemFor:wallet1');
  await assert.rejects(verifySavedRound(savedArgs(c)), { ...mismatch, message: /no redemption receipt for wallet1/ });
});
test('saved round fails when the saved verifier itself did not pass', async () => {
  const c = await fakeChain(); c.independent = { ...c.independent, passed: false };
  await assert.rejects(verifySavedRound(savedArgs(c)), { ...mismatch, message: /did not pass/ });
});

test('outside wallet passes with its own signed receipts and the redeemFor settlement', async () => {
  const r = await verifyOutsideWallet(walletArgs(await fakeChain()));
  assert.equal(r.payout, '1000000');
  assert.deepEqual(r.steps, ['approve', 'deposit', 'claimCredits', 'buyLong']);
});
test('outside wallet fails when a step was sent by someone else (the operator)', async () => {
  await assert.rejects(verifyOutsideWallet(walletArgs(await fakeChain({ chain: ({ receipts, outside }) => {
    receipts.get(outside.steps[1].transactionHash).from = '0x1903bDDF6F73eE4aA8F66D170E7590D28CD3f8B9';
  } }))), { ...mismatch, message: /deposit receipt mismatch/ });
});
test('outside wallet fails when a step sent value', async () => {
  await assert.rejects(verifyOutsideWallet(walletArgs(await fakeChain({ chain: ({ txs, outside }) => { txs.get(outside.steps[3].transactionHash).value = 1n; } }))),
    { ...mismatch, message: /buyLong receipt mismatch/ });
});
test('outside wallet fails when the calldata differs from the saved args', async () => {
  await assert.rejects(verifyOutsideWallet(walletArgs(await fakeChain({ chain: ({ txs, outside }) => {
    txs.get(outside.steps[1].transactionHash).input = encodeFunctionData({ abi: ENGINE_ABI, functionName: 'deposit', args: [9n, 2000000n] });
  } }))), { ...mismatch, message: /deposit calldata differs/ });
});
test('outside wallet fails when the redeemFor paid a different amount', async () => {
  await assert.rejects(verifyOutsideWallet(walletArgs(await fakeChain({ chain: ({ receipts, report, outside }) => {
    const s = report.completion.externalPayouts[0]; receipts.set(s.transactionHash, { status: 'success', to: ENGINE, logs: [redeemed(9, outside.wallet, 999999n)] });
  } }))), { ...mismatch, message: /redeemFor receipt mismatch/ });
});
test('outside wallet fails when the independent verifier did not count it', async () => {
  const c = await fakeChain(); c.independent = { ...c.independent, payouts: c.independent.payouts.filter(p => !p.external) };
  await assert.rejects(verifyOutsideWallet(walletArgs(c)), { ...mismatch, message: /not counted/ });
});

const ok = (result) => ({ ok: true, json: async () => ({ result }) });
const nearResult = { final_execution_status: 'FINAL', status: { SuccessValue: '' }, transaction: { hash: 'H', receiver_id: 'verifier.tidepool-sandbox.testnet', actions: [{ FunctionCall: { method_name: 'execute_intents' } }] } };
const scripted = (answers) => { const calls = []; return { calls, fetchImpl: async (url) => { calls.push(url); const a = answers.shift(); if (a instanceof Error) throw a; return a; } }; };

test('NEAR lookup retries the first RPC, then falls back to the second', async () => {
  const s = scripted([new Error('ECONNRESET'), { ok: false, status: 503 }, ok(nearResult)]);
  const r = await fetchNearTx({ hash: 'H', signer: 'S', fetchImpl: s.fetchImpl });
  assert.deepEqual(s.calls, [NEAR_TESTNET_RPCS[0], NEAR_TESTNET_RPCS[0], NEAR_TESTNET_RPCS[1]]);
  assert.equal(r.rpc, NEAR_TESTNET_RPCS[1]); assert.equal(r.attempts, 3);
});
test('NEAR lookup succeeds on the retry of the first RPC', async () => {
  const s = scripted([new Error('timeout'), ok(nearResult)]);
  assert.equal((await fetchNearTx({ hash: 'H', signer: 'S', fetchImpl: s.fetchImpl })).rpc, NEAR_TESTNET_RPCS[0]);
});
test('both NEAR RPCs down → amber "network unavailable", never a failed claim', async () => {
  const s = scripted([new Error('down'), new Error('down'), { ok: false, status: 502 }, ok(undefined)]);
  const error = await fetchNearTx({ hash: 'H', signer: 'S', fetchImpl: s.fetchImpl }).catch(e => e);
  assert.equal(error.code, 'NETWORK_UNAVAILABLE'); assert.equal(statusOf(error), 'amber'); assert.equal(s.calls.length, 4);
});
test('a rate-limit or node error body is treated as unavailable, not as a missing transaction', async () => {
  const s = scripted([{ ok: true, json: async () => ({ error: { code: -429, message: 'rate limited' } }) }, new Error('x'), new Error('x'), new Error('x')]);
  assert.equal(statusOf(await fetchNearTx({ hash: 'H', signer: 'S', fetchImpl: s.fetchImpl }).catch(e => e)), 'amber');
});
test('archival RPCs that say the transaction does not exist → failed claim', async () => {
  const unknown = { ok: true, json: async () => ({ error: { cause: { name: 'UNKNOWN_TRANSACTION' } } }) };
  const s = scripted([unknown, unknown]);
  const error = await fetchNearTx({ hash: 'H', signer: 'S', fetchImpl: s.fetchImpl }).catch(e => e);
  assert.equal(statusOf(error), 'failed'); assert.equal(s.calls.length, 2);
});
test('NEAR settlement must be FINAL execute_intents on the Tidepool verifier', () => {
  assert.equal(checkNearSettlement(nearResult).method, 'execute_intents');
  assert.throws(() => checkNearSettlement({ ...nearResult, transaction: { ...nearResult.transaction, receiver_id: 'evil.testnet' } }), mismatch);
  assert.throws(() => checkNearSettlement({ ...nearResult, final_execution_status: 'EXECUTED_OPTIMISTIC' }), mismatch);
});
test('statusOf maps only network outages to amber', () => {
  assert.equal(statusOf({ code: 'NETWORK_UNAVAILABLE' }), 'amber');
  assert.equal(statusOf({ code: 'CLAIM_MISMATCH' }), 'failed');
  assert.equal(statusOf(new Error('anything else')), 'unavailable');
});
test('inline attack ABIs encode every attack and contain its expected named error', () => {
  for (const a of buildAttacks(manifest.contracts)) {
    const abi = ATTACK_ABIS[a.contract];
    assert.ok(encodeFunctionData({ abi, functionName: a.function, args: a.args }), a.name);
    const inputs = abi.find(x => x.type === 'error' && x.name === a.expectedError)?.inputs;
    assert.ok(inputs, `${a.name}: ${a.expectedError} missing`);
    assert.ok(encodeErrorResult({ abi, errorName: a.expectedError, args: inputs.map(i => (i.type === 'address' ? a.from : i.type === 'bytes32' ? `0x${'0'.repeat(64)}` : 1n)) }));
  }
});
