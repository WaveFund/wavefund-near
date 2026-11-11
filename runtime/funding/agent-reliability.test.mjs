import test from 'node:test';
import assert from 'node:assert/strict';
import { anonymousStrategies, estimateNetReturn } from '../agents/allocation-evidence.mjs';
import { digest } from '../agents/policy.mjs';
import { recoverInterruptedRound } from '../agents/interrupted-round.mjs';

test('fee arithmetic preserves exact units, Hold exemption, and signed scenarios', () => {
  const rows = anonymousStrategies([{ id: 0, allocationBps: 10000 }, { id: 1, allocationBps: 4500 }], 10000);
  assert.equal(rows[0].feeArithmetic.portfolioFeeBpsNumerator, '0');
  assert.equal(rows[1].swapFeeEstimatePortfolioBps, 16.5);
  assert.equal(rows[1].returnReference[2].netReturnBpsNumerator, '285000'); // 45 - 16.5 = 28.5bps
  assert.equal(rows[1].returnReference[0].netReturnBpsNumerator, '-615000');
  assert.equal(estimateNetReturn({ allocationBps: 0, turnoverBps: 0, assetReturnBps: 100 }).netReturnBpsNumerator, '0');
  assert.throws(() => estimateNetReturn({ allocationBps: 10001, turnoverBps: 0, assetReturnBps: 1 }), /Invalid fee arithmetic inputs/);
  // Historical evidence format stays ordinary JSON.stringify, not sorted JSON.
  assert.notEqual(digest({ a: 1, b: 2 }), digest({ b: 2, a: 1 }));
});
function recovery(options = {}) {
  let status = options.status ?? 1; let redeemed = false; const calls = [];
  const events = [{ stage: 'schedule', roundId: '4', tradingEnd: '100', executionDeadline: '200' },
    { stage: 'confirmed', label: 'round4:deposit:Quant', actor: 'Quant', hash: '0xconfirmed' }];
  const chain = { contracts: { safe: 'safe' }, accounts: { Quant: { address: 'quant' } },
    inspect: async () => ({ currentRoundId: '4' }),
    read: async (contract, method) => {
      if (method === 'roundExecuted') return options.executed ?? false;
      if (method === 'roundStatus') return status;
      if (method === 'balanceOf') return 100n;
      if (method === 'previewRedeem') return redeemed ? 0n : 10n;
      throw new Error('Unexpected read');
    },
    waitUntil: async time => { calls.push(['wait', String(time)]); },
    tx: async (_label, _actor, _contract, method) => { calls.push([method]); if (options.failAt === method) throw new Error('RPC unavailable; known transaction requires review');
      if (method === 'collapse') status = 2; if (method === 'abortExpired') status = 4; if (method === 'redeem') redeemed = true; },
    roundRecord: async () => ({ seedReleased: true, depositsOutstanding: redeemed ? 0n : 10n }),
  };
  return { chain, events, calls };
}
test('explicit interrupted-round recovery waits, collapses, expires and redeems once', async () => {
  const f = recovery(); const result = await recoverInterruptedRound(f);
  assert.equal(result.status, 'cancelled');
  assert.deepEqual(f.calls, [['wait', '100'], ['collapse'], ['wait', '201'], ['abortExpired'], ['redeem']]);
  await recoverInterruptedRound(f);
  assert.equal(f.calls.filter(c => c[0] === 'redeem').length, 1);
});
test('executed rounds, unresolved broadcasts and wrong round never get cancelled', async () => {
  const f = recovery({ executed: true }); await assert.rejects(recoverInterruptedRound(f), /Executed round must settle/); assert.equal(f.calls.length, 0);
  const g = recovery(); g.events.push({ stage: 'prepared', hash: 'unknown' });
  await assert.rejects(recoverInterruptedRound(g), /Unresolved transaction/); assert.equal(g.calls.length, 0);
  const h = recovery(); h.chain.inspect = async () => ({ currentRoundId: '5' });
  await assert.rejects(recoverInterruptedRound(h), /Recovery round differs/);
});
test('interrupted recovery never retries an ambiguous write', async () => {
  const f = recovery({ failAt: 'collapse' });
  await assert.rejects(recoverInterruptedRound(f), /RPC unavailable/);
  assert.deepEqual(f.calls, [['wait', '100'], ['collapse']]);
});
