// Developer C: Tidepool demonstration, round identity and reputation-stack display logic. Uses the real API projections
// as input so the UI validators are tested against exactly what the local API serves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { nearTestnetTxUrl, validateFreshCheck, validateTidepoolDemo } from '../src/lib/tidepool/model.mjs';
import { exactFactorX18, findRound, validateReputationBoard, validateRoundEvidence } from '../src/lib/record/model.mjs';
import { classifyFunding, validateFundingConfig } from '../src/lib/funding/model.mjs';
import { fixtureConfig, fixtureScenarios } from '../src/lib/funding/fixtures.mjs';
import { loadTidepoolDemo } from '../../runtime/operator/tidepool-demo.mjs';
import { loadRoundEvidence } from '../../runtime/operator/round-evidence.mjs';
import { REPUTATION_STACKS, createReputationBoard } from '../../runtime/operator/reputation-api.mjs';

const TIDEPOOL_ENGINE = '0xba96a117f4de33c38df72002651f11024ed14a14';

test('the Tidepool demonstration validates as saved community-testnet history with explicit identities', async () => {
  const { demo } = await loadTidepoolDemo();
  const checked = validateTidepoolDemo(JSON.parse(JSON.stringify(demo)));
  assert.equal(checked.ok, true, checked.error);
  assert.equal(checked.demo.evidence, 'saved-independently-verified'); assert.equal(checked.demo.official1Click, false);
  assert.equal(checked.demo.funding.bridgeCost, '520000');
  assert.equal(checked.demo.nearSettlement.url, 'https://testnet.nearblocks.io/txns/93tnePQQPVsRDV4xFiQ4eeEYFUZWbQEr1YQXANatCVYC');
  assert.ok(checked.demo.strategy.roundSlug.includes(TIDEPOOL_ENGINE));
  assert.deepEqual([checked.demo.quote.recipient, checked.demo.quote.virtualChainRecipient], [checked.demo.contracts.safe, null], 'the Safe is the direct recipient');
  assert.equal(nearTestnetTxUrl('javascript:alert(1)'), null);
});

test('mainnet and Tidepool records cannot be mixed, and wrong or missing values are rejected', async () => {
  const { demo } = await loadTidepoolDemo();
  const base = JSON.parse(JSON.stringify(demo));
  const cases = [
    (d) => { d.official1Click = true; }, (d) => { d.testnetOnly = false; }, (d) => { d.networks.destination.chainId = 1313161554; },
    (d) => { d.networks.source.chainId = 42161; }, (d) => { d.funding.bridgeCost = '0'; }, (d) => { d.contracts.safe = 'javascript:alert(1)'; },
    (d) => { delete d.funding.deliveredAmount; }, (d) => { d.strategy.roundSlug = '1313161555-0x825b31dbc1af25b230d31caf5210c2b5a8fe22af-1'; },
    (d) => { d.nearSettlement.hash = '<img>'; },
    (d) => { d.quote.signatureVerified = false; }, (d) => { d.quote.virtualChainRecipient = 'safe.near'; },
    (d) => { d.quote.recipient = '0x781430393ec48f5c2af78be63ae273875b180ad1'; }, (d) => { delete d.quote; },
  ];
  for (const mutate of cases) { const copy = structuredClone(base); mutate(copy); assert.equal(validateTidepoolDemo(copy).ok, false, mutate.toString()); }
  // The production 1Click model rejects a testnet destination and a Tidepool-shaped record never classifies as verified.
  const mainnet = fixtureConfig(2_000_000_000); mainnet.destination.chainId = 1313161555;
  assert.equal(validateFundingConfig(mainnet).ok, false);
  const config = validateFundingConfig(fixtureConfig(2_000_000_000)).config;
  const record = structuredClone(fixtureScenarios(2_000_000_000).find((item) => item.id === 'fx-delivered').record);
  record.request.destination = { chainId: 1313161555, assetId: null, token: demo.token.address, decimals: 6 }; record.request.safe = demo.contracts.safe;
  const display = classifyFunding(record, { config, now: 2_000_000_000 });
  assert.equal(display.bucket, 'unavailable'); assert.equal(display.verified, false);
});

test('a fresh read is shown only when the API says it actually ran now', () => {
  assert.equal(validateFreshCheck({ status: 'verified', evidence: 'fresh-rpc-read', observedAt: 1794500000, deliveredAmount: '199480000' }).status, 'verified');
  assert.equal(validateFreshCheck({ status: 'verified', evidence: 'saved-independently-verified', observedAt: 1794500000, deliveredAmount: '199480000' }).status, 'unavailable', 'saved evidence never passes as fresh');
  assert.equal(validateFreshCheck({ status: 'verified', evidence: 'fresh-rpc-read', deliveredAmount: '199480000' }).status, 'unavailable', 'no timestamp, no fresh claim');
  assert.equal(validateFreshCheck({ status: 'mismatch', code: 'FRESH_CHECK_MISMATCH', observedAt: 1 }).status, 'mismatch');
  assert.equal(validateFreshCheck(null).status, 'unavailable');
});

test('round ids from different engines stay distinct; history is labelled saved; scripted stays scripted', async () => {
  const checked = validateRoundEvidence(JSON.parse(JSON.stringify(await loadRoundEvidence())));
  assert.equal(checked.ok, true, checked.error);
  const tidepool = checked.rounds.find((round) => round.stack.id === 'tidepool');
  assert.equal(tidepool.slug, `1313161555-${TIDEPOOL_ENGINE}-1`); assert.equal(tidepool.evidence, 'saved-independently-verified');
  assert.ok(tidepool.forecasters.every((item) => item.scripted));
  assert.equal(exactFactorX18(tidepool.realisedReturnX18), '0.993541889635073190', 'precise values come straight from the evidence');
  assert.equal(tidepool.collateral.seed, '100000000');
  assert.equal(findRound(checked.rounds, tidepool.slug).round, tidepool);
  assert.equal(findRound(checked.rounds, '7').round?.roundId, '7', 'a unique bare round number still resolves');
  // Two engines with the same round number: slugs differ, a bare number is ambiguous.
  const original = checked.rounds.find((round) => round.roundId === '7');
  const twin = { ...original, roundId: '1', slug: `1313161555-${original.stack.engine}-1` };
  const both = [tidepool, twin];
  assert.notEqual(tidepool.slug, twin.slug);
  assert.deepEqual(findRound(both, '1'), { round: null, ambiguous: true });
  // A round without a matching network + engine identity is dropped, never shown as "Round 1" alone.
  const raw = JSON.parse(JSON.stringify(await loadRoundEvidence()));
  raw.rounds[2].slug = '1313161555-0x825b31dbc1af25b230d31caf5210c2b5a8fe22af-1';
  assert.equal(validateRoundEvidence(raw).rounds.some((round) => round.stack.id === 'tidepool'), false);
});

test('separate reputation histories keep their stack and are never summed', async () => {
  const read = async () => ({ schemaVersion: 1, chainId: 1313161555, samples: '1', positive: '0', negative: '1', flat: '0', score: '-1', blockNumber: '5', blockTimestamp: '6', hasEvaluatedStrategies: true });
  const board = async (stack, contract) => createReputationBoard({ reader: { read }, stack, manifest: { contracts: { reputation: contract, engine: stack.id === 'tidepool' ? TIDEPOOL_ENGINE : '0x825b31dbc1af25b230d31caf5210c2b5a8fe22af' } } }).read();
  const original = validateReputationBoard(await board(REPUTATION_STACKS.original, '0xac9c56f1c032f74a9e84703602894315df2d9488')).board;
  const tidepool = validateReputationBoard(await board(REPUTATION_STACKS.tidepool, '0xfa71a652547284d1034ae6813ed4a882cb354e92')).board;
  assert.deepEqual([original.stack.id, tidepool.stack.id], ['original', 'tidepool']);
  assert.deepEqual([original.label, tidepool.label], ['Outcome reputation', 'Outcome reputation']);
  assert.notEqual(original.contract, tidepool.contract);
  const momentum = (b) => b.agents.find((agent) => agent.name === 'Momentum').reputation.score;
  assert.deepEqual([momentum(original), momentum(tidepool)], ['-1', '-1']);
  for (const key of ['total', 'combined', 'sum']) assert.equal(key in original || key in tidepool, false);
  assert.equal(validateReputationBoard({ ...(await board(REPUTATION_STACKS.original, '0xac9c56f1c032f74a9e84703602894315df2d9488')), stack: { id: 'combined' } }).board.stack, null, 'an unknown stack is not shown as one');
});
