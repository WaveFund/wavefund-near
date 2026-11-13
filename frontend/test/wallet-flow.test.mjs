// "Forecast from your wallet": pure gating, step derivation, slippage math and error text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CLOSE_MARGIN_SEC, explainError, isAuroraTestnet, minimumOut, nextTradeStep, redeemState, stepStates, windowFor } from '../src/lib/wallet/flow.mjs';

const json = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
const U = 1_000_000n; // 1 test USDC raw

test('public addresses match the deployment manifest exactly', () => {
  const manifest = json('../../deployments/aurora-testnet-tidepool.json');
  const local = json('../src/lib/wallet/contracts.json');
  assert.equal(local.chainId, manifest.chainId);
  for (const key of ['engine', 'market', 'tokens', 'stable']) assert.equal(local[key].toLowerCase(), manifest.contracts[key].toLowerCase(), key);
  assert.equal(local.stableDecimals, 6, 'QuantumRound constructor requires a 6-decimal stable');
});

test('chain check accepts only Aurora testnet', () => {
  assert.equal(isAuroraTestnet('0x4e454153'), true);
  assert.equal(isAuroraTestnet('0x4E454153'), true);
  assert.equal(isAuroraTestnet(1313161555), true);
  assert.equal(isAuroraTestnet('0x4e454152'), false, 'Aurora mainnet');
  assert.equal(isAuroraTestnet('0x1'), false);
  assert.equal(isAuroraTestnet(undefined), false);
});

test('trading window follows status and tradingEnd with a safety margin', () => {
  const end = 10_000;
  assert.equal(windowFor({ status: 1, tradingEnd: end, nowSec: end - CLOSE_MARGIN_SEC - 1 }).kind, 'open');
  assert.equal(windowFor({ status: 1, tradingEnd: end, nowSec: end - CLOSE_MARGIN_SEC }).kind, 'closing', 'margin boundary is not open');
  assert.equal(windowFor({ status: 1, tradingEnd: end, nowSec: end - 1 }).kind, 'closing');
  assert.equal(windowFor({ status: 1, tradingEnd: end, nowSec: end }).kind, 'closed', 'contract: block.timestamp >= tradingEnd reverts');
  assert.match(windowFor({ status: 1, tradingEnd: end, nowSec: end }).reason, /wait for settlement/);
  assert.equal(windowFor({ status: 1, tradingEnd: null, nowSec: 5 }).kind, 'closed', 'unknown timing never opens trading');
  assert.equal(windowFor({ status: 1, tradingEnd: undefined, nowSec: 5 }).kind, 'closed', 'NaN comparisons must not fall through to open');
  assert.equal(windowFor({ status: 1, tradingEnd: end, nowSec: null }).kind, 'closed', 'unknown chain time never opens trading');
  assert.equal(windowFor({ status: 2, tradingEnd: end, nowSec: 1 }).kind, 'closed', 'collapsed is closed even if the clock is early');
  assert.equal(windowFor({ status: 3, tradingEnd: end, nowSec: 1 }).kind, 'redeem');
  assert.equal(windowFor({ status: 4, tradingEnd: end, nowSec: 1 }).kind, 'redeem');
  assert.equal(windowFor({ status: 0, tradingEnd: end, nowSec: 1 }).kind, 'none');
});

test('minimum outcomes: floor of quote * (1 - slippage)', () => {
  assert.equal(minimumOut(1_000_000n, 50), 995_000n, 'matches policy.mjs quote*995/1000');
  assert.equal(minimumOut(1999n, 50), 1989n, 'rounds down: 1999*9950/10000 = 1989.005');
  assert.equal(minimumOut(10n ** 30n + 7n, 0), 10n ** 30n + 7n);
  assert.equal(minimumOut(0n, 50), null);
  assert.equal(minimumOut(-5n, 50), null);
  assert.equal(minimumOut(100n, 501), null, 'tolerance capped at 5%');
  assert.equal(minimumOut(100n, -1), null);
  assert.equal(minimumOut(100n, 1.5), null);
  assert.equal(minimumOut(100, 50), null, 'numbers are not accepted for money');
});

const R = (over = {}) => ({ balance: 20n * U, allowance: 0n, deposit: 0n, claimed: 0n, credits: 0n, ...over });
const step = (reads, depositAmount = 10n * U, creditAmount = 1n * U) => nextTradeStep({ reads, depositAmount, creditAmount });

test('next step: approve exactly the deposit, then deposit', () => {
  assert.deepEqual(step(R()), { step: 'approve', amount: 10n * U });
  assert.deepEqual(step(R({ allowance: 10n * U - 1n })), { step: 'approve', amount: 10n * U }, 'one raw unit short still needs approval');
  assert.deepEqual(step(R({ allowance: 10n * U })), { step: 'deposit', amount: 10n * U });
  assert.equal(step(R({ balance: 0n })).why, 'no-usdc');
  assert.equal(step(R({ balance: 10n * U - 1n, allowance: 10n * U })).why, 'insufficient', 'balance checked before allowance');
  assert.deepEqual(step(R({ balance: 10n * U })), { step: 'approve', amount: 10n * U }, 'exact balance is enough');
  assert.equal(step(R(), 0n).why, 'amount');
  assert.equal(step(R({ allowance: null })).why, 'unread');
});

test('next step after deposit: claim only the shortfall, capped by deposit per strategy', () => {
  const d = { deposit: 10n * U, allowance: 0n, balance: 10n * U };
  assert.deepEqual(step(R(d)), { step: 'claim', amount: 1n * U }, 'deposit done skips approve even with zero allowance');
  assert.deepEqual(step(R({ ...d, credits: 400_000n, claimed: 400_000n })), { step: 'claim', amount: 600_000n });
  assert.deepEqual(step(R({ ...d, credits: 1n * U, claimed: 1n * U })), { step: 'buy', amount: 1n * U });
  assert.deepEqual(step(R({ ...d, credits: 3n * U, claimed: 3n * U })), { step: 'buy', amount: 1n * U }, 'buy spends the chosen amount, not the balance');
  assert.deepEqual(step(R({ ...d, claimed: 9n * U }), 10n * U, 1n * U), { step: 'claim', amount: 1n * U }, 'claimed + need == deposit is allowed');
  assert.equal(step(R({ ...d, claimed: 9n * U + 1n }), 10n * U, 1n * U).why, 'cap', 'contract: total > deposited reverts');
  assert.equal(step(R({ ...d, claimed: 10n * U, credits: 0n })).why, 'cap', 'credits already spent cannot be re-claimed past the cap');
  assert.equal(step(R({ ...d, credits: null })).why, 'unread');
  assert.equal(step(R(d), 10n * U, 0n).why, 'amount');
});

test('stepper marks earlier steps done and the next one current', () => {
  const states = (next, reads) => stepStates(next, reads).map((s) => s.state).join(',');
  assert.equal(states({ step: 'approve' }, R()), 'current,upcoming,upcoming,upcoming');
  assert.equal(states({ step: 'deposit' }, R()), 'done,current,upcoming,upcoming', 'existing allowance skips approve');
  assert.equal(states({ step: 'buy' }, R({ deposit: 1n })), 'done,done,done,current');
  assert.equal(states({ step: 'blocked' }, R({ deposit: 1n })), 'done,done,blocked,upcoming');
  assert.equal(states({ step: 'blocked' }, R()), 'blocked,upcoming,upcoming,upcoming');
});

test('redeem is offered only after settlement and only when redeem would not revert', () => {
  const base = { windowKind: 'redeem', deposit: 10n * U, redeemed: false, winnerHoldings: 0n, preview: 9n * U };
  assert.deepEqual(redeemState(base), { canRedeem: true, message: null });
  assert.equal(redeemState({ ...base, windowKind: 'closed' }).canRedeem, false, 'collapsed is not redeemable');
  assert.equal(redeemState({ ...base, redeemed: true }).canRedeem, false);
  assert.match(redeemState({ ...base, redeemed: true }).message, /Already/);
  assert.equal(redeemState({ ...base, redeemed: true, winnerHoldings: 5n }).canRedeem, true, 'leftover winning tokens still redeem');
  assert.equal(redeemState({ ...base, deposit: 0n }).canRedeem, false);
  assert.equal(redeemState({ ...base, preview: 0n }).canRedeem, true, 'a zero payout still clears the position');
  assert.equal(redeemState({ ...base, preview: null }).canRedeem, false, 'never redeem without showing the preview first');
});

test('errors decode to plain English', () => {
  assert.match(explainError({ name: 'TradingNotOpen' }), /not open/);
  assert.match(explainError({ name: 'ClaimExceedsDeposit' }), /exceed your deposit/);
  assert.match(explainError({ name: 'Slippage' }), /slippage/);
  assert.match(explainError({ code: 4001 }), /rejected/);
  assert.match(explainError({ message: 'insufficient funds for gas * price + value' }), /ETH for gas/);
  assert.match(explainError({ name: 'toString' }), /did not go through/, 'prototype keys are not error names');
  assert.match(explainError(null), /did not go through/);
});
