import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeAbiParameters, encodeEventTopics, parseAbi } from 'viem';
import { verifyPlanTee } from '../agents/tee-record.mjs';
import { verifyTeeProposals } from '../agents/tee-proof.mjs';
import { verifyTeeEvidence } from '../agents/tee-client.mjs';
import { proposalRationale } from '../agents/tee.mjs';
import { digest, validateProposal } from '../agents/policy.mjs';
import { syntheticTee } from './fixtures/tee-synthetic.mjs';
const ABI = parseAbi(['event ProposalCreated(uint256 indexed roundId, uint256 indexed proposalId, address indexed proposer, uint16 tEthBps, string rationale)']);
async function proofFixture() {
  const f = await syntheticTee(); const engine = `0x${'23'.repeat(20)}`;
  const plan = { teeRequired: true, attestationVerified: true, roundId: '9', engine, market: { evidenceId: 'market' }, records: [], proposals: [{ id: 0, name: 'Hold' }] };
  const receipts = [];
  for (let id = 1; id <= 4; id++) {
    const raw = { allocationBps: id * 2000, confidenceBps: 4000, rationale: 'Measured test allocation.', risks: ['Risk'], evidenceIds: ['market'] };
    const decision = validateProposal(raw, { evidenceIds: ['market'] }); const input = { system: 'system', context: {} };
    const e = structuredClone(f.evidence); e.responseBody = JSON.stringify({ id: 'chat-test', choices: [{ message: { content: JSON.stringify(raw) } }] }); e.signature = await f.signature(e.requestBody, e.responseBody);
    const privacy = await verifyTeeEvidence(e, f.policy, { quoteVerifier: f.quoteVerifier });
    const record = { name: `Agent${id}`, role: 'proposer', provider: 'near-ai', attestationVerified: true, input, inputHash: digest(input), decision, outputHash: digest(decision), privacy, teeEvidence: e };
    plan.records.push(record); plan.proposals.push({ id, name: record.name, allocationBps: raw.allocationBps });
    receipts.push({ status: 'success', to: engine, from: f.report.signing_address, transactionHash: `0x${String(id).repeat(64)}`, logs: [{ address: engine,
      topics: encodeEventTopics({ abi: ABI, eventName: 'ProposalCreated', args: { roundId: 9n, proposalId: BigInt(id), proposer: f.report.signing_address } }),
      data: encodeAbiParameters([{ type: 'uint16' }, { type: 'string' }], [raw.allocationBps, proposalRationale(record, raw.rationale)]) }] });
  }
  return { f, plan, receipts };
}
test('TEE records recheck hardware/signature, literal prompt and normalized decision before accepting plan', async () => {
  const { f, plan } = await proofFixture(); const opts = { quoteVerifier: f.quoteVerifier };
  await verifyPlanTee(plan, f.policy, opts);
  await assert.rejects(verifyPlanTee({ ...plan, records: [] }, f.policy, opts), /TEE_RECORD_SET_INCOMPLETE/);
  await assert.rejects(verifyPlanTee({ ...plan, teeRequired: false, attestationVerified: false, records: [] }, f.policy, opts), /TEE_REQUESTED_BUT_PLAN_UNVERIFIED/);
  const wrong = structuredClone(plan); wrong.records[0].input.system = 'changed'; wrong.records[0].inputHash = digest(wrong.records[0].input);
  await assert.rejects(verifyPlanTee(wrong, f.policy, opts), /TEE_PROMPT_RECORD_MISMATCH/);
  const output = structuredClone(plan); output.records[0].outputHash = '00'.repeat(32);
  await assert.rejects(verifyPlanTee(output, f.policy, opts), /TEE_SIGNED_DECISION_MISMATCH/);
  const flags = structuredClone(plan); flags.records[0].privacy.nonceBound = false;
  await assert.rejects(verifyPlanTee(flags, f.policy, opts), /TEE_RECORD_RECHECK_FAILED/);
});
test('actual ProposalCreated event binds each allocation and response hash, not caller-provided proposalBound', async () => {
  const { f, plan, receipts } = await proofFixture(); const opts = { quoteVerifier: f.quoteVerifier };
  const result = await verifyTeeProposals(plan, receipts, f.policy, opts);
  assert.equal(result.length, 4); assert.ok(result.every(p => p.proposalBound));
  const wrong = structuredClone(receipts); wrong[0].to = `0x${'45'.repeat(20)}`;
  await assert.rejects(verifyTeeProposals(plan, wrong, f.policy, opts), /TEE_PROPOSAL_BINDING_FAILED/);
  await assert.rejects(verifyTeeProposals(plan, [...receipts, receipts[0]], f.policy, opts), /TEE_PROPOSAL_BINDING_FAILED/);
  await assert.rejects(verifyTeeProposals({ ...plan, roundId: '8' }, receipts, f.policy, opts), /TEE_HISTORICAL_ROUND_NOT_ATTESTED/);
});
