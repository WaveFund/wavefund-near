export function anonymousStrategies(proposals, currentAllocationBps) {
  if (!Number.isInteger(currentAllocationBps) || currentAllocationBps < 0 || currentAllocationBps > 10000) throw new Error('Invalid current allocation');
  return proposals.map(p => {
    if (!Number.isInteger(p.allocationBps) || p.allocationBps < 0 || p.allocationBps > 10000) throw new Error('Invalid proposal allocation');
    const turnoverBps = p.id === 0 ? 0 : Math.abs(p.allocationBps - currentAllocationBps);
    return { proposalId: p.id, allocationBps: p.allocationBps, isHold: p.id === 0, turnoverBps,
      swapFeeEstimatePortfolioBps: turnoverBps * 30 / 10000,
      feeArithmetic: { turnoverBps, routerFeeBpsOfTradedNotional: 30, portfolioFeeBpsNumerator: String(turnoverBps * 30), portfolioFeeBpsDenominator: '10000' },
      returnReference: [-100, 0, 100].map(assetReturnBps => ({ assetReturnBps, stableReturnBps: 0,
        ...estimateNetReturn({ allocationBps: p.allocationBps, turnoverBps, assetReturnBps }) })),
      feeNote: p.id === 0 ? 'Hold preserves quantities and pays no rebalance swap fee.' : 'Approximate router fee as a fraction of total portfolio, excluding slippage and gas.' };
  });
}

// Scenario references, NOT forecasts: no future data, confidence, or forced trade.
// Fixed initial weights, approximate turnover; excludes execution-induced weight
// changes, gas and slippage. Preserve exact signed fractions instead of floats.
export function estimateNetReturn({ allocationBps, turnoverBps, assetReturnBps, stableReturnBps = 0, routerFeeBps = 30 }) {
  for (const [value, min, max] of [[allocationBps, 0, 10000], [turnoverBps, 0, 10000], [assetReturnBps, -10000, 10000], [stableReturnBps, -10000, 10000], [routerFeeBps, 0, 1000]]) {
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error('Invalid fee arithmetic inputs');
  }
  const gross = BigInt(allocationBps) * BigInt(assetReturnBps) + BigInt(10000 - allocationBps) * BigInt(stableReturnBps);
  const cost = BigInt(turnoverBps) * BigInt(routerFeeBps);
  return { grossReturnBpsNumerator: gross.toString(), feeBpsNumerator: cost.toString(), netReturnBpsNumerator: (gross - cost).toString(), denominator: '10000',
    assumption: 'Hypothetical constant-weight reference; excludes gas/slippage; not a market prediction.' };
}
