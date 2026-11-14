const ORIGIN = 'https://cloud-api.near.ai';
const REJECTED = new Set([401, 402, 429]);

// Bounded credential fallback after an explicit completion rejection only. A successful/ambiguous
// completion, timeout, malformed answer or failed proof never causes another model generation.
export function createKeyFallback({ apiKey, backupApiKeys = [], fetchImpl = fetch }) {
  if (!Array.isArray(backupApiKeys) || backupApiKeys.length > 2 || backupApiKeys.some(k => typeof k !== 'string' || /[\r\n]/.test(k))) throw new Error('Invalid backup NEAR AI keys');
  const keys = [...new Set([apiKey, ...backupApiKeys.filter(Boolean)])];
  let index = 0; let rejectionStatus = null;
  return {
    usage: () => ({ slot: index === 0 ? 'primary' : `backup-${index}`, switches: index, ...(rejectionStatus === null ? {} : { lastRejectionStatus: rejectionStatus }) }),
    async fetch(url, options = {}) {
      const target = new URL(url);
      if (target.origin !== ORIGIN || !new Headers(options.headers).has('Authorization')) return fetchImpl(url, options);
      for (;;) {
        const response = await fetchImpl(url, { ...options, headers: { ...Object.fromEntries(new Headers(options.headers)), authorization: `Bearer ${keys[index]}` } });
        if (target.pathname !== '/v1/chat/completions' || !REJECTED.has(response.status) || index + 1 >= keys.length || options.signal?.aborted) return response;
        await response.body?.cancel().catch(() => {});
        rejectionStatus = response.status; index++;
      }
    },
  };
}
