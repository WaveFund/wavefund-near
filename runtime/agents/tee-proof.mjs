import { decodeEventLog, parseAbi } from 'viem';
import { verifyPlanTee, teeRecords } from './tee-record.mjs';
import { proposalBinding } from './tee.mjs';
const ABI = parseAbi(['event ProposalCreated(uint256 indexed roundId, uint256 indexed proposalId, address indexed proposer, uint16 tEthBps, string rationale)']);
const fail = (ok, message) => { if (!ok) throw new Error(message); };

// Receipts are saved public RPC observations, not a trustless chain proof. Export fetches them from the fixed chain.
export async function verifyTeeProposals(plan, receipts, policy, options) {
  fail(plan.teeRequired === true && Number(plan.roundId) > 8, 'TEE_HISTORICAL_ROUND_NOT_ATTESTED');
  await verifyPlanTee(plan, policy, options);
  // One bound proposal per challenger in the plan (1..9), never a hard-coded count.
  const expected = plan.proposals.filter(p => p.id !== 0).length;
  fail(expected >= 1 && expected <= 9 && plan.proposals.filter(p => p.id === 0).length === 1, 'TEE_PROPOSALS_INCOMPLETE');
  const out = [];
  for (const proposal of plan.proposals.filter(p => p.id !== 0)) {
    const matching = plan.records.filter(r => r.role === 'proposer' && r.name === proposal.name);
    fail(matching.length === 1 && teeRecords(plan)?.includes(matching[0]), 'TEE_PROPOSALS_INCOMPLETE');
    const record = matching[0];
    const matches = [];
    for (const receipt of receipts) {
      if (receipt.status !== 'success' || receipt.to?.toLowerCase() !== plan.engine.toLowerCase()) continue;
      for (const log of receipt.logs ?? []) {
        if (log.address?.toLowerCase() !== plan.engine.toLowerCase()) continue;
        let event; try { event = decodeEventLog({ abi: ABI, data: log.data, topics: log.topics, strict: true }); } catch { continue; }
        const a = event.args;
        if (String(a.roundId) === plan.roundId && Number(a.proposalId) === proposal.id && receipt.from?.toLowerCase() === a.proposer.toLowerCase()
          && Number(a.tEthBps) === proposal.allocationBps && proposalBinding(record, { rationale: a.rationale, allocationBps: a.tEthBps })) matches.push(receipt.transactionHash);
      }
    }
    fail(matches.length === 1, 'TEE_PROPOSAL_BINDING_FAILED');
    out.push({ proposalId: String(proposal.id), name: proposal.name, privacy: record.privacy, trustBasis: policy.trustBasis, proposalBound: true, transactionHash: matches[0] });
  }
  fail(out.length === expected && plan.records.filter(r => r.role === 'proposer').length === expected, 'TEE_PROPOSALS_INCOMPLETE');
  return out;
}
