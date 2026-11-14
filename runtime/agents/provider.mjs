import { createKeyFallback } from './key-fallback.mjs';
const NEAR_ENDPOINT = 'https://cloud-api.near.ai/v1/chat/completions';
const MAX_BYTES = 65536;
export function providerConfig(env = process.env) {
  const mode = env.WAVEFUND_AGENT_MODE ?? 'fixture';
  if (mode === 'fixture') return null;
  if (!['near-ai', 'local'].includes(mode)) throw new Error('Agent mode must be fixture, local or near-ai');
  const model = env.WAVEFUND_AGENT_MODEL;
  if (typeof model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_./:-]{0,119}$/.test(model)) throw new Error('Set WAVEFUND_AGENT_MODEL to an available model identifier');
  if (mode === 'near-ai') {
    if (env.WAVEFUND_ALLOW_REMOTE_INFERENCE !== '1') throw new Error('Remote inference requires explicit WAVEFUND_ALLOW_REMOTE_INFERENCE=1');
    if (!env.NEARAI_API_KEY || /[\r\n]/.test(env.NEARAI_API_KEY)) throw new Error('Configure NEARAI_API_KEY locally; never paste it into chat');
    const backupApiKeys = [env.NEARAI_API_KEY_1, env.NEARAI_API_KEY_2].filter(k => k !== undefined && k !== '');
    if (backupApiKeys.some(k => typeof k !== 'string' || /[\r\n]/.test(k))) throw new Error('Invalid backup NEAR AI keys');
    return { mode, model, endpoint: NEAR_ENDPOINT, apiKey: env.NEARAI_API_KEY, ...(backupApiKeys.length ? { backupApiKeys } : {}) };
  }
  let url;
  try { url = new URL(env.WAVEFUND_LOCAL_MODEL_URL ?? 'http://127.0.0.1:11434/v1/chat/completions'); } catch { throw new Error('Invalid local model URL'); }
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/v1/chat/completions') throw new Error('Local inference requires a loopback chat-completions endpoint');
  return { mode, model, endpoint: url.toString() };
}
async function boundedBody(response) {
  if (!response.body) throw new Error('Model returned no response');
  const reader = response.body.getReader(); let size = 0; const parts = [];
  try {
    while (true) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > MAX_BYTES) throw new Error('Model response exceeds size limit'); parts.push(value); }
  } finally { await reader.cancel().catch(() => {}); }
  const buffer = new Uint8Array(size); let at = 0; for (const part of parts) { buffer.set(part, at); at += part.byteLength; }
  return new TextDecoder().decode(buffer);
}
export function createProvider(config, { fetchImpl = fetch, timeoutMs = 20000, maxCalls = 4 } = {}) {
  if (!config || !['local', 'near-ai'].includes(config.mode)) throw new Error('Explicit inference configuration required');
  // Revalidate even when a caller constructs configuration directly.
  const checked = providerConfig({ WAVEFUND_AGENT_MODE: config.mode, WAVEFUND_AGENT_MODEL: config.model, WAVEFUND_LOCAL_MODEL_URL: config.endpoint, WAVEFUND_ALLOW_REMOTE_INFERENCE: config.mode === 'near-ai' ? '1' : undefined, NEARAI_API_KEY: config.apiKey, NEARAI_API_KEY_1: config.backupApiKeys?.[0], NEARAI_API_KEY_2: config.backupApiKeys?.[1] });
  const credentials = createKeyFallback({ ...checked, fetchImpl });
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000 || !Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 8) throw new Error('Invalid inference limits');
  let calls = 0;
  return {
    info: Object.freeze({ mode: checked.mode, model: checked.model, attestationVerified: false }),
    async complete({ system, context }) {
      if (++calls > maxCalls) throw new Error('Inference request budget exhausted');
      let response; let phase = 'transport'; let finishReason = null;
      try {
        response = await credentials.fetch(checked.endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs), headers: { 'Content-Type': 'application/json', ...(checked.apiKey ? { Authorization: `Bearer ${checked.apiKey}` } : {}) }, body: JSON.stringify({ model: checked.model, messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(context) }], max_tokens: 1800, temperature: 0.2, stream: false }) });
        if (!response.ok) throw new Error(`Inference HTTP ${response.status}`);
        phase = 'response-json';
        const payload = JSON.parse(await boundedBody(response));
        const choice = payload.choices?.[0];
        finishReason = ['stop','length','content_filter','tool_calls'].includes(choice?.finish_reason) ? choice.finish_reason : 'unknown'; phase = 'completion';
        if (choice?.finish_reason !== 'stop' || choice.message?.tool_calls?.length || typeof choice.message?.content !== 'string') throw new Error('Incomplete or non-text model answer');
        phase = 'content-json';
        const parsed = JSON.parse(choice.message.content); // No fence stripping or JSON extraction from arbitrary prose.
        return { value: parsed, ...(checked.mode === 'near-ai' ? { credentialUse: credentials.usage() } : {}), usage: { inputTokens: Number.isSafeInteger(payload.usage?.prompt_tokens) ? payload.usage.prompt_tokens : null, outputTokens: Number.isSafeInteger(payload.usage?.completion_tokens) ? payload.usage.completion_tokens : null } };
      } catch (error) {
        // Do not surface SDK/network errors, credentials, HTTP bodies or hidden model reasoning to UI/journal.
        if (/^Inference HTTP \d{3}$/.test(error?.message ?? '')) throw error;
        const code = ['TimeoutError','AbortError'].includes(error?.name) ? 'TIMEOUT' : error?.message === 'Model response exceeds size limit' ? 'OVERSIZED' : phase === 'response-json' ? 'INVALID_RESPONSE_JSON' : phase === 'content-json' ? 'INVALID_CONTENT_JSON' : phase === 'completion' ? `INCOMPLETE_${finishReason.toUpperCase()}` : 'TRANSPORT_ERROR';
        throw new Error(`Inference failed: ${code}; no fallback or retry`);
      }
    },
  };
}

// Logical model calls per round. Explicit HTTP credential rejections can try bounded backup slots; other failures end the plan.
export const PROFILE_CALLS = Object.freeze({ classic: 4, hybrid: 4, swarm: 8, swarm2: 12 }); // swarm2 = 5 proposers + 8 forecasters
/** One shared counter for every provider in a round; take() throws on the call after the profile cap. */
export function roundCallCap(profile) {
  const cap = PROFILE_CALLS[profile];
  if (!Number.isSafeInteger(cap)) throw new Error('Unknown agent profile');
  let used = 0;
  return Object.freeze({ cap, get used() { return used; }, take() { if (used >= cap) throw new Error('Round model-call cap exhausted'); return ++used; } });
}

export function subprocessEnvironment(source, inferenceAccess = false) {
  const environment = { ...source };
  if (!inferenceAccess) for (const key of ['NEARAI_API_KEY', 'NEARAI_API_KEY_1', 'NEARAI_API_KEY_2']) delete environment[key];
  return environment;
}
