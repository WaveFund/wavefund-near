import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeFunctionData, parseAbi } from 'viem';
import { fundingDemoRequest, fundingDemoPreviewInput, prepareFundingDemoDeposit } from './demo-plan.mjs';
import { fundingHash } from './schema.mjs';
const addr = n => `0x${String(n).padStart(40, '0')}`;
function fixture() {
  const manifest = { purpose: 'mainnet-funding-proof-only', chainId: 1313161554, wavefundModuleEnabled: false, manager: addr(1), safe: addr(2), refundRecipient: addr(1) };
  const options = { manifest, fundingId: 'demo-1', expiresAt: 1200, now: 1000 };
  const request = fundingDemoRequest(options);
  const quote = { requestHash: fundingHash(request), reference: 'quote-1', depositAddress: addr(3), amountIn: '1000000', minAmountOut: '989800', expiresAt: 1190, evidenceQuality: 'live-verified' };
  const sourceState = { chainId: 42161, manager: addr(1), token: request.source.token, balanceUSDC: '1000000', balanceETH: '10000000000000', nonce: 0, gasLimit: '100000', gasPrice: '20000000', observedAt: 1000 };
  return { options, quote, input: { manifest, request, providerQuote: {}, verifyQuote: async () => quote, sourceState, clock: () => 1000 } };
}
test('preview uses B mapping and one-USDC policy without requiring a trading module', () => {
  const f = fixture(); const p = fundingDemoPreviewInput(f.options);
  assert.equal(p.source.chain, 'arb'); assert.equal(p.source.chainId, 42161);
  assert.equal(p.amountIn, '1000000'); assert.equal(p.destination.safeAddress, addr(2));
  assert.equal(p.refundAddress, addr(1));
});
test('verified one-off plan encodes only exact ERC20 transfer, with a bounded gas cost', async () => {
  const f = fixture(); const p = await prepareFundingDemoDeposit(f.input);
  assert.equal(p.productionRoundReady, false); assert.equal(p.unsignedOnly, true); assert.equal(p.deliveryProven, false);
  assert.equal(p.transaction.chainId, 42161); assert.equal(p.transaction.value, '0');
  assert.equal(p.maximumGasCostWei, '2000000000000');
  const decoded = decodeFunctionData({ abi: parseAbi(['function transfer(address,uint256) returns(bool)']), data: p.transaction.data });
  assert.equal(decoded.functionName, 'transfer'); assert.deepEqual(decoded.args, [addr(3), 1000000n]);
  assert.equal(p.transaction.to, f.input.request.source.token);
});
test('changed amount, Safe, source chain and refund policy are rejected', async () => {
  for (const [key, value] of [['amountIn', '1000001'], ['safe', addr(4)], ['refundRecipient', addr(4)]]) {
    const f = fixture(); f.input.request[key] = value;
    await assert.rejects(prepareFundingDemoDeposit(f.input), { code: 'DEMO_REQUEST_CHANGED' });
  }
  const f = fixture(); f.input.sourceState.chainId = 1;
  await assert.rejects(prepareFundingDemoDeposit(f.input), { code: 'DEMO_SOURCE_IDENTITY' });
});
test('fixtures, insufficient funds, excessive gas and stale snapshots cannot prepare a send', async () => {
  const f = fixture(); f.quote.evidenceQuality = 'fixture'; await assert.rejects(prepareFundingDemoDeposit(f.input), { code: 'DEMO_QUOTE_NOT_LIVE' });
  for (const [key, value, code] of [['balanceUSDC', '999999', 'DEMO_SOURCE_UNFUNDED'], ['balanceETH', '0', 'DEMO_SOURCE_UNFUNDED'],
    ['gasPrice', '100000001', 'DEMO_GAS_CAP'], ['observedAt', 969, 'DEMO_SOURCE_STALE']]) {
    const f = fixture(); f.input.sourceState[key] = value;
    await assert.rejects(prepareFundingDemoDeposit(f.input), { code });
  }
});
test('quote expiry after asynchronous verification cannot prepare a transaction', async () => {
  const f = fixture(); let now = 1000; f.input.clock = () => now;
  f.input.verifyQuote = async () => { now = 1191; return f.quote; };
  await assert.rejects(prepareFundingDemoDeposit(f.input), { code: 'QUOTE_EXPIRED' });
});
