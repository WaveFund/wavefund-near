// Minimal human-readable ABIs for the visitor's own forecasting position. Signatures were checked against
// `forge inspect` of src/QuantumRound.sol, src/WaveV4ProposalMarket.sol and src/ProposalToken.sol.
import { parseAbi } from "viem";

// Errors that can bubble out of an engine call: its own, the market's (buy goes engine -> market) and the
// OpenZeppelin ERC20 errors raised by CREDIT burns and the stable token's transferFrom.
const ERRORS = [
  "error TradingNotOpen(uint256 roundId)",
  "error RoundNotFound(uint256 roundId)",
  "error ProposalNotFound(uint256 roundId, uint256 proposalId)",
  "error ZeroAmount()",
  "error ClaimExceedsDeposit(uint256 deposited, uint256 totalClaimed)",
  "error NotRedeemable(uint256 roundId)",
  "error NothingToRedeem()",
  "error SolvencyViolation(uint256 roundId)",
  "error Slippage(uint256 minRequired, uint256 actual)",
  "error InsufficientDepth(uint256 requestedIn, uint256 consumedIn)",
  "error TradingClosed(uint64 start, uint64 end, uint256 currentTime)",
  "error AlreadyFinalized(uint256 roundId, uint256 proposalId)",
  "error MarketNotSeeded(uint256 roundId, uint256 proposalId)",
  "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
  "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
] as const;

export const engineAbi = parseAbi([
  "function currentRoundId() view returns (uint256)",
  "function rounds(uint256) view returns (uint64 tradingStart, uint64 tradingEnd, uint64 evaluationEnd, uint64 twapWindow, uint256 rMin, uint256 rMax, uint8 status, uint8 proposalCount, uint8 winnerId, bool seedReleased, uint256 realisedReturn, uint256 pi, uint256 totalDeposits, uint256 depositsOutstanding, uint256 escrow, uint256 totalPaid)",
  "function deposits(uint256, address) view returns (uint256)",
  "function creditsClaimed(uint256, uint256, address) view returns (uint256)",
  "function redeemed(uint256, address) view returns (bool)",
  "function previewRedeem(uint256 roundId, address user) view returns (uint256 payout)",
  "function deposit(uint256 roundId, uint256 amount)",
  "function claimCredits(uint256 roundId, uint256 proposalId, uint256 amount)",
  "function buyLong(uint256 roundId, uint256 proposalId, uint256 amount, uint256 minOut) returns (uint256)",
  "function buyShort(uint256 roundId, uint256 proposalId, uint256 amount, uint256 minOut) returns (uint256)",
  "function redeem(uint256 roundId) returns (uint256)",
  ...ERRORS,
]);

export const marketAbi = parseAbi([
  "function quoteBuyLong(uint256 r, uint256 p, uint256 credits) view returns (uint256)",
  "function quoteBuyShort(uint256 r, uint256 p, uint256 credits) view returns (uint256)",
  ...ERRORS,
]);

export const tokensAbi = parseAbi([
  "function creditToken(uint256 roundId, uint256 proposalId) view returns (address)",
  "function longToken(uint256 roundId, uint256 proposalId) view returns (address)",
  "function shortToken(uint256 roundId, uint256 proposalId) view returns (address)",
]);

export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  ...ERRORS,
]);
