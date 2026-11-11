const check = (condition, message) => { if (!condition) throw new Error(message); };
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const ZERO = '0x0000000000000000000000000000000000000000';
// Hold means unchanged quantities, not a price-invariant percentage. Pin the
// actual opening baseline once; never rewrite the model's proposal/evidence.
export function verifySubmittedProposals({ proposals, actual, accounts, expectedBalances, currentBalances, baselineBps = null }) {
  check(['stableBalance', 'assetBalance'].every(key => expectedBalances[key] === currentBalances[key]), 'Treasury quantities changed after model analysis');
  check(Array.isArray(proposals) && Array.isArray(actual) && proposals.length === actual.length && proposals.length >= 1, 'Submitted proposal coverage changed');
  for (let i = 0; i < proposals.length; i++) {
    const expected = proposals[i]; const observed = actual[i];
    check(expected.id === i && observed.id === i && Number.isInteger(observed.allocationBps) && observed.allocationBps >= 0 && observed.allocationBps <= 10000, 'Submitted proposal identity changed');
    if (i === 0) {
      check(observed.isStatusQuo === true && same(observed.proposer, ZERO), 'Invalid Hold proposal identity');
      check(baselineBps === null || observed.allocationBps === baselineBps, 'Opening Hold baseline changed');
    } else {
      check(observed.isStatusQuo === false && observed.allocationBps === expected.allocationBps
        && same(observed.proposer, accounts[expected.name]?.address), 'Submitted proposal differs from model plan');
    }
  }
  return actual[0].allocationBps;
}
export function verifyWinningProposal({ proposals, winner, allocationBps, baselineBps }) {
  check(Number.isInteger(winner) && winner >= 0 && winner < proposals.length && Number.isInteger(baselineBps), 'Winner is outside the analysed set');
  check(allocationBps === (winner === 0 ? baselineBps : proposals[winner].allocationBps), 'Winner allocation changed');
}
