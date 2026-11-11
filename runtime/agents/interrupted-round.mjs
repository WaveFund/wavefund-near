// Selected cancellation logic from the parked experiment, extracted for isolated
// testing. No automatic recovery: only the explicit recover-cancel operator phase.
export async function recoverInterruptedRound({ chain, events, emit = () => {} }) {
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  check(Array.isArray(events), 'Recovery journal required');
  const confirmed = new Set(events.filter(e => e.stage === 'confirmed').map(e => e.hash));
  check(!events.some(e => e.stage === 'prepared' && !confirmed.has(e.hash)), 'Unresolved transaction; inspect receipt before recovery');
  const schedules = events.filter(e => e.stage === 'schedule');
  check(schedules.length === 1, 'Recovery requires exactly one journaled schedule');
  const schedule = schedules[0];
  for (const key of ['roundId', 'tradingEnd', 'executionDeadline']) check(typeof schedule[key] === 'string' && /^[1-9]\d*$/.test(schedule[key]), 'Invalid recovery schedule');
  const id = BigInt(schedule.roundId); const end = BigInt(schedule.tradingEnd); const deadline = BigInt(schedule.executionDeadline);
  check(deadline > end, 'Invalid recovery deadlines');
  const state = await chain.inspect();
  check(String(state.currentRoundId) === schedule.roundId, 'Recovery round differs from chain');
  check(!await chain.read('engine', 'roundExecuted', [id]), 'Executed round must settle, never cancel');
  const before = await Promise.all(['stable', 'asset'].map(t => chain.read(t, 'balanceOf', [chain.contracts.safe])));
  await chain.waitUntil(end);
  let status = await chain.read('engine', 'roundStatus', [id]);
  check([1, 2, 4].includes(status), 'Recovery requires open, collapsed or cancelled round');
  if (status === 1) await chain.tx(`round${id}:collapse`, 'owner', 'engine', 'collapse', [id]);
  status = await chain.read('engine', 'roundStatus', [id]);
  check([2, 4].includes(status), 'Recovery collapse did not complete');
  await chain.waitUntil(deadline + 1n);
  // Recheck execution immediately before cancellation; the contract also checks.
  check(!await chain.read('engine', 'roundExecuted', [id]), 'Executed round must settle, never cancel');
  if (status !== 4) await chain.tx(`round${id}:abortExpired`, 'owner', 'module', 'abortExpired', [id]);
  const depositors = [...new Set(events.filter(e => e.stage === 'confirmed' && e.label?.startsWith(`round${id}:deposit:`)).map(e => e.actor))];
  for (const name of depositors) {
    check(chain.accounts[name]?.address, 'Recovery depositor missing from configured actors');
    if (await chain.read('engine', 'previewRedeem', [id, chain.accounts[name].address]) > 0n)
      await chain.tx(`round${id}:redeem:${name}`, name, 'engine', 'redeem', [id]);
  }
  const after = await Promise.all(['stable', 'asset'].map(t => chain.read(t, 'balanceOf', [chain.contracts.safe])));
  check(await chain.read('engine', 'roundStatus', [id]) === 4 && before.every((b, i) => b === after[i]), 'Cancelled round or Safe balances did not reconcile');
  // Do not compare the engine's entire balance to sponsor seed: other historical
  // round liabilities may legitimately remain. Verify this round's liabilities.
  const round = await chain.roundRecord(id);
  check(round.seedReleased === true && round.depositsOutstanding === 0n, 'Cancelled round liabilities remain');
  const result = { stage: 'recovered', roundId: String(id), status: 'cancelled', treasuryBefore: before.map(String), treasuryAfter: after.map(String), automaticRetry: false };
  emit(result); return result;
}
