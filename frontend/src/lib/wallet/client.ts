// Wallet and chain I/O for "Forecast from your wallet". The app never holds keys: every write is signed by the
// visitor's injected EIP-1193 wallet. Reads go over HTTP to the public Aurora testnet RPC.
import {
  BaseError, ContractFunctionRevertedError, createPublicClient, createWalletClient, custom, defineChain, http,
  type Address, type EIP1193Provider, type Hash,
} from "viem";
import contracts from "./contracts.json";
import { engineAbi, erc20Abi, marketAbi, tokensAbi } from "./abi";
import { AURORA_ADD_PARAMS, AURORA_TESTNET_HEX } from "./flow.mjs";

export const CONTRACTS = {
  engine: contracts.engine as Address, market: contracts.market as Address,
  tokens: contracts.tokens as Address, stable: contracts.stable as Address,
};
export const STABLE_DECIMALS = contracts.stableDecimals;
export const OUTCOME_DECIMALS = contracts.outcomeDecimals;

export const auroraTestnet = defineChain({
  id: contracts.chainId, name: "Aurora Testnet", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [contracts.rpcUrl] } }, blockExplorers: { default: { name: "Aurora Explorer", url: contracts.explorer } },
});

export const reader = createPublicClient({ chain: auroraTestnet, transport: http(contracts.rpcUrl, { batch: true }) });

export function injected(): EIP1193Provider | null {
  if (typeof window === "undefined") return null;
  const provider = (window as unknown as { ethereum?: EIP1193Provider }).ethereum;
  return provider && typeof provider.request === "function" ? provider : null;
}

export async function accounts(provider: EIP1193Provider, ask: boolean): Promise<Address[]> {
  const list = await provider.request({ method: ask ? "eth_requestAccounts" : "eth_accounts" });
  return Array.isArray(list) ? (list as Address[]) : [];
}
export async function chainIdOf(provider: EIP1193Provider): Promise<string> {
  return String(await provider.request({ method: "eth_chainId" }));
}

/** One click: switch, and if the wallet has never seen Aurora testnet (4902), add it. */
export async function switchToAurora(provider: EIP1193Provider): Promise<void> {
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: AURORA_TESTNET_HEX }] });
  } catch (error) {
    if ((error as { code?: number })?.code !== 4902) throw error;
    await provider.request({ method: "wallet_addEthereumChain", params: [{ ...AURORA_ADD_PARAMS, rpcUrls: [...AURORA_ADD_PARAMS.rpcUrls], blockExplorerUrls: [...AURORA_ADD_PARAMS.blockExplorerUrls] }] });
  }
}

export type ProposalPosition = { id: number; claimed: bigint; credits: bigint; long: bigint; short: bigint };
export type ChainRound = { id: bigint; status: number; tradingEnd: number; evaluationEnd: number; proposalCount: number; winnerId: number; pi: bigint; nowSec: number };
export type Position = {
  round: ChainRound | null; balance: bigint; allowance: bigint; gas: bigint;
  deposit: bigint; redeemed: boolean; proposals: ProposalPosition[]; preview: bigint | null;
};

const ZERO = "0x0000000000000000000000000000000000000000";
async function balanceOf(token: Address, owner: Address): Promise<bigint> {
  if (token.toLowerCase() === ZERO) return 0n;
  return reader.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [owner] });
}

/** The current on-chain round and this address's whole position in it. Every number comes from the chain. */
export async function readPosition(user: Address): Promise<Position> {
  const [id, block, balance, allowance, gas] = await Promise.all([
    reader.readContract({ address: CONTRACTS.engine, abi: engineAbi, functionName: "currentRoundId" }),
    reader.getBlock(),
    balanceOf(CONTRACTS.stable, user),
    reader.readContract({ address: CONTRACTS.stable, abi: erc20Abi, functionName: "allowance", args: [user, CONTRACTS.engine] }),
    reader.getBalance({ address: user }),
  ]);
  if (id === 0n) return { round: null, balance, allowance, gas, deposit: 0n, redeemed: false, proposals: [], preview: null };
  const [r, deposit, redeemed, preview] = await Promise.all([
    reader.readContract({ address: CONTRACTS.engine, abi: engineAbi, functionName: "rounds", args: [id] }),
    reader.readContract({ address: CONTRACTS.engine, abi: engineAbi, functionName: "deposits", args: [id, user] }),
    reader.readContract({ address: CONTRACTS.engine, abi: engineAbi, functionName: "redeemed", args: [id, user] }),
    reader.readContract({ address: CONTRACTS.engine, abi: engineAbi, functionName: "previewRedeem", args: [id, user] }),
  ]);
  const [, tradingEnd, evaluationEnd, , , , status, proposalCount, winnerId, , , pi] = r;
  const proposals = await Promise.all(Array.from({ length: proposalCount }, async (_, p) => {
    const pid = BigInt(p);
    const [claimed, credit, long, short] = await Promise.all([
      reader.readContract({ address: CONTRACTS.engine, abi: engineAbi, functionName: "creditsClaimed", args: [id, pid, user] }),
      reader.readContract({ address: CONTRACTS.tokens, abi: tokensAbi, functionName: "creditToken", args: [id, pid] }),
      reader.readContract({ address: CONTRACTS.tokens, abi: tokensAbi, functionName: "longToken", args: [id, pid] }),
      reader.readContract({ address: CONTRACTS.tokens, abi: tokensAbi, functionName: "shortToken", args: [id, pid] }),
    ]);
    const [credits, longBal, shortBal] = await Promise.all([balanceOf(credit, user), balanceOf(long, user), balanceOf(short, user)]);
    return { id: p, claimed, credits, long: longBal, short: shortBal };
  }));
  const round: ChainRound = { id, status, tradingEnd: Number(tradingEnd), evaluationEnd: Number(evaluationEnd), proposalCount, winnerId, pi, nowSec: Number(block.timestamp) };
  return { round, balance, allowance, gas, deposit, redeemed, proposals, preview: status === 3 || status === 4 ? preview : null };
}

/** On-chain quote from the market (not the engine): all LONG/SHORT received, raw 18 decimals. */
export function quote(roundId: bigint, proposalId: number, side: "long" | "short", credits: bigint): Promise<bigint> {
  return reader.readContract({ address: CONTRACTS.market, abi: marketAbi, functionName: side === "long" ? "quoteBuyLong" : "quoteBuyShort", args: [roundId, BigInt(proposalId), credits] });
}

export type TxRequest =
  | { kind: "approve"; amount: bigint }
  | { kind: "deposit"; roundId: bigint; amount: bigint }
  | { kind: "claim"; roundId: bigint; proposalId: number; amount: bigint }
  | { kind: "buy"; roundId: bigint; proposalId: number; side: "long" | "short"; amount: bigint; minOut: bigint }
  | { kind: "redeem"; roundId: bigint };

function call(req: TxRequest) {
  switch (req.kind) {
    case "approve": return { address: CONTRACTS.stable, abi: erc20Abi, functionName: "approve", args: [CONTRACTS.engine, req.amount] } as const;
    case "deposit": return { address: CONTRACTS.engine, abi: engineAbi, functionName: "deposit", args: [req.roundId, req.amount] } as const;
    case "claim": return { address: CONTRACTS.engine, abi: engineAbi, functionName: "claimCredits", args: [req.roundId, BigInt(req.proposalId), req.amount] } as const;
    case "buy": return { address: CONTRACTS.engine, abi: engineAbi, functionName: req.side === "long" ? "buyLong" : "buyShort", args: [req.roundId, BigInt(req.proposalId), req.amount, req.minOut] } as const;
    case "redeem": return { address: CONTRACTS.engine, abi: engineAbi, functionName: "redeem", args: [req.roundId] } as const;
  }
}

/** Simulates first (so a revert is explained before the wallet opens), then asks the wallet to sign and send. */
export async function send(provider: EIP1193Provider, account: Address, req: TxRequest): Promise<Hash> {
  const wallet = createWalletClient({ account, chain: auroraTestnet, transport: custom(provider) });
  const { request } = await reader.simulateContract({ ...call(req), account } as Parameters<typeof reader.simulateContract>[0]);
  return wallet.writeContract(request as Parameters<typeof wallet.writeContract>[0]);
}

export async function confirm(hash: Hash): Promise<void> {
  const receipt = await reader.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (receipt.status !== "success") throw Object.assign(new Error("Transaction reverted"), { failure: { name: "Reverted" } });
}

/** Reduces any viem/wallet error to the fields explainError() understands. */
export function failureOf(error: unknown): { name: string | null; code: number | null; message: string | null } {
  const tagged = (error as { failure?: { name: string } })?.failure;
  if (tagged) return { name: tagged.name, code: null, message: null };
  let name: string | null = null; let code: number | null = null;
  if (error instanceof BaseError) {
    const revert = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) name = revert.data?.errorName ?? null;
    const coded = error.walk((e) => typeof (e as { code?: unknown }).code === "number") as { code?: number } | null;
    code = coded?.code ?? null;
    if (!name && error.walk((e) => (e as Error).name === "UserRejectedRequestError")) name = "UserRejectedRequestError";
    if (!name && error.walk((e) => (e as Error).name === "InsufficientFundsError")) name = "InsufficientFunds";
    return { name, code, message: error.shortMessage };
  }
  const raw = error as { code?: unknown; message?: unknown };
  return { name, code: typeof raw?.code === "number" ? raw.code : null, message: typeof raw?.message === "string" ? raw.message : null };
}
