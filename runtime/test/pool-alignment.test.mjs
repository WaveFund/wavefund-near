// Pre-round pool alignment (pure trade maths + the operator phase against an in-memory fake chain) and the
// round-return attribution. No network, keys or signing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { alignmentTrade, poolGapAttribution, v2AmountOut, orderedReserves, poolAssetUsdX18,
  ALIGN_TARGET_BPS, MAX_ALIGN_ASSET, MAX_ALIGN_STABLE } from '../agents/round-rules.mjs';
import { alignPool, roundBusy } from '../agents/pool-alignment.mjs';

const ONE = 10n ** 18n; const USD = (n) => BigInt(n) * ONE;
// Live Tidepool pair at the time of writing (token0 = test USDC): 80011.002986 USDC / 38.5177 test ETH.
const LIVE = { reserveStable: 80011002986n, reserveAsset: 38517661396650334105n };
const within = (price, reference, bps) => (price > reference ? price - reference : reference - price) * 10000n <= bps * reference;
// Independent re-implementation of the post-trade pool, so assertions do not reuse the code under test.
function applySwap({ reserveStable, reserveAsset }, sellAsset, amountIn) {
  const [rin, rout] = sellAsset ? [reserveAsset, reserveStable] : [reserveStable, reserveAsset];
  const out = amountIn * 997n * rout / (rin * 1000n + amountIn * 997n);
  return sellAsset ? { out, reserveStable: reserveStable - out, reserveAsset: reserveAsset + amountIn } : { out, reserveStable: reserveStable + amountIn, reserveAsset: reserveAsset - out };
}
const usdOf = (r, stablePrice = ONE) => r.reserveStable * 10n ** 30n / r.reserveAsset * stablePrice / ONE;

test('alignment: live stale pool (≈2077) vs oracle 1912 sells the minimal test ETH and lands on the oracle', () => {
  const trade = alignmentTrade({ reserves: LIVE, stablePrice: ONE, assetPrice: USD(1912) });
  assert.equal(trade.direction, 'sell-asset');
  assert.equal(trade.deviationBeforeBps, 864n, 'the pool overprices ETH by 8.64%');
  assert.equal(trade.amountIn, 1632505793338235063n, '≈1.6325 test ETH');
  assert.equal(trade.expectedOut, v2AmountOut(trade.amountIn, LIVE.reserveAsset, LIVE.reserveStable));
  const after = applySwap(LIVE, true, trade.amountIn);
  assert.equal(trade.expectedOut, after.out);
  assert.deepEqual(trade.reservesAfter, { reserveStable: after.reserveStable, reserveAsset: after.reserveAsset });
  assert.equal(trade.priceAfter, usdOf(after));
  assert.ok(within(trade.priceAfter, USD(1912), ALIGN_TARGET_BPS) && within(trade.priceAfter, USD(1912), 1n), 'lands within 1 bp (target 10 bps)');
  assert.ok(trade.priceAfter <= USD(1912), 'minimal amount just reaches the oracle');
  assert.ok(usdOf(applySwap(LIVE, true, trade.amountIn - 1n)) > USD(1912), 'one wei less does not reach it (minimal, rounding-exact)');
  assert.equal(trade.deviationAfterBps, 0n);
});

test('alignment: the oracle stable price converts pool USDC to USD (USDC at 0.99982)', () => {
  const stablePrice = 999820000000000000n;
  const trade = alignmentTrade({ reserves: LIVE, stablePrice, assetPrice: USD(1912) });
  assert.equal(trade.priceBefore, usdOf(LIVE, stablePrice));
  assert.notEqual(trade.amountIn, alignmentTrade({ reserves: LIVE, stablePrice: ONE, assetPrice: USD(1912) }).amountIn, 'discriminates: stable price matters');
  assert.ok(within(usdOf(applySwap(LIVE, true, trade.amountIn), stablePrice), USD(1912), 1n));
});

test('alignment: pool below the oracle buys test ETH with the minimal test USDC', () => {
  for (const eth of [100n, 300n, 340n]) {
    const reserves = { reserveStable: eth * 1800n * 1000000n, reserveAsset: eth * ONE };
    const trade = alignmentTrade({ reserves, stablePrice: ONE, assetPrice: USD(1912) });
    assert.equal(trade.direction, 'buy-asset');
    assert.ok(trade.deviationBeforeBps < -500n);
    const after = applySwap(reserves, false, trade.amountIn);
    assert.equal(trade.expectedOut, after.out);
    assert.ok(usdOf(after) >= USD(1912) && within(usdOf(after), USD(1912), ALIGN_TARGET_BPS), `${eth} ETH pool lands on the oracle`);
    assert.ok(usdOf(applySwap(reserves, false, trade.amountIn - 1n)) < USD(1912), 'minimal');
  }
  assert.equal(alignmentTrade({ reserves: { reserveStable: 100n * 1800n * 1000000n, reserveAsset: 100n * ONE }, stablePrice: ONE, assetPrice: USD(1912) }).amountIn, 5523783866n);
});

test('alignment: no trade when already within 25 bps either side; 26 bps trades', () => {
  // 76480 USDC / 40 ETH = 1912 exactly; factor is the pool price in units of 1e-4 of the oracle.
  for (const [factor, direction] of [[10000n, 'none'], [10025n, 'none'], [9975n, 'none'], [10026n, 'sell-asset'], [9974n, 'buy-asset']]) {
    const trade = alignmentTrade({ reserves: { reserveStable: 76480n * factor * 100n, reserveAsset: 40n * ONE }, stablePrice: ONE, assetPrice: USD(1912) });
    assert.equal(trade.direction, direction, String(factor));
    if (direction === 'none') { assert.equal(trade.amountIn, 0n); assert.equal(trade.expectedOut, 0n); assert.equal(trade.priceAfter, trade.priceBefore); }
    else assert.ok(trade.amountIn > 0n);
  }
});

test('alignment: refuses beyond the 5 test ETH / 20000 test USDC caps (boundary discriminates)', () => {
  const scaled = (k) => ({ reserveStable: LIVE.reserveStable * k / 100n, reserveAsset: LIVE.reserveAsset * k / 100n });
  const near = alignmentTrade({ reserves: scaled(306n), stablePrice: ONE, assetPrice: USD(1912) });
  assert.ok(near.amountIn > 4990n * ONE / 1000n && near.amountIn <= MAX_ALIGN_ASSET, '≈4.995 ETH is allowed');
  assert.throws(() => alignmentTrade({ reserves: scaled(307n), stablePrice: ONE, assetPrice: USD(1912) }), /5 test ETH cap/);
  assert.throws(() => alignmentTrade({ reserves: LIVE, stablePrice: ONE, assetPrice: USD(1000) }), /5 test ETH cap/);
  const pool = (eth) => ({ reserveStable: eth * 1800n * 1000000n, reserveAsset: eth * ONE });
  const buy = alignmentTrade({ reserves: pool(362n), stablePrice: ONE, assetPrice: USD(1912) });
  assert.ok(buy.amountIn > 19990n * 1000000n && buy.amountIn <= MAX_ALIGN_STABLE, '≈19,996 USDC is allowed');
  assert.throws(() => alignmentTrade({ reserves: pool(363n), stablePrice: ONE, assetPrice: USD(1912) }), /20000 test USDC cap/);
});

test('alignment: refuses when integer granularity cannot land within 10 bps, and rejects bad inputs', () => {
  assert.throws(() => alignmentTrade({ reserves: { reserveStable: 20n, reserveAsset: 10n ** 10n }, stablePrice: ONE, assetPrice: 20n * 10n ** 30n / 10n ** 10n * 1912n / 2077n }), /within 10 bps/);
  const ok = { reserves: LIVE, stablePrice: ONE, assetPrice: USD(1912) };
  for (const [patch, message] of [[{ feeBps: 25n }, /0.3%/], [{ feeBps: 30 }, /bigints/], [{ assetPrice: 1912 }, /bigints/], [{ stablePrice: 0n }, /positive/], [{ assetPrice: 0n }, /positive/],
    [{ reserves: { ...LIVE, reserveAsset: 0n } }, /Empty/], [{ reserves: { ...LIVE, reserveStable: 0n } }, /Empty/], [{ reserves: undefined }, /bigints/]])
    assert.throws(() => alignmentTrade({ ...ok, ...patch }), message, JSON.stringify(Object.keys(patch)));
  assert.equal(alignmentTrade({ ...ok, feeBps: 30n }).direction, 'sell-asset');
});

// ---------------------------------------------------------------- return attribution on Tidepool round 2 (real chain numbers)
// Oracle prices are the on-chain PricesVerified events of the execute (block 277466540) and settle (277469514) refreshes.
const R2 = { startingValueX18: 187692546277684744385n, stableBefore6: 49870000n, assetBefore18: 71692173391461052n, stableAfter6: 188477014n, assetAfter18: 4881432557813197n,
  oraclePriceAtExecution: { stablePrice: 999865000000000000n, assetPrice: 1922515000000000000000n },
  oraclePriceAtEnd: { stablePrice: 999820000000000000n, assetPrice: 1919075000000000000000n }, realisedReturnX18: 1053909317372203058n };

test('attribution: round 2 return is ≈ +5.40% fill-vs-oracle gap and ≈ −0.01% market move', () => {
  const a = poolGapAttribution(R2);
  assert.equal(a.executionGapBps, 540n); assert.equal(a.marketMoveBps, -1n); assert.equal(a.totalBps, 539n);
  assert.equal(a.executionGapX18, 54043971593322132n, '+5.404%');
  assert.equal(a.marketMoveX18, -127750098428556n, '−0.0128% on the post-trade holdings');
  assert.equal((ONE + a.executionGapX18) * (ONE + a.marketMoveX18) / ONE / 1000n, R2.realisedReturnX18 / 1000n, 'multiplicative legs compose to the measured return');
  assert.deepEqual({ ...a.fill }, { side: 'sell-asset', stableAmount: 138607014n, assetAmount: 66810740833647855n, fillPriceX18: 2074621719060379423561n, fillPremiumBps: 789n });
  assert.equal(poolGapAttribution({ ...R2, executionPoolPrice: 2077254954864889852256n }).poolPremiumBps, 803n, 'pool mid 2077.25 USDC vs oracle 1922.52 USD');
});

test('attribution: refuses oracle prices the contracts did not use, and non-swap holding changes', () => {
  assert.throws(() => poolGapAttribution({ ...R2, oraclePriceAtExecution: { ...R2.oraclePriceAtExecution, assetPrice: R2.oraclePriceAtExecution.assetPrice + 10n ** 15n } }), /Starting value does not reconcile/);
  assert.throws(() => poolGapAttribution({ ...R2, oraclePriceAtEnd: { ...R2.oraclePriceAtEnd, assetPrice: 1912n * ONE } }), /Realised return does not reconcile/);
  const noTrade = { startingValueX18: 0n, stableBefore6: 100000000n, assetBefore18: ONE / 10n, stableAfter6: 100000000n, assetAfter18: ONE / 10n, oraclePriceAtExecution: R2.oraclePriceAtExecution, oraclePriceAtEnd: R2.oraclePriceAtEnd };
  noTrade.startingValueX18 = 100000000n * 999865000000000000n / 1000000n + ONE / 10n * 1922515000000000000000n / ONE;
  noTrade.realisedReturnX18 = (100000000n * 999820000000000000n / 1000000n + ONE / 10n * 1919075000000000000000n / ONE) * ONE / noTrade.startingValueX18;
  const flat = poolGapAttribution(noTrade);
  assert.equal(flat.executionGapX18, 0n); assert.equal(flat.fill, null); assert.ok(flat.marketMoveX18 < 0n);
  assert.throws(() => poolGapAttribution({ ...R2, stableAfter6: R2.stableBefore6 - 1n, assetAfter18: R2.assetBefore18 - 1n, realisedReturnX18: 0n }), /reconcile|single swap/);
  const bothUp = { ...noTrade, stableAfter6: noTrade.stableAfter6 + 1n, assetAfter18: noTrade.assetAfter18 + 1n };
  bothUp.realisedReturnX18 = (bothUp.stableAfter6 * 999820000000000000n / 1000000n + bothUp.assetAfter18 * 1919075000000000000000n / ONE) * ONE / bothUp.startingValueX18;
  assert.throws(() => poolGapAttribution(bothUp), /single swap/);
  assert.throws(() => poolGapAttribution({ ...R2, realisedReturnX18: 1 }), /bigints/);
});

// ---------------------------------------------------------------- align-pool phase against a fake chain
const A = { stable: '0x' + '51'.repeat(20), asset: '0x' + 'a5'.repeat(20), router: '0x' + '70'.repeat(20), factory: '0x' + 'fa'.repeat(20), pair: '0x' + 'ba'.repeat(20), owner: '0x' + '0e'.repeat(20) };
const MANIFEST = { chainId: 1313161555, integrations: { investmentPair: A.pair } };
function fakeChain({ reserves = LIVE, oracle = [ONE, USD(1912), 1000n], ownerStable = 20000n * 1000000n, chainId = 1313161555, operator = A.owner,
  state: roundState = { activeStatus: 3, pendingAuthorization: '0' }, busyAfter = Infinity, moveOnApprove = false, routerKeepsAllowance = false, poolAbsorbs = 1n, outputCutBps = 0n, mintShortfall = 0n, pair = A.pair } = {}) {
  const state = { block: 100n, rs: reserves.reserveStable, ra: reserves.reserveAsset, balances: { stable: ownerStable, asset: 0n }, allowance: { stable: 0n, asset: 0n }, history: new Map(), sent: [], inspections: 0 };
  const snap = () => state.history.set(state.block, { rs: state.rs, ra: state.ra, balances: { ...state.balances } });
  snap();
  const at = (block) => state.history.get(block ?? state.block);
  const tx = async (label, actor, name, method, args) => {
    assert.equal(actor, 'owner'); state.sent.push(label); state.block += 1n;
    if (method === 'mint') { assert.equal(name, 'asset'); state.balances.asset += args[1] - mintShortfall; }
    if (method === 'approve') { state.allowance[name] = args[1]; if (moveOnApprove) state.rs += 1n; }
    if (method === 'swapExactTokensForTokens') {
      assert.equal(name, 'router');
      const [amountIn, minOut, path, to, deadline] = args; const buy = path[0] === A.stable; const key = buy ? 'stable' : 'asset';
      assert.equal(to, A.owner); assert.ok(deadline > 5000n);
      assert.ok(state.allowance[key] >= amountIn && state.balances[key] >= amountIn, 'router needs allowance and balance');
      const quoted = buy ? v2AmountOut(amountIn, state.rs, state.ra) : v2AmountOut(amountIn, state.ra, state.rs);
      const out = quoted * (10000n - outputCutBps) / 10000n; // a faulty router that ignores minOut
      if (outputCutBps === 0n) assert.ok(out >= minOut, 'minOut');
      if (!routerKeepsAllowance) state.allowance[key] -= amountIn;
      state.balances[key] -= amountIn; state.balances[buy ? 'asset' : 'stable'] += out;
      const [shiftIn, shiftOut] = [amountIn / poolAbsorbs, quoted / poolAbsorbs]; // a pool that does not move as quoted
      if (buy) { state.rs += shiftIn; state.ra -= shiftOut; } else { state.ra += shiftIn; state.rs -= shiftOut; }
    }
    snap(); return { transactionHash: '0x' + state.block.toString(16).padStart(64, '0'), blockNumber: state.block };
  };
  const chain = {
    contracts: { stable: A.stable, asset: A.asset, router: A.router }, accounts: { owner: { address: A.owner } }, abi: name => name,
    client: {
      getChainId: async () => chainId, getBlock: async () => ({ timestamp: 5000n, number: state.block }),
      readContract: async ({ address, functionName, args, blockNumber }) => {
        if (functionName === 'factory') { assert.equal(address, A.router); return A.factory; }
        if (functionName === 'getPair') { assert.equal(address, A.factory); assert.deepEqual(args, [A.stable, A.asset]); return pair; }
        assert.equal(address, A.pair);
        const view = at(blockNumber);
        return { getReserves: [view.rs, view.ra, 0], token0: A.stable }[functionName];
      },
    },
    read: async (name, fn, args = [], blockNumber) => {
      if (name === 'module' && fn === 'router') return A.router;
      if (name === 'asset' && fn === 'operator') return operator;
      if (fn === 'balanceOf') { assert.equal(args[0], A.owner); return at(blockNumber).balances[name]; }
      if (fn === 'allowance') return state.allowance[name];
      throw new Error(`unexpected read ${name}.${fn}`);
    },
    tx,
    refresh: async (label) => { await tx(label, 'owner', 'oracle', 'update', ['0xproof']); return oracle; },
    inspect: async () => { state.inspections += 1; return state.inspections > busyAfter ? { activeStatus: 1, pendingAuthorization: '0' } : roundState; },
  };
  return { chain, state };
}
async function align(options = {}, events = []) {
  const { chain, state } = fakeChain(options); const emitted = [];
  try { const result = await alignPool({ chain, manifest: options.manifest ?? MANIFEST, events, emit: e => emitted.push(e) }); return { result, emitted, state }; }
  catch (error) { return { error, emitted, state }; }
}

test('align-pool: sell path mints exactly, exact approval, swaps, allowance 0, pool within 25 bps, all numbers emitted', async () => {
  const { result, emitted, state, error } = await align();
  assert.equal(error, undefined);
  assert.deepEqual(state.sent, ['align1:oracle', 'align1:mint', 'align1:approve', 'align1:swap']);
  assert.deepEqual(emitted.map(e => e.stage), ['align-start', 'pool-aligned']);
  const event = emitted[1];
  assert.equal(event.direction, 'sell-asset'); assert.equal(event.amountIn, 1632505793338235063n);
  assert.equal(event.minimumOut, event.expectedOut * 995n / 1000n); assert.equal(event.actualOut, event.expectedOut);
  assert.equal(event.allowanceAfter, 0n); assert.equal(state.allowance.asset, 0n);
  assert.equal(state.balances.asset, 0n, 'every minted wei was sold into the pool');
  assert.equal(event.priceAfter, event.expectedPriceAfter); assert.equal(event.deviationAfterBps, 0n);
  assert.deepEqual(event.transactions.map(t => t.label), state.sent.slice(1));
  assert.equal(event.swapHash, event.transactions.at(-1).hash);
  assert.equal(result.direction, 'sell-asset');
  // A second attempt in the same alignment journal gets fresh labels, never a reused receipt.
  assert.deepEqual((await align({}, [{ stage: 'align-start', attempt: 1 }])).state.sent[0], 'align2:oracle');
});

test('align-pool: buy path spends operator test USDC, no mint; refuses without enough USDC', async () => {
  const low = { reserveStable: 100n * 1800n * 1000000n, reserveAsset: 100n * ONE };
  const { emitted, state, error } = await align({ reserves: low });
  assert.equal(error, undefined);
  assert.deepEqual(state.sent, ['align1:oracle', 'align1:approve', 'align1:swap']);
  assert.equal(emitted[1].direction, 'buy-asset'); assert.equal(emitted[1].amountIn, 5523783866n);
  assert.equal(state.balances.stable, 20000n * 1000000n - 5523783866n);
  const broke = await align({ reserves: low, ownerStable: 5523783865n });
  assert.match(broke.error.message, /lacks the alignment test USDC/); assert.deepEqual(broke.state.sent, ['align1:oracle']);
});

test('align-pool: none band does only the oracle refresh', async () => {
  const { emitted, state } = await align({ reserves: { reserveStable: 76480n * 1000000n, reserveAsset: 40n * ONE } });
  assert.deepEqual(state.sent, ['align1:oracle']); assert.equal(emitted.at(-1).direction, 'none');
});

test('align-pool: never under a live or authorized round, testnet only, manifest pair only, token operator only', async () => {
  assert.equal(roundBusy({ activeStatus: null, pendingAuthorization: '0' }), false);
  for (const roundState of [{ activeStatus: 1, pendingAuthorization: '0' }, { activeStatus: 2, pendingAuthorization: '0' }, { activeStatus: 3, pendingAuthorization: '7' }]) {
    const { error, state, emitted } = await align({ state: roundState });
    assert.match(error.message, /round is active or authorized/, JSON.stringify(roundState)); assert.deepEqual(state.sent, []); assert.deepEqual(emitted, []);
  }
  const late = await align({ busyAfter: 1 }); // a round opens between the quote and the swap
  assert.match(late.error.message, /round is active/); assert.ok(!late.state.sent.includes('align1:swap'));
  const mainnet = await align({ chainId: 1313161554 });
  assert.match(mainnet.error.message, /testnet only/); assert.deepEqual(mainnet.state.sent, []);
  assert.match((await align({ manifest: { ...MANIFEST, chainId: 1 } })).error.message, /testnet only/);
  const wrongPair = await align({ pair: '0x' + 'bb'.repeat(20) });
  assert.match(wrongPair.error.message, /manifest investment pair/); assert.deepEqual(wrongPair.state.sent, []);
  const notMinter = await align({ operator: '0x' + '99'.repeat(20) });
  assert.match(notMinter.error.message, /not the test ETH minter/); assert.deepEqual(notMinter.state.sent, ['align1:oracle']);
  const shortMint = await align({ mintShortfall: 1n }); // minted one wei less than asked
  assert.match(shortMint.error.message, /exactly the alignment amount/); assert.deepEqual(shortMint.state.sent, ['align1:oracle', 'align1:mint']);
});

test('align-pool: refuses a moved pool, resets a leftover allowance, and rejects a swap that leaves the pool >25 bps off', async () => {
  const moved = await align({ moveOnApprove: true });
  assert.match(moved.error.message, /Pool moved/); assert.ok(!moved.state.sent.includes('align1:swap'));
  const kept = await align({ routerKeepsAllowance: true });
  assert.equal(kept.error, undefined);
  assert.deepEqual(kept.state.sent.slice(-2), ['align1:swap', 'align1:resetApproval']); assert.equal(kept.emitted.at(-1).allowanceAfter, 0n);
  const half = await align({ poolAbsorbs: 2n }); // full output delivered, but the pool only moved half way
  assert.match(half.error.message, /more than 25 bps from the oracle/); assert.ok(!half.emitted.some(e => e.stage === 'pool-aligned'));
  const cut = await align({ outputCutBps: 100n }); // router paid 1% less than quoted, below the 99.5% minimum
  assert.match(cut.error.message, /less than the minimum/);
  assert.equal((await align({ outputCutBps: 40n })).error, undefined, 'discriminates: 0.4% short is within the 0.5% minimum');
});

test('orderedReserves + poolAssetUsdX18 read the live pair the right way round', () => {
  const r = orderedReserves({ token0: '0x38D81431B9f76d9699AF7517040D5221D9dEA252', reserve0: LIVE.reserveStable, reserve1: LIVE.reserveAsset, stable: '0x38d81431b9f76d9699af7517040d5221d9dea252' });
  assert.deepEqual(r, LIVE);
  assert.equal(poolAssetUsdX18(r, ONE) / ONE, 2077n);
});
