import { decodeEventLog, parseAbi } from 'viem';

const ABI = parseAbi(['event Collapsed(uint256 indexed roundId, uint256 indexed winnerId, uint256[] probabilities)']);
const ONE = 10n ** 18n;
export const SELECTION_MARGIN = 5000000000000000n;
const check = (ok, message) => { if (!ok) throw new Error(`Selection evidence rejected: ${message}`); };
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

// Decode the actual collapse event, not current pool prices or a rounded value from a report.
export function selectionTwaps(value, { engine, roundId, winnerId, proposals, transaction }) {
  const r = value?.receipt; const l = value?.log;
  check(value?.schemaVersion === 1 && value.chainId === 1313161555, 'wrong schema or network');
  check(r?.status === '0x1' && same(r.to, engine) && same(l?.address, engine) && l.removed === false, 'unsuccessful receipt or wrong emitter');
  check(transaction && same(r.transactionHash, transaction.transactionHash) && same(l.transactionHash, r.transactionHash), 'wrong collapse transaction');
  check(/^0x[0-9a-f]{64}$/i.test(r.blockHash) && same(l.blockHash, r.blockHash) && r.blockNumber === l.blockNumber
    && BigInt(r.blockNumber).toString() === transaction.blockNumber, 'wrong collapse block');
  const { args } = decodeEventLog({ abi: ABI, eventName: 'Collapsed', topics: l.topics, data: l.data, strict: true });
  check(String(args.roundId) === roundId && String(args.winnerId) === winnerId, 'wrong round or winner');
  const values = args.probabilities;
  check(values.length === proposals.length && values.length > 0 && proposals.every((p, i) => p.id === String(i))
    && values.every(v => v >= 0n && v <= ONE), 'incomplete or invalid TWAP coverage');
  let best = 0;
  for (let i = 1; i < values.length; i++) if (best === 0 || values[i] > values[best]) best = i;
  const computed = best !== 0 && values[best] > values[0] + SELECTION_MARGIN ? best : 0;
  check(String(computed) === winnerId, 'TWAPs contradict the strict Hold margin or tie rule');
  return values.map(String);
}
