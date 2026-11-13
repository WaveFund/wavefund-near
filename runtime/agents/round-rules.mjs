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
