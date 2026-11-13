// Run-phase guards for pre-registered rounds, the operator manipulation probe (against an in-memory fake chain),
// and AgentReputation expectations. No network, keys or signing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runTerms, probeAmountOf, requireScriptedWinner, expectedExecution, requireSwapRule, v2AmountOut, moduleCheckAtPool, recomputeSettlement, roundScope, MAX_PROBE_STABLE } from '../agents/round-rules.mjs';
import { manipulationProbe, finishProbe } from '../agents/manipulation-probe.mjs';
import { roundIdOf, reputationLabel, expectedAfterRecord, checkRecordedOutcome, checkOutcomeEvent, pointOf } from '../tidepool/reputation-outcome.mjs';

const ONE = 10n ** 18n;
const ROOT = new URL('../../', import.meta.url);

test('run terms come from the plan: evaluation window 180..3600, hybrid target 0..4, config may only repeat them', () => {
  assert.deepEqual(runTerms({ plan: { scriptedTarget: 2, evaluationSeconds: 900 }, hybrid: true }), { evaluationSeconds: 900, scriptedTarget: 2, manipulationProbe: null });
  assert.deepEqual(runTerms({ plan: {}, hybrid: false }), { evaluationSeconds: 180, scriptedTarget: null, manipulationProbe: null }, 'legacy plans default to 180');
  assert.equal(runTerms({ config: { evaluationSeconds: 3600 }, plan: { scriptedTarget: 0, evaluationSeconds: 3600 }, hybrid: true }).evaluationSeconds, 3600);
  assert.equal(runTerms({ plan: { scriptedTarget: 0, evaluationSeconds: 180 }, hybrid: true }).scriptedTarget, 0, 'Hold is a valid target');
  for (const evaluationSeconds of [179, 3601, 200.5, '600']) assert.throws(() => runTerms({ plan: { scriptedTarget: 3, evaluationSeconds }, hybrid: true }), /Evaluation window/, String(evaluationSeconds));
  assert.throws(() => runTerms({ config: { evaluationSeconds: 600 }, plan: { scriptedTarget: 3, evaluationSeconds: 900 }, hybrid: true }), /differs from the pre-registered plan/);
  assert.throws(() => runTerms({ config: { scriptedTarget: 3 }, plan: { scriptedTarget: 2 }, hybrid: true }), /Run target differs/);
  assert.throws(() => runTerms({ plan: {}, hybrid: true }), /Scripted target/, 'hybrid plans must carry a target');
  assert.throws(() => runTerms({ plan: { scriptedTarget: 5 }, hybrid: true }), /Scripted target/);
  assert.throws(() => runTerms({ plan: { scriptedTarget: 3 }, hybrid: false }), /Only hybrid/);
});

test('probe amount is a positive 6-decimal integer string capped at 20000 test USDC', () => {
  assert.deepEqual(probeAmountOf({ stableAmount: '20000000000' }), { stableAmount: MAX_PROBE_STABLE });
  assert.deepEqual(runTerms({ config: { manipulationProbe: { stableAmount: '1' } }, plan: { scriptedTarget: 1 }, hybrid: true }).manipulationProbe, { stableAmount: 1n });
  for (const bad of [{ stableAmount: '20000000001' }, { stableAmount: '0' }, { stableAmount: '-5' }, { stableAmount: 5000000 }, { stableAmount: '01' }, { stableAmount: '5', router: '0x' }, []])
    assert.throws(() => probeAmountOf(bad), /Probe|probe/, JSON.stringify(bad));
});

test('winner must be the pre-registered target for hybrid, including Hold; other profiles are not forced', () => {
  for (const target of [0, 1, 2, 3, 4]) {
    assert.doesNotThrow(() => requireScriptedWinner({ hybrid: true, scriptedTarget: target, winner: BigInt(target) }));
    assert.throws(() => requireScriptedWinner({ hybrid: true, scriptedTarget: target, winner: BigInt((target + 1) % 5) }), /Scripted target did not win/);
  }
  assert.throws(() => requireScriptedWinner({ hybrid: true, scriptedTarget: 3, winner: 3 }), /did not win/, 'a number is not the engine bigint');
  assert.doesNotThrow(() => requireScriptedWinner({ hybrid: false, scriptedTarget: null, winner: 0n }));
});

const prices = { stablePrice: 999920000000000000n, assetPrice: 2068220000000000000000n };
test('swap rule mirrors TradingSafeModule.execute: Hold and unchanged splits never swap, any value change must', () => {
  const cash = { stableBalance: 199480000n, assetBalance: 0n, ...prices };
  // Tidepool round 1 execute-time oracle: the mirror reproduces the swap the module actually made on chain.
  const momentum = expectedExecution({ winner: 3n, targetBps: 7500n, stableBalance: 199480000n, assetBalance: 0n, stablePrice: 999745000000000000n, assetPrice: 2070020000000000000000n });
  assert.equal(momentum.required, true); assert.equal(momentum.buyAsset, true);
  assert.equal(momentum.amountIn, 149610000n, 'recorded amount0In of the round 1 execution swap');
  assert.ok(71692173391461052n >= momentum.minimumOut, 'the recorded fill cleared the module minimum');
  assert.equal(momentum.minimumOut, momentum.expectedOut * 9900n / 10000n);
  assert.equal(expectedExecution({ winner: 0n, targetBps: 0n, ...cash }).required, false, 'Hold never swaps');
  assert.equal(expectedExecution({ winner: 0n, targetBps: 9500n, ...cash }).required, false, 'Hold never swaps even with a nonzero baseline');
  assert.equal(expectedExecution({ winner: 1n, targetBps: 0n, ...cash }).required, false, 'Conservative 0% on an all-cash Safe needs no swap');
  const sell = expectedExecution({ winner: 1n, targetBps: 0n, stableBalance: 49870000n, assetBalance: 71692173391461052n, ...prices });
  assert.equal(sell.required, true); assert.equal(sell.buyAsset, false); assert.equal(sell.amountIn, 71692173391461051n, 'sells all asset for 0%, less the 1 wei the module loses to floor division');
  requireSwapRule({ expected: momentum, swaps: [{}] });
  assert.throws(() => requireSwapRule({ expected: momentum, swaps: [] }), /swap was required/);
  requireSwapRule({ expected: expectedExecution({ winner: 0n, targetBps: 0n, ...cash }), swaps: [] });
  assert.throws(() => requireSwapRule({ expected: expectedExecution({ winner: 0n, targetBps: 0n, ...cash }), swaps: [{}] }), /no AMM swap was expected/);
});

test('settlement recomputation reproduces the published Tidepool round 1 return from the oracle and rejects a pool mark', async () => {
  const report = JSON.parse(await readFile(new URL('docs/test-evidence/tidepool-v1/happy-path.json', ROOT), 'utf8'));
  const p = report.completion.portfolio; const portfolio = Object.fromEntries(Object.entries(p).map(([k, v]) => [k, /^0x/.test(v) ? v : BigInt(v)]));
  const base = { chainId: 1313161555, tracker: '0xc2c389f3abd8c55d78a2400a6918b2ed02bf937d', roundId: 1n, portfolio, ...prices, publishedAt: portfolio.oraclePublishedAt };
  const result = recomputeSettlement(base);
  assert.equal(result.returnX18, 993541889635073190n);
  assert.equal(result.observationHash, p.observationHash, 'the tracker observation hash binds exactly these oracle prices');
  assert.equal(result.matchesTracker, true);
  assert.equal(recomputeSettlement({ ...base, assetPrice: prices.assetPrice * 105n / 100n }).matchesTracker, false, 'a pool-marked asset price does not reproduce the tracker');
});

test('module oracle-anchored minimum rejects a buy at a pool pushed up by >1% and accepts the opposite side', () => {
  const reserves = { reserveStable: 80000000000n, reserveAsset: 80000000000n * 10n ** 30n / 2068220000000000000000n };
  const inputs = { ...prices, maxSlippageBps: 100n, referenceStableIn: 10000000n, referenceAssetIn: 10000000n * 10n ** 30n / 2068220000000000000000n };
  const fair = moduleCheckAtPool({ reserves, ...inputs });
  assert.equal(fair.buyAsset.wouldReject, false); assert.equal(fair.sellAsset.wouldReject, false);
  const bought = v2AmountOut(5000000000n, reserves.reserveStable, reserves.reserveAsset);
  const pushed = moduleCheckAtPool({ reserves: { reserveStable: reserves.reserveStable + 5000000000n, reserveAsset: reserves.reserveAsset - bought }, ...inputs });
  assert.equal(pushed.buyAsset.wouldReject, true); assert.equal(pushed.sellAsset.wouldReject, false);
  assert.ok(pushed.buyAsset.poolOut < pushed.buyAsset.minimumOut && pushed.sellAsset.poolOut > pushed.sellAsset.oracleExpectedOut);
});

test('scope states SCRIPTED forecasters, the pre-registered target and the window', () => {
  const scope = roundScope({ hybrid: true, scriptedTarget: 0, evaluationSeconds: 900, probe: { stableAmount: 5n } });
  assert.match(scope, /SCRIPTED forecasters deliberately target pre-registered proposal0\./); assert.match(scope, /900s/); assert.match(scope, /manipulation probe/);
  assert.doesNotMatch(roundScope({ swarm: true, evaluationSeconds: 180 }), /SCRIPTED/);
});

// ---------------------------------------------------------------- manipulation probe against a fake chain
const A = { stable: '0x' + '51'.repeat(20), asset: '0x' + 'a5'.repeat(20), router: '0x' + '70'.repeat(20), pair: '0x' + 'ba'.repeat(20), tracker: '0x' + 'c2'.repeat(20), module: '0x' + 'dd'.repeat(20), owner: '0x' + '0e'.repeat(20) };
function fakeChain({ ownerStable = 30000n * 1000000n, trackerUsesPool = false } = {}) {
  const oracle = [prices.stablePrice, prices.assetPrice, 1000n];
  const state = { block: 100n, rs: 80000000000n, ra: 80000000000n * 10n ** 30n / prices.assetPrice, balances: { stable: ownerStable, asset: 0n }, allowance: { stable: 0n, asset: 0n }, history: new Map(), sent: [] };
  const snap = () => state.history.set(state.block, { rs: state.rs, ra: state.ra, balances: { ...state.balances } });
  snap();
  const at = (block) => state.history.get(block ?? state.block);
  const portfolio = { startingValueX18: 199429132600000000000n, stableQty6: 49870000n, assetQty18: 71692173391461052n, executedAt: 1n, observedAt: 2n, oraclePublishedAt: 1000n };
  const contracts = { stable: A.stable, asset: A.asset, router: A.router, tracker: A.tracker, module: A.module };
  const chain = {
    contracts, accounts: { owner: { address: A.owner } }, abi: name => name,
    client: {
      getBlockNumber: async () => state.block, getBlock: async () => ({ timestamp: 5000n, number: state.block }),
      readContract: async ({ functionName, blockNumber }) => {
        const view = at(blockNumber);
        return { getReserves: [view.rs, view.ra, 0], token0: A.stable, token1: A.asset }[functionName];
      },
    },
    read: async (name, fn, args = [], blockNumber) => {
      if (name === 'module' && fn === 'router') return A.router;
      if (name === 'oracle' && fn === 'read') return oracle;
      if (fn === 'balanceOf') return at(blockNumber).balances[name];
      if (fn === 'allowance') return state.allowance[name];
      if (name === 'tracker' && fn === 'portfolios') {
        const assetPrice = trackerUsesPool ? state.rs * 10n ** 30n / state.ra : oracle[1];
        const ending = portfolio.stableQty6 * oracle[0] / 1000000n + portfolio.assetQty18 * assetPrice / ONE;
        const realised = ending * ONE / portfolio.startingValueX18;
        const { observationHash } = recomputeSettlement({ chainId: 1313161555, tracker: A.tracker, roundId: 9n, portfolio: { ...portfolio, realisedReturn: realised }, stablePrice: oracle[0], assetPrice: oracle[1], publishedAt: 1000n });
        return [portfolio.startingValueX18, portfolio.stableQty6, portfolio.assetQty18, 1n, 2n, 1000n, realised, observationHash];
      }
      throw new Error(`unexpected read ${name}.${fn}`);
    },
    tx: async (label, actor, name, method, args) => {
      assert.equal(actor, 'owner'); state.sent.push(label); state.block += 1n;
      if (method === 'approve') state.allowance[name] = args[1];
      if (method === 'swapExactTokensForTokens') {
        const [amountIn, minOut, path] = args; const buy = path[0] === A.stable; const key = buy ? 'stable' : 'asset';
        assert.ok(state.allowance[key] >= amountIn && state.balances[key] >= amountIn, 'router needs exact allowance');
        const out = buy ? v2AmountOut(amountIn, state.rs, state.ra) : v2AmountOut(amountIn, state.ra, state.rs);
        assert.ok(out >= minOut);
        state.allowance[key] -= amountIn; state.balances[key] -= amountIn; state.balances[buy ? 'asset' : 'stable'] += out;
        if (buy) { state.rs += amountIn; state.ra -= out; } else { state.ra += amountIn; state.rs -= out; }
      }
      snap(); return { transactionHash: '0x' + state.block.toString(16).padStart(64, '0'), blockNumber: state.block };
    },
    namedTracker: portfolio,
  };
  return { chain, state };
}
const namedFake = (chain) => ({ ...chain, abi: (name) => name === 'tracker' ? trackerAbi : name });
const trackerAbi = [{ type: 'function', name: 'portfolios', inputs: [{ type: 'uint256' }], outputs: ['startingValueX18', 'stableQty6', 'assetQty18', 'executedAt', 'observedAt', 'oraclePublishedAt', 'realisedReturn', 'observationHash'].map(name => ({ name, type: name === 'observationHash' ? 'bytes32' : 'uint256' })), stateMutability: 'view' }];
const noSwap = expectedExecution({ winner: 0n, targetBps: 0n, stableBalance: 199480000n, assetBalance: 0n, ...prices });

async function runProbe(options = {}) {
  const { chain, state } = fakeChain(options); const events = [];
  const label = name => `round9:${name}`;
  const c = namedFake(chain);
  const probe = await manipulationProbe({ chain: c, id: 9n, label, pair: A.pair, expectedSwap: options.expectedSwap ?? noSwap, maxSlippageBps: 100n, stableAmount: options.stableAmount ?? 5000n * 1000000n, emit: e => events.push(e) });
  if (probe) await finishProbe({ chain: c, id: 9n, label, probe, settlement: { transactionHash: '0x' + 'ee'.repeat(32), blockNumber: state.block }, prices: { ...prices, publishedAt: 1000n }, emit: e => events.push(e) });
  return { events, state };
}

test('manipulation probe: owner-only exact approvals, pool pushed and restored, return proven oracle-marked, module buy check rejects', async () => {
  const { events, state } = await runProbe();
  assert.deepEqual(state.sent, ['round9:probe:approve', 'round9:probe:swap', 'round9:probe:approveRestore', 'round9:probe:restore'], 'exact approvals are consumed, so no reset tx is needed');
  const [event] = events; assert.equal(events.length, 1); assert.equal(event.stage, 'manipulation-probe'); assert.equal(event.status, 'complete');
  assert.equal(event.stableAllowanceAfter, 0n); assert.equal(event.assetAllowanceAfter, 0n);
  assert.ok(event.manipulated.poolAssetPriceX18 > event.before.poolAssetPriceX18 * 112n / 100n, 'a 5000 USDC push on an 80000 USDC pool moves price >12%');
  assert.ok(event.poolDeviationManipulatedBps > 1000n);
  assert.equal(event.settlement.usedOracle, true);
  assert.equal(event.settlement.oracleRecomputedReturnX18, event.settlement.measuredReturnX18);
  assert.notEqual(event.settlement.poolMarkedReturnX18, event.settlement.measuredReturnX18, 'the pool mark would have given a different return');
  assert.equal(event.moduleCheck.computedNotExecuted, true);
  assert.equal(event.moduleCheck.before.buyAsset.wouldReject, false); assert.equal(event.moduleCheck.manipulated.buyAsset.wouldReject, true);
  assert.equal(event.moduleCheck.manipulated.sellAsset.wouldReject, false);
  assert.ok(event.stableRecovered < 5000n * 1000000n && event.stableRecovered > 4900n * 1000000n, 'two 0.3% fees lost on the round trip');
  assert.ok(event.restored.reserveStable > event.before.reserveStable && event.restored.reserveStable - event.before.reserveStable < 50000000n);
  assert.deepEqual(event.transactions.map(t => t.label), state.sent);
});

test('manipulation probe detects a tracker that marked to the pool (discriminating), and refuses without operator funds', async () => {
  const pooled = await runProbe({ trackerUsesPool: true });
  assert.equal(pooled.events[0].status, 'complete-oracle-mismatch'); assert.equal(pooled.events[0].settlement.usedOracle, false);
  const broke = await runProbe({ ownerStable: 10n });
  assert.equal(broke.events.length, 1); assert.equal(broke.events[0].stage, 'manipulation-probe-failed'); assert.match(broke.events[0].reason, /lacks the probe/);
  assert.deepEqual(broke.state.sent, [], 'no transaction before the balance check');
});

// ---------------------------------------------------------------- reputation expectations
test('reputation: per-round point is sign(return - 1); samples = previous + 1; score is cumulative', () => {
  assert.equal(roundIdOf('2'), 2n); assert.equal(reputationLabel(2n), 'reputation:round2');
  for (const bad of ['0', '-1', '1.5', '', undefined, 0, '01']) assert.throws(() => roundIdOf(bad), /--round/, String(bad));
  assert.deepEqual([pointOf(ONE + 1n), pointOf(ONE), pointOf(ONE - 1n)], [1n, 0n, -1n]);
  const fresh = expectedAfterRecord({ factor: 993541889635073190n, previousStatistics: [0n, 0n, 0n, 0n], previousScore: 0n });
  assert.deepEqual(fresh, { point: -1n, statistics: [1n, 0n, 1n, 0n], score: -1n }, 'matches the recorded Tidepool round 1');
  const second = expectedAfterRecord({ factor: ONE + 5n, previousStatistics: [1n, 0n, 1n, 0n], previousScore: -1n });
  assert.deepEqual(second, { point: 1n, statistics: [2n, 1n, 1n, 0n], score: 0n }, 'cumulative score, not the per-round point');
  assert.deepEqual(expectedAfterRecord({ factor: ONE, previousStatistics: [2n, 1n, 1n, 0n], previousScore: 0n }).statistics, [3n, 1n, 1n, 1n], 'flat counts as flat');
  checkRecordedOutcome({ expected: second, statistics: [2n, 1n, 1n, 0n], score: 0n });
  assert.throws(() => checkRecordedOutcome({ expected: second, statistics: [1n, 1n, 1n, 0n], score: 0n }), /expected samples 2/);
  assert.throws(() => checkRecordedOutcome({ expected: second, statistics: [2n, 1n, 1n, 0n], score: 1n }), /cumulative score/);
  assert.throws(() => expectedAfterRecord({ factor: ONE, previousStatistics: [1n, 1n, 0n, 0n], previousScore: 0n }), /inconsistent/);
  const agent = '0x' + '8b'.repeat(20);
  const event = point => [{ eventName: 'OutcomeRecorded', args: { roundId: 2n, agent, returnFactorX18: ONE + 5n, point } }];
  assert.equal(checkOutcomeEvent({ events: event(1), roundId: 2n, agent, factor: ONE + 5n }), 1n);
  assert.throws(() => checkOutcomeEvent({ events: event(-1), roundId: 2n, agent, factor: ONE + 5n }), /sign/);
  assert.throws(() => checkOutcomeEvent({ events: event(1), roundId: 3n, agent, factor: ONE + 5n }), /another round/);
  assert.throws(() => checkOutcomeEvent({ events: [], roundId: 2n, agent, factor: ONE + 5n }), /exactly one/);
});

test('worker source uses the pre-registered window for openRound and no longer hard-codes proposal 3 or a 180s horizon', async () => {
  const source = await readFile(new URL('scripts/aurora-agent-round.mjs', ROOT), 'utf8');
  assert.match(source, /'openRound', \[end, horizon, /);
  assert.match(source, /const evaluation = end \+ horizon;/);
  assert.doesNotMatch(source, /winner === 3n/);
  assert.match(source, /requireScriptedWinner\(/); assert.match(source, /requireSwapRule\(/);
  const recorder = await readFile(new URL('runtime/tidepool/record.mjs', ROOT), 'utf8');
  assert.doesNotMatch(recorder, /id=1n/); assert.doesNotMatch(recorder, /'reputation:round1'/);
});
