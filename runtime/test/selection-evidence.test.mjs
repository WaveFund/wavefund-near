import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { encodeAbiParameters } from 'viem';
import { selectionTwaps } from '../operator/selection-evidence.mjs';
const root = new URL('../../docs/test-evidence/tidepool-rounds/round9/', import.meta.url);
const value = JSON.parse(await readFile(new URL('selection.json', root)));
const report = JSON.parse(await readFile(new URL('report.json', root)));
const context = { engine: value.receipt.to, roundId: '9', winnerId: '3', proposals: [0,1,2,3,4].map(i => ({ id: String(i) })),
  transaction: report.confirmedTransactions.filter(t => t.label === 'round9:collapse').map(t => ({ transactionHash: t.hash, blockNumber: t.blockNumber }))[0] };

test('real collapse event supplies all five TWAPs and explains the recorded winner', () => {
  const values = selectionTwaps(value, context);
  assert.equal(values.length, 5);
  assert.equal(values[0], '500000000000000000');
  assert.ok(BigInt(values[3]) > BigInt(values[0]) + 5000000000000000n);
  console.log('Round 9 final-window TWAPs X18:', values.join(', '));
});

test('selection evidence rejects altered identity, receipt and strict-margin failures', () => {
  const cases = [
    [v => { v.chainId = 1; }, /wrong schema or network/],
    [v => { v.receipt.status = '0x0'; }, /unsuccessful receipt/],
    [v => { v.log.address = '0x' + '1'.repeat(40); }, /wrong emitter/],
    [v => { v.log.transactionHash = '0x' + '1'.repeat(64); }, /wrong collapse transaction/],
    [v => { v.log.blockHash = '0x' + '1'.repeat(64); }, /wrong collapse block/],
    [v => { v.log.topics[1] = '0x' + '0'.repeat(63) + '8'; }, /wrong round or winner/],
    [v => { v.log.topics[2] = '0x' + '0'.repeat(64); }, /wrong round or winner/],
    [v => { v.log.data = encodeAbiParameters([{type:'uint256[]'}], [[500000000000000000n]]); }, /TWAP coverage/],
    [v => { v.log.data = encodeAbiParameters([{type:'uint256[]'}], [[500000000000000000n, 500000000000000000n, 500000000000000000n, 505000000000000000n, 500000000000000000n]]); }, /strict Hold margin/],
  ];
  for (const [mutate, error] of cases) { const copy = structuredClone(value); mutate(copy); assert.throws(() => selectionTwaps(copy, context), error); }
});
