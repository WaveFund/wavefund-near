import test from 'node:test';
import { request as httpRequest } from 'node:http';
import assert from 'node:assert/strict';
import { httpPolicy, permittedHost, cachedRead } from '../http-policy.mjs';
import { startServer } from '../server.mjs';

const env = { WAVEFUND_HOSTED: '1', WAVEFUND_NETWORK: 'aurora-testnet', WAVEFUND_ALLOWED_ORIGINS: 'https://wavefund-near.vercel.app', RENDER_EXTERNAL_HOSTNAME: 'wavefund-api.onrender.com' };
test('public mode requires an explicit network, exact HTTPS UI origin and exact host; local defaults stay closed', () => {
  const p = httpPolicy(env);
  assert.equal(permittedHost('wavefund-api.onrender.com', p.hosts), true);
  for (const host of ['evil.example', 'wavefund-api.onrender.com.evil.example', 'user@wavefund-api.onrender.com', 'wavefund-api.onrender.com?x=1']) assert.equal(permittedHost(host, p.hosts), false);
  assert.equal(permittedHost('wavefund-api.onrender.com', httpPolicy({}).hosts), false);
  for (const patch of [{ WAVEFUND_NETWORK: 'local' }, { WAVEFUND_ALLOWED_ORIGINS: '*' }, { WAVEFUND_ALLOWED_ORIGINS: '' }, { RENDER_EXTERNAL_HOSTNAME: '' }]) assert.throws(() => httpPolicy({ ...env, ...patch }));
});
test('public API accepts only configured origins and denies owner/local execution routes', async () => {
  let writes = 0;
  const runtime = { metadata: { mode: 'aurora-testnet-readonly', chainId: 1313161555 }, state: async () => ({ ok: true }), manager: { inspect: async () => ({}), prepare: async () => { writes++; } }, start: () => { writes++; }, close: async () => {} };
  const app = await startServer({ env, host: '127.0.0.1', port: 19274, runtime, funding: null, reputation: null, evidence: null, tidepoolDemo: null });
  try {
    const headers = { host: env.RENDER_EXTERNAL_HOSTNAME, origin: env.WAVEFUND_ALLOWED_ORIGINS };
    const r = await fetch('http://127.0.0.1:19274/api/health', { headers });
    assert.equal(r.status, 200); assert.equal(r.headers.get('access-control-allow-origin'), headers.origin);
    assert.equal((await r.json()).chainId, 1313161555);
    for (const path of ['/api/demo/start', '/api/manager/prepare', '/api/funding/submitted', '/api/funding/execute']) assert.equal((await fetch(`http://127.0.0.1:19274${path}`, { method: 'POST', headers })).status, 405);
    assert.equal((await fetch('http://127.0.0.1:19274/api/state', { headers: { ...headers, origin: 'https://evil.example' } })).status, 403);
    const badHost = await new Promise((resolve, reject) => { const req = httpRequest('http://127.0.0.1:19274/api/state', { headers: { ...headers, host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject); req.end(); });
    assert.equal(badHost, 403);
    assert.equal(writes, 0);
  } finally { await app.close(); }
});
test('read caching coalesces simultaneous RPC work and retries failures without inventing data', async () => {
  let time = 0, calls = 0;
  const read = cachedRead(async () => { calls++; return { block: calls }; }, 10, () => time);
  assert.deepEqual(await Promise.all([read(), read(), read()]), [{ block: 1 }, { block: 1 }, { block: 1 }]);
  assert.equal(calls, 1); time = 11; assert.deepEqual(await read(), { block: 2 });
  let failures = 0; const bad = cachedRead(async () => { failures++; throw Error('unavailable'); }, 10);
  await assert.rejects(bad(), /unavailable/); await assert.rejects(bad(), /unavailable/); assert.equal(failures, 2);
});
