// AI provenance: which model made each output, and what is proven about it. Uses the real API projection as input.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRoundEvidence } from '../src/lib/record/model.mjs';
import { doesNotProve, provenanceLine, recordProofView, roundProvenance, savedRoundForLive, shortModel, SCRIPTED_TEXT, UNKNOWN_TEXT } from '../src/lib/record/provenance.mjs';
import { agentProposals } from '../src/lib/record/agents-view.mjs';
import { loadRoundEvidence } from '../../runtime/operator/round-evidence.mjs';

const raw = await loadRoundEvidence();
const QWEN = 'Qwen/Qwen3.6-35B-A3B-FP8';
const find = (rounds, stack, id) => rounds.find((round) => round.stack.id === stack && round.roundId === id);
const shown = () => validateRoundEvidence(structuredClone(raw)).rounds;
const mutate = (stack, id, change) => { const copy = structuredClone(raw); change(find(copy.rounds, stack, id)); return validateRoundEvidence(copy); };

test('single-model rounds 2-8 name Qwen per proposer, are "Before TEE checks", and keep scripted forecasters model-less', () => {
  const rounds = shown();
  for (const [stack, id] of [['tidepool', '1'], ['tidepool', '2'], ['tidepool', '3'], ['tidepool', '5'], ['tidepool', '6'], ['tidepool', '7'], ['tidepool', '8'], ['original', '7'], ['original', '8']]) {
    const round = find(rounds, stack, id);
    for (const p of round.proposals.filter((item) => item.id !== '0')) {
      assert.equal(p.provenance.status, 'model', `${stack} ${id} ${p.name}`);
      assert.equal(p.provenance.model, QWEN); assert.equal(p.provenance.provider, 'near-ai');
      assert.equal(p.provenance.tee, 'before-tee', `${stack} round ${id} predates TEE checks`);
      assert.match(p.provenance.proposeTxUrl, /^https:\/\/explorer\.testnet\.aurora\.dev\/tx\/0x[0-9a-f]{64}$/);
    }
    assert.equal(roundProvenance(round).tee, 'before-tee');
    assert.deepEqual(roundProvenance(round).models, [QWEN]);
  }
  const r2 = find(rounds, 'tidepool', '2');
  assert.equal(r2.proposals[1].provenance.proposeTx, '0xe6b3749e70e2356485789b93f8f60648d7cf80f2d5a2ebbc4a82dda67daa8bf7');
  assert.ok(r2.forecasters.every((f) => f.provenance.status === 'scripted' && f.provenance.model === null && f.scripted));
  assert.ok(find(rounds, 'tidepool', '7').forecasters.every((f) => f.provenance.status === 'model' && f.provenance.model === QWEN), 'round 7: all eight calls genuine');
  assert.equal(r2.evidenceUrl, 'https://github.com/WaveFund/wavefund-near/blob/main/docs/test-evidence/tidepool-rounds/round2/plan.json');
  assert.equal(find(rounds, 'original', '7').evidenceUrl, 'https://github.com/WaveFund/wavefund-near/blob/main/docs/test-evidence/round7-hybrid/plan.json');
  assert.equal(find(rounds, 'tidepool', '1').evidenceUrl, 'https://github.com/WaveFund/wavefund-near/blob/main/docs/test-evidence/tidepool-v1/plan.json');
});

test('round 9: proposers are TEE verified, forecasters are "Not TEE-attested", twelve distinct models', () => {
  const r9 = find(shown(), 'tidepool', '9');
  assert.ok(r9.proposals.filter((p) => p.id !== '0').every((p) => p.provenance.tee === 'verified'));
  assert.ok(r9.forecasters.every((f) => f.provenance.status === 'model' && f.provenance.tee === 'not-attested'));
  assert.deepEqual({ ...roundProvenance(r9), models: roundProvenance(r9).models.length }, { models: 12, verified: 4, challengers: 4, tee: 'verified' });
  assert.equal(r9.attestationVerified, true);
});

test('the inline line: TEE verified opens the TEE proof, other model calls open the record, scripted and unknown have no Proof', () => {
  const rounds = shown();
  const r9 = find(rounds, 'tidepool', '9'); const r2 = find(rounds, 'tidepool', '2'); const r8 = find(rounds, 'tidepool', '8');
  assert.deepEqual(provenanceLine(r9.proposals[2].provenance), { kind: 'model', text: 'Qwen3.8-27B · NEAR AI · TEE verified', model: 'Qwen3.8-27B', fullModel: 'Qwen/Qwen3.8-27B', provider: 'NEAR AI', tee: 'verified', teeLabel: 'TEE verified', proof: 'tee' });
  assert.equal(provenanceLine(r9.forecasters.find((f) => f.name === 'Guardian').provenance).text, 'claude-haiku-5-5 · NEAR AI · Not TEE-attested');
  assert.equal(provenanceLine(r9.forecasters[0].provenance).proof, 'record');
  const before = provenanceLine(r8.proposals[1].provenance);
  assert.equal(before.text, 'Qwen3.6-35B-A3B-FP8 · NEAR AI · Before TEE checks'); assert.equal(before.proof, 'record');
  const scripted = provenanceLine(r2.forecasters[0].provenance);
  assert.equal(scripted.kind, 'scripted'); assert.equal(scripted.text, SCRIPTED_TEXT); assert.equal(scripted.proof, null, 'a scripted actor never gets a Proof link');
  assert.equal(scripted.model, null);
  for (const missing of [null, undefined, { status: 'unknown' }]) assert.deepEqual([provenanceLine(missing).text, provenanceLine(missing).proof], [UNKNOWN_TEXT, null]);
  assert.equal(shortModel('Qwen/Qwen3.6-35B-A3B-FP8'), 'Qwen3.6-35B-A3B-FP8'); assert.equal(shortModel('gpt-4.1'), 'gpt-4.1'); assert.equal(shortModel(null), null);
});

test('the record proof: claims, a propose transaction link, an honest "does not prove" list and no prompt text', () => {
  const rounds = shown();
  const r2 = find(rounds, 'tidepool', '2'); const conservative = r2.proposals[1];
  const view = recordProofView(r2, conservative, 'proposer');
  const claim = (id) => view.claims.find((c) => c.id === id);
  assert.equal(claim('model').value, QWEN); assert.equal(claim('provider').value, 'NEAR AI'); assert.equal(claim('tee').value, 'Before TEE checks');
  assert.equal(claim('input').value, conservative.provenance.inputHash); assert.equal(claim('output').copy, conservative.provenance.outputHash);
  assert.equal(claim('tx').href, 'https://explorer.testnet.aurora.dev/tx/0xe6b3749e70e2356485789b93f8f60648d7cf80f2d5a2ebbc4a82dda67daa8bf7');
  assert.match(claim('round').value, /^tidepool-funded-real-ai-proposals-scripted-forecasters — /);
  assert.match(view.notProven[0], /cannot be attested retroactively/);
  assert.ok(view.notProven.some((t) => /operator's own record/.test(t)) && view.notProven.some((t) => /provider's claim/.test(t)));
  const record = JSON.parse(view.json);
  assert.deepEqual(Object.keys(record), ['round', 'stack', 'role', 'name', 'proposalId', 'provider', 'model', 'scripted', 'teeStatus', 'inputHash', 'outputHash', 'proposeTx', 'decision']);
  assert.ok(!/system|messages|prompt/i.test(view.json), 'no prompt text in the shown record');
  assert.equal(view.evidenceUrl, r2.evidenceUrl);
  const r9 = find(rounds, 'tidepool', '9');
  const forecaster = recordProofView(r9, r9.forecasters[0], 'forecaster');
  assert.equal(forecaster.claims.some((c) => c.id === 'tx'), false, 'forecasters have no propose transaction');
  assert.match(forecaster.notProven[0], /not checked by hardware attestation/);
  assert.equal(recordProofView(r2, r2.forecasters[0], 'forecaster'), null, 'a scripted actor has no record proof');
  assert.notEqual(doesNotProve('before-tee')[0], doesNotProve('not-attested')[0]);
});

test('provenance that disagrees with the round is rejected, not shown', () => {
  const dropped = (change) => find(mutate('tidepool', '2', change).rounds ?? [], 'tidepool', '2');
  assert.ok(dropped(() => {}), 'the unmodified round is shown');
  assert.equal(dropped((r) => { r.proposals[1].proposeTx = r.proposals[2].proposeTx; }), undefined, 'a propose tx labelled for another proposer');
  assert.equal(dropped((r) => { r.proposals[1].provider = 'openai'; }), undefined, 'unknown provider');
  assert.equal(dropped((r) => { r.forecasters[0].model = QWEN; }), undefined, 'a scripted actor naming a model');
  assert.equal(dropped((r) => { r.forecasters[0].scripted = false; }), undefined, 'scripted flag disagrees with provider');
  assert.equal(dropped((r) => { r.proposals[1].inputHash = 'abc'; }), undefined, 'malformed hash');
  assert.equal(dropped((r) => { r.forecasters[0].proposeTx = r.proposals[1].proposeTx; }), undefined, 'a forecaster with a propose tx');
});

test('an older API without provenance fields still renders what it knows', () => {
  const copy = structuredClone(raw);
  for (const round of copy.rounds) for (const actor of [...round.proposals, ...round.forecasters]) {
    for (const key of ['provider', 'inputHash', 'outputHash', 'proposeTx']) delete actor[key];
    if (!(round.stack.id === 'tidepool' && round.roundId === '9')) delete actor.model;
  }
  const rounds = validateRoundEvidence(copy).rounds;
  assert.equal(rounds.length, raw.rounds.length);
  const r2 = find(rounds, 'tidepool', '2'); const r9 = find(rounds, 'tidepool', '9');
  assert.equal(provenanceLine(r2.proposals[1].provenance).text, UNKNOWN_TEXT);
  assert.equal(provenanceLine(r2.forecasters[0].provenance).text, SCRIPTED_TEXT);
  assert.equal(provenanceLine(r9.proposals[1].provenance).proof, 'tee', 'TEE proofs still open');
  assert.deepEqual([provenanceLine(r9.forecasters[0].provenance).text, provenanceLine(r9.forecasters[0].provenance).proof], ['gpt-4.1-mini · Not TEE-attested', null]);
});

test('attestationVerified needs one verified proof per non-Hold proposal, however many there are', () => {
  const r9 = (change) => find(mutate('tidepool', '9', change).rounds, 'tidepool', '9');
  // Three challengers with three proofs: verified (the old code demanded exactly four).
  const three = r9((r) => { r.proposals = r.proposals.filter((p) => p.id !== '4'); r.tee = r.tee.filter((t) => t.proposalId !== '4'); });
  assert.equal(three.proposals.length, 4); assert.equal(three.attestationVerified, true);
  assert.equal(r9((r) => { r.tee = r.tee.filter((t) => t.proposalId !== '4'); }).attestationVerified, false, 'four challengers, three proofs');
  assert.equal(r9((r) => { r.tee = [...r.tee.slice(0, 3), r.tee[0]]; }).attestationVerified, false, 'a repeated proof id');
  assert.equal(r9((r) => { r.proposals = r.proposals.filter((p) => p.id === '0' || p.id === '3'); r.tee = r.tee.filter((t) => t.proposalId === '3'); }).attestationVerified, true, 'one challenger, one proof');
  assert.equal(r9((r) => { r.attestationVerified = false; }).attestationVerified, false);
  const holdOnly = r9((r) => { r.proposals = r.proposals.filter((p) => p.id === '0'); r.winner.proposalId = '0'; r.tee = []; });
  assert.equal(holdOnly.proposals.length, 1); assert.equal(holdOnly.attestationVerified, false, 'no challengers, no proofs: nothing was attested');
});

test('live provenance comes only from the same saved round; agents list their saved proposals newest first', () => {
  const rounds = shown(); const r9 = find(rounds, 'tidepool', '9');
  const live = r9.proposals.map((p) => ({ id: p.id, name: p.name, allocationBps: p.allocationBps }));
  assert.equal(savedRoundForLive(rounds, '9', live), r9);
  assert.equal(savedRoundForLive(rounds, '11', live), null, 'an unsaved live round has no saved evidence yet');
  assert.equal(savedRoundForLive(rounds, '9', live.map((p) => p.id === '2' ? { ...p, allocationBps: p.allocationBps + 1 } : p)), null, 'a different proposal is never borrowed');
  assert.equal(savedRoundForLive(null, '9', live), null);
  const history = agentProposals(rounds, 'tidepool', 'Balanced');
  assert.deepEqual(history.map((item) => item.roundId), ['10', '9', '8', '7', '6', '5', '3', '2', '1']);
  assert.equal(history[0].proposal.provenance.model, QWEN);
  assert.equal(history[1].proposal.provenance.model, 'Qwen/Qwen3.8-27B');
  const r10 = find(rounds, 'tidepool', '10');
  assert.ok(r10.forecasters.length === 4 && r10.forecasters.every(f => f.provenance.status === 'scripted' && f.provenance.model === null));
  assert.ok(r10.proposals.filter(p => p.id !== '0').every(p => p.provenance.model === QWEN));
  assert.deepEqual(agentProposals(rounds, 'original', 'Balanced').map((item) => item.roundId), ['8', '7']);
  assert.deepEqual(agentProposals(rounds, 'tidepool', 'Hold'), []);
});
