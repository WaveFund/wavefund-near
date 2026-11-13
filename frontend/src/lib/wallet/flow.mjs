// Pure rules for "Forecast from your wallet". No I/O: every input is a chain read made by client.ts.
// Contract facts (src/QuantumRound.sol, src/WaveV4ProposalMarket.sol):
// - deposit / claimCredits / buyLong / buyShort all go through QuantumRound._trading: status == Trading AND
//   block.timestamp < tradingEnd, otherwise TradingNotOpen. Quotes revert TradingClosed outside the same window.
// - claimCredits is capped per proposal: creditsClaimed(r, p, user) + amount <= deposits(r, user).
// - buy burns `amount` CREDIT of that proposal from the caller; minOut is in raw LONG/SHORT units (18 decimals).
// - redeem needs status Settled (3) or Cancelled (4). previewRedeem returns what redeem would pay right now.

export const ROUND = Object.freeze({ none: 0, trading: 1, collapsed: 2, settled: 3, cancelled: 4 });
export const AURORA_TESTNET_ID = 1313161555;
export const AURORA_TESTNET_HEX = '0x4e454153';
/** Same 0.5% tolerance the scripted forecasters use (runtime/agents/policy.mjs: quote * 995 / 1000). */
export const DEFAULT_SLIPPAGE_BPS = 50;
export const MAX_SLIPPAGE_BPS = 500;
/** A transaction sent this close to tradingEnd may be mined after it and revert, so we stop offering trades. */
export const CLOSE_MARGIN_SEC = 30;
export const STEPS = Object.freeze(['approve', 'deposit', 'claim', 'buy']);

export const AURORA_ADD_PARAMS = Object.freeze({
  chainId: AURORA_TESTNET_HEX, chainName: 'Aurora Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: ['https://testnet.aurora.dev'], blockExplorerUrls: ['https://explorer.testnet.aurora.dev'],
});

const big = (value) => (typeof value === 'bigint' ? value : null);

/** Accepts the wallet's hex chainId or a number. */
export function isAuroraTestnet(chainId) {
  if (typeof chainId === 'number') return chainId === AURORA_TESTNET_ID;
  if (typeof chainId === 'string' && /^0x[0-9a-f]+$/i.test(chainId)) return BigInt(chainId) === BigInt(AURORA_TESTNET_ID);
  return false;
}

/**
 * Which actions the round allows right now, from chain status and chain time (seconds).
 * open: trade steps enabled. closing: still Trading but inside the safety margin. closed: Trading past
 * tradingEnd or Collapsed, nothing to do until settlement. redeem: Settled or Cancelled. none: no round.
 */
export function windowFor({ status, tradingEnd, nowSec, marginSec = CLOSE_MARGIN_SEC }) {
  if (status === ROUND.settled || status === ROUND.cancelled) return { kind: 'redeem', reason: status === ROUND.cancelled ? 'Round cancelled — your deposit redeems at par.' : 'Round settled — you can redeem.' };
  if (status === ROUND.collapsed) return { kind: 'closed', reason: 'Trading closed — wait for settlement to redeem.' };
  if (status === ROUND.trading) {
    if (!Number.isFinite(tradingEnd) || !Number.isFinite(nowSec)) return { kind: 'closed', reason: 'Round timing unavailable — trading is not offered.' };
    if (nowSec >= tradingEnd) return { kind: 'closed', reason: 'Trading closed — wait for settlement to redeem.' };
    if (nowSec >= tradingEnd - marginSec) return { kind: 'closing', reason: `Trading closes in under ${marginSec} s — a transaction sent now could arrive too late.` };
    return { kind: 'open', reason: 'Forecasting open.' };
  }
  return { kind: 'none', reason: 'No round is open on the testnet.' };
}

/** Minimum outcome tokens after slippage, rounded down. Null when the quote or tolerance is unusable. */
export function minimumOut(quote, slippageBps = DEFAULT_SLIPPAGE_BPS) {
  if (typeof quote !== 'bigint' || quote <= 0n) return null;
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > MAX_SLIPPAGE_BPS) return null;
  return (quote * BigInt(10000 - slippageBps)) / 10000n;
}

/**
 * The single next transaction for a trade, derived from chain reads. Amounts are raw bigint
 * (stable 6 decimals; 1 credit = 1 raw stable). Reads: balance, allowance (to engine), deposit,
 * claimed (creditsClaimed for the chosen proposal), credits (CREDIT balance of the chosen proposal).
 * Returns { step, amount } or { step: 'blocked', why, message }.
 */
export function nextTradeStep({ reads, depositAmount, creditAmount }) {
  const balance = big(reads?.balance); const allowance = big(reads?.allowance); const deposit = big(reads?.deposit);
  const claimed = big(reads?.claimed); const credits = big(reads?.credits);
  if (balance === null || allowance === null || deposit === null) return { step: 'blocked', why: 'unread', message: 'Reading your position from the chain…' };
  if (deposit === 0n) {
    if (typeof depositAmount !== 'bigint' || depositAmount <= 0n) return { step: 'blocked', why: 'amount', message: 'Enter a deposit amount greater than zero.' };
    if (balance === 0n) return { step: 'blocked', why: 'no-usdc', message: 'This wallet holds no test USDC.' };
    if (balance < depositAmount) return { step: 'blocked', why: 'insufficient', message: 'The deposit is more than this wallet holds.' };
    if (allowance < depositAmount) return { step: 'approve', amount: depositAmount };
    return { step: 'deposit', amount: depositAmount };
  }
  if (claimed === null || credits === null) return { step: 'blocked', why: 'unread', message: 'Reading your credits from the chain…' };
  if (typeof creditAmount !== 'bigint' || creditAmount <= 0n) return { step: 'blocked', why: 'amount', message: 'Enter a credit amount greater than zero.' };
  if (credits >= creditAmount) return { step: 'buy', amount: creditAmount };
  const need = creditAmount - credits;
  if (claimed + need > deposit) return { step: 'blocked', why: 'cap', message: 'Credits per strategy cannot exceed your deposit. Lower the amount.' };
  return { step: 'claim', amount: need };
}

/** Stepper rows: steps before the next one are done; a blocked flow keeps its position by read state. */
export function stepStates(next, reads) {
  const at = STEPS.indexOf(next?.step);
  const fallback = big(reads?.deposit) > 0n ? 2 : 0;
  const current = at === -1 ? fallback : at;
  return STEPS.map((id, index) => ({ id, state: index < current ? 'done' : index === current ? (at === -1 ? 'blocked' : 'current') : 'upcoming' }));
}

/** Redeem is offered when redeem would not revert NothingToRedeem: an unredeemed deposit or winning tokens held. */
export function redeemState({ windowKind, deposit, redeemed, winnerHoldings, preview }) {
  if (windowKind !== 'redeem') return { canRedeem: false, message: null };
  const active = (big(deposit) ?? 0n) > 0n && redeemed === false;
  const holds = (big(winnerHoldings) ?? 0n) > 0n;
  if (!active && !holds) return { canRedeem: false, message: redeemed ? 'Already redeemed.' : 'Nothing to redeem for this address.' };
  return { canRedeem: typeof preview === 'bigint', message: typeof preview === 'bigint' ? null : 'Reading the redeem amount…' };
}

const ERROR_TEXT = Object.freeze({
  TradingNotOpen: 'Trading is not open for this round any more.',
  TradingClosed: 'The market is closed for this round.',
  RoundNotFound: 'That round does not exist on chain.',
  ProposalNotFound: 'That strategy does not exist in this round.',
  ZeroAmount: 'The amount must be greater than zero.',
  ClaimExceedsDeposit: 'Credits per strategy cannot exceed your deposit.',
  Slippage: 'The price moved past your slippage limit. Get a fresh quote and try again.',
  InsufficientDepth: 'The market is too shallow for that amount. Try a smaller amount.',
  AlreadyFinalized: 'This strategy’s market is already final.',
  MarketNotSeeded: 'This strategy’s market is not open.',
  NotRedeemable: 'The round has not settled yet.',
  NothingToRedeem: 'Nothing to redeem for this address.',
  SolvencyViolation: 'The round refused this payout (solvency check). Ask the operator.',
  ERC20InsufficientBalance: 'Not enough balance for this step.',
  ERC20InsufficientAllowance: 'The approval is lower than the deposit. Approve again.',
});

/** Plain-English failure text. Input: { name?, code?, message? } (custom error name from a decoded revert). */
export function explainError(failure) {
  const name = typeof failure?.name === 'string' ? failure.name : null;
  if (name && Object.hasOwn(ERROR_TEXT, name)) return ERROR_TEXT[name];
  if (failure?.code === 4001 || name === 'UserRejectedRequestError') return 'You rejected the request in your wallet. Nothing was sent.';
  if (failure?.code === 4902) return 'Your wallet does not know Aurora testnet yet.';
  if (failure?.code === -32002) return 'Your wallet already has a request open. Check the wallet window.';
  if (name === 'ChainMismatch') return 'Switch your wallet to Aurora testnet first.';
  if (name === 'InsufficientFunds' || /insufficient funds/i.test(failure?.message ?? '')) return 'Not enough testnet ETH for gas.';
  if (name === 'Reverted') return 'The transaction was mined but reverted. Nothing changed.';
  return 'The transaction did not go through. Your position was re-read from the chain.';
}

/** A wallet remains usable without the monitoring API; trades still require fresh on-chain round reads. */
export function walletAvailability(round) {
  return round && typeof round === 'object' && typeof round.roundId === 'string'
    ? { visible: true, context: 'round' }
    : { visible: true, context: 'between-rounds' };
}
