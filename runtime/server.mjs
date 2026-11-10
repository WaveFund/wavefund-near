import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { createAuroraRuntime } from './operator/aurora.mjs';
import { createRuntime } from './demo.mjs';
import { json, safeError } from './config.mjs';

export const UI_ORIGINS = new Set(['http://localhost:3000', 'http://127.0.0.1:3000']);
export function validHost(value) {
  if (!value) return false;
  try { const url = new URL(`http://${value}`); return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && !url.username && !url.password && url.pathname === '/'; } catch { return false; }
}

export async function startServer(options = {}) {
  const host = options.host ?? process.env.HOST ?? '127.0.0.1';
  const port = Number(options.port ?? process.env.PORT ?? 3001);
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) && !(host === '0.0.0.0' && process.env.WAVEFUND_CONTAINER === '1')) throw new Error('Public listening is disabled; container binding requires explicit local-container mode');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid API port');
  const runtime = options.runtime ?? (process.env.WAVEFUND_NETWORK === 'aurora-testnet' ? await createAuroraRuntime({ manifestPath: process.env.AURORA_MANIFEST ?? 'deployments/aurora-testnet.json', artifactsDir: process.env.CONTRACT_ARTIFACTS ?? 'out' }) : await createRuntime({ rpcUrl: process.env.LOCAL_RPC_URL, manifestPath: process.env.LOCAL_MANIFEST ?? 'deployments/local.json', journalPath: process.env.LOCAL_JOURNAL ?? '.run/local-demo/journal.json', artifactsDir: process.env.CONTRACT_ARTIFACTS ?? 'out', marketDataPath: process.env.WAVEFUND_MARKET_DATA_FILE, ...options }));
  const server = createServer(async (request, response) => {
    const origin = request.headers.origin;
    function send(status, value) {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...(UI_ORIGINS.has(origin) ? { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } : {}) });
      response.end(json(value));
    }
    if (!validHost(request.headers.host) || (origin && !UI_ORIGINS.has(origin))) return send(403, { error: 'Local origin/host required' });
    if (request.method === 'OPTIONS') return send(204, null);
    let url;
    try { url = new URL(request.url, 'http://localhost'); } catch { return send(400, { error: 'Invalid URL' }); }
    try {
      if (request.method === 'GET' && url.pathname === '/api/health') return send(200, { ok: true, ...(runtime.metadata ?? { mode: 'local-simulation', chainId: 31337 }) });
      if (request.method === 'GET' && url.pathname === '/api/state') return send(200, await runtime.state());
      if (request.method === 'GET' && url.pathname === '/api/manager') return send(200, await runtime.manager.inspect());
      if (request.method === 'GET' && url.pathname === '/api/research') return send(200, await runtime.research());
      if (request.method === 'GET' && url.pathname === '/api/recovery') return send(200, await runtime.recovery());
      if (request.method === 'POST' && url.pathname === '/api/manager/prepare') {
        if (request.headers['content-type'] !== 'application/json') return send(415, { error: 'Use application/json' });
        const parts = []; let size = 0;
        for await (const chunk of request) { size += chunk.length; if (size > 2048) return send(413, { error: 'Body too large' }); parts.push(chunk); }
        return send(200, await runtime.manager.prepare(JSON.parse(Buffer.concat(parts).toString('utf8'))));
      }
      if (request.method === 'POST' && url.pathname === '/api/demo/start') {
        if (request.headers['content-type'] && !request.headers['content-type'].startsWith('application/json')) return send(415, { error: 'Use JSON or an empty request body' });
        let body = '';
        for await (const chunk of request) { body += chunk; if (body.length > 1024) return send(413, { error: 'Body too large' }); }
        if (body.trim() && JSON.stringify(JSON.parse(body)) !== '{}') return send(400, { error: 'Demo accepts no transaction parameters' });
        try { runtime.start(); } catch (error) { return send(409, { error: safeError(error) }); }
        return send(202, { accepted: true, mode: 'local-simulation' });
      }
      return send(404, { error: 'Not found' });
    } catch (error) { return send(request.method === 'GET' ? 503 : 400, { mode: 'local-simulation', error: safeError(error) }); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  return { server, runtime, async close() { await new Promise((resolve) => server.close(resolve)); await runtime.close(); } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const app = await startServer();
    console.log('Wavefund local-simulation API ready on port 3001. Inference is configured separately; assets and oracle prices remain simulated.');
    const close = () => app.close().then(() => process.exit(0), (error) => { console.error(safeError(error)); process.exit(1); });
    process.once('SIGINT', close); process.once('SIGTERM', close);
  } catch (error) { console.error(safeError(error)); process.exitCode = 1; }
}
