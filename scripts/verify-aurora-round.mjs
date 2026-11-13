// Independent read-only verification. Input contains public journal events and a manifest only.
import { readFile } from 'node:fs/promises';
import { createPublicClient, http, parseAbi, decodeEventLog } from 'viem';
import { namedOutputs } from '../runtime/chain.mjs';
let body = ''; for await (const chunk of process.stdin) body += chunk;
const { events, manifest, artifactsDir = '/work/out' } = JSON.parse(body);
const check = (condition, message) => { if (!condition) throw new Error(message); };
check(manifest.chainId === 1313161555, 'Testnet verification only');
const client = createPublicClient({ transport: http('https://testnet.aurora.dev', { retryCount: 1 }) });
check(await client.getChainId() === 1313161555, 'Wrong RPC chain');
const contracts = manifest.contracts;
const engineAbi = JSON.parse(await readFile(`${artifactsDir}/QuantumRound.sol/QuantumRound.json`)).abi;
const factoryAbi = JSON.parse(await readFile(`${artifactsDir}/ProposalTokens.sol/ProposalTokens.json`)).abi;
const trackerAbi = JSON.parse(await readFile(`${artifactsDir}/PerformanceTracker.sol/PerformanceTracker.json`)).abi;
const tokenAbi = parseAbi(['function balanceOf(address) view returns(uint256)']);
const readEngine = (functionName, args, blockNumber) => client.readContract({ address: contracts.engine, abi: engineAbi, functionName, args, blockNumber });
const schedule = events.find(e => e.stage === 'schedule'); const id = BigInt(schedule.roundId);
const collapse = events.find(e => e.stage === 'confirmed' && e.label === `round${id}:collapse`);
const pinned = BigInt(collapse.blockNumber);
const round = namedOutputs(engineAbi, 'rounds', await readEngine('rounds', [id]));
if (round.status === 4) {
  check(round.totalDeposits === 0n && round.depositsOutstanding === 0n && round.seedReleased, 'Cancellation verifier requires cleared zero-deposit experiment');
  check(!await readEngine('roundExecuted', [id]), 'Cancelled experiment executed an investment');
  const cancellation = events.find(e => e.stage === 'confirmed' && e.label === `round${id}:abortExpired`);
  check(cancellation, 'Missing cancellation receipt');
  const receipt = await client.getTransactionReceipt({ hash: cancellation.hash });
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  check(receipt.status === 'success' && receipt.to.toLowerCase() === contracts.module.toLowerCase() && block.timestamp > BigInt(schedule.executionDeadline), 'Cancellation receipt/deadline mismatch');
  const snapshot = events.find(e => e.stage === 'snapshot').snapshot.portfolio;
  const quantities = await Promise.all(['stable', 'asset'].map(t => client.readContract({ address: contracts[t], abi: tokenAbi, functionName: 'balanceOf', args: [contracts.safe] })));
  check(quantities[0] === BigInt(snapshot.stableBalance) && quantities[1] === BigInt(snapshot.assetBalance), 'Safe quantities changed in interrupted round');
  const reserve = await readEngine('protocolLiquiditySeed', []);
  const collateral = await client.readContract({ address: contracts.stable, abi: tokenAbi, functionName: 'balanceOf', args: [contracts.engine] });
  check(collateral === reserve, 'Cancelled seed not reconciled');
  console.log(JSON.stringify({ chainId: 1313161555, roundId: id, status: 'cancelled', cancellationHash: receipt.transactionHash, cancellationBlock: receipt.blockNumber, quantities, reserve, noInvestmentExecution: true, passed: true }, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
  await new Promise(resolve => process.stdout.write('', resolve)); process.exit(0);
}
check(round.status === 3, 'Round has not settled normally');
const winner = BigInt(round.winnerId);
const actors = events.find(e => e.stage === 'actors').actors;
const forecasters = events.filter(e => e.stage === 'confirmed' && e.label.startsWith(`round${id}:deposit:`)).map(e => e.actor);
const addresses = await Promise.all(['creditToken', 'longToken', 'shortToken'].map(functionName => client.readContract({ address: contracts.tokens, abi: factoryAbi, functionName, args: [id, winner], blockNumber: pinned })));
const payouts = [];
for (const name of forecasters) {
  const address = actors[name];
  const [deposit, claimed, ...balances] = await Promise.all([
    readEngine('deposits', [id, address], pinned), readEngine('creditsClaimed', [id, winner, address], pinned),
    ...addresses.map(token => client.readContract({ address: token, abi: tokenAbi, functionName: 'balanceOf', args: [address], blockNumber: pinned })),
  ]);
  const [credit, long, short] = balances;
  const unclaimedPrincipal = deposit - claimed;
  const derivedPayout = unclaimedPrincipal + credit + long * round.pi / 10n ** 30n + short * (10n ** 18n - round.pi) / 10n ** 30n;
  const paid = events.find(e => e.stage === 'confirmed' && e.label === `round${id}:redeem:${name}`);
  const receipt = await client.getTransactionReceipt({ hash: paid.hash });
  const redeemed = receipt.logs.filter(l => l.address.toLowerCase() === contracts.engine.toLowerCase()).flatMap(l => { try { const e = decodeEventLog({ abi: engineAbi, ...l }); return e.eventName === 'Redeemed' ? [e.args] : []; } catch { return []; } });
  check(receipt.status === 'success' && redeemed.length === 1 && redeemed[0].payout === derivedPayout && redeemed[0].user.toLowerCase() === address.toLowerCase(), `Wrong derived payout for ${name}`);
  check(await readEngine('previewRedeem', [id, address]) === 0n, 'Liabilities remain after redemption');
  payouts.push({ name, address, deposit, claimedWinningCredits: claimed, unclaimedPrincipal, credit, long, short, derivedPayout, actualPayout: redeemed[0].payout });
}
const fills = [];
for (const event of events.filter(e => e.stage === 'confirmed' && e.label.startsWith(`round${id}:trade:`))) {
  const decision = events.find(e => e.stage === 'trade-decision' && e.name === event.actor);
  const receipt = await client.getTransactionReceipt({ hash: event.hash });
  const bought = receipt.logs.filter(l => l.address.toLowerCase() === contracts.engine.toLowerCase()).flatMap(l => { try { const e = decodeEventLog({ abi: engineAbi, ...l }); return e.eventName === 'Bought' ? [e.args] : []; } catch { return []; } });
  check(receipt.status === 'success' && bought.length === 1, 'Missing actual Bought event');
  const fill = bought[0];
  check(fill.user.toLowerCase() === actors[event.actor].toLowerCase() && fill.proposalId === BigInt(decision.proposalId) && fill.isLong === (decision.side === 'long') && fill.credits === BigInt(decision.creditAmount) && fill.tokensOut >= BigInt(decision.minimumOutcomes), 'Actual trade differs from quoted decision');
  fills.push({ name: event.actor, hash: event.hash, ...fill });
}
const collateralAtCollapse = await client.readContract({ address: contracts.stable, abi: tokenAbi, functionName: 'balanceOf', args: [contracts.engine], blockNumber: pinned });
// Pin the ending state at this round's last redemption, so later rounds cannot change what is checked here.
const redemptions = events.filter(e => e.stage === 'confirmed' && (e.label.startsWith(`round${id}:redeem:`) || e.label.startsWith(`round${id}:redeemFor:`)));
check(redemptions.length > 0, 'Missing redemption receipts');
const endBlock = redemptions.map(e => BigInt(e.blockNumber)).reduce((a, b) => (a > b ? a : b));
const endingCollateral = await client.readContract({ address: contracts.stable, abi: tokenAbi, functionName: 'balanceOf', args: [contracts.engine], blockNumber: endBlock });
const reserve = await readEngine('protocolLiquiditySeed', [], endBlock);
check(endingCollateral === reserve && reserve + payouts.reduce((s, p) => s + p.derivedPayout, 0n) === collateralAtCollapse && round.seedReleased && round.depositsOutstanding === 0n, 'Collateral conservation failed');
const portfolio = namedOutputs(trackerAbi, 'portfolios', await client.readContract({ address: contracts.tracker, abi: trackerAbi, functionName: 'portfolios', args: [id] }));
const settlementPrices = events.find(e => e.stage === 'oracle' && e.label === `round${id}:oracle:settle`).values.map(BigInt);
const endingValue = portfolio.stableQty6 * settlementPrices[0] / 1000000n + portfolio.assetQty18 * settlementPrices[1] / 10n ** 18n;
check(endingValue * 10n ** 18n / portfolio.startingValueX18 === round.realisedReturn && portfolio.oraclePublishedAt >= round.evaluationEnd, 'Return recomputation or publication time failed');
console.log(JSON.stringify({ chainId: 1313161555, roundId: id, pinnedPreRedemptionBlock: pinned, winner, fills, payouts, collateralAtCollapse, endingCollateral, reserve, recomputedReturn: round.realisedReturn, passed: true }, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
