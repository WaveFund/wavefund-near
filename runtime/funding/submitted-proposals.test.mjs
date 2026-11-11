import test from 'node:test';
import assert from 'node:assert/strict';
import { verifySubmittedProposals, verifyWinningProposal } from '../agents/submitted-proposals.mjs';
function fixture() {
  return { proposals: [{ id: 0, name: 'Hold', allocationBps: 4483 }, { id: 1, name: 'Momentum', allocationBps: 4483 }],
    actual: [{ id: 0, proposer: '0x0000000000000000000000000000000000000000', allocationBps: 4485, isStatusQuo: true },
      { id: 1, proposer: 'agent-address', allocationBps: 4483, isStatusQuo: false }],
    accounts: { Momentum: { address: 'agent-address' } }, expectedBalances: { stableBalance: '1094400091', assetBalance: '428886426777995925' },
    currentBalances: { stableBalance: '1094400091', assetBalance: '428886426777995925' } };
}
test('Hold tolerates mark-price weight drift only with unchanged quantities and pins opening weight', () => {
  const f = fixture(); assert.equal(verifySubmittedProposals(f), 4485);
  assert.equal(f.proposals[0].allocationBps, 4483);
  assert.equal(verifySubmittedProposals({ ...f, baselineBps: 4485 }), 4485);
  assert.throws(() => verifySubmittedProposals({ ...f, baselineBps: 4484 }), /Opening Hold baseline changed/);
});
test('custody changes and altered agent strategies remain rejected', () => {
  const f = fixture(); f.currentBalances.stableBalance = '1094400092';
  assert.throws(() => verifySubmittedProposals(f), /Treasury quantities changed/);
  const g = fixture(); g.actual[1].allocationBps = 4485;
  assert.throws(() => verifySubmittedProposals(g), /Submitted proposal differs/);
  const h = fixture(); h.actual[0].isStatusQuo = false;
  assert.throws(() => verifySubmittedProposals(h), /Invalid Hold proposal identity/);
});
test('a winning Hold uses the pinned onchain baseline without permitting changed other winners', () => {
  const f = fixture(); verifyWinningProposal({ proposals: f.proposals, winner: 0, allocationBps: 4485, baselineBps: 4485 });
  assert.throws(() => verifyWinningProposal({ proposals: f.proposals, winner: 0, allocationBps: 4483, baselineBps: 4485 }), /Winner allocation changed/);
  assert.throws(() => verifyWinningProposal({ proposals: f.proposals, winner: 1, allocationBps: 4485, baselineBps: 4485 }), /Winner allocation changed/);
});
