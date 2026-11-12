import {createPublicClient,http,parseAbi} from 'viem';
import {verifyTidepoolDelivery,tidepoolDeliveryHash} from './delivery.mjs';
import {TIDEPOOL} from './client.mjs';
export async function readTidepoolFundingProof({response,sourceHash}) {
const source=createPublicClient({transport:http('https://sepolia-rollup.arbitrum.io/rpc',{retryCount:0,timeout:20000})});
const destination=createPublicClient({transport:http('https://testnet.aurora.dev',{retryCount:0,timeout:20000})});
const request=response.quoteRequest;
const r=await fetch(TIDEPOOL.baseUrl+'/v0/status?depositAddress='+encodeURIComponent(response.quote.depositAddress),{signal:AbortSignal.timeout(20000),redirect:'error'});
if(!r.ok)throw Error('Provider status unavailable');const status=await r.json();
const hash=tidepoolDeliveryHash(status);
const sr=await source.getTransactionReceipt({hash:sourceHash}),dr=await destination.getTransactionReceipt({hash});
const sb=await source.getBlock({blockNumber:sr.blockNumber}),db=await destination.getBlock({blockNumber:dr.blockNumber});
const proof=verifyTidepoolDelivery({status,response,sourceReceipt:sr,destinationReceipt:dr,sourceChainId:await source.getChainId(),destinationChainId:await destination.getChainId(),sourceCanonicalHash:sb.hash,destinationCanonicalHash:db.hash,sourceBlockTimestamp:Number(sb.timestamp)});
const abi=parseAbi(['function balanceOf(address) view returns(uint256)']);
const [before,after]=await Promise.all([dr.blockNumber-1n,dr.blockNumber].map(blockNumber=>destination.readContract({address:TIDEPOOL.token,abi,functionName:'balanceOf',args:[request.recipient],blockNumber})));
if(before!==0n||after-before!==BigInt(proof.destination.amount))throw Error('Safe balance delta differs from delivery');
return JSON.parse(JSON.stringify({...proof,safeBalance:{before,after,delta:after-before},status},(_,v)=>typeof v==='bigint'?String(v):v));

}
