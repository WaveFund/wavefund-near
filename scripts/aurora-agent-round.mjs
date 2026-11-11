// Explicit one-round CLI. No API server, cloud scheduling, fallback agents or mainnet path.
import readline from 'node:readline';
import { parseAbi, decodeEventLog } from 'viem';
import { createAuroraChain, sameAddress, requireLive } from '../runtime/agents/aurora-chain.mjs';
import { makeAuroraPlan, validateAuroraPlan } from '../runtime/agents/aurora-plan.mjs';
import { chooseTrade } from '../runtime/agents/policy.mjs';
import { collectResearch } from '../runtime/operator/research.mjs';
import { namedOutputs } from '../runtime/chain.mjs';
import { recoverInterruptedRound } from '../runtime/agents/interrupted-round.mjs';
import { verifySubmittedProposals, verifyWinningProposal } from '../runtime/agents/submitted-proposals.mjs';

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const iterator = lines[Symbol.asyncIterator]();
const config = JSON.parse((await iterator.next()).value);
const emit = (event) => console.log(JSON.stringify(event, (_, v) => typeof v === 'bigint' ? v.toString() : v));
async function acknowledge(hash) {
  const next = await iterator.next();
  requireLive(!next.done && JSON.parse(next.value).ack === hash, 'Prepared journal entry was not durably acknowledged');
}
let stage = config.phase;
try {
  if (config.phase === 'plan') {
    requireLive(!config.privateKey && !config.actorKeys, 'Wallet credentials must not enter inference process');
    const plan = await makeAuroraPlan({ snapshot: config.snapshot, market: config.market,
      env: { WAVEFUND_AGENT_MODE: 'near-ai', WAVEFUND_AGENT_MODEL: config.model, WAVEFUND_ALLOW_REMOTE_INFERENCE: '1', NEARAI_API_KEY: config.apiKey },
      onRequest: async request => { emit({ stage: 'inference-request', ...request }); await acknowledge(`inference-${request.request}`); },
      onRecord: record => emit({ stage: 'agent-record', record }) });
    emit({ stage: 'plan', plan });
  } else {
    const chain = createAuroraChain({ ...config, emit, acknowledge });
    delete config.privateKey; delete config.actorKeys;
    const { contracts, accounts, client, abi, read, tx, send, ownerCall, refresh, waitUntil } = chain;
    if (config.phase === 'recover-cancel') {
      await recoverInterruptedRound({ chain: { ...chain, roundRecord: async id => namedOutputs(abi('engine'), 'rounds', await read('engine', 'rounds', [id])) }, events: config.events, emit });
    } else {
    const state = await chain.inspect();
    const nextId = BigInt(state.currentRoundId) + 1n;
    const prefix = `round${nextId}`;
    requireLive(state.activeStatus === null || [3, 4].includes(state.activeStatus), 'Previous round is still active');
    requireLive(state.pendingAuthorization === '0', 'An owner authorization is already pending');
    emit({ stage: 'actors', actors: Object.fromEntries(Object.entries(accounts).map(([name, a]) => [name, a.address])) });
    if (config.phase === 'prepare') {
      for (const name of ['Momentum', 'Conservative', 'Quant', 'Guardian']) {
        const address = accounts[name].address;
        const gasAmount = ['Momentum', 'Conservative'].includes(name) ? 300000000000000n : 150000000000000n;
        if (await client.getBalance({ address }) < gasAmount) await send(`${prefix}:gas:${name}`, 'owner', address, '0x', gasAmount);
        await tx(`${prefix}:mint:${name}`, 'owner', 'stable', 'mint', [address, 20000000n]);
        if (['Momentum', 'Conservative'].includes(name)) {
          const agent = await read('registry', 'agents', [address]);
          if (!agent[0]) await tx(`${prefix}:register:${name}`, name, 'registry', 'registerAgent', [name]);
          await tx(`${prefix}:bondApproval:${name}`, name, 'stable', 'approve', [contracts.registry, 1000000n]);
        } else await tx(`${prefix}:depositApproval:${name}`, name, 'stable', 'approve', [contracts.engine, 10000000n]);
      }
      emit({ stage: 'prepared-actors', roundId: nextId });
    } else if (config.phase === 'snapshot') {
      const prices = await chain.verifiedProof();
      const portfolio = await chain.portfolio(prices);
      const market = await collectResearch();
      emit({ stage: 'snapshot', snapshot: { chainId: 1313161555, roundId: String(nextId), safe: contracts.safe, engine: contracts.engine, portfolio,
        blockNumber: (await client.getBlockNumber()).toString() }, market });
    } else if (config.phase === 'run') {
      const plan = config.plan;
      requireLive(plan, 'A completed four-agent plan is required');
      const prices = await chain.verifiedProof();
      const portfolio = await chain.portfolio(prices);
      validateAuroraPlan(plan, { contracts, roundId: nextId, portfolio, now: Math.floor(Date.now() / 1000) });
      requireLive(BigInt(state.sponsorReserve) >= 15000000n, 'Three proposals need separate forecasting seed');
      const id = nextId;
      const label = name => `round${id}:${name}`;
      const beforeEngine = await read('stable', 'balanceOf', [contracts.engine]);
      const initial = Object.fromEntries(await Promise.all(['Quant', 'Guardian'].map(async name => [name, await read('stable', 'balanceOf', [accounts[name].address])])));
      await refresh(label('oracle:open'));
      const now = (await client.getBlock()).timestamp;
      const end = now + 300n; const evaluation = end + 180n; const deadline = end + 100n;
      emit({ stage: 'schedule', roundId: id, tradingEnd: end, evaluationEnd: evaluation, executionDeadline: deadline });
      stage = 'authorize';
      await ownerCall(label('authorize'), 'module', 'authorizeRound', [id, end, evaluation, deadline, 950000000000000000n, 1050000000000000000n, 90n]);
      await tx(label('open'), 'owner', 'engine', 'openRound', [end, 180n, 950000000000000000n, 1050000000000000000n, 90n]);
      for (const proposal of plan.proposals.filter(p => p.id > 0)) {
        stage = `propose:${proposal.name}`;
        await tx(label(`propose:${proposal.name}`), proposal.name, 'engine', 'propose', [id, { tEthBps: proposal.allocationBps }, `NEAR AI model summary (test assets): ${proposal.rationale}`]);
      }
      let baselineBps = null;
      async function verifyProposalSet() {
        const round = namedOutputs(abi('engine'), 'rounds', await read('engine', 'rounds', [id]));
        requireLive(round.proposalCount === 3, 'Onchain proposal set changed after analysis');
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
      for (const forecaster of plan.forecasts) {
        stage = `forecast:${forecaster.name}`;
        await verifyProposalSet();
        await tx(label(`deposit:${forecaster.name}`), forecaster.name, 'engine', 'deposit', [id, 10000000n]);
        const creditAmount = 100000n; // 0.1 test USDC; no forced trade or disagreement.
        const blockNumber = await client.getBlockNumber();
        const quotes = await Promise.all(plan.proposals.flatMap(p => ['long', 'short'].map(async side => ({ proposalId: p.id, side, outcomeAmount: await read('market', side === 'long' ? 'quoteBuyLong' : 'quoteBuyShort', [id, BigInt(p.id), creditAmount], blockNumber) }))));
        const trade = chooseTrade({ forecasts: forecaster.forecasts, quotes, creditAmount });
        if (!trade) { const decision = { name: forecaster.name, action: 'abstain', reason: 'No forecast clears confidence and actual entry-cost edge checks' }; decisions.push(decision); emit({ stage: 'trade-decision', ...decision }); continue; }
        const decision = { name: forecaster.name, action: 'buy', ...trade }; decisions.push(decision); emit({ stage: 'trade-decision', ...decision });
        await tx(label(`claim:${forecaster.name}`), forecaster.name, 'engine', 'claimCredits', [id, BigInt(trade.proposalId), 10000000n]);
        await tx(label(`trade:${forecaster.name}`), forecaster.name, 'engine', trade.side === 'long' ? 'buyLong' : 'buyShort', [id, BigInt(trade.proposalId), creditAmount, trade.minimumOutcomes]);
      }
      emit({ stage: 'waiting', until: end }); await waitUntil(end);
      stage = 'collapse';
      await verifyProposalSet();
      await tx(label('collapse'), 'owner', 'engine', 'collapse', [id]);
      const [winner, allocation] = await read('engine', 'winningAllocation', [id]);
      verifyWinningProposal({ proposals: plan.proposals, winner: Number(winner), allocationBps: Number(allocation), baselineBps });
      emit({ stage: 'winner', winner, allocationBps: allocation });
      stage = 'execution';
      await refresh(label('oracle:execute'));
      const execution = await tx(label('execute'), 'owner', 'module', 'execute', [id, 0n, deadline]);
      requireLive(await read('engine', 'roundExecuted', [id]), 'Strategy execution was not recorded');
      for (const token of ['stable', 'asset']) requireLive(await read(token, 'allowance', [contracts.safe, contracts.router]) === 0n, 'Safe router allowance remained live');
      const factory = '0x60913758635b54e6C9685f92201A5704eEe74748';
      const pair = await client.readContract({ address: factory, abi: parseAbi(['function getPair(address,address) view returns(address)']), functionName: 'getPair', args: [contracts.stable, contracts.asset] });
      const swapAbi = parseAbi(['event Swap(address indexed sender,uint256 amount0In,uint256 amount1In,uint256 amount0Out,uint256 amount1Out,address indexed to)']);
      const swaps = execution.logs.filter(x => sameAddress(x.address, pair)).flatMap(entry => { try { return [decodeEventLog({ abi: swapAbi, ...entry }).args]; } catch { return []; } });
      requireLive(swaps.every(s => sameAddress(s.to, contracts.safe)), 'Unexpected AMM recipient');
      emit({ stage: 'execution', hash: execution.transactionHash, swaps, note: swaps.length ? 'Actual investment AMM swap' : 'Chosen allocation required no swap; do not claim a venue fill' });
      emit({ stage: 'waiting', until: evaluation }); await waitUntil(evaluation);
      stage = 'settlement';
      await refresh(label('oracle:settle'), evaluation);
      await tx(label('settle'), 'owner', 'tracker', 'settle', [id]);
      const payouts = [];
      for (const name of ['Quant', 'Guardian']) {
        stage = `redeem:${name}`;
        const address = accounts[name].address;
        const preview = await read('engine', 'previewRedeem', [id, address]);
        const before = await read('stable', 'balanceOf', [address]);
        await tx(label(`redeem:${name}`), name, 'engine', 'redeem', [id]);
        const after = await read('stable', 'balanceOf', [address]);
        requireLive(after - before === preview, 'Actual redemption differs from preview');
        payouts.push({ name, address, deposit: '10000000', payout: preview, profitLoss: after - initial[name] });
      }
      const round = namedOutputs(abi('engine'), 'rounds', await read('engine', 'rounds', [id]));
      const portfolioResult = namedOutputs(abi('tracker'), 'portfolios', await read('tracker', 'portfolios', [id]));
      const engineBalance = await read('stable', 'balanceOf', [contracts.engine]);
      const reserve = await read('engine', 'protocolLiquiditySeed');
      requireLive(round.status === 3 && round.seedReleased && round.depositsOutstanding === 0n, 'Round liabilities not cleared');
      requireLive(engineBalance === reserve && beforeEngine + 20000000n === engineBalance + payouts.reduce((sum, p) => sum + p.payout, 0n), 'Forecast collateral does not reconcile');
      emit({ stage: 'complete', chainId: 1313161555, roundId: id, winner, allocation, round, portfolio: portfolioResult, payouts, decisions, reserve,
        provider: plan.provider, recordHashes: plan.records.map(r => ({ name: r.name, inputHash: r.inputHash, outputHash: r.outputHash })),
        scope: 'Four separate agent wallets and four separately prompted calls to the same NEAR AI model; test assets, no verified attestation, no forced winner or trade.' });
    } else throw new Error('Unknown phase');
    }
  }
} catch (error) {
  emit({ stage, status: 'failed', errorName: error.name, reason: error.shortMessage ?? (error.name === 'Error' ? error.message : 'Inspect the known prepared hash; no automatic retry') });
  process.exitCode = 1;
} finally { lines.close(); }
