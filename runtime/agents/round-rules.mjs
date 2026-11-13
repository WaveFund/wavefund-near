// Pure run-phase rules for pre-registered Aurora rounds. No network, signing or clock: the worker supplies chain reads.
import { encodeAbiParameters, keccak256 } from 'viem';
import { DEFAULT_EVALUATION_SECONDS, evaluationSecondsOf, scriptedTargetOf } from './strategy-team.mjs';

const BPS = 10000n; const ONE = 10n ** 18n;
export const MAX_PROBE_STABLE = 20000n * 1000000n; // 20,000 test USDC (6 decimals)
const check = (condition, message) => { if (!condition) throw new Error(message); };
const min = (a, b) => a < b ? a : b;
const max = (a, b) => a > b ? a : b;

// Terms come from the pre-registered plan. A config value may only repeat them, never override them.
export function runTerms({ config = {}, plan, hybrid }) {
  const evaluationSeconds = evaluationSecondsOf(plan?.evaluationSeconds ?? DEFAULT_EVALUATION_SECONDS);
  if (config.evaluationSeconds !== undefined) check(evaluationSecondsOf(config.evaluationSeconds) === evaluationSeconds, 'Run evaluation window differs from the pre-registered plan');
  let scriptedTarget = null;
  if (hybrid) {
    scriptedTarget = scriptedTargetOf(plan?.scriptedTarget);
    if (config.scriptedTarget !== undefined) check(config.scriptedTarget === scriptedTarget, 'Run target differs from the pre-registered plan');
  } else check(config.scriptedTarget === undefined && plan?.scriptedTarget === undefined, 'Only hybrid rounds carry a scripted target');
  const probe = config.manipulationProbe === undefined || config.manipulationProbe === null ? null : probeAmountOf(config.manipulationProbe);
  return { evaluationSeconds, scriptedTarget, manipulationProbe: probe };
}

export function probeAmountOf(probe) {
  check(probe && typeof probe === 'object' && !Array.isArray(probe) && Object.keys(probe).join() === 'stableAmount', 'Manipulation probe takes only stableAmount');
  check(typeof probe.stableAmount === 'string' && /^[1-9][0-9]{0,15}$/.test(probe.stableAmount), 'Probe stableAmount must be a positive 6-decimal integer string');
  const stableAmount = BigInt(probe.stableAmount);
  check(stableAmount <= MAX_PROBE_STABLE, 'Probe exceeds the 20000 test USDC cap');
  return { stableAmount };
}

export function requireScriptedWinner({ hybrid, scriptedTarget, winner }) {
  if (!hybrid) return;
  check(typeof winner === 'bigint' && winner === BigInt(scriptedTargetOf(scriptedTarget)), 'Scripted target did not win; do not claim AI-strategy rebalance');
}

const mulDiv = (a, b, d) => a * b / d;
// Mirrors TradingSafeModule.execute: Hold (winner 0) or an unchanged value split never swaps.
export function expectedExecution({ winner, targetBps, stableBalance, assetBalance, stablePrice, assetPrice, maxSlippageBps = 100n, minOut = 0n }) {
  for (const value of [winner, targetBps, stableBalance, assetBalance, stablePrice, assetPrice, maxSlippageBps]) check(typeof value === 'bigint' && value >= 0n, 'Execution inputs must be non-negative bigints');
  check(targetBps <= BPS && stablePrice > 0n && assetPrice > 0n, 'Invalid execution inputs');
  const assetValue = mulDiv(assetBalance, assetPrice, ONE);
  const startingValue = mulDiv(stableBalance, stablePrice, 1000000n) + assetValue;
  check(startingValue > 0n, 'Empty portfolio');
  const targetValue = mulDiv(startingValue, targetBps, BPS);
  let buyAsset = null; let amountIn = 0n; let expected = 0n;
  if (winner !== 0n && targetValue > assetValue) {
    buyAsset = true; amountIn = min(stableBalance, mulDiv(targetValue - assetValue, 1000000n, stablePrice));
    expected = mulDiv(mulDiv(amountIn, stablePrice, 1000000n), ONE, assetPrice);
  } else if (winner !== 0n && assetValue > targetValue) {
    buyAsset = false; amountIn = min(assetBalance, mulDiv(assetValue - targetValue, ONE, assetPrice));
    expected = mulDiv(mulDiv(amountIn, assetPrice, ONE), 1000000n, stablePrice);
  }
  const required = amountIn !== 0n;
  return { required, buyAsset: required ? buyAsset : null, amountIn, expectedOut: expected, startingValue,
    minimumOut: required ? max(1n, max(minOut, mulDiv(expected, BPS - maxSlippageBps, BPS))) : 0n };
}

// A swap is required exactly when the module's own arithmetic moves value; otherwise any swap is unexpected.
export function requireSwapRule({ expected, swaps }) {
  check(Array.isArray(swaps), 'Swap list missing');
  if (expected.required) check(swaps.length > 0, 'Target allocation differs from current: an actual investment AMM swap was required');
  else check(swaps.length === 0, 'Target allocation equals current (or Hold): no AMM swap was expected');
}

// Uniswap-V2 constant product with a 0.3% input fee.
export function v2AmountOut(amountIn, reserveIn, reserveOut) {
  check(amountIn > 0n && reserveIn > 0n && reserveOut > 0n, 'Empty pool or zero input');
  const withFee = amountIn * 997n;
  return withFee * reserveOut / (reserveIn * 1000n + withFee);
}
// USD-per-asset price implied by pool reserves, X18, treating one test USDC as one dollar.
export const poolAssetPriceX18 = ({ reserveStable, reserveAsset }) => reserveStable * 10n ** 12n * ONE / reserveAsset;
export const deviationBps = (price, reference) => (price - reference) * BPS / reference;

export function orderedReserves({ token0, reserve0, reserve1, stable }) {
  const stableIsToken0 = token0.toLowerCase() === stable.toLowerCase();
  return { reserveStable: stableIsToken0 ? reserve0 : reserve1, reserveAsset: stableIsToken0 ? reserve1 : reserve0 };
}

// Would the module's oracle-anchored minimum output reject a swap at these (manipulated) pool reserves? Computed only.
export function moduleCheckAtPool({ reserves, stablePrice, assetPrice, maxSlippageBps, referenceStableIn, referenceAssetIn }) {
  const buy = expectedFor(true, referenceStableIn); const sell = expectedFor(false, referenceAssetIn);
  function expectedFor(buyAsset, amountIn) {
    const expected = buyAsset ? mulDiv(mulDiv(amountIn, stablePrice, 1000000n), ONE, assetPrice) : mulDiv(mulDiv(amountIn, assetPrice, ONE), 1000000n, stablePrice);
    const minimumOut = max(1n, mulDiv(expected, BPS - maxSlippageBps, BPS));
    const poolOut = buyAsset ? v2AmountOut(amountIn, reserves.reserveStable, reserves.reserveAsset) : v2AmountOut(amountIn, reserves.reserveAsset, reserves.reserveStable);
    return { amountIn, oracleExpectedOut: expected, minimumOut, poolOut, wouldReject: poolOut < minimumOut };
  }
  return { maxSlippageBps, buyAsset: buy, sellAsset: sell };
}

// PerformanceTracker.settle recomputation: valueOf(stable, asset, oracle prices) / starting value, plus the tracker's
// observation hash, which binds the exact oracle prices it used (not the pool).
export function recomputeSettlement({ chainId, tracker, roundId, portfolio, stablePrice, assetPrice, publishedAt }) {
  const endingValue = mulDiv(portfolio.stableQty6, stablePrice, 1000000n) + mulDiv(portfolio.assetQty18, assetPrice, ONE);
  const returnX18 = mulDiv(endingValue, ONE, portfolio.startingValueX18);
  const observationHash = keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }],
    [BigInt(chainId), tracker, roundId, stablePrice, assetPrice, publishedAt]));
  return { endingValue, returnX18, observationHash,
    matchesTracker: returnX18 === portfolio.realisedReturn && observationHash.toLowerCase() === String(portfolio.observationHash).toLowerCase() && publishedAt === portfolio.oraclePublishedAt };
}

export function roundScope({ hybrid, swarm, scriptedTarget, evaluationSeconds, probe }) {
  const window = `Evaluation window ${evaluationSeconds}s after trading end.`;
  const probeText = probe ? ` Operator manipulation probe swapped ${probe.stableAmount} raw test USDC through the investment pool after execution; return is still oracle-marked.` : '';
  if (hybrid) return `HYBRID TEST: four genuine NEAR AI proposer calls with assigned exposure mandates; four SCRIPTED forecasters deliberately target pre-registered proposal${scriptedTarget}. ${window} Actual testnet swaps/payouts are not evidence of AI forecasting alpha.${probeText}`;
  if (swarm) return `Eight separate agent wallets; four genuine proposer and four genuine forecaster calls to the same NEAR AI model. Test assets, no verified attestation, no forced winner or trade. ${window}${probeText}`;
  return `Four separate agent wallets and four separately prompted calls to the same NEAR AI model; test assets, no verified attestation, no forced winner or trade. ${window}${probeText}`;
}

/** Outside (non-operator) depositors in a round, from Deposited events: address → summed deposit. Operator forecasters are excluded. */
export function externalDepositors({ deposits, own }) {
  const mine = new Set((own ?? []).map((address) => String(address).toLowerCase()));
  const totals = new Map();
  for (const item of deposits ?? []) {
    const user = String(item.user).toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(user)) throw new Error('Invalid depositor address');
    if (mine.has(user)) continue;
    const amount = BigInt(item.amount);
    if (amount <= 0n) throw new Error('Invalid deposit amount');
    totals.set(user, (totals.get(user) ?? 0n) + amount);
  }
  return [...totals.entries()].map(([user, amount]) => ({ user, amount }));
}

/** Forecast collateral conservation including outside depositors: what came in equals what is left plus what was paid out. */
export function collateralReconciles({ beforeEngine, ownDeposits, externalDeposits, engineBalance, reserve, payouts }) {
  const paid = (payouts ?? []).reduce((sum, value) => sum + BigInt(value), 0n);
  return BigInt(engineBalance) === BigInt(reserve) && BigInt(beforeEngine) + BigInt(ownDeposits) + BigInt(externalDeposits) === BigInt(engineBalance) + paid;
}

// ---------------------------------------------------------------- pool alignment (operator arbitrage before a round)
// The investment pair is a private test pool with no arbitrageurs, so its price drifts from the oracle. Before a round
// the operator trades it back to the authenticated oracle price, as an arbitrageur would on a public market.
export const ALIGN_TARGET_BPS = 10n; // the trade must land the pool mid price within this of the oracle
export const ALIGN_NONE_BPS = 25n; // already this close: no trade
export const MAX_ALIGN_ASSET = 5n * ONE; // 5 test ETH (18 decimals)
export const MAX_ALIGN_STABLE = 20000n * 1000000n; // 20,000 test USDC (6 decimals)
const absolute = (x) => x < 0n ? -x : x;
/** Pool mid price of one asset in USD X18: reserves give test USDC per asset, the oracle converts USDC to USD. */
export const poolAssetUsdX18 = (reserves, stablePrice) => poolAssetPriceX18(reserves) * stablePrice / ONE;
const withinBps = (price, reference, bps) => absolute(price - reference) * BPS <= bps * reference;

/**
 * Smallest exact-input V2 swap that moves the pool mid price to (just past) the oracle price.
 * reserves: { reserveStable (6 dec), reserveAsset (18 dec) } as orderedReserves returns them.
 * stablePrice, assetPrice: oracle USD prices X18, exactly as SupraPortfolioOracle.read() returns them.
 */
export function alignmentTrade({ reserves, stablePrice, assetPrice, feeBps = 30n }) {
  const { reserveStable, reserveAsset } = reserves ?? {};
  for (const value of [reserveStable, reserveAsset, stablePrice, assetPrice, feeBps]) check(typeof value === 'bigint', 'Alignment inputs must be bigints');
  check(reserveStable > 0n && reserveAsset > 0n, 'Empty investment pool');
  check(stablePrice > 0n && assetPrice > 0n, 'Oracle prices must be positive');
  check(feeBps === 30n, 'Only the 0.3% V2 pool fee is modelled');
  const priceBefore = poolAssetUsdX18(reserves, stablePrice);
  const common = { oracleAssetPrice: assetPrice, oracleStablePrice: stablePrice, reservesBefore: { reserveStable, reserveAsset }, priceBefore, deviationBeforeBps: deviationBps(priceBefore, assetPrice) };
  if (withinBps(priceBefore, assetPrice, ALIGN_NONE_BPS)) {
    return { direction: 'none', amountIn: 0n, expectedOut: 0n, ...common, reservesAfter: common.reservesBefore, priceAfter: priceBefore, deviationAfterBps: common.deviationBeforeBps };
  }
  const sell = priceBefore > assetPrice; // pool overprices the asset: sell asset into it
  const after = (amountIn) => {
    const out = sell ? v2AmountOut(amountIn, reserveAsset, reserveStable) : v2AmountOut(amountIn, reserveStable, reserveAsset);
    const next = sell ? { reserveStable: reserveStable - out, reserveAsset: reserveAsset + amountIn } : { reserveStable: reserveStable + amountIn, reserveAsset: reserveAsset - out };
    return { out, reserves: next, price: poolAssetUsdX18(next, stablePrice) };
  };
  const reaches = (amountIn) => sell ? after(amountIn).price <= assetPrice : after(amountIn).price >= assetPrice;
  const cap = sell ? MAX_ALIGN_ASSET : MAX_ALIGN_STABLE;
  check(reaches(cap), `Alignment needs more than the ${sell ? '5 test ETH' : '20000 test USDC'} cap; refusing`);
  let low = 0n; let high = cap; // invariant: reaches(high), and low === 0n or !reaches(low)
  while (high - low > 1n) { const mid = (low + high) / 2n; if (reaches(mid)) high = mid; else low = mid; }
  const result = after(high);
  check(withinBps(result.price, assetPrice, ALIGN_TARGET_BPS), 'Alignment trade cannot land within 10 bps of the oracle');
  return { direction: sell ? 'sell-asset' : 'buy-asset', amountIn: high, expectedOut: result.out, ...common,
    reservesAfter: result.reserves, priceAfter: result.price, deviationAfterBps: deviationBps(result.price, assetPrice) };
}
/** Exact post-trade tolerance check used after the live alignment swap. */
export const alignedWithin = (price, assetPrice, bps = ALIGN_NONE_BPS) => withinBps(price, assetPrice, bps);

// ---------------------------------------------------------------- return attribution
const valueAt = (stable6, asset18, { stablePrice, assetPrice }) => mulDiv(stable6, stablePrice, 1000000n) + mulDiv(asset18, assetPrice, ONE);
/**
 * Splits a settled return into (a) the execution fill versus the oracle and (b) the oracle move on what was held.
 * startingValue is the module's oracle value of the pre-trade holdings; settlement marks the post-trade holdings at the
 * end oracle. So: return = post/start (fill gap, same oracle) × end/post (market, same holdings). Both legs must reconcile
 * exactly with the chain's numbers, otherwise the supplied oracle prices are not the ones the contracts used.
 */
export function poolGapAttribution({ startingValueX18, stableBefore6, assetBefore18, stableAfter6, assetAfter18, oraclePriceAtExecution, oraclePriceAtEnd, realisedReturnX18, executionPoolPrice }) {
  for (const value of [startingValueX18, stableBefore6, assetBefore18, stableAfter6, assetAfter18, realisedReturnX18, oraclePriceAtExecution?.stablePrice, oraclePriceAtExecution?.assetPrice, oraclePriceAtEnd?.stablePrice, oraclePriceAtEnd?.assetPrice])
    check(typeof value === 'bigint' && value >= 0n, 'Attribution inputs must be non-negative bigints');
  check(startingValueX18 > 0n, 'Empty starting value');
  check(valueAt(stableBefore6, assetBefore18, oraclePriceAtExecution) === startingValueX18, 'Starting value does not reconcile with the execution oracle prices');
  const postTradeValueX18 = valueAt(stableAfter6, assetAfter18, oraclePriceAtExecution);
  const endingValueX18 = valueAt(stableAfter6, assetAfter18, oraclePriceAtEnd);
  check(postTradeValueX18 > 0n, 'Empty post-trade portfolio');
  check(mulDiv(endingValueX18, ONE, startingValueX18) === realisedReturnX18, 'Realised return does not reconcile with the end oracle prices');
  const stableDelta = stableAfter6 - stableBefore6; const assetDelta = assetAfter18 - assetBefore18;
  check((stableDelta === 0n) === (assetDelta === 0n) && (stableDelta === 0n || (stableDelta > 0n) !== (assetDelta > 0n)), 'Holdings change is not a single swap');
  let fill = null;
  if (assetDelta !== 0n) {
    const stableAmount = absolute(stableDelta); const assetAmount = absolute(assetDelta);
    const fillPriceX18 = stableAmount * 10n ** 12n * ONE / assetAmount; // test USDC per asset
    fill = { side: assetDelta < 0n ? 'sell-asset' : 'buy-asset', stableAmount, assetAmount, fillPriceX18,
      fillPremiumBps: deviationBps(fillPriceX18 * oraclePriceAtExecution.stablePrice / ONE, oraclePriceAtExecution.assetPrice) };
  }
  const relative = (x, base) => (x - base) * ONE / base; // signed X18 fraction
  return {
    startingValueX18, postTradeValueX18, endingValueX18, realisedReturnX18,
    totalReturnX18: realisedReturnX18 - ONE,
    executionGapX18: relative(postTradeValueX18, startingValueX18), // (a) fill vs oracle, same prices before and after
    marketMoveX18: relative(endingValueX18, postTradeValueX18), // (b) oracle move on the post-trade holdings
    // Additive split in bps of the starting value: gap + market = total (up to 1 bp of truncation).
    executionGapBps: (postTradeValueX18 - startingValueX18) * BPS / startingValueX18,
    marketMoveBps: (endingValueX18 - postTradeValueX18) * BPS / startingValueX18,
    totalBps: (endingValueX18 - startingValueX18) * BPS / startingValueX18,
    fill,
    poolPremiumBps: typeof executionPoolPrice === 'bigint' ? deviationBps(executionPoolPrice * oraclePriceAtExecution.stablePrice / ONE, oraclePriceAtExecution.assetPrice) : null,
  };
}
