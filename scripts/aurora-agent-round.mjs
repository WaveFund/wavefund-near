import { verifyPlanTee } from '../runtime/agents/tee-record.mjs';
import { proposalRationale } from '../runtime/agents/tee.mjs';
// Explicit one-round CLI. No API server, cloud scheduling, fallback agents or mainnet path.
import readline from 'node:readline';
import { parseAbi, decodeEventLog, parseUnits } from 'viem';
import { createAuroraChain, sameAddress, requireLive } from '../runtime/agents/aurora-chain.mjs';
import { makeAuroraPlan, validateAuroraPlan } from '../runtime/agents/aurora-plan.mjs';
import { chooseTrade, chooseValueTrade } from '../runtime/agents/policy.mjs';
import { namedOutputs } from '../runtime/chain.mjs';
import { recoverInterruptedRound } from '../runtime/agents/interrupted-round.mjs';
import { verifySubmittedProposals, verifyWinningProposal } from '../runtime/agents/submitted-proposals.mjs';
import { makeStrategyPlan, validateStrategyPlan, makeSwarm2Plan, validateSwarm2Plan, SWARM2_MIN_EDGE_BPS, SWARM2_TRADE_RULE, SWARM2_R_MIN, SWARM2_R_MAX, STRATEGIES, FORECASTERS } from '../runtime/agents/strategy-team.mjs';
import { SWARM2_PROPOSERS, SWARM2_FORECASTERS } from '../runtime/agents/swarm-config.mjs';
import { collectAgentResearch } from '../runtime/agents/research-context.mjs';
import { runTerms, requireScriptedWinner, expectedExecution, requireSwapRule, roundScope, externalDepositors, collateralReconciles } from '../runtime/agents/round-rules.mjs';
import { manipulationProbe, finishProbe } from '../runtime/agents/manipulation-probe.mjs';
import { alignPool } from '../runtime/agents/pool-alignment.mjs';

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const iterator = lines[Symbol.asyncIterator]();
const config = JSON.parse((await iterator.next()).value);
const emit = (event) => console.log(JSON.stringify(event, (_, v) => typeof v === 'bigint' ? v.toString() : v));
async function acknowledge(hash) {
  const next = await iterator.next();
  requireLive(!next.done && JSON.parse(next.value).ack === hash, 'Prepared journal entry was not durably acknowledged');
}
const swarm2 = config.swarm2 === true;
if (swarm2 && (config.hybrid === true || config.swarm === true)) throw new Error('Choose exactly one agent profile');
const expanded = config.hybrid === true || config.swarm === true || swarm2;
// swarm2: proposer-only TEE. verifyPlanTee checks the proposer records (6); forecasters are proxied and never claim attestation.
const teeView = plan => swarm2 ? { ...plan, records: plan.records.filter(r => r.role === 'proposer') } : plan;
const swarm2Scope = ({ evaluationSeconds, probe, tee }) => `Fourteen separate agent wallets; six genuine proposer calls and eight genuine forecaster calls, each agent on a different NEAR AI model. Forecasters give each proposal's expected return over the evaluation horizon; a fixed rule (${SWARM2_TRADE_RULE}) values one LONG at the clamped scaled payout clamp((1+R-rMin)/(rMax-rMin),0,1) of that return and one SHORT at 1 minus it, and buys only when that value beats the actual on-chain entry price by at least ${SWARM2_MIN_EDGE_BPS / 100} points. ${tee ? 'Proposer responses TEE-verified; forecaster models are proxied and unattested.' : 'No verified attestation.'} Test assets, no forced winner or trade. Evaluation window ${evaluationSeconds}s after trading end.${probe ? ` Operator manipulation probe swapped ${probe.stableAmount} raw test USDC through the investment pool after execution; return is still oracle-marked.` : ''}`;

let stage = config.phase;
try {
  if (config.phase === 'plan') {
    requireLive(!config.privateKey && !config.actorKeys, 'Wallet credentials must not enter inference process');
    requireLive(config.scriptedTarget === undefined || config.hybrid === true, 'Only the hybrid profile takes a scripted target');
    requireLive(expanded || config.evaluationSeconds === undefined || config.evaluationSeconds === 180, 'The classic profile keeps its 180 second horizon');
    const terms = expanded ? { ...(config.scriptedTarget !== undefined ? { scriptedTarget: config.scriptedTarget } : {}), ...(config.evaluationSeconds !== undefined ? { evaluationSeconds: config.evaluationSeconds } : {}) } : {};
    const plan = swarm2 ? await makeSwarm2Plan({ snapshot: config.snapshot, market: config.market, ...terms, teePolicy: config.teePolicy, researchContext: config.researchContext,
      env: { WAVEFUND_ALLOW_REMOTE_INFERENCE: '1', NEARAI_API_KEY: config.apiKey },
      onRequest: async request => { emit({ stage: 'inference-request', ...request }); await acknowledge(`inference-${request.request}`); },
      onRecord: record => emit({ stage: 'agent-record', record }) }) : await (expanded ? makeStrategyPlan : makeAuroraPlan)({ snapshot: config.snapshot, market: config.market, ...terms,
      teePolicy: config.teePolicy, scriptedForecasts: config.hybrid === true, researchContext: config.researchContext,
      env: { WAVEFUND_AGENT_MODE: 'near-ai', WAVEFUND_AGENT_MODEL: config.model, WAVEFUND_ALLOW_REMOTE_INFERENCE: '1', NEARAI_API_KEY: config.apiKey },
      onRequest: async request => { emit({ stage: 'inference-request', ...request }); await acknowledge(`inference-${request.request}`); },
      onRecord: record => emit({ stage: 'agent-record', record }) });
    emit({ stage: 'plan', plan });
  } else {
    const chain = createAuroraChain({ ...config, emit, acknowledge });
    delete config.privateKey; delete config.actorKeys;
    const { contracts, accounts, client, abi, read, tx, send, ownerCall, refresh, waitUntil } = chain;
    const proposerNames = swarm2 ? SWARM2_PROPOSERS.map(s => s.name) : expanded ? STRATEGIES.map(s => s.name) : ['Momentum', 'Conservative'];
    const forecasterNames = swarm2 ? SWARM2_FORECASTERS.map(s => s.name) : expanded ? FORECASTERS.map(s => s.name) : ['Quant', 'Guardian'];
    if (config.phase === 'recover-cancel') {
      await recoverInterruptedRound({ chain: { ...chain, roundRecord: async id => namedOutputs(abi('engine'), 'rounds', await read('engine', 'rounds', [id])) }, events: config.events, emit });
    } else if (config.phase === 'align-pool') {
      // Owner-only pre-round arbitrage of the private investment pool to the verified oracle. Refuses under a live round.
      await alignPool({ chain, manifest: config.manifest, events: config.events, emit });
    } else {
    const state = await chain.inspect();
    const nextId = BigInt(state.currentRoundId) + 1n;
    const prefix = `round${nextId}`;
    requireLive(state.activeStatus === null || [3, 4].includes(state.activeStatus), 'Previous round is still active');
    requireLive(state.pendingAuthorization === '0', 'An owner authorization is already pending');
    emit({ stage: 'actors', actors: Object.fromEntries(Object.entries(accounts).map(([name, a]) => [name, a.address])) });
    if (config.phase === 'prepare') {
      for (const name of [...proposerNames, ...forecasterNames]) {
        const address = accounts[name].address;
        const gasAmount = proposerNames.includes(name) ? 300000000000000n : 150000000000000n;
        if (await client.getBalance({ address }) < gasAmount) await send(`${prefix}:gas:${name}`, 'owner', address, '0x', gasAmount);
        const suppliedStable = sameAddress(contracts.stable, '0x38d81431b9f76d9699af7517040d5221d9dea252');
        await tx(`${prefix}:${suppliedStable ? 'transfer' : 'mint'}:${name}`, 'owner', 'stable', suppliedStable ? 'transfer' : 'mint', [address, 20000000n]);
        if (proposerNames.includes(name)) {
          const agent = await read('registry', 'agents', [address]);
          if (!agent[0]) await tx(`${prefix}:register:${name}`, name, 'registry', 'registerAgent', [name]);
          await tx(`${prefix}:bondApproval:${name}`, name, 'stable', 'approve', [contracts.registry, 1000000n]);
        } else await tx(`${prefix}:depositApproval:${name}`, name, 'stable', 'approve', [contracts.engine, 10000000n]);
      }
      emit({ stage: 'prepared-actors', roundId: nextId });
    } else if (config.phase === 'snapshot') {
      const prices = await chain.verifiedProof();
      const portfolio = await chain.portfolio(prices);
      const research = await collectAgentResearch();
      emit({ stage: 'snapshot', snapshot: { chainId: 1313161555, roundId: String(nextId), safe: contracts.safe, engine: contracts.engine, portfolio,
        blockNumber: (await client.getBlockNumber()).toString() }, ...research });
    } else if (config.phase === 'run') {
      const plan = config.plan;
      requireLive(plan, 'A completed matching-profile agent plan is required');
      await verifyPlanTee(teeView(plan), config.teePolicy);
      const prices = await chain.verifiedProof();
      const portfolio = await chain.portfolio(prices);
      (swarm2 ? validateSwarm2Plan : expanded ? validateStrategyPlan : validateAuroraPlan)(plan, { contracts, roundId: nextId, portfolio, now: Math.floor(Date.now() / 1000), scriptedForecasts: config.hybrid === true });
      const terms = runTerms({ config, plan, hybrid: config.hybrid === true });
      requireLive(BigInt(state.sponsorReserve) >= BigInt(plan.proposals.length) * 5000000n, 'All proposals need separate forecasting seed');
      const id = nextId;
      const label = name => `round${id}:${name}`;
      const beforeEngine = await read('stable', 'balanceOf', [contracts.engine]);
      const initial = Object.fromEntries(await Promise.all(forecasterNames.map(async name => [name, await read('stable', 'balanceOf', [accounts[name].address])])));
      await refresh(label('oracle:open'));
      const now = (await client.getBlock()).timestamp;
      const horizon = BigInt(terms.evaluationSeconds); // QuantumRound.openRound horizon == evaluationEnd - tradingEnd, authorized identically
      const end = now + (swarm2 ? 600n : expanded ? 420n : 300n); const evaluation = end + horizon; const deadline = end + 100n;
      emit({ stage: 'schedule', roundId: id, tradingEnd: end, evaluationEnd: evaluation, executionDeadline: deadline, evaluationSeconds: terms.evaluationSeconds, scriptedTarget: terms.scriptedTarget });
      stage = 'authorize';
      await ownerCall(label('authorize'), 'module', 'authorizeRound', [id, end, evaluation, deadline, 950000000000000000n, 1050000000000000000n, 90n]);
      const opened = await tx(label('open'), 'owner', 'engine', 'openRound', [end, horizon, 950000000000000000n, 1050000000000000000n, 90n]);
      // The value rule prices tokens with the round's actual on-chain bounds, which must be the bounds the forecasters were told.
      const bounds = namedOutputs(abi('engine'), 'rounds', await read('engine', 'rounds', [id]));
      requireLive(!swarm2 || (bounds.rMin === parseUnits(SWARM2_R_MIN, 18) && bounds.rMax === parseUnits(SWARM2_R_MAX, 18)), 'On-chain return bounds differ from the forecasters\' stated terms');
      for (const proposal of plan.proposals.filter(p => p.id > 0)) {
        stage = `propose:${proposal.name}`;
        await tx(label(`propose:${proposal.name}`), proposal.name, 'engine', 'propose', [id, { tEthBps: proposal.allocationBps }, proposalRationale(plan.records.find(r => r.role === 'proposer' && r.name === proposal.name), proposal.rationale)]);
      }
      let baselineBps = null;
      async function verifyProposalSet() {
        const round = namedOutputs(abi('engine'), 'rounds', await read('engine', 'rounds', [id]));
        requireLive(round.proposalCount === plan.proposals.length, 'Onchain proposal set changed after analysis');
        const actualProposals = [];
        for (const expected of plan.proposals) {
          const actual = namedOutputs(abi('engine'), 'proposals', await read('engine', 'proposals', [id, BigInt(expected.id)]));
          actualProposals.push({ id: expected.id, allocationBps: Number(actual.tEthBps), proposer: actual.proposer, isStatusQuo: actual.isStatusQuo });
        }
        const blockNumber = await client.getBlockNumber();
        const [stableBalance, assetBalance] = await Promise.all(['stable', 'asset'].map(token => read(token, 'balanceOf', [contracts.safe], blockNumber)));
        baselineBps = verifySubmittedProposals({ proposals: plan.proposals, actual: actualProposals, accounts, baselineBps,
          expectedBalances: plan.snapshot.portfolio, currentBalances: { stableBalance: String(stableBalance), assetBalance: String(assetBalance) } });
      }
      await verifyProposalSet();
      const decisions = [];
      for (const [forecasterIndex, forecaster] of plan.forecasts.entries()) {
        stage = `forecast:${forecaster.name}`;
        await verifyProposalSet();
        await tx(label(`deposit:${forecaster.name}`), forecaster.name, 'engine', 'deposit', [id, 10000000n]);
        const creditAmount = config.hybrid && forecasterIndex === 0 ? 400000n : 100000n;
        const blockNumber = await client.getBlockNumber();
        const quotes = await Promise.all(plan.proposals.flatMap(p => ['long', 'short'].map(async side => ({ proposalId: p.id, side, outcomeAmount: await read('market', side === 'long' ? 'quoteBuyLong' : 'quoteBuyShort', [id, BigInt(p.id), creditAmount], blockNumber) }))));
        const trade = swarm2 ? chooseValueTrade({ forecasts: forecaster.forecasts, quotes, creditAmount, rMin: bounds.rMin, rMax: bounds.rMax, minEdgeBps: plan.minEdgeBps }) : chooseTrade({ forecasts: forecaster.forecasts, quotes, creditAmount });
        if (!trade) { const decision = { name: forecaster.name, ...(swarm2 ? { model: forecaster.model } : {}), action: 'abstain', reason: swarm2 ? `No forecast payout beats the actual entry price by at least ${plan.minEdgeBps} bps (${plan.tradeRule})` : 'No forecast clears confidence and actual entry-cost edge checks' }; decisions.push(decision); emit({ stage: 'trade-decision', ...decision }); continue; }
        const decision = { name: forecaster.name, ...(swarm2 ? { model: forecaster.model } : {}), action: 'buy', ...trade }; decisions.push(decision); emit({ stage: 'trade-decision', ...decision });
        await tx(label(`claim:${forecaster.name}`), forecaster.name, 'engine', 'claimCredits', [id, BigInt(trade.proposalId), 10000000n]);
        await tx(label(`trade:${forecaster.name}`), forecaster.name, 'engine', trade.side === 'long' ? 'buyLong' : 'buyShort', [id, BigInt(trade.proposalId), creditAmount, trade.minimumOutcomes]);
      }
      emit({ stage: 'waiting', until: end }); await waitUntil(end);
      stage = 'collapse';
      await verifyProposalSet();
      await tx(label('collapse'), 'owner', 'engine', 'collapse', [id]);
      const [winner, allocation] = await read('engine', 'winningAllocation', [id]);
      verifyWinningProposal({ proposals: plan.proposals, winner: Number(winner), allocationBps: Number(allocation), baselineBps });
      requireScriptedWinner({ hybrid: config.hybrid === true, scriptedTarget: terms.scriptedTarget, winner });
      emit({ stage: 'winner', winner, allocationBps: allocation });
      stage = 'execution';
      const [executeStablePrice, executeAssetPrice] = await refresh(label('oracle:execute'));
      const maxSlippageBps = BigInt(await read('module', 'maxSlippageBps'));
      const expectedSwap = expectedExecution({ winner, targetBps: BigInt(allocation), stableBalance: BigInt(plan.snapshot.portfolio.stableBalance), assetBalance: BigInt(plan.snapshot.portfolio.assetBalance),
        stablePrice: executeStablePrice, assetPrice: executeAssetPrice, maxSlippageBps });
      const execution = await tx(label('execute'), 'owner', 'module', 'execute', [id, 0n, deadline]);
      requireLive(await read('engine', 'roundExecuted', [id]), 'Strategy execution was not recorded');
      for (const token of ['stable', 'asset']) requireLive(await read(token, 'allowance', [contracts.safe, contracts.router]) === 0n, 'Safe router allowance remained live');
      const factory = '0x60913758635b54e6C9685f92201A5704eEe74748';
      const pair = await client.readContract({ address: factory, abi: parseAbi(['function getPair(address,address) view returns(address)']), functionName: 'getPair', args: [contracts.stable, contracts.asset] });
      if (config.manifest?.integrations?.investmentPair) requireLive(sameAddress(config.manifest.integrations.investmentPair, pair), 'Manifest investment pair differs from the factory pair');
      const swapAbi = parseAbi(['event Swap(address indexed sender,uint256 amount0In,uint256 amount1In,uint256 amount0Out,uint256 amount1Out,address indexed to)']);
      const swaps = execution.logs.filter(x => sameAddress(x.address, pair)).flatMap(entry => { try { return [decodeEventLog({ abi: swapAbi, ...entry }).args]; } catch { return []; } });
      requireLive(swaps.every(s => sameAddress(s.to, contracts.safe)), 'Unexpected AMM recipient');
      if (config.hybrid) requireSwapRule({ expected: expectedSwap, swaps });
      emit({ stage: 'execution', hash: execution.transactionHash, swaps, expectedSwap: { required: expectedSwap.required, buyAsset: expectedSwap.buyAsset, amountIn: expectedSwap.amountIn, minimumOut: expectedSwap.minimumOut },
        note: swaps.length ? 'Actual investment AMM swap' : 'Chosen allocation required no swap; do not claim a venue fill' });
      const probe = terms.manipulationProbe ? await manipulationProbe({ chain, id, label, pair, expectedSwap, maxSlippageBps, stableAmount: terms.manipulationProbe.stableAmount, emit, setStage: value => { stage = value; } }) : null;
      emit({ stage: 'waiting', until: evaluation }); await waitUntil(evaluation);
      stage = 'settlement';
      const [settleStablePrice, settleAssetPrice, settlePublishedAt] = await refresh(label('oracle:settle'), evaluation);
      const settlement = await tx(label('settle'), 'owner', 'tracker', 'settle', [id]);
      if (probe) await finishProbe({ chain, id, label, probe, settlement, prices: { stablePrice: settleStablePrice, assetPrice: settleAssetPrice, publishedAt: settlePublishedAt }, emit, setStage: value => { stage = value; } });
      const payouts = [];
      for (const name of forecasterNames) {
        stage = `redeem:${name}`;
        const address = accounts[name].address;
        const preview = await read('engine', 'previewRedeem', [id, address]);
        const before = await read('stable', 'balanceOf', [address]);
        await tx(label(`redeem:${name}`), name, 'engine', 'redeem', [id]);
        const after = await read('stable', 'balanceOf', [address]);
        requireLive(after - before === preview, 'Actual redemption differs from preview');
        payouts.push({ name, address, deposit: '10000000', payout: preview, profitLoss: after - initial[name] });
      }
      // Outside wallets that forecast in this round are settled with redeemFor: the contract pays the user directly.
      const depositedEvent = parseAbi(['event Deposited(uint256 indexed roundId, address indexed user, uint256 amount)'])[0];
      const depositLogs = await client.getLogs({ address: contracts.engine, event: depositedEvent, args: { roundId: id }, fromBlock: opened.blockNumber, toBlock: 'latest' });
      const external = externalDepositors({ deposits: depositLogs.map(log => log.args), own: forecasterNames.map(name => accounts[name].address) });
      const externalPayouts = [];
      for (const [index, { user, amount }] of external.entries()) {
        stage = `redeemFor:${index + 1}`;
        const preview = await read('engine', 'previewRedeem', [id, user]);
        if (preview > 0n) await tx(label(`redeemFor:wallet${index + 1}`), 'owner', 'engine', 'redeemFor', [id, user]);
        // The payout is whatever the chain's Redeemed event says, whether the user redeemed themselves or we called redeemFor.
        const redeemedEvent = parseAbi(['event Redeemed(uint256 indexed roundId, address indexed user, uint256 payout)'])[0];
        const redeemedLogs = await client.getLogs({ address: contracts.engine, event: redeemedEvent, args: { roundId: id, user }, fromBlock: opened.blockNumber, toBlock: 'latest' });
        requireLive(redeemedLogs.length === 1, 'Outside depositor must have exactly one redemption');
        const paid = redeemedLogs[0].args.payout;
        requireLive(preview === 0n || paid === preview, 'Outside redemption differs from preview');
        externalPayouts.push({ address: user, deposit: amount, payout: paid, redeemedBy: preview > 0n ? 'operator-redeemFor' : 'self', transactionHash: redeemedLogs[0].transactionHash });
        emit({ stage: 'external-redemption', address: user, deposit: amount, payout: paid, transactionHash: redeemedLogs[0].transactionHash });
      }
      const round = namedOutputs(abi('engine'), 'rounds', await read('engine', 'rounds', [id]));
      const portfolioResult = namedOutputs(abi('tracker'), 'portfolios', await read('tracker', 'portfolios', [id]));
      const engineBalance = await read('stable', 'balanceOf', [contracts.engine]);
      const reserve = await read('engine', 'protocolLiquiditySeed');
      requireLive(round.status === 3 && round.seedReleased && round.depositsOutstanding === 0n, 'Round liabilities not cleared');
      requireLive(collateralReconciles({ beforeEngine, ownDeposits: BigInt(forecasterNames.length) * 10000000n, externalDeposits: external.reduce((sum, item) => sum + item.amount, 0n),
        engineBalance, reserve, payouts: [...payouts.map(p => p.payout), ...externalPayouts.map(p => p.payout)] }), 'Forecast collateral does not reconcile');
      emit({ stage: 'complete', chainId: 1313161555, roundId: id, winner, allocation, round, portfolio: portfolioResult, payouts, externalPayouts, decisions, reserve,
        provider: plan.provider, recordHashes: plan.records.map(r => ({ name: r.name, ...(swarm2 ? { model: r.model } : {}), inputHash: r.inputHash, outputHash: r.outputHash })),
        evaluationSeconds: terms.evaluationSeconds, scriptedTarget: terms.scriptedTarget,
        scope: swarm2 ? swarm2Scope({ evaluationSeconds: terms.evaluationSeconds, probe: terms.manipulationProbe, tee: plan.teeRequired === true }) : roundScope({ hybrid: config.hybrid === true, swarm: config.swarm === true, scriptedTarget: terms.scriptedTarget, evaluationSeconds: terms.evaluationSeconds, probe: terms.manipulationProbe }) });
    } else throw new Error('Unknown phase');
    }
  }
} catch (error) {
  emit({ stage, status: 'failed', errorName: error.name, reason: error.shortMessage ?? (error.name === 'Error' ? error.message : 'Inspect the known prepared hash; no automatic retry') });
  process.exitCode = 1;
} finally { lines.close(); }
