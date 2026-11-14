const loopback = host => ['localhost', '127.0.0.1', '[::1]'].includes(host);
export function resolveApiUrl(path, configured, pageOrigin) {
  if (typeof path !== 'string' || !path.startsWith('/api/') || path.startsWith('//') || path.includes('\\')) throw new Error('Invalid API path');
  const localPage = !pageOrigin || loopback(new URL(pageOrigin).hostname);
  if (!configured && !localPage) throw new Error('Backend is not configured');
  const base = new URL(configured || 'http://127.0.0.1:3001');
  if (base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw new Error('Invalid API origin');
  if (loopback(base.hostname)) {
    if (!localPage || base.protocol !== 'http:') throw new Error('Hosted pages cannot access a local API');
  } else if (base.protocol !== 'https:') throw new Error('Public API requires HTTPS');
  return new URL(path, base).toString();
}
