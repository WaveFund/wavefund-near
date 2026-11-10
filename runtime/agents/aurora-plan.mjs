import { createAgentTeam } from './team.mjs';
import { createProvider, providerConfig } from './provider.mjs';
import { AGENT_SPECS, digest, exactKeys, validateProposal, validateForecast } from './policy.mjs';
import { validateMarket } from './market.mjs';

export const LIVE_MODEL = 'Qwen/Qwen3.6-35B-A3B-FP8';
export const LIVE_LIMITS = Object.freeze({ calls: 4, outputTokens: 1800, inputBytes: 16384, budgetNanoUsd: 50000000 });
const check = (condition, message) => { if (!condition) throw new Error(message); };
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

export function boundedLiveProvider(config, { fetchImpl, onRequest, maxCalls = 4, budgetNanoUsd = 50000000 } = {}) {
  check(config?.mode === 'near-ai' && config.model === LIVE_MODEL, 'Use the explicitly priced live model');
  check(Number.isInteger(maxCalls) && maxCalls >= 1 && maxCalls <= 8 && Number.isSafeInteger(budgetNanoUsd) && budgetNanoUsd > 0 && budgetNanoUsd <= 100000000, 'Invalid explicit live budget');
  const provider = createProvider(config, { fetchImpl: (url, options) => {
    const body = JSON.parse(options.body);
    // Documented Qwen3.6 controls: keep the bounded response for the requested JSON.
    body.chat_template_kwargs = { enable_thinking: false };
    body.response_format = { type: 'json_object' };
    return (fetchImpl ?? fetch)(url, { ...options, body: JSON.stringify(body) });
  }, maxCalls, timeoutMs: 20000 });
  let reserved = 0; let requests = 0;
  return {
    info: provider.info,
    async complete(task) {
      const bytes = Buffer.byteLength(JSON.stringify({ system: task.system, context: task.context }), 'utf8');
      check(bytes <= LIVE_LIMITS.inputBytes, 'Inference context exceeds the live input limit');
      // Conservative byte-token allowance plus envelope margin, using the checked catalog rates.
      // This is a client estimate, not a provider-enforced billing cap.
      const allowance = (bytes + 512) * 170 + LIVE_LIMITS.outputTokens * 1100;
      check(requests < maxCalls && reserved + allowance <= budgetNanoUsd, 'Live inference budget exhausted');
      requests++; reserved += allowance;
      await onRequest?.({ request: requests, inputBytes: bytes, reservedNanoUsd: reserved });
      return provider.complete(task); // No retries or fallback.
    },
  };
}

export async function makeAuroraPlan({ snapshot, market: input, env, provider, onRecord, onRequest, now = Math.floor(Date.now() / 1000) }) {
  exactKeys(snapshot, ['chainId', 'roundId', 'safe', 'engine', 'portfolio', 'blockNumber'], 'live snapshot');
  exactKeys(snapshot.portfolio, ['stableBalance', 'assetBalance', 'currentAllocationBps'], 'live portfolio');
  check(snapshot?.chainId === 1313161555 && /^[1-9]\d*$/.test(snapshot.roundId), 'Invalid live snapshot identity');
  const market = validateMarket(input, { now });
  check(market.source === 'external-unverified', 'Live planning requires actual external research, not fixtures');
  const selected = provider ?? boundedLiveProvider(providerConfig(env), { onRequest });
  check(selected.info.mode === 'near-ai' && selected.info.model === LIVE_MODEL, 'Live planning requires the selected NEAR AI model');
  const team = createAgentTeam({ provider: selected, onRecord });
  const plan = await team.plan({ market, portfolio: snapshot.portfolio, policy: { horizonSeconds: 180 } });
  return { schemaVersion: 1, chainId: 1313161555, roundId: snapshot.roundId, safe: snapshot.safe, engine: snapshot.engine,
    createdAt: now, snapshot, market, proposals: plan.proposals, forecasts: plan.forecasts, records: plan.records,
    provider: plan.provider, attestationVerified: false };
}

export function validateAuroraPlan(plan, { contracts, roundId, portfolio, now }) {
  check(plan?.schemaVersion === 1 && plan.chainId === 1313161555 && plan.roundId === String(roundId), 'Plan belongs to another chain or round');
  check(same(plan.safe, contracts.safe) && same(plan.engine, contracts.engine), 'Plan belongs to another treasury');
  check(plan.provider?.mode === 'near-ai' && plan.provider.model === LIVE_MODEL && plan.attestationVerified === false, 'Invalid live provider provenance');
  const market = validateMarket(plan.market, { now });
  check(market.source === 'external-unverified' && market.evidenceId === plan.market.evidenceId, 'Invalid live research identity');
  check(Number.isSafeInteger(plan.createdAt) && plan.createdAt <= now && now - plan.createdAt <= 300, 'Plan expired or future-dated');
  for (const key of ['stableBalance', 'assetBalance']) check(plan.snapshot?.portfolio?.[key] === portfolio[key], 'Treasury changed after model analysis');
  check(plan.proposals?.length === 3 && plan.forecasts?.length === 2 && plan.records?.length === 4, 'Incomplete four-agent plan');
  const evidenceIds = [market.evidenceId];
  const hold = plan.proposals[0];
  check(hold.id === 0 && hold.allocationBps === plan.snapshot.portfolio.currentAllocationBps, 'Hold allocation differs from snapshot');
  for (const [index, spec] of AGENT_SPECS.filter(s => s.role === 'proposer').entries()) {
    const proposal = plan.proposals[index + 1];
    check(proposal.id === index + 1 && proposal.name === spec.name && proposal.accountIndex === spec.accountIndex, 'Unexpected proposer mapping');
    const { id, name, accountIndex, ...raw } = proposal;
    const decision = validateProposal(raw, { evidenceIds });
    const record = plan.records[index];
    check(record.name === spec.name && record.role === 'proposer' && record.outputHash === digest(decision), 'Proposal differs from recorded model decision');
  }
  for (const [index, spec] of AGENT_SPECS.filter(s => s.role === 'forecaster').entries()) {
    const forecast = plan.forecasts[index];
    check(forecast.name === spec.name && forecast.accountIndex === spec.accountIndex, 'Unexpected forecaster mapping');
    const decision = validateForecast({ forecasts: forecast.forecasts }, { evidenceIds, proposalIds: [0, 1, 2] });
    const record = plan.records[index + 2];
    check(record.name === spec.name && record.role === 'forecaster' && record.outputHash === digest(decision), 'Forecast differs from recorded model decision');
  }
  check(plan.records.every(r => r.provider === 'near-ai' && r.model === LIVE_MODEL && r.attestationVerified === false && /^[a-f0-9]{64}$/.test(r.inputHash)), 'Incomplete model evidence');
  return plan;
}
