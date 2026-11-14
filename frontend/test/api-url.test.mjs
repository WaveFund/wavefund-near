import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveApiUrl } from '../src/lib/api-url.mjs';

test('local API remains available only to local pages; hosted pages never default to localhost', () => {
  assert.equal(resolveApiUrl('/api/state', undefined, 'http://127.0.0.1:3000'), 'http://127.0.0.1:3001/api/state');
  assert.throws(() => resolveApiUrl('/api/state', undefined, 'https://wavefund-near.vercel.app'), /Backend is not configured/);
  assert.throws(() => resolveApiUrl('/api/state', 'http://127.0.0.1:3001', 'https://wavefund-near.vercel.app'), /Hosted pages cannot access a local API/);
  assert.equal(resolveApiUrl('/api/state', 'https://wavefund-api.onrender.com', 'https://wavefund-near.vercel.app'), 'https://wavefund-api.onrender.com/api/state');
  for (const url of ['http://public.example', 'https://user:pass@public.example', 'https://public.example/api', 'https://public.example?key=x']) assert.throws(() => resolveApiUrl('/api/state', url, 'https://wavefund-near.vercel.app'));
  for (const path of ['https://evil.example', '//evil.example/api', '/api/\\evil']) assert.throws(() => resolveApiUrl(path, 'https://wavefund-api.onrender.com'));
});
