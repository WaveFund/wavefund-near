// Developer C: round-journey view models. Saved rounds use the real API projections as input; the local cases use the
// /api/state shape the runtime serves, so the UI's stage mapping is tested against what the backend actually reports.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HOLD_APPLIED, HOLD_AWAITING, QUALIFYING_MARGIN_X18, STAGES, defaultStage, describeSavedTx, groupLocalReceipts, groupSavedTransactions, localJourney,
  localWorkspaceAccess, participantViews, percentFromBps, positionGroups, resolveStage, returnOnScale, roundSummary, roundWindows, savedJourney, savedTxStage,
  selectionSignals, settlementShares, shortReturnX18, stageOrder, stepStage,
} from '../src/lib/arena/model.mjs';
import { validateRoundEvidence } from '../src/lib/record/model.mjs';
import { validateTidepoolDemo } from '../src/lib/tidepool/model.mjs';
import { loadRoundEvidence } from '../../runtime/operator/round-evidence.mjs';
import { loadTidepoolDemo } from '../../runtime/operator/tidepool-demo.mjs';

const MINUS = '−';
const statuses = (journey) => journey.stages.map((stage) => stage.status);
const summary = (journey, id) => journey.stages.find((stage) => stage.id === id).summary;

// The completed local round as /api/state reports it (trimmed to the fields the journey reads).
const completedLocal = () => ({
  mode: 'local-simulation', chainId: 31337, running: false, stage: 'completed', roundId: '1',
  safe: { address: '0x5FC8d32690cc91D4c39d9d3abcBD16989F875707', stableBalance: '0', assetBalance: '997000000000000000', valueUsdX18: '2093700000000000000000' },
  forecast: { escrow: '0', deposits: '20000000', participants: [
    { name: 'Quant', deposit: '10000000', payout: '12448755', profitLoss: '2448755' }, { name: 'Guardian', deposit: '10000000', payout: '10151998', profitLoss: '151998' }],
  payouts: [{ address: '0x3C44', amount: '12448755' }, { address: '0x90F7', amount: '10151998' }] },
  sponsor: { reserve: '97399247' },
  round: { status: 3, tradingEnd: '1794484762', evaluationEnd: '1794484942', realisedReturnX18: '1046850000000000000', piX18: '968500000000000000', winnerId: 1 },
  proposals: [
    { id: '0', label: 'Hold current assets', allocationBps: 0, probabilityX18: '500000000000000000', twapX18: '500000000000000000', rationale: '' },
    { id: '1', label: '100% approved asset', allocationBps: 10000, probabilityX18: '851628913633849393', twapX18: '851628913633849393', rationale: 'SIMULATED AGENT: bullish' },
    { id: '2', label: '50% approved asset', allocationBps: 5000, probabilityX18: '338221600519811424', twapX18: '338221600519811424', rationale: 'SIMULATED AGENT: preserve' }],
  agents: [{ name: 'Momentum', role: 'proposer', action: '100% asset allocation', rationale: '' }, { name: 'Conservative', role: 'proposer', action: '50% asset allocation', rationale: '' },
    { name: 'Quant', role: 'forecaster', action: 'LONG full-exposure proposal', rationale: '' }],
  receipts: ['Refresh simulated oracle: ETH 2000 USD', 'Safe authorizes round 1 policy', 'Keeper opens forecasting round', 'Momentum registers', 'Momentum approves refundable proposal bond',
    'Momentum proposes 100% asset exposure', 'Quant approves forecast collateral', 'Quant deposits 10 simulated USDC', 'Quant claims conditional full-exposure credits', 'Quant buys LONG on full exposure',
    'Guardian claims the same deposit entitlement in the alternative world', 'Collapse forecasting markets', 'Refresh simulated oracle: ETH 2000 USD', 'Execute canonical winner through Safe',
    'Refresh simulated oracle: ETH 2100 USD', 'Settle measured portfolio return', 'Quant redeems winning-world balance', 'Guardian redeems winning-world balance']
    .map((label, index) => ({ label, hash: `0x${String(index).padStart(64, '0')}`, status: 'success', blockNumber: String(index + 1) })),
  error: null,
});

test('the seven journey steps are fixed and each asks one question', () => {
  assert.deepEqual(STAGES.map((stage) => stage.label), ['Funded', 'Proposals', 'Forecasting', 'Selected', 'Executed', 'Measured', 'Redeemed']);
  assert.ok(STAGES.every((stage) => stage.question.endsWith('?')));
});

test('a completed local round maps onto every step, with its return and payouts only after settlement', () => {
  const journey = localJourney(completedLocal());
  assert.deepEqual(statuses(journey), ['done', 'done', 'done', 'done', 'done', 'done', 'done']);
  assert.equal(journey.winnerId, '1'); assert.equal(journey.isHold, false);
  assert.equal(summary(journey, 'evaluated'), '+4.685%');
  assert.equal(summary(journey, 'redeemed'), '2 redeemed');
  assert.equal(summary(journey, 'proposals'), '2 strategies + Hold');
  assert.deepEqual(journey.proposals.map((item) => item.name), ['Hold', 'Momentum', 'Conservative'], 'proposers are matched by their stated allocation');
  assert.equal(journey.returnX18, '1046850000000000000');
});

test('in-progress local states never show a return, a payout or a winner early', () => {
  const at = (stage, extra = {}) => localJourney({ ...completedLocal(), stage, running: true, ...extra });
  const forecasting = at('forecasting');
  assert.deepEqual(statuses(forecasting), ['done', 'done', 'current', 'upcoming', 'upcoming', 'upcoming', 'upcoming']);
  assert.equal(forecasting.winnerId, null, 'the winner is not known before selection');
  assert.equal(forecasting.returnX18, null);
  assert.equal(summary(forecasting, 'evaluated'), null); assert.equal(summary(forecasting, 'redeemed'), null);
  const settling = at('settling');
  assert.equal(settling.stages[5].status, 'current');
  assert.equal(settling.returnX18, null, 'no return while settlement is still running');
  const idle = localJourney({ ...completedLocal(), stage: 'idle', running: false, round: null, receipts: [], proposals: [] });
  assert.deepEqual(statuses(idle), ['done', 'upcoming', 'upcoming', 'upcoming', 'upcoming', 'upcoming', 'upcoming']);
  const empty = localJourney({ ...completedLocal(), stage: 'idle', running: false, safe: { stableBalance: '0', assetBalance: '0', valueUsdX18: '0' } });
  assert.equal(empty.stages[0].status, 'upcoming', 'an empty Safe is not funded');
});

test('Hold is a valid outcome with no swap, and a halted round stays halted', () => {
  const hold = localJourney({ ...completedLocal(), round: { ...completedLocal().round, winnerId: 0 } });
  assert.equal(hold.isHold, true);
  assert.equal(hold.stages[4].status, 'done', 'a completed Hold round has applied its decision; the step is not skipped');
  assert.equal(summary(hold, 'executed'), 'Hold applied · no swap needed');
  const failed = localJourney({ ...completedLocal(), stage: 'failed', receipts: completedLocal().receipts.slice(0, 10) });
  assert.deepEqual(statuses(failed), ['done', 'done', 'halted', 'upcoming', 'upcoming', 'upcoming', 'upcoming'], 'the step with the last receipts is halted');
  assert.equal(failed.returnX18, null);
});

test('local receipts group by step and oracle refreshes attach to the step they prepare', () => {
  const groups = groupLocalReceipts(completedLocal().receipts);
  const labels = (id) => groups[id].map((item) => item.label);
  assert.deepEqual(labels('selected'), ['Collapse forecasting markets'], '"forecasting" in the collapse label does not misfile it');
  assert.deepEqual(labels('executed'), ['Refresh simulated oracle: ETH 2000 USD', 'Execute canonical winner through Safe']);
  assert.deepEqual(labels('evaluated'), ['Refresh simulated oracle: ETH 2100 USD', 'Settle measured portfolio return']);
  assert.ok(labels('proposals').includes('Keeper opens forecasting round') && labels('proposals')[0].startsWith('Refresh simulated oracle'));
  assert.equal(groups.redeemed.length, 2); assert.equal(groups.forecasting.length, 5);
  assert.equal(Object.values(groups).reduce((total, list) => total + list.length, 0), completedLocal().receipts.length, 'no receipt is dropped');
  const trailing = groupLocalReceipts([...completedLocal().receipts, { label: 'Refresh simulated oracle: ETH 2100 USD', hash: `0x${'f'.repeat(64)}`, status: 'success', blockNumber: '99' }]);
  assert.equal(trailing.redeemed.at(-1).label, 'Refresh simulated oracle: ETH 2100 USD', 'a trailing oracle refresh stays with the last step instead of disappearing');
});

test('selection follows the contract: the best challenger must beat Hold by more than 0.5 points', () => {
  assert.equal(QUALIFYING_MARGIN_X18, 5_000_000_000_000_000n);
  const signals = selectionSignals(completedLocal().proposals);
  assert.equal(signals.winnerId, '1');
  assert.deepEqual(signals.rows.map((row) => [row.id, row.qualifies]), [['0', false], ['1', true], ['2', false]]);
  assert.equal(signals.holdPercent, 50); assert.equal(signals.thresholdPercent, 50.5);
  const near = selectionSignals([{ id: '0', twapX18: '500000000000000000' }, { id: '1', twapX18: '505000000000000000' }]);
  assert.equal(near.winnerId, '0', 'exactly Hold + margin does not qualify');
  const just = selectionSignals([{ id: '0', twapX18: '500000000000000000' }, { id: '1', twapX18: '505000000000000001' }, { id: '2', twapX18: '505000000000000001' }]);
  assert.equal(just.winnerId, '1', 'ties go to the lowest id');
  assert.equal(selectionSignals([{ id: '1', twapX18: '600000000000000000' }]), null, 'no Hold average, no signal board');
  assert.equal(selectionSignals([{ id: '0', twapX18: '2000000000000000000' }]), null, 'an average above 100% is rejected');
});

test('saved public rounds map onto the journey from validated evidence; Tidepool supplies the funding step', async () => {
  const evidence = validateRoundEvidence(JSON.parse(JSON.stringify(await loadRoundEvidence())));
  assert.equal(evidence.ok, true, evidence.error);
  const { demo } = await loadTidepoolDemo();
  const linked = validateTidepoolDemo(JSON.parse(JSON.stringify(demo)));
  assert.equal(linked.ok, true, linked.error);
  const [r7, r8, tide] = evidence.rounds;

  const tidepool = savedJourney(tide, linked.demo);
  assert.deepEqual(statuses(tidepool), ['done', 'done', 'done', 'done', 'done', 'done', 'done']);
  assert.equal(summary(tidepool, 'funded'), '199.48 USDC delivered');
  assert.equal(summary(tidepool, 'executed'), '149.61 USDC → 0.071692 ETH');
  assert.equal(summary(tidepool, 'evaluated'), `${MINUS}0.6458%`);
  assert.equal(summary(tidepool, 'forecasting'), '4 positions');
  assert.equal(summary(tidepool, 'selected'), 'Momentum · 75%');
  assert.equal(tidepool.longPayoutX18, '435418896350731900');
  assert.equal(tide.market.returnBounds.minX18, '950000000000000000', 'payout bounds come from the round record');
  assert.equal(tidepool.linkedDemo.swap.stableAfter, '49870000', 'the Safe kept 49.87 test USDC after the swap');

  const original = savedJourney(r7, linked.demo);
  assert.equal(original.linkedDemo, null, 'Tidepool funding is never attached to an original-stack round');
  assert.equal(summary(original, 'funded'), 'Safe funded earlier');

  const hold = savedJourney(r8);
  assert.equal(hold.isHold, true);
  assert.equal(hold.stages[4].status, 'done'); assert.equal(summary(hold, 'executed'), HOLD_APPLIED);
  assert.ok(hold.transactions.executed.length > 0, 'the Hold round records its execute transaction');
  assert.equal(summary(hold, 'forecasting'), 'All abstained');
});

test('positions stay per proposal world: LONG and SHORT side by side, abstentions listed, credits never summed', async () => {
  const evidence = validateRoundEvidence(JSON.parse(JSON.stringify(await loadRoundEvidence())));
  const tide = evidence.rounds[2];
  const { groups, abstained, positions } = positionGroups(tide.proposals, tide.forecasters);
  const momentum = groups.find((group) => group.proposalId === '3');
  assert.deepEqual(momentum.long.map((item) => [item.name, item.credits]), [['Quant', '400000'], ['StressAnalyst', '100000']]);
  assert.deepEqual(momentum.short.map((item) => item.name), ['Guardian']);
  assert.deepEqual(groups.find((group) => group.proposalId === '1').short.map((item) => item.name), ['FeeAnalyst']);
  assert.ok([...momentum.long, ...momentum.short].every((item) => item.scripted === true));
  assert.equal(positions, 4); assert.equal(abstained.length, 0);
  const r8 = positionGroups(evidence.rounds[1].proposals, evidence.rounds[1].forecasters);
  assert.equal(r8.positions, 0); assert.equal(r8.abstained.length, 4);
});

test('saved transactions are filed under the step they belong to and described in plain words', async () => {
  const evidence = validateRoundEvidence(JSON.parse(JSON.stringify(await loadRoundEvidence())));
  const groups = groupSavedTransactions(evidence.rounds[2].transactions);
  assert.deepEqual(groups.selected.map((item) => item.label), ['round1:collapse']);
  assert.deepEqual(groups.executed.map((item) => item.label), ['round1:oracle:execute', 'round1:execute']);
  assert.equal(groups.redeemed.length, 4); assert.equal(groups.proposals.length, 7);
  assert.equal(savedTxStage('round1:trade:Quant'), 'forecasting');
  assert.equal(describeSavedTx('round1:propose:Momentum'), 'Propose a strategy · Momentum');
  assert.equal(describeSavedTx('round1:oracle:settle'), 'Refresh the price oracle (settle)');
});

test('round terms and the post-swap balance are shown only when they are internally consistent', async () => {
  const raw = JSON.parse(JSON.stringify(await loadRoundEvidence()));
  raw.rounds[2].market.returnBounds.minX18 = '1000000000000000000';
  raw.rounds[1].market.evaluationEnd = raw.rounds[1].market.tradingStart;
  raw.rounds[0].forecasters[0].credits = 400000;
  const checked = validateRoundEvidence(raw);
  assert.equal(checked.ok, true, checked.error);
  assert.equal(checked.rounds[2].market, null, 'bounds that do not straddle a flat return are dropped, not shown');
  assert.equal(checked.rounds[1].market, null, 'a window that does not run forward is dropped');
  assert.equal(checked.rounds[0].forecasters[0].credits, null, 'numeric JSON credits are not trusted');
  const { demo } = await loadTidepoolDemo();
  const copy = JSON.parse(JSON.stringify(demo)); copy.swap.stableAfter = '49870001';
  assert.equal(validateTidepoolDemo(copy).demo.swap.stableAfter, null, 'a post-swap balance that does not reconcile with the delivery is not shown');
});

test('numbers render with integer maths and honest edges', () => {
  assert.equal(percentFromBps(7500), '75%'); assert.equal(percentFromBps(4487), '44.87%'); assert.equal(percentFromBps(10001), null);
  assert.equal(shortReturnX18('993541889635073190'), `${MINUS}0.6458%`);
  assert.equal(shortReturnX18('1046850000000000000'), '+4.685%');
  assert.equal(shortReturnX18('1050000000000000000'), '+5%');
  assert.equal(shortReturnX18('1000000000000000000'), '0%');
  assert.equal(shortReturnX18('999584491909995608'), `${MINUS}0.0416%`);
  assert.equal(shortReturnX18(0.99), null);
  const bounds = { minX18: '950000000000000000', maxX18: '1050000000000000000' };
  assert.equal(returnOnScale('993541889635073190', bounds), 43.54);
  assert.equal(returnOnScale('900000000000000000', bounds), 0, 'a return below the bounds pins to the edge');
  assert.equal(returnOnScale('1000000000000000000', { minX18: '1', maxX18: '1' }), null);
  assert.deepEqual(roundWindows({ tradingStart: '1794434097', tradingEnd: '1794434503', evaluationEnd: '1794434683', twapWindowSeconds: '90' }), { trading: '7 min', evaluation: '3 min', twap: '90 s' });
});

test('Hold execution is done only when execution is recorded, locally and in saved evidence', async () => {
  const evidence = validateRoundEvidence(JSON.parse(JSON.stringify(await loadRoundEvidence())));
  const holdRound = evidence.rounds[1];
  const unrecorded = { ...holdRound, transactions: holdRound.transactions.filter((item) => !/:(execute|oracle:execute)$/.test(item.label)) };
  const awaiting = savedJourney(unrecorded);
  assert.equal(awaiting.stages[4].status, 'upcoming'); assert.equal(summary(awaiting, 'executed'), HOLD_AWAITING);
  const swapRound = savedJourney({ ...evidence.rounds[2], transactions: [] });
  assert.equal(swapRound.stages[4].status, 'done', 'only Hold depends on a recorded execution to count as applied');
  const hold = (stage, extra = {}) => localJourney({ ...completedLocal(), stage, running: stage !== 'completed', round: { ...completedLocal().round, winnerId: 0 }, ...extra });
  const executing = hold('executing', { receipts: completedLocal().receipts.slice(0, 12) });
  assert.notEqual(executing.stages[4].status, 'done', 'Hold is not applied before execution is reached');
  assert.notEqual(summary(executing, 'executed'), HOLD_APPLIED);
  const evaluating = hold('evaluating');
  assert.equal(evaluating.stages[4].status, 'done'); assert.equal(summary(evaluating, 'executed'), HOLD_APPLIED);
  assert.equal(summary(localJourney({ ...completedLocal(), stage: 'evaluating', running: true }), 'executed'), 'Swap executed', 'a non-Hold winner still reports the swap');
});

test('defaultStage opens Result for finished rounds, the live stage while running, Funded otherwise', async () => {
  const evidence = validateRoundEvidence(JSON.parse(JSON.stringify(await loadRoundEvidence())));
  assert.equal(defaultStage(savedJourney(evidence.rounds[2])), 'result');
  assert.equal(defaultStage(localJourney(completedLocal())), 'result');
  const at = (stage, extra = {}) => defaultStage(localJourney({ ...completedLocal(), stage, running: true, ...extra }));
  assert.equal(at('forecasting'), 'forecasting'); assert.equal(at('executing'), 'executed'); assert.equal(at('settling'), 'evaluated');
  assert.equal(defaultStage(localJourney({ ...completedLocal(), stage: 'failed', running: false, receipts: completedLocal().receipts.slice(0, 10) })), 'forecasting', 'a halted round opens on the stage that halted');
  assert.equal(defaultStage(localJourney({ ...completedLocal(), stage: 'idle', running: false, round: null, receipts: [], proposals: [] })), 'funded');
  assert.equal(defaultStage(null), 'funded');
});

test('stage selection: Result exists only for finished rounds and a bad ?stage= is ignored', async () => {
  const evidence = validateRoundEvidence(JSON.parse(JSON.stringify(await loadRoundEvidence())));
  const saved = savedJourney(evidence.rounds[2]); const running = localJourney({ ...completedLocal(), stage: 'forecasting', running: true });
  assert.deepEqual(stageOrder(saved), ['result', ...STAGES.map((item) => item.id)]);
  assert.deepEqual(stageOrder(running), STAGES.map((item) => item.id));
  assert.equal(resolveStage('executed', saved), 'executed'); assert.equal(resolveStage('result', saved), 'result');
  assert.equal(resolveStage('result', running), null, 'a running round has no Result view'); assert.equal(resolveStage('nope', saved), null); assert.equal(resolveStage(null, saved), null);
  assert.equal(stepStage('funded', 1), 'proposals'); assert.equal(stepStage('redeemed', 1), null, 'replay stops at the end'); assert.equal(stepStage('funded', -1), null);
  assert.equal(stepStage('result', 1), 'funded', 'replay starts from Funded'); assert.equal(stepStage('result', -1), null);
});

test('round summary metrics come from the record; Hold and zero-trade rounds are stated plainly', async () => {
  const evidence = validateRoundEvidence(JSON.parse(JSON.stringify(await loadRoundEvidence())));
  const tide = roundSummary(evidence.rounds[2]);
  assert.deepEqual([tide.allocation, tide.measured, tide.tradesText, tide.selectedName], ['75% ETH selected', `${MINUS}0.6458%`, '4 recorded trades', 'Momentum']);
  const hold = roundSummary(evidence.rounds[1]);
  assert.deepEqual([hold.allocation, hold.tradesText, hold.selectedName], ['Hold selected', '0 recorded trades', 'Hold']);
  assert.equal(roundSummary({ ...evidence.rounds[2], realisedReturnX18: null }).measured, null, 'no return is invented before measurement');
  const one = roundSummary({ ...evidence.rounds[2], forecasters: evidence.rounds[2].forecasters.slice(0, 1) });
  assert.equal(one.tradesText, '1 recorded trade');
});

test('settlement shares and participant views keep LONG/SHORT and per-person numbers exact', async () => {
  assert.deepEqual(settlementShares('435418896350731900'), { long: '43.54%', short: '56.45%' });
  assert.deepEqual(settlementShares('0'), { long: '0.00%', short: '100.00%' });
  assert.equal(settlementShares('1000000000000000001'), null); assert.equal(settlementShares(null), null);
  const evidence = validateRoundEvidence(JSON.parse(JSON.stringify(await loadRoundEvidence())));
  const quant = participantViews(evidence.rounds[2]).find((item) => item.name === 'Quant');
  assert.deepEqual([quant.scripted, quant.deposit, quant.redeemed, quant.net], [true, '10000000', '9934985', '-65015']);
  assert.deepEqual(quant.position, { side: 'long', strategy: 'Momentum', credits: '400000' });
  const abstainer = participantViews(evidence.rounds[1])[0];
  assert.equal(abstainer.abstained, true); assert.equal(abstainer.position, null); assert.ok(abstainer.reason);
});

test('the local workspace is available, and startable, only on an idle local backend', () => {
  const local = (extra = {}) => ({ mode: 'local-simulation', chainId: 31337, stage: 'idle', running: false, ...extra });
  assert.deepEqual(localWorkspaceAccess(local()), { available: true, reason: 'Ready to start on a local chain', canStart: true });
  assert.equal(localWorkspaceAccess(local({ running: true, stage: 'forecasting' })).canStart, false, 'a running round cannot be started again');
  assert.equal(localWorkspaceAccess(local({ stage: 'completed' })).canStart, false);
  assert.equal(localWorkspaceAccess(local({ stage: 'completed' })).available, true, 'a finished local round can still be inspected');
  const aurora = localWorkspaceAccess({ mode: 'aurora-testnet-readonly', chainId: 1313161555, stage: 'idle', running: false });
  assert.deepEqual([aurora.available, aurora.canStart], [false, false]); assert.match(aurora.reason, /read-only/);
  assert.deepEqual([localWorkspaceAccess(null).available, localWorkspaceAccess(null).canStart], [false, false]);
  assert.equal(localWorkspaceAccess({ mode: 'mystery', chainId: 1, stage: 'idle' }).canStart, false);
});

test('swap legs read either direction and refuse malformed deltas', async () => {
  const { swapLeg, swapText } = await import('../src/lib/arena/model.mjs');
  assert.equal(swapText({ stableDelta: '-149610000', assetDelta: '71692173391461052' }), '149.61 USDC → 0.071692 ETH');
  assert.equal(swapText({ stableDelta: '138607014', assetDelta: '-66810740833647855' }), '0.06681 ETH → 138.6 USDC');
  assert.equal(swapLeg({ stableDelta: '-1', assetDelta: '-1' }), null, 'both negative is not a swap');
  assert.equal(swapLeg({ stableDelta: '1', assetDelta: '1' }), null, 'both positive is not a swap');
  assert.equal(swapLeg({ stableDelta: '0', assetDelta: '-5' }), null);
  assert.equal(swapLeg({ stableDelta: '1.5', assetDelta: '-5' }), null);
  assert.equal(swapLeg(null), null);
});
