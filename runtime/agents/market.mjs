import { digest, ONE } from './policy.mjs';

export function validateMarket(input, { now, maxAgeSeconds = 300 } = {}) {
  if (!input || !['fixture', 'external-unverified'].includes(input.source) || !Number.isSafeInteger(input.asOf) || !Number.isSafeInteger(now) || input.asOf < 0 || input.asOf > now || now - input.asOf > maxAgeSeconds) throw new Error('Market evidence is stale, future-dated or invalid');
  if (!Array.isArray(input.history) || input.history.length < 3 || input.history.length > 64) throw new Error('Market evidence requires 3–64 history points');
  let last = -1;
  const history = input.history.map((point) => {
    if (!Number.isSafeInteger(point.timestamp) || point.timestamp < 0 || point.timestamp <= last || point.timestamp > input.asOf || typeof point.assetUsdX18 !== 'string' || !/^[1-9]\d{0,25}$/.test(point.assetUsdX18)) throw new Error('Invalid ordered price evidence');
    last = point.timestamp; return { timestamp: point.timestamp, assetUsdX18: point.assetUsdX18 };
  });
  if (last !== input.asOf || typeof input.stableUsdX18 !== 'string' || !/^[1-9]\d{0,25}$/.test(input.stableUsdX18)) throw new Error('Evidence needs current final prices');
  const prices = history.map((point) => BigInt(point.assetUsdX18));
  const bps = (a, b) => { const value = (a - b) * 10000n / b; if (value < -10000n || value > 1000000n) throw new Error('Price evidence change exceeds research bounds'); return Number(value); };
  let peak = prices[0]; let drawdown = 0; let largestMove = 0;
  for (let i = 0; i < prices.length; i++) {
    if (prices[i] > peak) peak = prices[i];
    drawdown = Math.max(drawdown, -bps(prices[i], peak));
    if (i) largestMove = Math.max(largestMove, Math.abs(bps(prices[i], prices[i - 1])));
  }
  const clean = { source: input.source, asOf: input.asOf, stableUsdX18: input.stableUsdX18, history, features: { lookbackReturnBps: bps(prices.at(-1), prices[0]), maxDrawdownBps: drawdown, largestStepBps: largestMove }, warning: input.source === 'fixture' ? 'Synthetic history for local testing; not live market data or an oracle.' : 'External research data is unverified and cannot settle the contract.' };
  return { ...clean, evidenceId: `market-${digest(clean).slice(0, 16)}` };
}
export function localResearchFixture({ now, assetUsdX18 = 2000n * ONE, stableUsdX18 = ONE }) {
  // Historical evidence only. The later evaluation price is deliberately absent.
  const multipliers = [9250n, 9500n, 9650n, 9850n, 10000n];
  return validateMarket({ source: 'fixture', asOf: now, stableUsdX18: stableUsdX18.toString(), history: multipliers.map((multiplier, i) => ({ timestamp: now - (4 - i) * 3600, assetUsdX18: (assetUsdX18 * multiplier / 10000n).toString() })) }, { now });
}
