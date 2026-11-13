// swarm2: six proposers + Hold and eight forecasters, every agent on a DIFFERENT NEAR AI catalog model.
// Pure data + validation: no network, clock or credentials. Model ids, features and prices were read from the public
// catalog (GET https://cloud-api.near.ai/v1/models) on 2026-11-13; re-check before a live round.
//
// Proposers use models NEAR AI serves from its own attested CVMs: GET /v1/attestation/report returned a gateway + model
// report for each of the six proposer ids on 2026-11-13. Proposer TEE verification still needs each model's
// mrTd:mrConfigId in the reviewed --tee-policy; three of them share the Qwen3.6 measurement, GLM and DeepSeek do not.
// Forecasters are third-party models proxied by NEAR AI: no hardware attestation is claimed for them.

const check = (condition, message) => { if (!condition) throw new Error(message); };
export const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9_./:-]{0,119}$/;

// priceIn/priceOut: catalog USD per million tokens, stored as nano-USD per token (USD/M x 1000).
// responseFormat: 'json_object' where the catalog lists json_mode, 'json_schema' where it lists only structured_outputs,
// 'none' where it lists neither (the prompt still demands bare JSON and the parser accepts nothing else).
// temperature: sent only where the catalog lists it as a supported sampling parameter.
// maxTokens: 4000 for models that may spend output tokens on reasoning, else the classic 1800.
// thinkingOff: chat_template_kwargs for NEAR-hosted open weights (ignored by templates that do not use a key).
export const SWARM2_MODELS = Object.freeze(Object.fromEntries([
  ['Qwen/Qwen3.6-35B-A3B-FP8', { family: 'Qwen', hosting: 'near-attested', priceIn: 170, priceOut: 1100, responseFormat: 'json_object', temperature: true, maxTokens: 1800, thinkingOff: { enable_thinking: false } }],
  ['Qwen/Qwen3.8-27B', { family: 'Qwen', hosting: 'near-attested', priceIn: 40, priceOut: 1350, responseFormat: 'json_schema', temperature: true, maxTokens: 1800, thinkingOff: { enable_thinking: false } }],
  ['z-ai/glm-5.3-flash', { family: 'GLM', hosting: 'near-attested', priceIn: 80, priceOut: 500, responseFormat: 'json_object', temperature: true, maxTokens: 1800, thinkingOff: { enable_thinking: false } }],
  ['deepseek-ai/DeepSeek-V4.1-Flash-1017', { family: 'DeepSeek', hosting: 'near-attested', priceIn: 300, priceOut: 1200, responseFormat: 'none', temperature: false, maxTokens: 1800, thinkingOff: { enable_thinking: false, thinking: false } }],
  ['Qwen/Qwen3-VL-30B-A3B-Instruct', { family: 'Qwen', hosting: 'near-attested', priceIn: 150, priceOut: 550, responseFormat: 'json_schema', temperature: true, maxTokens: 1800, thinkingOff: null }],
  ['Qwen/Qwen3.8-27B-abliterated', { family: 'Qwen', hosting: 'near-attested', priceIn: 40, priceOut: 1350, responseFormat: 'json_schema', temperature: true, maxTokens: 1800, thinkingOff: { enable_thinking: false } }],
  ['openai/gpt-4.1-mini', { family: 'OpenAI', hosting: 'proxied', priceIn: 400, priceOut: 1600, responseFormat: 'json_object', temperature: true, maxTokens: 1800, thinkingOff: null }],
  ['anthropic/claude-haiku-5-5', { family: 'Anthropic', hosting: 'proxied', priceIn: 100, priceOut: 500, responseFormat: 'json_schema', temperature: false, maxTokens: 4000, thinkingOff: null }],
  ['google/gemini-2.5-flash', { family: 'Google', hosting: 'proxied', priceIn: 300, priceOut: 2500, responseFormat: 'json_object', temperature: true, maxTokens: 4000, thinkingOff: null }],
  ['x-ai/grok-4.6', { family: 'xAI', hosting: 'proxied', priceIn: 2000, priceOut: 6000, responseFormat: 'json_object', temperature: true, maxTokens: 4000, thinkingOff: null }],
  ['moonshotai/kimi-k2.6', { family: 'Moonshot', hosting: 'proxied', priceIn: 810, priceOut: 3850, responseFormat: 'json_schema', temperature: true, maxTokens: 4000, thinkingOff: null }],
  ['deepseek/deepseek-v3.2', { family: 'DeepSeek', hosting: 'proxied', priceIn: 1100, priceOut: 1100, responseFormat: 'json_object', temperature: true, maxTokens: 1800, thinkingOff: null }],
  ['qwen/qwen3.7-max', { family: 'Qwen', hosting: 'proxied', priceIn: 2800, priceOut: 7500, responseFormat: 'json_object', temperature: true, maxTokens: 1800, thinkingOff: null }],
  ['z-ai/glm-5.3', { family: 'GLM', hosting: 'proxied', priceIn: 1800, priceOut: 5750, responseFormat: 'none', temperature: true, maxTokens: 4000, thinkingOff: null }],
].map(([id, spec]) => [id, Object.freeze(spec)])));

// Proposal ids follow array order: 0 Hold, 1..6 below. The first four keep the classic swarm ids and bounds.
// Allocation intervals never overlap, so six valid proposals are always six distinct allocations.
export const SWARM2_PROPOSERS = Object.freeze([
  { name: 'Conservative', min: 0, max: 2000, target: 1000, model: 'Qwen/Qwen3.6-35B-A3B-FP8', mandate: 'Capital preservation: choose a low asset exposure within the assigned mandate.' },
  { name: 'Balanced', min: 3500, max: 5000, target: 4500, model: 'Qwen/Qwen3.8-27B', mandate: 'Balanced treasury: choose a diversified cash/asset allocation within the assigned mandate.' },
  { name: 'Momentum', min: 6500, max: 8000, target: 7500, model: 'z-ai/glm-5.3-flash', mandate: 'Growth exposure: assess trend risk while retaining the assigned growth exposure.' },
  { name: 'HighBeta', min: 9000, max: 10000, target: 9500, model: 'deepseek-ai/DeepSeek-V4.1-Flash-1017', mandate: 'High asset exposure: assess downside and choose a weight inside the assigned high-exposure mandate.' },
  { name: 'Contrarian', min: 2100, max: 3400, target: 3000, model: 'Qwen/Qwen3-VL-30B-A3B-Instruct', mandate: 'Contrarian: question the recent trend; choose a weight inside the assigned interval that would hold up if the recent move reverses.' },
  { name: 'VolAware', min: 5100, max: 6400, target: 6000, model: 'Qwen/Qwen3.8-27B-abliterated', mandate: 'Volatility-aware: size asset exposure inside the assigned interval inversely to the realised volatility in the supplied history.' },
].map(Object.freeze));

export const SWARM2_FORECASTERS = Object.freeze([
  { name: 'Quant', model: 'openai/gpt-4.1-mini', mandate: 'Estimate each expected return from the actual allocations and trend/volatility evidence.' },
  { name: 'Guardian', model: 'anthropic/claude-haiku-5-5', mandate: 'Independently examine downside and stablecoin depeg uncertainty.' },
  { name: 'FeeAnalyst', model: 'google/gemini-2.5-flash', mandate: 'Examine turnover and fees: a challenger pays a rebalance fee that Hold does not.' },
  { name: 'StressAnalyst', model: 'x-ai/grok-4.6', mandate: 'Challenge extrapolation of recent prices and stress-test each allocation.' },
  { name: 'BaseRate', model: 'moonshotai/kimi-k2.6', mandate: 'Anchor on the base rate that short-horizon returns are close to zero, then adjust only for supplied evidence.' },
  { name: 'VolAnalyst', model: 'deepseek/deepseek-v3.2', mandate: 'Relate each allocation to realised volatility: more asset exposure means a wider spread of outcomes, not a higher expected return.' },
  { name: 'Regime', model: 'qwen/qwen3.7-max', mandate: 'Judge whether the supplied history looks trending or mean-reverting and what that implies for each allocation\'s return.' },
  { name: 'Skeptic', model: 'z-ai/glm-5.3', mandate: 'Argue against the most popular view; stay near zero expected return unless the evidence clearly supports a move.' },
].map(Object.freeze));

export const SWARM2_CALLS = SWARM2_PROPOSERS.length + SWARM2_FORECASTERS.length; // 14 paid calls, no retries
export const SWARM2_PROPOSAL_IDS = Object.freeze([0, ...SWARM2_PROPOSERS.map((_, i) => i + 1)]);
export const SWARM2_FORECAST_IDS = SWARM2_PROPOSAL_IDS; // every proposal, Hold included: each has its own LONG/SHORT market
// Trade rule (runtime/agents/policy.mjs chooseValueTrade): trade only when the forecast payout beats the actual entry
// price by at least 3 points (300 bps of the 1-unit payout). Recorded in every swarm2 plan and export.
export const SWARM2_MIN_EDGE_BPS = 300;
export const SWARM2_TRADE_RULE = 'expected-payout-value-v1';
export const SWARM2_ACTORS = Object.freeze([...SWARM2_PROPOSERS, ...SWARM2_FORECASTERS].map(a => a.name));
export const SWARM2_INPUT_BYTES = 20480; // forecaster context grows with seven anonymous strategies
export const SWARM2_TIMEOUT_MS = 60000;

// Client-side reservation per call: every input byte counted as a token (an upper bound) plus the full output allowance.
export function callAllowanceNanoUsd(model, inputBytes) {
  const spec = SWARM2_MODELS[model];
  check(spec, 'Model is not in the swarm2 allowlist');
  check(Number.isSafeInteger(inputBytes) && inputBytes >= 0 && inputBytes <= SWARM2_INPUT_BYTES, 'Inference context exceeds the swarm2 input limit');
  return (inputBytes + 512) * spec.priceIn + spec.maxTokens * spec.priceOut;
}
// The round budget is the sum of every agent's worst-case reservation: no call can be refused for budget unless an
// input is larger than the limit, and no extra call fits.
export const SWARM2_BUDGET_NANO_USD = [...SWARM2_PROPOSERS, ...SWARM2_FORECASTERS].reduce((sum, a) => sum + callAllowanceNanoUsd(a.model, SWARM2_INPUT_BYTES), 0);

export function validateSwarmConfig({ proposers = SWARM2_PROPOSERS, forecasters = SWARM2_FORECASTERS, models = SWARM2_MODELS } = {}) {
  check(proposers.length === 6 && forecasters.length === 8, 'swarm2 needs exactly six proposers and eight forecasters');
  check(proposers.length + 1 <= 10, 'Contract allows at most ten proposals including Hold');
  const agents = [...proposers, ...forecasters];
  check(new Set(agents.map(a => a.name)).size === agents.length && agents.every(a => /^[A-Za-z][A-Za-z0-9]{0,31}$/.test(a.name) && a.name !== 'Hold'), 'Agent names must be distinct identifiers');
  check(agents.every(a => typeof a.model === 'string' && MODEL_ID.test(a.model) && Object.hasOwn(models, a.model)), 'Unknown model: every agent model must be in the allowlist');
  check(new Set(agents.map(a => a.model)).size === agents.length, 'Every agent needs a different model');
  check(proposers.every(p => models[p.model].hosting === 'near-attested'), 'Proposers must use NEAR-attested open-weight models');
  check(agents.every(a => typeof a.mandate === 'string' && a.mandate.length > 0 && a.mandate.length <= 240), 'Every agent needs a short mandate');
  check(proposers.every(p => Number.isSafeInteger(p.min) && Number.isSafeInteger(p.max) && Number.isSafeInteger(p.target) && p.min >= 0 && p.max <= 10000 && p.min <= p.target && p.target <= p.max), 'Invalid proposer allocation bounds');
  const sorted = [...proposers].sort((a, b) => a.min - b.min);
  check(sorted.every((p, i) => i === 0 || sorted[i - 1].max < p.min), 'Proposer allocation intervals must not overlap');
  for (const spec of Object.values(models)) check(['near-attested', 'proxied'].includes(spec.hosting) && ['json_object', 'json_schema', 'none'].includes(spec.responseFormat)
    && [spec.priceIn, spec.priceOut].every(v => Number.isSafeInteger(v) && v > 0) && [1800, 4000].includes(spec.maxTokens), 'Invalid model allowlist entry');
  return { proposers, forecasters, models };
}
validateSwarmConfig();

export function modelOf(name) {
  const agent = [...SWARM2_PROPOSERS, ...SWARM2_FORECASTERS].find(a => a.name === name);
  check(agent, 'Unknown swarm2 agent');
  return agent.model;
}

// JSON schemas for models that support structured outputs but not json_mode. They mirror validateProposal and
// validateReturnForecast; the local validators remain the authority. The optional free-text `uncertainty` field is left
// out of the strict schema, so structured-output models simply never send it.
const explanation = { rationale: { type: 'string' }, risks: { type: 'array', items: { type: 'string' } }, evidenceIds: { type: 'array', items: { type: 'string' } } };
export const PROPOSAL_SCHEMA = Object.freeze({ name: 'proposal', strict: true, schema: { type: 'object', additionalProperties: false, required: ['allocationBps', 'confidenceBps', 'rationale', 'risks', 'evidenceIds'],
  properties: { allocationBps: { type: 'integer' }, confidenceBps: { type: 'integer' }, ...explanation } } });
export const FORECAST_SCHEMA = Object.freeze({ name: 'forecasts', strict: true, schema: { type: 'object', additionalProperties: false, required: ['forecasts'],
  properties: { forecasts: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['proposalId', 'expectedReturnBps', 'rationale', 'risks', 'evidenceIds'],
    properties: { proposalId: { type: 'integer' }, expectedReturnBps: { type: 'integer' }, ...explanation } } } } } });

/** Rewrites a chat-completions body for one allowlisted model and role. Pure. */
export function requestBodyFor(model, role, body) {
  const spec = SWARM2_MODELS[model];
  check(spec && body?.model === model, 'Request model differs from the allowlisted agent model');
  check(role === 'proposer' || role === 'forecaster', 'Unknown agent role');
  const out = { ...body, max_tokens: spec.maxTokens };
  if (!spec.temperature) delete out.temperature;
  if (spec.thinkingOff) out.chat_template_kwargs = { ...spec.thinkingOff };
  if (spec.responseFormat === 'json_object') out.response_format = { type: 'json_object' };
  else if (spec.responseFormat === 'json_schema') out.response_format = { type: 'json_schema', json_schema: role === 'proposer' ? PROPOSAL_SCHEMA : FORECAST_SCHEMA };
  else delete out.response_format;
  return out;
}
