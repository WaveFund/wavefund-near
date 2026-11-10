export function anonymousStrategies(proposals, currentAllocationBps) {
  return proposals.map(p => {
    const turnoverBps = p.id === 0 ? 0 : Math.abs(p.allocationBps - currentAllocationBps);
    return { proposalId: p.id, allocationBps: p.allocationBps, isHold: p.id === 0, turnoverBps,
      swapFeeEstimatePortfolioBps: turnoverBps * 30 / 10000,
      feeNote: p.id === 0 ? 'Hold preserves quantities and pays no rebalance swap fee.' : 'Approximate router fee as a fraction of total portfolio, excluding slippage and gas.' };
  });
}
