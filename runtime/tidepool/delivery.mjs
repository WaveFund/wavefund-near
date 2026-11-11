import { decodeTransfers } from '../intents/delivery.mjs';
import { TIDEPOOL, validateTidepoolQuote } from './client.mjs';
const check=(v,m)=>{if(!v)throw Error(m);};
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
export function verifyTidepoolDelivery({ status, response, sourceReceipt, destinationReceipt, sourceChainId, destinationChainId,
  sourceCanonicalHash, destinationCanonicalHash, sourceBlockTimestamp, now }) {
  const request=response.quoteRequest;validateTidepoolQuote(response,request,{now:Math.ceil(Date.parse(response.timestamp)/1000)});
  check(Number.isSafeInteger(sourceBlockTimestamp)&&sourceBlockTimestamp<=Date.parse(request.deadline)/1000,'TIDEPOOL_DEPOSIT_EXPIRED');
  check(!request.dry&&sourceChainId===421614&&destinationChainId===1313161555,'TIDEPOOL_PROOF_NETWORK');
  check(status.status==='SUCCESS','TIDEPOOL_PENDING');
  const linked=(list,hash)=>Array.isArray(list)&&list.some(x=>same(typeof x==='string'?x:x?.hash,hash));
  check(linked(status.swapDetails?.originChainTxHashes,sourceReceipt.transactionHash)
    &&linked(status.swapDetails?.destinationChainTxHashes,destinationReceipt.transactionHash),'TIDEPOOL_LINKAGE');
  for(const [receipt,canonical]of[[sourceReceipt,sourceCanonicalHash],[destinationReceipt,destinationCanonicalHash]])
    check(receipt.status==='success'&&same(receipt.blockHash,canonical),'TIDEPOOL_RECEIPT');
  const sum=(receipt,from,to)=>decodeTransfers(receipt).filter(t=>same(t.token,TIDEPOOL.token)&&same(t.to,to)&&(!from||same(t.from,from))).reduce((s,t)=>s+t.value,0n);
  const sent=sum(sourceReceipt,request.refundTo,response.quote.depositAddress),received=sum(destinationReceipt,null,request.recipient);
  check(sent===BigInt(request.amount),'TIDEPOOL_SOURCE_AMOUNT');
  check(received>=BigInt(response.quote.minAmountOut),'TIDEPOOL_DELIVERY_AMOUNT');
  return {schemaVersion:1,testnetOnly:true,official1Click:false,deliveryProven:true,method:'provider-linked canonical receipts from trusted RPCs; not a trustless bridge proof',
    source:{chainId:421614,transactionHash:sourceReceipt.transactionHash,blockNumber:String(sourceReceipt.blockNumber),amount:String(sent)},
    destination:{chainId:1313161555,transactionHash:destinationReceipt.transactionHash,blockNumber:String(destinationReceipt.blockNumber),safe:request.recipient,amount:String(received)},
    token:TIDEPOOL.token,minAmountOut:response.quote.minAmountOut,nearTransactionsReportedByProvider:status.swapDetails?.nearTxHashes??[],
    confirmationPolicy:'Testnet canonical receipts only; not Ethereum L1 finality',strategyExecuted:false};
}

export function tidepoolDeliveryHash(status) {
  const hashes=(status.swapDetails?.destinationChainTxHashes??[]).map(x=>typeof x==='string'?x:x?.hash)
    .filter(x=>typeof x==='string'&&/^0x[0-9a-fA-F]{64}$/.test(x));
  check(hashes.length===1,'TIDEPOOL_AMBIGUOUS_DELIVERY_HASH');return hashes[0];
}
