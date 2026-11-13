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
async function proofFixture(count = 4, { swarm2 = false, forecasters = 0 } = {}) {
  const f = await syntheticTee(); const engine = `0x${'23'.repeat(20)}`;
  const plan = { teeRequired: true, attestationVerified: true, roundId: '9', engine, safe: `0x${'67'.repeat(20)}`, chainId: 1313161555, createdAt: f.at - 1, snapshot: { blockNumber: '100' }, market: { evidenceId: 'market' }, records: [], proposals: [{ id: 0, name: 'Hold' }] };
  const receipts = [];
  for (let id = 1; id <= count; id++) {
    const raw = { allocationBps: id * 1000, confidenceBps: 4000, rationale: 'Measured test allocation.', risks: ['Risk'], evidenceIds: ['market'] };
    const decision = validateProposal(raw, { evidenceIds: ['market'] }); const input = { system: 'system', context: { agent: `Agent${id}`, role: 'proposer', roundContext: { chainId: plan.chainId, engine: plan.engine, safe: plan.safe, roundId: plan.roundId, snapshotBlock: '100' } } };
    const e = structuredClone(f.evidence); e.requestBody = JSON.stringify({ model: f.model, messages: [{ role: 'system', content: input.system }, { role: 'user', content: JSON.stringify({ ...input.context, teeChallenge: f.nonce }) }] }); e.responseBody = JSON.stringify({ id: 'chat-test', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(raw) } }] }); e.signature = await f.signature(e.requestBody, e.responseBody);
    const privacy = await verifyTeeEvidence(e, f.policy, { quoteVerifier: f.quoteVerifier });
    const record = { name: `Agent${id}`, role: 'proposer', provider: 'near-ai', attestationVerified: true, input, inputHash: digest(input), decision, outputHash: digest(decision), privacy, teeEvidence: e };
    plan.records.push(record); plan.proposals.push({ id, name: record.name, allocationBps: raw.allocationBps });
    receipts.push({ status: 'success', to: engine, from: f.report.signing_address, transactionHash: `0x${String(id).repeat(64)}`, logs: [{ address: engine,
      topics: encodeEventTopics({ abi: ABI, eventName: 'ProposalCreated', args: { roundId: 9n, proposalId: BigInt(id), proposer: f.report.signing_address } }),
      data: encodeAbiParameters([{ type: 'uint16' }, { type: 'string' }], [raw.allocationBps, proposalRationale(record, raw.rationale)]) }] });
  }
  if (swarm2) {
    plan.teeScope = 'proposers';
    for (let i = 1; i <= forecasters; i++) plan.records.push({ name: `Forecaster${i}`, role: 'forecaster', provider: 'near-ai', attestationVerified: false, input: {}, inputHash: 'x', decision: {}, outputHash: 'y' });
  }
  return { f, plan, receipts };
}
test('TEE records recheck hardware/signature, literal prompt and normalized decision before accepting plan', async () => {
  const { f, plan } = await proofFixture(); const opts = { quoteVerifier: f.quoteVerifier };
  await verifyPlanTee(plan, f.policy, opts);
  await assert.rejects(verifyPlanTee({ ...plan, records: [] }, f.policy, opts), /TEE_RECORD_SET_INCOMPLETE/);
  await assert.rejects(verifyPlanTee({ ...plan, teeRequired: false, attestationVerified: false, records: [] }, f.policy, opts), /TEE_REQUESTED_BUT_PLAN_UNVERIFIED/);
  await assert.rejects(verifyPlanTee({ ...plan, createdAt: undefined }, f.policy, opts), /TEE_ROUND_CONTEXT_MISMATCH/);
  await assert.rejects(verifyPlanTee({ ...plan, roundId: '10' }, f.policy, opts), /TEE_ROUND_CONTEXT_MISMATCH/);
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
  assert.equal(result.length, 4); assert.ok(result.every(p => p.proposalBound && p.trustBasis === 'observed-at-2026-11-13-not-independently-reproduced'));
  const wrong = structuredClone(receipts); wrong[0].to = `0x${'45'.repeat(20)}`;
  await assert.rejects(verifyTeeProposals(plan, wrong, f.policy, opts), /TEE_PROPOSAL_BINDING_FAILED/);
  await assert.rejects(verifyTeeProposals(plan, [...receipts, receipts[0]], f.policy, opts), /TEE_PROPOSAL_BINDING_FAILED/);
  await assert.rejects(verifyTeeProposals({ ...plan, roundId: '8' }, receipts, f.policy, opts), /TEE_HISTORICAL_ROUND_NOT_ATTESTED/);
});

test('proposal binding count matches the plan exactly: swarm2 with 5 or 6 proposers plus unattested forecasters', async () => {
  for (const count of [5, 6]) {
    const { f, plan, receipts } = await proofFixture(count, { swarm2: true, forecasters: 8 }); const opts = { quoteVerifier: f.quoteVerifier };
    await verifyPlanTee(plan, f.policy, opts); // the full plan, forecaster records included: no proposer-only view needed
    const result = await verifyTeeProposals(plan, receipts, f.policy, opts);
    assert.equal(result.length, count); assert.deepEqual(result.map(p => p.proposalId), [...Array(count).keys()].map(i => String(i + 1)));
  }
});

test('a proposer count that does not match the plan is rejected', async () => {
  const { f, plan, receipts } = await proofFixture(5, { swarm2: true, forecasters: 8 }); const opts = { quoteVerifier: f.quoteVerifier };
  // A sixth proposal in the plan with no attested record behind it.
  const extra = structuredClone(plan); extra.proposals.push({ id: 6, name: 'Agent6', allocationBps: 6000 });
  await assert.rejects(verifyPlanTee(extra, f.policy, opts), /TEE_RECORD_SET_INCOMPLETE/);
  await assert.rejects(verifyTeeProposals(extra, receipts, f.policy, opts), /TEE_RECORD_SET_INCOMPLETE/);
  // A proposer record dropped while its proposal stays.
  const missing = structuredClone(plan); missing.records.splice(4, 1);
  await assert.rejects(verifyTeeProposals(missing, receipts, f.policy, opts), /TEE_RECORD_SET_INCOMPLETE/);
  // Same count, but a proposal whose name has no proposer record.
  const renamed = structuredClone(plan); renamed.proposals[2].name = 'Unrecorded';
  await assert.rejects(verifyPlanTee(renamed, f.policy, opts), /TEE_RECORD_SET_INCOMPLETE/);
  // A forecaster that claims attestation inside a proposer-scoped plan.
  const claim = structuredClone(plan); claim.records.at(-1).attestationVerified = true;
  await assert.rejects(verifyPlanTee(claim, f.policy, opts), /TEE_RECORD_SET_INCOMPLETE/);
  // Receipts for only four of the five proposals.
  await assert.rejects(verifyTeeProposals(plan, receipts.slice(0, 4), f.policy, opts), /TEE_PROPOSAL_BINDING_FAILED/);
  // The legacy set still caps at 8 NEAR AI records and needs at least 4.
  const legacy = await proofFixture(3); await assert.rejects(verifyPlanTee(legacy.plan, legacy.f.policy, { quoteVerifier: legacy.f.quoteVerifier }), /TEE_RECORD_SET_INCOMPLETE/);
});
