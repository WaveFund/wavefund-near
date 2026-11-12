// One bounded testnet transfer. Private key arrives only over stdin. No transaction retries.
import readline from 'node:readline';
import {createPublicClient,createWalletClient,http,encodeFunctionData,parseAbi,keccak256} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {arbitrumSepolia} from 'viem/chains';
import {tidepoolRequest,fetchTidepoolQuote,validateTidepoolQuote,tidepoolGasBudget,TIDEPOOL} from './client.mjs';
import {verifyTidepoolDelivery,tidepoolDeliveryHash} from './delivery.mjs';
const lines=readline.createInterface({input:process.stdin,crlfDelay:Infinity}),iterator=lines[Symbol.asyncIterator]();
const config=JSON.parse((await iterator.next()).value),account=privateKeyToAccount(config.privateKey);delete config.privateKey;
const emit=x=>console.log(JSON.stringify(x,(_,v)=>typeof v==='bigint'?String(v):v));const check=(v,m)=>{if(!v)throw Error(m);};
const tokenAbi=parseAbi(['function transfer(address,uint256) returns(bool)','function balanceOf(address) view returns(uint256)']);
try {
 check(account.address.toLowerCase()==='0x1903bddf6f73ee4aa8f66d170e7590d28cd3f8b9','wrong test operator');
 const manifest=config.manifest;check(manifest.chainId===1313161555&&manifest.contracts.stable.toLowerCase()===TIDEPOOL.token,'wrong manifest');
 const source=createPublicClient({chain:arbitrumSepolia,transport:http('https://sepolia-rollup.arbitrum.io/rpc',{retryCount:0,timeout:20000})});
 const destination=createPublicClient({transport:http('https://testnet.aurora.dev',{retryCount:0,timeout:20000})});
 check(await source.getChainId()===421614&&await destination.getChainId()===1313161555,'wrong chains');
 check(await source.getBalance({address:account.address})>0n,'ARBITRUM_SEPOLIA_GAS_REQUIRED');
 check(await destination.readContract({address:TIDEPOOL.token,abi:tokenAbi,functionName:'balanceOf',args:[manifest.contracts.safe]})===0n,'Safe already funded; review');
 const request=config.recoveryResponse?.quoteRequest??tidepoolRequest({safe:manifest.contracts.safe,refund:account.address,dry:false});
 check(request.recipient.toLowerCase()===manifest.contracts.safe.toLowerCase()&&request.refundTo.toLowerCase()===account.address.toLowerCase()&&request.amount==='200000000','recovery binding');
 const verified=config.recoveryResponse ? validateTidepoolQuote(config.recoveryResponse,request,{now:Math.ceil(Date.parse(config.recoveryResponse.timestamp)/1000)}) : await fetchTidepoolQuote(request,{allowExecution:true});
 const response=verified.response;check(Date.parse(request.deadline)>Date.now()+60000,'quote too close to expiry');
 emit({stage:'fundingQuote',...verified});
 const tx={account,to:TIDEPOOL.token,data:encodeFunctionData({abi:tokenAbi,functionName:'transfer',args:[response.quote.depositAddress,BigInt(request.amount)]}),value:0n,type:'legacy'};
 const sim=await source.simulateContract({account,address:TIDEPOOL.token,abi:tokenAbi,functionName:'transfer',args:[response.quote.depositAddress,BigInt(request.amount)]});check(sim.result===true,'transfer simulation failed');
 const {gas,gasPrice}=tidepoolGasBudget({estimatedGas:await source.estimateGas(tx),quotedGasPrice:await source.getGasPrice(),balance:await source.getBalance({address:account.address})});
 const wallet=createWalletClient({account,chain:arbitrumSepolia,transport:http('https://sepolia-rollup.arbitrum.io/rpc',{retryCount:0})});
 const nonce=await source.getTransactionCount({address:account.address,blockTag:'pending'});if(config.recoveryResponse)check(nonce===0&&config.recoveryNonce===0,'same-nonce recovery no longer safe');const signed=await wallet.signTransaction({...tx,gas,gasPrice,nonce});const hash=keccak256(signed);
 emit({stage:'prepared',label:'fund:source',hash,nonce,chainId:421614,amount:request.amount,depositAddress:response.quote.depositAddress,gas,gasPrice,rawTransaction:signed});
 check(JSON.parse((await iterator.next()).value).ack===hash,'missing durable ack');
 const sequencer=createPublicClient({transport:http('https://sepolia-rollup-sequencer.arbitrum.io/rpc',{retryCount:0,timeout:20000})});
 check(await sequencer.sendRawTransaction({serializedTransaction:signed})===hash,'broadcast mismatch');
 const sourceReceipt=await source.waitForTransactionReceipt({hash,timeout:120000,pollingInterval:1000});check(sourceReceipt.status==='success','source reverted');
 emit({stage:'confirmed',label:'fund:source',hash,blockNumber:sourceReceipt.blockNumber});
 const notify=await fetch(TIDEPOOL.baseUrl+'/v0/deposit/submit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({txHash:hash,depositAddress:response.quote.depositAddress}),signal:AbortSignal.timeout(20000),redirect:'error'});
 check(notify.ok,'provider notification unavailable; inspect known hash');
 for(let i=0;i<60;i++) {
  const r=await fetch(TIDEPOOL.baseUrl+'/v0/status?depositAddress='+encodeURIComponent(response.quote.depositAddress),{signal:AbortSignal.timeout(15000),redirect:'error'});check(r.ok,'status unavailable; inspect known hash');
  const status=await r.json();emit({stage:'fundingStatus',status});
  if(status.status==='SUCCESS') {
   const target=tidepoolDeliveryHash(status);
   const destinationReceipt=await destination.getTransactionReceipt({hash:target});
   const sb=await source.getBlock({blockNumber:sourceReceipt.blockNumber}),db=await destination.getBlock({blockNumber:destinationReceipt.blockNumber});
   const proof=verifyTidepoolDelivery({status,response,sourceReceipt,destinationReceipt,sourceChainId:await source.getChainId(),destinationChainId:await destination.getChainId(),sourceCanonicalHash:sb.hash,destinationCanonicalHash:db.hash,sourceBlockTimestamp:Number(sb.timestamp),now:Math.floor(Date.now()/1000)});
   const balance=await destination.readContract({address:TIDEPOOL.token,abi:tokenAbi,functionName:'balanceOf',args:[request.recipient]});
   check(balance===BigInt(proof.destination.amount),'Safe balance differs from verified delivery');emit({stage:'fundingComplete',proof,safeBalance:balance});break;
  }
  check(!['FAILED','REFUNDED'].includes(status.status),'provider ended without delivery; inspect refund evidence');
  check(i<59,'delivery pending; inspect saved deposit, never resend');await new Promise(resolve=>setTimeout(resolve,5000));
 }
} catch(error) {emit({stage:'failed',reason:error.shortMessage??error.message,details:error.details??null});process.exitCode=1;} finally{lines.close();}
