import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildCandidate, nrasKeysFromJwks, summarizeReport, REPRODUCED_MRTD } from '../../scripts/tee-preflight.mjs';
import { validateTeePolicy } from '../agents/tee-client.mjs';
import { SWARM2_PROPOSERS } from '../agents/swarm-config.mjs';
import { syntheticTee } from './fixtures/tee-synthetic.mjs';

const ok = { tdxQuoteVerified: true, nonceBound: true, configurationBound: true, eventLogVerified: true };
const m = (c) => `${'ab'.repeat(48)}:${c.repeat(96)}`;

test('NRAS keys keep only public P-384 coordinates and refuse an empty or private set', () => {
  const keys = nrasKeysFromJwks({ keys: [{ kty: 'EC', crv: 'P-384', kid: 'a', x: 'x', y: 'y', x5c: ['cert'], alg: 'ES384' }, { kty: 'EC', crv: 'P-256', kid: 'b', x: 'x', y: 'y' }, { kty: 'RSA', kid: 'c', n: 'n', e: 'e' }] });
  assert.deepEqual(keys, [{ kty: 'EC', crv: 'P-384', kid: 'a', x: 'x', y: 'y' }]);
  assert.throws(() => nrasKeysFromJwks({ keys: [{ kty: 'EC', crv: 'P-384', kid: 'a', x: 'x', y: 'y', d: 'secret' }] }), /no usable distinct P-384 keys/);
  assert.throws(() => nrasKeysFromJwks({}), /no usable distinct P-384 keys/);
});

test('summarizeReport reports the observed measurement, policy membership and failed checks from a DCAP result', async () => {
  const f = await syntheticTee();
  const inPolicy = summarizeReport(f.report, f.quoteResult, { nonce: f.nonce, allowed: f.policy.modelMeasurements });
  assert.equal(inPolicy.measurement, f.policy.modelMeasurements[0]); assert.equal(inPolicy.inPolicy, true); assert.deepEqual(inPolicy.checks, ok);
  assert.equal(inPolicy.mrTdReproduced, null); // the synthetic mrTd is not a dstack release value
  const missing = summarizeReport(f.report, f.quoteResult, { nonce: f.nonce, allowed: [m('0')] });
  assert.equal(missing.inPolicy, false); assert.equal(missing.measurement, f.policy.modelMeasurements[0]);
  const stale = summarizeReport(f.report, f.quoteResult, { nonce: '18'.repeat(32), allowed: f.policy.modelMeasurements });
  assert.equal(stale.checks.nonceBound, false);
  assert.ok(REPRODUCED_MRTD.df4d77c857de652bd0fafa343a2026b51071ee03773d076d283abf1a7d36ff91ffa279ee4a617ac664f7e2a2c8d5891b);
});

test('candidate lists only fully checked models missing from the policy, and is never a runnable policy', () => {
  const policy = { schemaVersion: 1, trustBasis: 'observed-at-2026-11-13-not-independently-reproduced', gatewayMeasurements: [m('1')], modelMeasurements: [m('2')], nrasKeys: [{ kty: 'EC', crv: 'P-384', kid: 'old', x: 'x', y: 'y' }] };
  const inst = (c, extra = {}) => ({ measurement: m(c), inPolicy: c === '2', mrTdReproduced: null, osImageHash: null, checks: ok, gpuAttested: true, ...extra });
  const results = [
    { model: 'known', gateway: { measurement: m('1') }, instances: [inst('2')] },
    { model: 'new', gateway: { measurement: m('1') }, instances: [inst('3'), inst('4')] },
    { model: 'gpu-failed', gateway: { measurement: m('1') }, instances: [inst('5', { gpuAttested: false })] },
    { model: 'quote-failed', gateway: { measurement: m('1') }, instances: [inst('6', { checks: { ...ok, eventLogVerified: false } })] },
    { model: 'none', error: 'HTTP 503: No provider found', gateway: null, instances: [] },
  ];
  const keys = [{ kty: 'EC', crv: 'P-384', kid: 'new', x: 'x', y: 'y' }];
  const c = buildCandidate(policy, results, keys, '2026-11-13T00:00:00.000Z');
  assert.equal(c.schemaVersion, 0); assert.equal(c.reviewRequired, true);
  assert.throws(() => validateTeePolicy(c), /TEE_POLICY_NOT_CONFIGURED/);
  assert.deepEqual(c.entries.map(e => [e.model, e.measurements]), [['new', [m('3'), m('4')]]]);
  assert.deepEqual(c.unattested.map(e => e.model), ['gpu-failed', 'quote-failed', 'none']);
  assert.deepEqual(c.proposedPolicy.modelMeasurements, [m('2'), m('3'), m('4')]);
  assert.deepEqual(c.proposedPolicy.nrasKeys, keys);
  assert.equal(validateTeePolicy(c.proposedPolicy), c.proposedPolicy);
});

test('committed policy pins a measurement for every swarm2 proposer model, all inside modelMeasurements', async () => {
  const policy = JSON.parse(await readFile(new URL('../../docs/tee-policy.json', import.meta.url), 'utf8'));
  validateTeePolicy(policy);
  assert.deepEqual(Object.keys(policy.models).sort(), SWARM2_PROPOSERS.map(p => p.model).sort());
  for (const [model, values] of Object.entries(policy.models)) assert.ok(values.length > 0 && values.every(v => policy.modelMeasurements.includes(v)), model);
  assert.deepEqual([...new Set(Object.values(policy.models).flat())].sort(), [...policy.modelMeasurements].sort());
  assert.ok(policy.modelMeasurements.every(v => REPRODUCED_MRTD[v.split(':')[0]]), 'every model mrTd is the reproduced dstack v0.5.12 value');
});
