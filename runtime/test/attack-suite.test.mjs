import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { encodeErrorResult, parseAbi } from 'viem';
import { classify, revertDataOf, buildAttacks, runSuite } from '../../scripts/attack-suite.mjs';

const abi = parseAbi(['error OnlySafe()', 'error NotExecutable(uint256 roundId)', 'function authorizeRound(uint256,uint256,uint256,uint256,uint256,uint256,uint256)', 'function execute(uint256,uint256,uint256)']);
const onlySafe = encodeErrorResult({ abi, errorName: 'OnlySafe' });
const notExec = encodeErrorResult({ abi, errorName: 'NotExecutable', args: [8n] });

test('classify passes only on the exact expected named error', () => {
  assert.deepEqual(classify({ expectedError: 'OnlySafe', abi }, { ok: false, data: onlySafe }), { observedError: 'OnlySafe', pass: true });
});
test('classify fails a revert with a different (wrong) named error', () => {
  const v = classify({ expectedError: 'OnlySafe', abi }, { ok: false, data: notExec });
  assert.equal(v.pass, false);
  assert.equal(v.observedError, 'NotExecutable');
});
test('classify fails when the attack call succeeds', () => {
  const v = classify({ expectedError: 'OnlySafe', abi }, { ok: true });
  assert.equal(v.pass, false);
  assert.equal(v.observedError, null);
});
test('classify fails empty, truncated and unknown-selector reverts', () => {
  for (const data of [undefined, '0x', '0x1234', '0xdeadbeef']) {
    assert.equal(classify({ expectedError: 'OnlySafe', abi }, { ok: false, data }).pass, false, String(data));
  }
});
test('revertDataOf digs revert data out of nested viem-style errors', () => {
  assert.equal(revertDataOf({ cause: { cause: { data: onlySafe } } }), onlySafe);
  assert.equal(revertDataOf({ cause: { data: { data: onlySafe } } }), onlySafe);
  assert.equal(revertDataOf({ message: `x {"data":"${onlySafe}"}` }), onlySafe);
  assert.equal(revertDataOf(new Error('nothing')), undefined);
});

const manifest = { contracts: Object.fromEntries(['module', 'engine', 'tracker', 'reputation', 'asset'].map((k, i) => [k, `0x${String(i + 1).padStart(40, '0')}`])) };
const allAbis = new Proxy({}, { get: () => abi });
test('buildAttacks covers every required attack and pins no signing material', () => {
  const attacks = buildAttacks(manifest.contracts);
  assert.ok(attacks.length >= 8);
  for (const a of attacks) {
    assert.match(a.from, /^0x[0-9a-fA-F]{40}$/);
    assert.ok(a.expectedError && a.function && a.address);
  }
  assert.ok(attacks.some((a) => a.function === 'mint' && a.expectedError === 'OnlyOperator'));
  assert.ok(attacks.some((a) => a.function === 'record' && a.expectedError === 'NoAgentWinner'));
});

test('runSuite: one pinned block; only the exact expected error passes; success and wrong error fail', async () => {
  const mkAttack = (expectedError) => ({ name: 'x', contract: 'M', address: '0x' + '1'.repeat(40), function: 'execute', from: '0x' + '2'.repeat(40), args: [8n, 0n, 1n], expectedError });
  const blocks = [];
  const client = (behaviour) => ({ async call({ blockNumber }) { blocks.push(blockNumber); return behaviour(); } });
  const run = (behaviour, expected) => runSuite({ client: client(behaviour), manifest, abis: allAbis, block: 123n, attacks: [mkAttack(expected), mkAttack(expected)] });

  const good = await run(() => { throw { cause: { data: notExec } }; }, 'NotExecutable');
  assert.deepEqual(good.map((r) => r.pass), [true, true]);
  assert.deepEqual(good.map((r) => r.observedError), ['NotExecutable', 'NotExecutable']);
  assert.ok(good.every((r) => r.blockNumber === '123'));

  const wrong = await run(() => { throw { cause: { data: onlySafe } }; }, 'NotExecutable');
  assert.deepEqual(wrong.map((r) => [r.pass, r.observedError]), [[false, 'OnlySafe'], [false, 'OnlySafe']]);

  const succeeded = await run(() => ({ data: '0x' }), 'NotExecutable');
  assert.deepEqual(succeeded.map((r) => [r.pass, r.observedError]), [[false, null], [false, null]]);

  assert.ok(blocks.length === 6 && blocks.every((b) => b === 123n));
});

test('committed live evidence: every attack blocked with its exact error at one block', async () => {
  const doc = JSON.parse(await readFile(new URL('../../docs/test-evidence/attack-suite.json', import.meta.url), 'utf8'));
  assert.ok(doc.results.length >= 8);
  assert.equal(doc.passed, doc.total);
  for (const r of doc.results) {
    assert.equal(r.pass, true, r.name);
    assert.equal(r.observedError, r.expectedError, r.name);
    assert.equal(r.blockNumber, doc.blockNumber, r.name);
  }
});
