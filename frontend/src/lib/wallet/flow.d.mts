export declare const ROUND: Readonly<{ none: 0; trading: 1; collapsed: 2; settled: 3; cancelled: 4 }>;
export declare const AURORA_TESTNET_ID: 1313161555;
export declare const AURORA_TESTNET_HEX: '0x4e454153';
export declare const DEFAULT_SLIPPAGE_BPS: number;
export declare const MAX_SLIPPAGE_BPS: number;
export declare const CLOSE_MARGIN_SEC: number;
export type TradeStepId = 'approve' | 'deposit' | 'claim' | 'buy';
export declare const STEPS: ReadonlyArray<TradeStepId>;
export declare const AURORA_ADD_PARAMS: Readonly<{ chainId: string; chainName: string; nativeCurrency: { name: string; symbol: string; decimals: number }; rpcUrls: string[]; blockExplorerUrls: string[] }>;

export type WindowKind = 'open' | 'closing' | 'closed' | 'redeem' | 'none';
export declare function isAuroraTestnet(chainId: unknown): boolean;
export declare function windowFor(input: { status: number; tradingEnd: number | null; nowSec: number | null; marginSec?: number }): { kind: WindowKind; reason: string };
export declare function minimumOut(quote: bigint | null | undefined, slippageBps?: number): bigint | null;

export type TradeReads = { balance: bigint | null; allowance: bigint | null; deposit: bigint | null; claimed: bigint | null; credits: bigint | null };
export type NextStep = { step: TradeStepId; amount: bigint } | { step: 'blocked'; why: 'unread' | 'amount' | 'no-usdc' | 'insufficient' | 'cap'; message: string };
export declare function nextTradeStep(input: { reads: TradeReads | null; depositAmount: bigint | null; creditAmount: bigint | null }): NextStep;
export declare function stepStates(next: NextStep | null, reads: TradeReads | null): Array<{ id: TradeStepId; state: 'done' | 'current' | 'upcoming' | 'blocked' }>;
export declare function redeemState(input: { windowKind: WindowKind; deposit: bigint | null; redeemed: boolean | null; winnerHoldings: bigint | null; preview: bigint | null }): { canRedeem: boolean; message: string | null };
export declare function explainError(failure: { name?: string | null; code?: number | null; message?: string | null } | null | undefined): string;
