import { decodeEventLog } from 'viem';
import { safeAbi } from '../chain.mjs';

export async function auditReceipts({ publicClient, journal, contracts, chainId = 31337 }) {
  if (await publicClient.getChainId() !== chainId) throw new Error('Receipt audit network mismatch');
  if (journal?.schemaVersion !== 1 || !Array.isArray(journal.actions) || journal.actions.length > 1000) throw new Error('Invalid receipt journal');
  let latest = await publicClient.getBlockNumber({ cacheTime: 0 }); const actions = [];
  for (const action of journal.actions) {
    if (!action.hash) { actions.push({ id: action.id, label: action.label, status: action.status === 'failed' ? 'never-broadcast' : 'manual-review', reason: 'No hash recorded; never assume a retry is safe.' }); continue; }
    if (!/^0x[a-fA-F0-9]{64}$/.test(action.hash)) throw new Error('Invalid journal transaction hash');
    let receipt;
    try { receipt = await publicClient.getTransactionReceipt({ hash: action.hash }); } catch { actions.push({ id: action.id, label: action.label, hash: action.hash, status: 'unresolved', reason: 'Receipt absent or RPC unavailable; no resubmission.' }); continue; }
    let status = receipt.status === 'success' ? 'confirmed' : 'reverted';
    if (action.blockHash && action.blockHash !== receipt.blockHash) status = 'chain-mismatch';
    if (receipt.blockNumber > latest) latest = await publicClient.getBlockNumber({ cacheTime: 0 });
    if (receipt.blockNumber > latest) status = 'newer-than-audit-head';
    if (status === 'confirmed') {
      const transaction = await publicClient.getTransaction({ hash: action.hash });
      if (transaction.from.toLowerCase() !== action.from.toLowerCase() || transaction.to?.toLowerCase() !== action.to.toLowerCase() || transaction.nonce !== action.nonce) status = 'transaction-mismatch';
    }
    if (status === 'confirmed' && action.functionName === 'execTransaction') {
      const events = receipt.logs.filter((log) => log.address.toLowerCase() === contracts.safe.toLowerCase()).flatMap((log) => { try { return [decodeEventLog({ abi: safeAbi, data: log.data, topics: log.topics }).eventName]; } catch { return []; } });
      if (!events.includes('ExecutionSuccess') || events.includes('ExecutionFailure')) status = 'safe-inner-failure';
    }
    actions.push({ id: action.id, label: action.label, hash: action.hash, status, blockNumber: receipt.blockNumber.toString(), confirmations: receipt.blockNumber <= latest ? (latest - receipt.blockNumber + 1n).toString() : '0' });
  }
  return { readOnly: true, automaticRetry: false, recordedStage: journal.stage, allConfirmed: actions.length > 0 && actions.every((action) => action.status === 'confirmed'), needsManualReview: actions.some((action) => !['confirmed', 'never-broadcast'].includes(action.status)), actions };
}
