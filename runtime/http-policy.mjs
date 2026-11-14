export const LOCAL_UI_ORIGINS = new Set(['http://localhost:3000', 'http://127.0.0.1:3000']);
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function httpPolicy(env = process.env) {
  const hosted = env.WAVEFUND_HOSTED === '1';
  const origins = hosted ? new Set() : new Set(LOCAL_UI_ORIGINS);
  const hosts = new Set(LOCAL_HOSTS);
  if (hosted) {
    if (env.WAVEFUND_NETWORK !== 'aurora-testnet') throw new Error('Hosted API requires Aurora testnet monitoring');
    for (const value of (env.WAVEFUND_ALLOWED_ORIGINS ?? '').split(',').filter(Boolean)) {
      const url = new URL(value.trim());
      if (url.protocol !== 'https:' || url.origin !== value.trim() || url.username || url.password) throw new Error('Use exact HTTPS UI origins');
      origins.add(url.origin);
    }
    if (!origins.size) throw new Error('Hosted API needs an explicit UI origin');
    const name = env.RENDER_EXTERNAL_HOSTNAME ?? env.WAVEFUND_PUBLIC_HOST;
    if (!name || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(name) || !name.includes('.')) throw new Error('Hosted API needs its exact public hostname');
    hosts.add(name);
  }
  return { hosted, origins, hosts };
}

export function permittedHost(value, hosts = LOCAL_HOSTS) {
  if (!value) return false;
  try { const url = new URL(`http://${value}`); return hosts.has(url.hostname) && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash; }
  catch { return false; }
}

export function publicMethodAllowed(method, path) {
  return method === 'GET' || method === 'OPTIONS' || (method === 'POST' && path === '/api/funding/preview');
}

export function cachedRead(read, ttlMs, now = Date.now) {
  let value; let expires = 0; let pending;
  return async () => {
    if (value !== undefined && now() < expires) return value;
    if (!pending) pending = Promise.resolve().then(read).then(next => { value = next; expires = now() + ttlMs; return next; }).finally(() => { pending = undefined; });
    return pending;
  };
}
