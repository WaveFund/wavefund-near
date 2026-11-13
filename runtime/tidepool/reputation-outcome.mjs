// Pure expectations for AgentReputation.record(roundId). No network or signing.
// The contract keeps CUMULATIVE per-agent statistics: score = positive - negative over every recorded round. The
// per-round point is sign(returnFactor - 1e18); the cumulative score equals that point only on an agent's first sample.
const ONE = 10n ** 18n;
const check = (condition, message) => { if (!condition) throw new Error(message); };

export function roundIdOf(value) {
  check((typeof value === 'string' && /^[1-9][0-9]{0,8}$/.test(value)) || (Number.isSafeInteger(value) && value >= 1), 'A positive integer --round is required');
  return BigInt(value);
}
export const reputationLabel = (roundId) => `reputation:round${roundId}`;
export const pointOf = (factor) => { check(typeof factor === 'bigint' && factor > 0n, 'Missing return factor'); return factor > ONE ? 1n : factor < ONE ? -1n : 0n; };

const stats = (value) => { check(Array.isArray(value) && value.length === 4 && value.every(v => typeof v === 'bigint' && v >= 0n), 'Malformed statistics'); return value.map(v => v); };

// Before sending: the statistics after one new record for this agent.
export function expectedAfterRecord({ factor, previousStatistics, previousScore }) {
  const [samples, positive, negative, flat] = stats(previousStatistics);
  check(typeof previousScore === 'bigint' && previousScore === positive - negative, 'Previous score inconsistent with statistics');
  const point = pointOf(factor);
  const statistics = [samples + 1n, positive + (point === 1n ? 1n : 0n), negative + (point === -1n ? 1n : 0n), flat + (point === 0n ? 1n : 0n)];
  return { point, statistics, score: statistics[1] - statistics[2] };
}

export function checkRecordedOutcome({ expected, statistics, score }) {
  const actual = stats(statistics);
  check(actual.every((v, i) => v === expected.statistics[i]), `Unexpected statistics: expected samples ${expected.statistics[0]}`);
  check(score === expected.score, `Unexpected cumulative score: expected ${expected.score}`);
}

// The receipt's OutcomeRecorded event is the per-round evidence, also when the round was recorded earlier.
export function checkOutcomeEvent({ events, roundId, agent, factor }) {
  const matching = events.filter(e => e.eventName === 'OutcomeRecorded');
  check(matching.length === 1, 'Expected exactly one OutcomeRecorded event');
  const { args } = matching[0];
  check(args.roundId === roundId && String(args.agent).toLowerCase() === String(agent).toLowerCase() && args.returnFactorX18 === factor, 'OutcomeRecorded names another round, agent or factor');
  check(BigInt(args.point) === pointOf(factor), 'Recorded point is not sign(returnFactor - 1e18)');
  return BigInt(args.point);
}
