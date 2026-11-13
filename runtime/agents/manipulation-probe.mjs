import { requireLive, sameAddress } from './aurora-chain.mjs';
import { namedOutputs } from '../chain.mjs';
import { v2AmountOut, poolAssetPriceX18, deviationBps, orderedReserves, moduleCheckAtPool, recomputeSettlement } from './round-rules.mjs';

// Operator manipulation-resistance probe. Owner wallet only, exact approvals reset to zero, every tx journaled.
// Probe failures are reported, never allowed to strand the round before settlement/redemption.
export async function manipulationProbe({ chain, id, label, pair, expectedSwap, maxSlippageBps, stableAmount, emit, setStage = () => {} }) {
  const { contracts, accounts, client, abi, read, tx } = chain; const owner = accounts.owner.address;
  const probe = { pair, router: contracts.router, stableAmount, transactions: [], status: 'started' };
  const reservesAt = async blockNumber => {
    const [reserve0, reserve1] = await client.readContract({ address: pair, abi: abi('pair'), functionName: 'getReserves', blockNumber });
    const reserves = orderedReserves({ token0: probe.token0, reserve0, reserve1, stable: contracts.stable });
    return { blockNumber, ...reserves, poolAssetPriceX18: poolAssetPriceX18(reserves) };
  };
  const send = async (name, ...args) => { const receipt = await tx(label(name), 'owner', ...args); probe.transactions.push({ label: label(name), hash: receipt.transactionHash, blockNumber: receipt.blockNumber }); return receipt; };
  try {
    setStage('manipulation-probe');
    requireLive(sameAddress(await read('module', 'router'), contracts.router), 'Module router differs from manifest router');
    probe.token0 = await client.readContract({ address: pair, abi: abi('pair'), functionName: 'token0' });
    const token1 = await client.readContract({ address: pair, abi: abi('pair'), functionName: 'token1' });
    requireLive([probe.token0, token1].every(t => sameAddress(t, contracts.stable) || sameAddress(t, contracts.asset)) && !sameAddress(probe.token0, token1), 'Pair is not the investment pair');
    requireLive(await read('stable', 'balanceOf', [owner]) >= stableAmount, 'Operator lacks the probe test USDC');
    probe.before = await reservesAt(await client.getBlockNumber());
    const [stablePrice, assetPrice, publishedAt] = await read('oracle', 'read');
    probe.oracleAtManipulation = { stablePrice, assetPrice, publishedAt };
    const quoted = v2AmountOut(stableAmount, probe.before.reserveStable, probe.before.reserveAsset);
    await send('probe:approve', 'stable', 'approve', [contracts.router, stableAmount]);
    const assetBefore = await read('asset', 'balanceOf', [owner]);
    const swap = await send('probe:swap', 'router', 'swapExactTokensForTokens',
      [stableAmount, quoted * 99n / 100n, [contracts.stable, contracts.asset], owner, (await client.getBlock()).timestamp + 300n]);
    probe.assetBought = await read('asset', 'balanceOf', [owner], swap.blockNumber) - assetBefore;
    requireLive(probe.assetBought > 0n, 'Probe bought no test ETH');
    if (await read('stable', 'allowance', [owner, contracts.router]) !== 0n) await send('probe:resetApproval', 'stable', 'approve', [contracts.router, 0n]);
    probe.stableAllowanceAfter = await read('stable', 'allowance', [owner, contracts.router]);
    probe.manipulated = await reservesAt(swap.blockNumber);
    // Pool price is quoted in test USDC; convert with the oracle stable price before comparing with the oracle USD price.
    probe.poolDeviationBeforeBps = deviationBps(probe.before.poolAssetPriceX18 * stablePrice / 10n ** 18n, assetPrice);
    probe.poolDeviationManipulatedBps = deviationBps(probe.manipulated.poolAssetPriceX18 * stablePrice / 10n ** 18n, assetPrice);
    const referenceStableIn = expectedSwap.required ? (expectedSwap.buyAsset ? expectedSwap.amountIn : expectedSwap.expectedOut) : 10000000n;
    const referenceAssetIn = expectedSwap.required ? (expectedSwap.buyAsset ? expectedSwap.expectedOut : expectedSwap.amountIn) : referenceStableIn * stablePrice * 10n ** 12n / assetPrice;
    const inputs = { stablePrice, assetPrice, maxSlippageBps, referenceStableIn, referenceAssetIn };
    probe.moduleCheck = { computedNotExecuted: true, referenceIsExecutedSwap: expectedSwap.required,
      before: moduleCheckAtPool({ reserves: probe.before, ...inputs }), manipulated: moduleCheckAtPool({ reserves: probe.manipulated, ...inputs }) };
    probe.status = 'manipulated';
  } catch (error) {
    probe.status = 'failed'; probe.reason = error.shortMessage ?? error.message;
    emit({ stage: 'manipulation-probe-failed', roundId: id, ...probe });
    return probe.assetBought > 0n ? probe : null; // bought test ETH is still swapped back after settlement
  }
  return probe;
}

export async function finishProbe({ chain, id, label, probe, settlement, prices, emit, setStage = () => {} }) {
  const { contracts, accounts, client, abi, read, tx } = chain; const owner = accounts.owner.address;
  const send = async (name, ...args) => { const receipt = await tx(label(name), 'owner', ...args); probe.transactions.push({ label: label(name), hash: receipt.transactionHash, blockNumber: receipt.blockNumber }); return receipt; };
  const manipulatedCleanly = probe.status === 'manipulated';
  try {
    setStage('manipulation-probe:settled');
    const portfolio = namedOutputs(abi('tracker'), 'portfolios', await read('tracker', 'portfolios', [id]));
    const [reserve0, reserve1] = await client.readContract({ address: probe.pair, abi: abi('pair'), functionName: 'getReserves', blockNumber: settlement.blockNumber });
    const atSettle = orderedReserves({ token0: probe.token0, reserve0, reserve1, stable: contracts.stable });
    probe.atSettlement = { blockNumber: settlement.blockNumber, ...atSettle, poolAssetPriceX18: poolAssetPriceX18(atSettle) };
    const recomputed = recomputeSettlement({ chainId: 1313161555, tracker: contracts.tracker, roundId: id, portfolio, ...prices });
    const poolAssetUsd = probe.atSettlement.poolAssetPriceX18 * prices.stablePrice / 10n ** 18n;
    const poolEnding = portfolio.stableQty6 * prices.stablePrice / 1000000n + portfolio.assetQty18 * poolAssetUsd / 10n ** 18n;
    probe.settlement = { settleHash: settlement.transactionHash, oracle: prices, stableQty6: portfolio.stableQty6, assetQty18: portfolio.assetQty18, startingValueX18: portfolio.startingValueX18,
      measuredReturnX18: portfolio.realisedReturn, oracleEndingValueX18: recomputed.endingValue, oracleRecomputedReturnX18: recomputed.returnX18,
      observationHash: recomputed.observationHash, usedOracle: recomputed.matchesTracker, poolMarkedReturnX18: poolEnding * 10n ** 18n / portfolio.startingValueX18 };
    setStage('manipulation-probe:restore');
    const assetIn = probe.assetBought;
    const quoted = v2AmountOut(assetIn, probe.atSettlement.reserveAsset, probe.atSettlement.reserveStable);
    const stableBefore = await read('stable', 'balanceOf', [owner]);
    await send('probe:approveRestore', 'asset', 'approve', [contracts.router, assetIn]);
    const restore = await send('probe:restore', 'router', 'swapExactTokensForTokens', [assetIn, quoted * 99n / 100n, [contracts.asset, contracts.stable], owner, (await client.getBlock()).timestamp + 300n]);
    probe.stableRecovered = await read('stable', 'balanceOf', [owner], restore.blockNumber) - stableBefore;
    if (await read('asset', 'allowance', [owner, contracts.router]) !== 0n) {
      await send('probe:resetRestoreApproval', 'asset', 'approve', [contracts.router, 0n]);
    }
    probe.assetAllowanceAfter = await read('asset', 'allowance', [owner, contracts.router]);
    const [r0, r1] = await client.readContract({ address: probe.pair, abi: abi('pair'), functionName: 'getReserves', blockNumber: restore.blockNumber });
    const restored = orderedReserves({ token0: probe.token0, reserve0: r0, reserve1: r1, stable: contracts.stable });
    probe.restored = { blockNumber: restore.blockNumber, ...restored, poolAssetPriceX18: poolAssetPriceX18(restored) };
    probe.status = !manipulatedCleanly ? 'restored-after-failure' : probe.settlement.usedOracle ? 'complete' : 'complete-oracle-mismatch';
  } catch (error) { probe.status = 'failed-after-settlement'; probe.reason = error.shortMessage ?? error.message; }
  emit({ stage: 'manipulation-probe', roundId: id, ...probe });
}
