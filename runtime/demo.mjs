import { readFile } from 'node:fs/promises';
import { configuredTeam } from './agents/team.mjs';
import { localResearchFixture, validateMarket } from './agents/market.mjs';
import { chooseTrade } from './agents/policy.mjs';
import { loadManifest, safeError } from './config.mjs';
import { acquireLock, openJournal } from './journal.mjs';
import { connectChain, namedOutputs } from './chain.mjs';

const ONE = 10n ** 18n;
const roles = [
  { name: 'Momentum', role: 'proposer', rationale: 'Simulated bullish outlook: propose full approved-asset exposure.', action: '100% asset allocation' },
  { name: 'Conservative', role: 'proposer', rationale: 'Independent capital-preservation policy: retain half in the stablecoin.', action: '50% asset allocation' },
  { name: 'Quant', role: 'forecaster', rationale: 'Deterministic rehearsal policy favors the higher-exposure proposal and buys LONG.', action: 'LONG full-exposure proposal' },
  { name: 'Guardian', role: 'forecaster', rationale: 'Starts with a bearish risk scenario, then responds to an explicitly simulated positive evidence update.', action: 'SHORT mixed proposal, then LONG full exposure' },
];

export async function createRuntime({ rpcUrl, manifestPath = 'deployments/local.json', journalPath = '.run/local-demo/journal.json', artifactsDir = 'out', onStage, paceMs = 400, agentTeam, agentEnv = process.env, marketDataPath } = {}) {
  if (!Number.isInteger(paceMs) || paceMs < 0 || paceMs > 2000) throw new Error('Demo pacing must be between 0 and 2000 milliseconds');
  const manifest = await loadManifest(manifestPath);
  const release = await acquireLock(`${journalPath}.lock`);
  let journal;
  let chain;
  let team;
  const control = { stopping: false };
  try {
    journal = await openJournal(journalPath, manifest);
    chain = await connectChain({ rpcUrl, manifest, artifactsDir, journal, control });
    team = agentTeam ?? configuredTeam({ env: agentEnv, onRecord: async (record) => { journal.data.agentRecords ??= []; journal.data.agentRecords.push(record); await journal.save(); } });
  } catch (error) { await release(); throw error; }
  const { read, tx, ownerCall, advanceTo, publicClient, accounts, abis } = chain;
  let runPromise = null;
  let lastState = null;
  let lastAt = 0;
  let statePromise = null;

  async function stage(name, message) { await journal.stage(name, message); lastAt = 0; await onStage?.(name, message); if (paceMs) await new Promise((resolve) => setTimeout(resolve, paceMs)); }
  async function refreshOracle(assetPrice = 2_000n * ONE) { return tx(0, 'oracle', 'setPrices', [ONE, assetPrice], `Refresh simulated oracle: ETH ${assetPrice / ONE} USD`); }
  async function run() {
    if (journal.data.stage !== 'idle' || journal.data.running) throw new Error('This local session has already started. Use the explicit local reset command.');
    journal.data.running = true; journal.data.error = null; journal.data.agents = team ? [] : roles; journal.data.inference = { mode: team?.info.mode ?? 'fixture', model: team?.info.model ?? null, status: team ? 'pending' : 'fixture', attestationVerified: false }; await journal.save();
    try {
      if (await read('engine', 'currentRoundId') !== 0n) throw new Error('Expected a fresh local stack with no round; reset explicitly before another rehearsal');
      for (const index of [2, 3]) journal.data.initialBalances[accounts[index].address] = (await read('stable', 'balanceOf', [accounts[index].address])).toString();
      let plan = null;
      if (team) {
        await stage('analysing', 'Research agents independently assess evidence. No round authorization or forecasting deposit is submitted until all four decisions validate.');
        const block = await publicClient.getBlock();
        const [stableBalance, assetBalance, allocation, prices] = await Promise.all([read('stable', 'balanceOf', [manifest.contracts.safe], block.number), read('asset', 'balanceOf', [manifest.contracts.safe], block.number), read('module', 'currentTEthBps', [], block.number), read('oracle', 'read', [], block.number)]);
        const market = marketDataPath ? validateMarket(JSON.parse(await readFile(marketDataPath, 'utf8')), { now: Number(block.timestamp) }) : localResearchFixture({ now: Number(block.timestamp), stableUsdX18: prices[0], assetUsdX18: prices[1] });
        plan = await team.plan({ market, portfolio: { stableBalance: stableBalance.toString(), assetBalance: assetBalance.toString(), currentAllocationBps: Number(allocation) }, policy: { horizonSeconds: manifest.timing.evaluationSeconds } });
        journal.data.agentRecords = plan.records;
        journal.data.inference.status = 'complete'; journal.data.inference.evidenceSource = market.source;
        journal.data.agents = [...plan.proposals.filter((proposal) => proposal.id > 0).map((proposal) => ({ name: proposal.name, role: 'proposer', rationale: proposal.rationale, action: `${proposal.allocationBps / 100}% asset allocation`, risks: proposal.risks, evidenceIds: proposal.evidenceIds })), ...plan.forecasts.map((forecast) => ({ name: forecast.name, role: 'forecaster', rationale: 'Independent forecasts recorded for every proposal; entry quotes determine whether to trade.', action: 'Awaiting quote and budget checks', forecasts: forecast.forecasts }))];
        await journal.save();
      }
      await stage('opening', 'Owner approves exact policy terms. All investment capital stays in the trading Safe.');
      await refreshOracle();
      const now = (await publicClient.getBlock()).timestamp;
      const tradingEnd = now + BigInt(manifest.timing.tradingSeconds);
      const evaluationEnd = tradingEnd + BigInt(manifest.timing.evaluationSeconds);
      const executionDeadline = tradingEnd + BigInt(manifest.timing.executionGraceSeconds);
      const window = BigInt(manifest.timing.twapWindowSeconds);
      await ownerCall('module', 'authorizeRound', [1n, tradingEnd, evaluationEnd, executionDeadline, 950_000_000_000_000_000n, 1_050_000_000_000_000_000n, window], 'Safe authorizes round 1 policy');
      await tx(0, 'engine', 'openRound', [tradingEnd, BigInt(manifest.timing.evaluationSeconds), 950_000_000_000_000_000n, 1_050_000_000_000_000_000n, window], 'Keeper opens forecasting round');
      const roundId = await read('engine', 'currentRoundId');
      if (roundId !== 1n) throw new Error('Unexpected round identifier');
      journal.data.roundId = roundId.toString(); await journal.save();

      await stage('proposing', plan ? 'Validated model allocations are submitted under the fixed owner-approved asset policy.' : 'Two deterministic agents submit different approved allocation strategies.');
      const proposalPlans = plan ? plan.proposals.filter((proposal) => proposal.id > 0).map((proposal) => [proposal.accountIndex, proposal.name, proposal.allocationBps, `MODEL SUMMARY (${plan.provider.mode}; synthetic assets): ${proposal.rationale}`]) : [[1, 'Momentum', 10000, `SIMULATED AGENT: ${roles[0].rationale}`], [4, 'Conservative', 5000, `SIMULATED AGENT: ${roles[1].rationale}`]];
      for (const [index, name, bps, rationale] of proposalPlans) {
        await tx(index, 'registry', 'registerAgent', [name], `${name} registers`);
        await tx(index, 'stable', 'approve', [manifest.contracts.registry, 1_000_000n], `${name} approves refundable proposal bond`);
        await tx(index, 'engine', 'propose', [roundId, { tEthBps: bps }, rationale], `${name} proposes ${bps / 100}% asset exposure`);
      }
      if (plan) {
        const actual = namedOutputs(abis.engine, 'rounds', await read('engine', 'rounds', [roundId]));
        if (Number(actual.proposalCount) !== plan.proposals.length) throw new Error('Proposal set changed after model analysis');
        for (const expected of plan.proposals) {
          const observed = namedOutputs(abis.engine, 'proposals', await read('engine', 'proposals', [roundId, BigInt(expected.id)]));
          if (Number(observed.tEthBps) !== expected.allocationBps || (expected.id > 0 && observed.proposer.toLowerCase() !== accounts[expected.accountIndex].address.toLowerCase())) throw new Error('Onchain proposal differs from validated model decision');
        }
      }
      await stage('forecasting', plan ? 'Independent model forecasts are compared with actual v4 entry quotes; no qualifying edge means abstain.' : 'Quant and Guardian deposit separate forecast collateral, then disagree through actual v4 trades.');
      for (const index of [2, 3]) {
        const name = index === 2 ? 'Quant' : 'Guardian';
        await tx(index, 'stable', 'approve', [manifest.contracts.engine, 10_000_000n], `${name} approves forecast collateral`);
        await tx(index, 'engine', 'deposit', [roundId, 10_000_000n], `${name} deposits 10 simulated USDC`);
      }
      if (plan) {
        await advanceTo(tradingEnd - window - 15n);
        journal.data.tradeDecisions = [];
        for (const forecast of plan.forecasts) {
          const amount = 2000000n; const quotes = [];
          for (const proposal of plan.proposals) for (const side of ['long', 'short']) {
            quotes.push({ proposalId: proposal.id, side, outcomeAmount: await read('market', side === 'long' ? 'quoteBuyLong' : 'quoteBuyShort', [roundId, BigInt(proposal.id), amount]) });
          }
          const trade = chooseTrade({ forecasts: forecast.forecasts, quotes, creditAmount: amount });
          const agent = journal.data.agents.find((item) => item.name === forecast.name);
          if (!trade) {
            agent.action = 'Abstained: no sufficiently confident forecast with a positive quoted edge';
            journal.data.tradeDecisions.push({ agent: forecast.name, action: 'abstain' }); await journal.save(); continue;
          }
          agent.rationale = trade.forecast.rationale; agent.risks = trade.forecast.risks; agent.evidenceIds = trade.forecast.evidenceIds;
          agent.action = `${trade.side.toUpperCase()} proposal ${trade.proposalId}: 2 test USDC, expected value ${trade.expectedValue} micro-USDC (forecast, not a guarantee)`;
          const record = { agent: forecast.name, action: 'buy', proposalId: trade.proposalId, side: trade.side, creditAmount: amount.toString(), quotedOutcomes: trade.quotedOutcomes.toString(), minimumOutcomes: trade.minimumOutcomes.toString(), expectedValue: trade.expectedValue.toString(), expectedProfit: trade.expectedProfit.toString() };
          journal.data.tradeDecisions.push(record); await journal.save();
          await tx(forecast.accountIndex, 'engine', 'claimCredits', [roundId, BigInt(trade.proposalId), 10000000n], `${forecast.name} claims credits for proposal ${trade.proposalId}`);
          await tx(forecast.accountIndex, 'engine', trade.side === 'long' ? 'buyLong' : 'buyShort', [roundId, BigInt(trade.proposalId), amount, trade.minimumOutcomes], `${forecast.name} buys ${trade.side.toUpperCase()} after forecast, quote and budget validation`);
        }
      } else {
        await tx(2, 'engine', 'claimCredits', [roundId, 1n, 10_000_000n], 'Quant claims conditional full-exposure credits');
        await tx(3, 'engine', 'claimCredits', [roundId, 2n, 10_000_000n], 'Guardian claims conditional mixed-allocation credits');
        await advanceTo(tradingEnd - window - 15n);
        async function buy(index, proposalId, amount, side, label) {
          const output = await read('market', side === 'long' ? 'quoteBuyLong' : 'quoteBuyShort', [roundId, proposalId, amount]);
          if (output <= 0n) throw new Error('Trade quote is empty');
          await tx(index, 'engine', side === 'long' ? 'buyLong' : 'buyShort', [roundId, proposalId, amount, output * 995n / 1000n], label);
        }
        await buy(2, 1n, 5_000_000n, 'long', 'Quant buys LONG on full exposure');
        await buy(3, 2n, 2_000_000n, 'short', 'Guardian buys SHORT on mixed exposure');
        journal.data.messages.push({ timestamp: new Date().toISOString(), stage: 'forecasting', message: 'New evidence is a deterministic simulation fixture, not a live AI/data-provider response. Quant strengthens its view; Guardian revises its risk scenario.' }); await journal.save();
        await buy(2, 1n, 1_000_000n, 'long', 'Quant reacts to simulated evidence with another LONG trade');
        await tx(3, 'engine', 'claimCredits', [roundId, 1n, 10_000_000n], 'Guardian claims the same deposit entitlement in the alternative world');
        await buy(3, 1n, 1_000_000n, 'long', 'Guardian responds to simulated new evidence with LONG on full exposure');
      }

      await stage('selecting', 'Anvil advances the local clock; final-window scores select the canonical winner.');
      await advanceTo(tradingEnd);
      await tx(0, 'engine', 'collapse', [roundId], 'Collapse forecasting markets');
      const [winner, target] = await read('engine', 'winningAllocation', [roundId]);
      journal.data.messages.push({ timestamp: new Date().toISOString(), stage: 'selecting', message: `Onchain selected proposal ${winner} with target ${target} bps. No caller supplies the winning target.` }); await journal.save();
      await stage('executing', 'The restricted module reads the winner and executes the approved allocation through the Safe.');
      await refreshOracle();
      await tx(0, 'module', 'execute', [roundId, 0n, executionDeadline], 'Execute canonical winner through Safe');
      if (!(await read('engine', 'roundExecuted', [roundId]))) throw new Error('Engine did not acknowledge execution');
      await stage('evaluating', 'Record actual holdings and advance the local evaluation horizon. Prices remain explicit simulation fixtures.');
      await advanceTo(evaluationEnd);
      await refreshOracle(2_100n * ONE);
      await stage('settling', 'The tracker computes return from recorded quantities and simulated prices, including actual fixture-router fees.');
      await tx(0, 'tracker', 'settle', [roundId], 'Settle measured portfolio return');
      await stage('redeeming', 'Forecasters redeem only winning-world claims; Safe investment balances are not used for payouts.');
      for (const index of [2, 3]) {
        const amount = await read('engine', 'previewRedeem', [roundId, accounts[index].address]);
        await tx(index, 'engine', 'redeem', [roundId], `${index === 2 ? 'Quant' : 'Guardian'} redeems winning-world balance`);
        journal.data.payouts[accounts[index].address] = amount.toString(); await journal.save();
      }
      journal.data.running = false;
      await stage('completed', plan ? 'Model-directed local round completed. Real Safe/v4 transactions; prices and assets remain simulated; inference attestation not verified.' : 'Local onchain rehearsal completed. Real Safe/v4 contracts; simulated assets, prices and deterministic agents.');
      return state({ force: true });
    } catch (error) {
      journal.data.running = false; journal.data.error = safeError(error);
      if (journal.data.inference?.status === 'pending') journal.data.inference.status = 'failed';
      await stage(control.stopping || journal.data.actions.some((action) => action.status === 'unknown' || action.status === 'broadcast') ? 'interrupted' : 'failed', 'Execution stopped. No automatic retry or resubmission.');
      throw error;
    }
  }

  async function state({ force = false } = {}) {
    if (!force && lastState && Date.now() - lastAt < 250) return lastState;
    if (statePromise) return statePromise;
    statePromise = (async () => {
      const block = await publicClient.getBlock(); const pinned = block.number;
      const roundId = await read('engine', 'currentRoundId', [], pinned);
      const [safeStable, safeAsset, engineStable, reserve, prices] = await Promise.all([read('stable', 'balanceOf', [manifest.contracts.safe], pinned), read('asset', 'balanceOf', [manifest.contracts.safe], pinned), read('stable', 'balanceOf', [manifest.contracts.engine], pinned), read('engine', 'protocolLiquiditySeed', [], pinned), read('oracle', 'read', [], pinned).catch(() => null)]);
      let round = null; const proposals = [];
      if (roundId !== 0n) {
        round = namedOutputs(abis.engine, 'rounds', await read('engine', 'rounds', [roundId], pinned));
        for (let i = 0; i < Number(round.proposalCount); i++) {
          const proposal = namedOutputs(abis.engine, 'proposals', await read('engine', 'proposals', [roundId, BigInt(i)], pinned));
          const [probability] = await read('market', 'probabilities', [roundId, BigInt(i)], pinned);
          proposals.push({ id: String(i), label: i === 0 ? 'Hold current assets' : `${Number(proposal.tEthBps) / 100}% approved asset`, allocationBps: Number(proposal.tEthBps), probabilityX18: probability.toString(), twapX18: proposal.probabilityTwap.toString(), rationale: proposal.rationale, proposer: proposal.proposer });
        }
      }
      const participants = [];
      for (const [i, index] of [2, 3].entries()) {
        const address = accounts[index].address;
        const stable = await read('stable', 'balanceOf', [address], pinned);
        const initial = journal.data.initialBalances[address] ?? stable.toString();
        participants.push({ address, name: i === 0 ? 'Quant' : 'Guardian', stableBalance: stable.toString(), initialStableBalance: initial, deposit: roundId ? (await read('engine', 'deposits', [roundId, address], pinned)).toString() : '0', payout: journal.data.payouts[address] ?? null, profitLoss: journal.data.stage === 'completed' ? (stable - BigInt(initial)).toString() : null });
      }
      const value = prices ? safeStable * prices[0] / 1_000_000n + safeAsset * prices[1] / ONE : null;
      lastState = {
        mode: 'local-simulation', chainId: 31337, chain: { id: 31337, blockNumber: pinned.toString(), timestamp: block.timestamp.toString() }, running: journal.data.running, stage: journal.data.stage, roundId: roundId ? roundId.toString() : null,
        safe: { address: manifest.contracts.safe, stableBalance: safeStable.toString(), assetBalance: safeAsset.toString(), valueUsdX18: value?.toString() ?? null },
        forecast: { escrow: (engineStable >= reserve ? engineStable - reserve : 0n).toString(), committedEscrow: round?.escrow?.toString() ?? '0', deposits: round?.totalDeposits?.toString() ?? '0', participants, payouts: Object.entries(journal.data.payouts).map(([address, amount]) => ({ address, amount })) }, sponsor: { reserve: reserve.toString() },
        round: round ? { status: Number(round.status), tradingEnd: round.tradingEnd.toString(), evaluationEnd: round.evaluationEnd.toString(), realisedReturnX18: round.realisedReturn.toString(), piX18: round.pi.toString(), winnerId: Number(round.winnerId) } : null,
        oracle: prices ? { stableUsdX18: prices[0].toString(), assetUsdX18: prices[1].toString(), publishedAt: prices[2].toString(), simulated: true } : { simulated: true, error: 'Simulation oracle unavailable/stale' },
        proposals, inference: journal.data.inference ?? { mode: team?.info.mode ?? 'fixture', model: team?.info.model ?? null, status: 'not-started', attestationVerified: false }, agentRecords: journal.data.agentRecords ?? [], tradeDecisions: journal.data.tradeDecisions ?? [], agents: journal.data.agents.length ? journal.data.agents : (team ? [] : roles), receipts: journal.data.actions.map((action) => ({ ...action })), messages: journal.data.messages.slice(-30), error: journal.data.error,
      };
      lastAt = Date.now(); return lastState;
    })();
    try { return await statePromise; } finally { statePromise = null; }
  }

  function start() {
    if (runPromise || journal.data.running || journal.data.stage !== 'idle') throw new Error('A demo is running or this session already executed; reset explicitly to run again');
    runPromise = run();
    // Attach a handler immediately; the API is asynchronous but failures remain visible in state/journal.
    runPromise.catch(() => {});
    return runPromise;
  }
  let closed = false;
  async function close() { if (closed) return; closed = true; control.stopping = true; await runPromise?.catch(() => {}); await release(); }
  return { state, start, close, journal, get running() { return journal.data.running; } };
}

export async function runDemo(options = {}) {
  const runtime = await createRuntime(options);
  try { return await runtime.start(); } finally { await runtime.close(); }
}
