import { parseAbi } from 'viem';
import { requireLive, sameAddress } from './aurora-chain.mjs';
import { alignmentTrade, alignedWithin, orderedReserves, poolAssetUsdX18, deviationBps } from './round-rules.mjs';

// Pre-round operator arbitrage: trade the private investment pool back to the authenticated oracle price.
// Owner wallet only, Aurora testnet only, never while a round is trading/collapsed or an authorization is pending.
// Every transaction goes through chain.tx, so it is journaled and acknowledged like every other operator tx.
export const AURORA_TESTNET = 1313161555;
const FACTORY_ABI = parseAbi(['function getPair(address,address) view returns(address)']);

/** A round is live (or about to be) unless the active one is Settled (3) / Cancelled (4) and nothing is authorized. */
export const roundBusy = (state) => (state.activeStatus !== null && state.activeStatus !== undefined && ![3, 4].includes(state.activeStatus)) || state.pendingAuthorization !== '0';

export async function alignPool({ chain, manifest, events = [], emit }) {
  const { contracts, accounts, client, abi, read, tx, refresh, inspect } = chain; const owner = accounts.owner.address;
  requireLive(manifest?.chainId === AURORA_TESTNET && await client.getChainId() === AURORA_TESTNET, 'Pool alignment is Aurora testnet only');
  const requireIdle = async () => requireLive(!roundBusy(await inspect()), 'A round is active or authorized; refusing to touch the investment pool');
  await requireIdle();
  const attempt = events.filter(e => e.stage === 'align-start').length + 1; // fresh labels per attempt, never a stale receipt
  const label = name => `align${attempt}:${name}`;
  emit({ stage: 'align-start', attempt });

  requireLive(sameAddress(await read('module', 'router'), contracts.router), 'Module router differs from manifest router');
  const factory = await client.readContract({ address: contracts.router, abi: abi('router'), functionName: 'factory' });
  const pair = await client.readContract({ address: factory, abi: FACTORY_ABI, functionName: 'getPair', args: [contracts.stable, contracts.asset] });
  requireLive(sameAddress(pair, manifest.integrations?.investmentPair), 'Factory pair differs from the manifest investment pair');
  const token0 = await client.readContract({ address: pair, abi: abi('pair'), functionName: 'token0' });
  const reservesAt = async (blockNumber) => {
    const [reserve0, reserve1] = await client.readContract({ address: pair, abi: abi('pair'), functionName: 'getReserves', blockNumber });
    return orderedReserves({ token0, reserve0, reserve1, stable: contracts.stable });
  };

  // The verified Supra observation, written on-chain through the same refresh path rounds use.
  const [stablePrice, assetPrice, publishedAt] = await refresh(label('oracle'));
  const before = await reservesAt();
  const trade = alignmentTrade({ reserves: before, stablePrice, assetPrice });
  const report = { attempt, pair, router: contracts.router, oracle: { stablePrice, assetPrice, publishedAt }, ...trade, transactions: [] };
  if (trade.direction === 'none') { emit({ stage: 'pool-aligned', ...report, note: 'Pool already within 25 bps of the oracle; no trade' }); return report; }

  const send = async (name, ...args) => { const receipt = await tx(label(name), 'owner', ...args); report.transactions.push({ label: label(name), hash: receipt.transactionHash, blockNumber: receipt.blockNumber }); return receipt; };
  const sell = trade.direction === 'sell-asset';
  const tokenIn = sell ? 'asset' : 'stable'; const tokenOut = sell ? 'stable' : 'asset';
  const { amountIn, expectedOut } = trade;
  if (sell) {
    requireLive(sameAddress(await read('asset', 'operator'), owner), 'Operator is not the test ETH minter');
    const held = await read('asset', 'balanceOf', [owner]);
    const minted = await send('mint', 'asset', 'mint', [owner, amountIn]);
    requireLive(await read('asset', 'balanceOf', [owner], minted.blockNumber) - held === amountIn, 'Mint did not deliver exactly the alignment amount');
  } else requireLive(await read('stable', 'balanceOf', [owner]) >= amountIn, 'Operator lacks the alignment test USDC');

  await send('approve', tokenIn, 'approve', [contracts.router, amountIn]);
  await requireIdle();
  const now = await reservesAt();
  requireLive(now.reserveStable === before.reserveStable && now.reserveAsset === before.reserveAsset, 'Pool moved since the alignment quote; refusing');
  const minimumOut = expectedOut * 995n / 1000n;
  const [inBefore, outBefore] = await Promise.all([read(tokenIn, 'balanceOf', [owner]), read(tokenOut, 'balanceOf', [owner])]);
  const swap = await send('swap', 'router', 'swapExactTokensForTokens', [amountIn, minimumOut, [contracts[tokenIn], contracts[tokenOut]], owner, (await client.getBlock()).timestamp + 300n]);
  const [inAfter, outAfter] = await Promise.all([read(tokenIn, 'balanceOf', [owner], swap.blockNumber), read(tokenOut, 'balanceOf', [owner], swap.blockNumber)]);
  requireLive(inBefore - inAfter === amountIn, 'Swap spent a different amount');
  const actualOut = outAfter - outBefore;
  requireLive(actualOut >= minimumOut, 'Swap delivered less than the minimum');
  if (await read(tokenIn, 'allowance', [owner, contracts.router]) !== 0n) await send('resetApproval', tokenIn, 'approve', [contracts.router, 0n]);
  const allowanceAfter = await read(tokenIn, 'allowance', [owner, contracts.router]);
  requireLive(allowanceAfter === 0n, 'Router allowance remained live');

  const after = await reservesAt(swap.blockNumber);
  const priceAfter = poolAssetUsdX18(after, stablePrice);
  const deviationAfterBps = deviationBps(priceAfter, assetPrice);
  requireLive(alignedWithin(priceAfter, assetPrice), 'Pool still more than 25 bps from the oracle after alignment');
  const aligned = { ...report, minimumOut, actualOut, allowanceAfter, swapHash: swap.transactionHash,
    expectedPriceAfter: trade.priceAfter, expectedDeviationAfterBps: trade.deviationAfterBps, reservesAfter: { blockNumber: swap.blockNumber, ...after }, priceAfter, deviationAfterBps };
  emit({ stage: 'pool-aligned', ...aligned });
  return aligned;
}
