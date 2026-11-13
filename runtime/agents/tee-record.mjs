import { verifyTeeEvidence } from './tee-client.mjs';
import { digest, validateProposal, validateForecast } from './policy.mjs';
import { privacyVerified } from './tee.mjs';

export async function verifyPlanTee(plan, policy, options) {
  if (plan.teeRequired !== true) {
    if (policy) throw new Error('TEE_REQUESTED_BUT_PLAN_UNVERIFIED');
    if (plan.attestationVerified === true || plan.records?.some(r => r.attestationVerified === true)) throw new Error('TEE_UNEXPECTED_CLAIM');
    return;
  }
  const records = plan.records?.filter(r => r.provider === 'near-ai');
  if (!records || records.length < 4 || records.length > 8 || !plan.attestationVerified) throw new Error('TEE_RECORD_SET_INCOMPLETE');
  try {
  for (const record of records) {
    const evidence = record.teeEvidence;
    const expectedRound = { chainId: plan.chainId, engine: plan.engine, safe: plan.safe, roundId: plan.roundId, snapshotBlock: String(plan.snapshot?.blockNumber) };
    if (!Number.isSafeInteger(plan.createdAt) || JSON.stringify(record.input?.context?.roundContext) !== JSON.stringify(expectedRound) || record.input?.context?.agent !== record.name || record.input?.context?.role !== record.role
      || evidence?.preflightTime < plan.createdAt || evidence?.verificationTime > plan.createdAt + 300) throw new Error('TEE_ROUND_CONTEXT_MISMATCH');
    const p = await verifyTeeEvidence(evidence, policy, options);
    if (!p.verified || !privacyVerified(p) || JSON.stringify(p) !== JSON.stringify(record.privacy)) throw new Error('TEE_RECORD_RECHECK_FAILED');
    const input = JSON.parse(evidence.requestBody);
    if (input.messages?.length !== 2 || input.messages[0].role !== 'system' || input.messages[0].content !== record.input?.system || input.messages[1].role !== 'user' || input.messages[1].content !== JSON.stringify({ ...record.input?.context, teeChallenge: evidence.nonce })) throw new Error('TEE_PROMPT_RECORD_MISMATCH');
    const response = JSON.parse(evidence.responseBody); const choice = response.choices?.[0];
    if (choice?.finish_reason !== 'stop' || choice.message?.tool_calls?.length || choice.message?.reasoning_content || choice.message?.reasoning) throw new Error('TEE_COMPLETION_INVALID');
    const raw = JSON.parse(choice.message.content);
    const evidenceIds = [plan.market.evidenceId, ...(plan.researchContext ? [plan.researchContext.evidenceId] : [])];
    const decision = record.role === 'proposer' ? validateProposal(raw, { evidenceIds }) : validateForecast(raw, { evidenceIds, proposalIds: [0, 1, 2, 3, 4] });
    if (digest(decision) !== record.outputHash || record.inputHash !== digest(record.input)) throw new Error('TEE_SIGNED_DECISION_MISMATCH');
  }
  } catch (error) {
    if (/^TEE_[A-Z0-9_]+$/.test(error?.message ?? '')) throw error;
    throw new Error('TEE_RECORD_RECHECK_FAILED');
  }
}
