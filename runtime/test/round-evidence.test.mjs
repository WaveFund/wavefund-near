// Developer C: published testnet round evidence projection and endpoint. Reads repository files only; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startServer } from '../server.mjs';
import { loadRoundEvidence, roundEvidenceFromEnvironment } from '../operator/round-evidence.mjs';

const ROOT = new URL('../../', import.meta.url);
const read = async (path) => JSON.parse(await readFile(new URL(path, ROOT), 'utf8'));
// Reads the real files, then applies one mutation to a single file to simulate tampered or malformed evidence.
const tampered = (file, mutate) => async (path) => { const value = await read(path); if (path === file) mutate(value); return value; };
const runtime = () => ({ state: async () => ({ stage: 'idle' }), start: () => {}, close: async () => {} });

test('round 7 is a hybrid test: real AI proposers, scripted forecasters, an actual swap and a measured loss', async () => {
  const { rounds, network } = await loadRoundEvidence();
  assert.deepEqual(network, { chainId: 1313161555, name: 'Aurora testnet' });
  const r7 = rounds.find((round) => round.roundId === '7');
  assert.equal(r7.kind, 'real-ai-proposals-scripted-forecasters');
  assert.equal(r7.genuineModelCalls, 4); assert.equal(r7.scriptedForecasters, 4); assert.equal(r7.attestationVerified, false);
  assert.deepEqual(r7.proposals.map((item) => [item.name, item.allocationBps]), [['Hold', 4487], ['Conservative', 500], ['Balanced', 4500], ['Momentum', 7500], ['HighBeta', 9500]]);
  assert.deepEqual(r7.winner, { proposalId: '3', name: 'Momentum', allocationBps: 7500, isHold: false });
  assert.ok(r7.forecasters.length === 4 && r7.forecasters.every((item) => item.action === 'buy' && item.scripted === true), 'round 7 forecasters are scripted fixtures');
  assert.equal(r7.swap.transactionHash, '0x63a743ae801bc7ee0e51b71397e87148e1838ffccbc6c7397d05a2e92a028ead');
  assert.equal(r7.swap.independentlyChecked, true);
  assert.equal(r7.realisedReturnX18, '997835674193170672', 'a measured -0.2164% return, shown as a loss');
  assert.deepEqual(r7.reputation, { agent: '0x8b6af0b1738b941c0c7dd4deec6fabee3447888f', score: '-1', transactionHash: '0x0a2be8476e8527709b049a84ab2ac9ccc33d6674060835badd39f6805b7dfe04', blockNumber: '277266787' });
  assert.deepEqual(r7.checks, { independentPassed: true, returnRecomputed: true, payoutsRecomputed: true, swapChecked: true });
  assert.equal(r7.payouts.find((item) => item.name === 'Quant').profitLoss, '-31981');
  assert.equal(r7.transactions.length, 50);
  assert.ok(r7.transactions.every((item) => /^0x[0-9a-f]{64}$/.test(item.transactionHash) && /^\d+$/.test(item.blockNumber)));
});

test('round 8: eight genuine calls, every forecaster abstained, Hold won, no swap and full redemptions', async () => {
  const r8 = (await loadRoundEvidence()).rounds.find((round) => round.roundId === '8');
  assert.equal(r8.genuineModelCalls, 8); assert.equal(r8.scriptedForecasters, 0);
  assert.deepEqual(r8.winner, { proposalId: '0', name: 'Hold', allocationBps: 7489, isHold: true });
  assert.ok(r8.forecasters.length === 4 && r8.forecasters.every((item) => item.action === 'abstain' && item.scripted === false && item.reason.length > 0));
  assert.equal(r8.swap, null, 'Hold won: no investment swap');
  assert.ok(r8.payouts.every((item) => item.payout === '10000000' && item.deposit === '10000000' && item.profitLoss === '0'));
  assert.equal(r8.totals.deposits, r8.totals.paid);
  assert.equal(r8.reputation, null, 'Hold rounds never score');
  assert.ok(r8.correction.includes('eight distinct agent wallets'));
  assert.ok(r8.limitations.some((item) => /abstained/.test(item)));
});

test('tampered or malformed evidence is rejected instead of displayed', async () => {
  const cases = [
    ['docs/test-evidence/round7-hybrid/report.json', (r) => { r.confirmedTransactions[3].hash = 'javascript:alert(1)'; }, /32-byte hash/],
    ['docs/test-evidence/round7-hybrid/report.json', (r) => { r.completion.chainId = 1313161554; }, /Aurora testnet/],
    ['docs/test-evidence/round8-swarm/independent.json', (r) => { r.winner = '3'; }, /winner disagrees/],
    ['docs/test-evidence/round7-hybrid/swap-independent.json', (r) => { r.hash = `0x${'1'.repeat(64)}`; }, /different transaction/],
    ['docs/test-evidence/round7-hybrid/report.json', (r) => { r.completion.payouts[0].profitLoss = '0'; }, /payout arithmetic/],
    ['docs/test-evidence/round8-swarm/report.json', (r) => { r.completion.payouts[0].payout = 10000000; }, /integer string/],
    ['docs/test-evidence/round7-hybrid/report.json', (r) => { r.confirmedTransactions[0].label = '<img src=x>'; }, /label/],
  ];
  for (const [file, mutate, expected] of cases) await assert.rejects(loadRoundEvidence({ read: tampered(file, mutate) }), expected, String(expected));
  // A report/independent disagreement that is structurally valid is surfaced, not hidden.
  const disagreeing = await loadRoundEvidence({ read: tampered('docs/test-evidence/round7-hybrid/independent.json', (r) => { r.recomputedReturn = '1000000000000000000'; }) });
  assert.equal(disagreeing.rounds[0].checks.returnRecomputed, false);
  const hostileText = await loadRoundEvidence({ read: tampered('docs/test-evidence/round8-swarm/report.json', (r) => { r.limitations[0] = '\u202eevil\u0000 text'; }) });
  assert.equal(hostileText.rounds[1].limitations[0], 'evil text');
});

test('GET /api/evidence/testnet-rounds only; disabled is 404 and invalid evidence is 503', async () => {
  const evidence = await roundEvidenceFromEnvironment({});
  const app = await startServer({ port: 19264, runtime: runtime(), funding: null, reputation: null, evidence });
  const call = (path, init) => fetch(`http://127.0.0.1:19264${path}`, init);
  try {
    const response = await call('/api/evidence/testnet-rounds');
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).rounds.map((round) => round.roundId), ['7', '8']);
    for (const method of ['POST', 'PUT', 'DELETE']) assert.equal((await call('/api/evidence/testnet-rounds', { method, headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 404, method);
    assert.equal((await call('/api/evidence')).status, 404);
    assert.equal((await call('/api/evidence/testnet-rounds', { headers: { Origin: 'https://evil.example' } })).status, 403);
  } finally { await app.close(); }
  assert.equal(await roundEvidenceFromEnvironment({ WAVEFUND_EVIDENCE: 'disabled' }), null);
  const broken = await roundEvidenceFromEnvironment({}, { read: tampered('docs/test-evidence/round7-hybrid/report.json', (r) => { r.completion.chainId = 1; }) });
  const second = await startServer({ port: 19265, runtime: runtime(), funding: null, reputation: null, evidence: broken });
  try {
    const response = await fetch('http://127.0.0.1:19265/api/evidence/testnet-rounds');
    assert.equal(response.status, 503); assert.equal((await response.json()).code, 'EVIDENCE_INVALID');
  } finally { await second.close(); }
});
