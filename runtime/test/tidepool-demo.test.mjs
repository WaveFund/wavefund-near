// Developer C: completed Tidepool community-testnet demonstration projection and endpoints. Saved repository
// evidence only; the fresh check is injected, so no network is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startServer } from '../server.mjs';
import { createTidepoolDemo, loadTidepoolDemo, projectTidepoolDemo, tidepoolDemoFromEnvironment } from '../operator/tidepool-demo.mjs';
import { validateFundingSafe } from '../operator/funding-readonly.mjs';

const ROOT = new URL('../../', import.meta.url);
const read = async (path) => JSON.parse(await readFile(new URL(path, ROOT), 'utf8'));
const tampered = (file, mutate) => async (path) => { const value = await read(path); if (path === file) mutate(value); return value; };
const runtime = () => ({ state: async () => ({ stage: 'idle' }), start: () => {}, close: async () => {} });
const FUNDING = 'docs/test-evidence/tidepool-v1/funding-proof.json';

test('the saved Tidepool demonstration matches the reviewed manifest and cross-check values', async () => {
  const { demo } = await loadTidepoolDemo();
  assert.equal(demo.official1Click, false); assert.equal(demo.testnetOnly, true); assert.equal(demo.evidence, 'saved-independently-verified');
  assert.deepEqual([demo.networks.source.chainId, demo.networks.destination.chainId], [421614, 1313161555]);
  assert.equal(demo.token.address, '0x38d81431b9f76d9699af7517040d5221d9dea252');
  assert.deepEqual(demo.contracts, { safe: '0x37947266fc1c2b20ffa36869af5dd531f2d80f11', engine: '0xba96a117f4de33c38df72002651f11024ed14a14',
    reputation: '0xfa71a652547284d1034ae6813ed4a882cb354e92', investmentPair: '0x218f2849e4401c194bf9068edf41fd3a8f643a1b' });
  assert.equal(demo.funding.sourceAmount, '200000000'); assert.equal(demo.funding.deliveredAmount, '199480000');
  assert.equal(demo.funding.bridgeCost, '520000', 'the relayer cost is a bridge cost, kept apart from strategy performance');
  assert.equal(demo.funding.sourceTransaction.hash, '0xb56675db59f1eda47a2b0998cb4ca28689a83a1e66f2723215aba29a31fd5a69');
  assert.equal(demo.funding.destinationTransaction.hash, '0x28999ced84c15e9a7bc53bfe0ea8d368d6a332455cfde3bd8e741d01ce51c45b');
  assert.deepEqual(demo.nearSettlement, { hash: '93tnePQQPVsRDV4xFiQ4eeEYFUZWbQEr1YQXANatCVYC', receiver: 'verifier.tidepool-sandbox.testnet', signer: 'maker.tidepool-sandbox.testnet', status: 'FINAL' });
  assert.equal(demo.swap.hash, '0x4dc76edba6d01cb0eacb6bcd8538ce9d5071b4e24d2872a8c4ed13da61a2de40');
  assert.equal(demo.swap.stableIn, '149610000'); assert.equal(demo.swap.assetOut, '71692173391461052');
  assert.equal(demo.strategy.roundSlug, '1313161555-0xba96a117f4de33c38df72002651f11024ed14a14-1', 'the round identity includes network and engine');
  assert.equal(demo.provider.providerReported, true, 'provider status is labelled as provider-reported');
  assert.equal(demo.observedAt, null, 'saved evidence never claims a fresh observation');
});

test('wrong Safe, token, network, route type or NEAR receiver is rejected instead of displayed', async () => {
  const cases = [
    [FUNDING, (f) => { f.destination.safe = '0x781430393ec48f5c2af78be63ae273875b180ad1'; }, /different Safe/],
    [FUNDING, (f) => { f.token = '0x8be4b1fdedadcd0269ee3f5b9820e88f557b915c'; }, /different token/],
    [FUNDING, (f) => { f.destination.chainId = 1313161554; }, /destination network/],
    [FUNDING, (f) => { f.source.chainId = 42161; }, /Arbitrum Sepolia/],
    [FUNDING, (f) => { f.official1Click = true; }, /community-testnet/],
    [FUNDING, (f) => { f.destination.amount = '200000000'; }, /delivered amount/],
    ['docs/test-evidence/tidepool-v1/near-settlement.json', (n) => { n.transaction.receiver_id = 'intents.near'; }, /Tidepool verifier/],
    ['docs/test-evidence/tidepool-v1/capital-linkage.json', (c) => { c.engine = '0x825b31dbc1af25b230d31caf5210c2b5a8fe22af'; }, /this Safe and capital/],
    ['deployments/aurora-testnet-tidepool.json', (m) => { m.chainId = 1313161554; }, /Tidepool Aurora testnet stack/],
  ];
  for (const [file, mutate, expected] of cases) await assert.rejects(loadTidepoolDemo({ read: tampered(file, mutate) }), expected, String(expected));
  // The production mainnet funding read model still refuses any testnet Safe: the two integrations cannot be mixed.
  assert.throws(() => validateFundingSafe({ schemaVersion: 1, chainId: 1313161555, safe: '0x37947266fc1c2b20ffa36869af5dd531f2d80f11', manager: `0x${'1'.repeat(40)}`, refundRecipient: `0x${'1'.repeat(40)}` }), /Aurora mainnet/);
  assert.throws(() => projectTidepoolDemo({}), /Tidepool Aurora testnet stack/);
});

test('the fresh check is on demand, labelled fresh, and never mistaken for saved evidence', async () => {
  const { demo, funding } = await loadTidepoolDemo();
  const proof = { deliveryProven: true, token: demo.token.address, destination: { safe: demo.contracts.safe, amount: '199480000', transactionHash: demo.funding.destinationTransaction.hash, blockNumber: '277272331' }, safeBalance: { delta: '199480000' }, status: { status: 'SUCCESS' } };
  let calls = 0; let ms = 0;
  const live = createTidepoolDemo({ demo, funding, freshRead: async (input) => { calls++; assert.equal(input.sourceHash, demo.funding.sourceTransaction.hash); return proof; }, clock: () => 1794500000, nowMs: () => ms });
  assert.equal(calls, 0, 'nothing is read until asked');
  const result = await live.fresh();
  assert.deepEqual([result.status, result.evidence, result.observedAt, result.deliveredAmount], ['verified', 'fresh-rpc-read', 1794500000, '199480000']);
  await live.fresh(); assert.equal(calls, 1, 'cached for a minute'); ms = 61_000; await live.fresh(); assert.equal(calls, 2);
  assert.equal(live.read().evidence, 'saved-independently-verified', 'the saved projection keeps its own label');
  const wrong = createTidepoolDemo({ demo, funding, freshRead: async () => ({ ...proof, destination: { ...proof.destination, safe: `0x${'2'.repeat(40)}` } }) });
  assert.equal((await wrong.fresh()).status, 'mismatch');
  const down = createTidepoolDemo({ demo, funding, freshRead: async () => { throw new Error('ECONNREFUSED secret-rpc'); } });
  const failed = await down.fresh();
  assert.deepEqual([failed.status, failed.code], ['unavailable', 'FRESH_CHECK_UNAVAILABLE']); assert.equal(JSON.stringify(failed).includes('secret'), false);
  assert.equal((await createTidepoolDemo({ demo, funding }).fresh()).code, 'FRESH_CHECK_DISABLED');
});

test('only GET demo and fresh-check routes exist; no signing, sending, retry or cancel route', async () => {
  const demoApi = await tidepoolDemoFromEnvironment({}, { freshRead: async () => { throw new Error('offline'); } });
  const app = await startServer({ port: 19266, runtime: runtime(), funding: null, reputation: null, evidence: null, tidepoolDemo: demoApi });
  const call = (path, init) => fetch(`http://127.0.0.1:19266${path}`, init);
  try {
    const saved = await call('/api/tidepool/demo'); assert.equal(saved.status, 200); assert.equal((await saved.json()).kind, 'tidepool-community-testnet-demo');
    const fresh = await call('/api/tidepool/demo/fresh-check'); assert.equal(fresh.status, 200); assert.equal((await fresh.json()).status, 'unavailable');
    for (const path of ['/api/tidepool', '/api/tidepool/send', '/api/tidepool/sign', '/api/tidepool/fund', '/api/tidepool/retry', '/api/tidepool/cancel', '/api/tidepool/demo/execute']) assert.equal((await call(path)).status, 404, path);
    for (const method of ['POST', 'PUT', 'DELETE']) assert.equal((await call('/api/tidepool/demo', { method, headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 404, method);
    assert.equal((await call('/api/tidepool/demo', { headers: { Origin: 'https://evil.example' } })).status, 403);
  } finally { await app.close(); }
  assert.equal(await tidepoolDemoFromEnvironment({ WAVEFUND_TIDEPOOL_DEMO: 'disabled' }), null);
  const broken = await tidepoolDemoFromEnvironment({}, { read: tampered(FUNDING, (f) => { f.official1Click = true; }) });
  const second = await startServer({ port: 19267, runtime: runtime(), funding: null, reputation: null, evidence: null, tidepoolDemo: broken });
  try { const response = await fetch('http://127.0.0.1:19267/api/tidepool/demo'); assert.equal(response.status, 503); } finally { await second.close(); }
});
