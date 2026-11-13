// Explicit permissionless testnet outcome recording for one settled round; no fund movement.
import readline from 'node:readline';
import {createPublicClient,createWalletClient,http,parseAbi,encodeFunctionData,keccak256,decodeEventLog} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {auroraTestnet} from 'viem/chains';
import {roundIdOf,reputationLabel,expectedAfterRecord,checkRecordedOutcome,checkOutcomeEvent} from './reputation-outcome.mjs';
const lines=readline.createInterface({input:process.stdin,crlfDelay:Infinity}),iterator=lines[Symbol.asyncIterator]();
const config=JSON.parse((await iterator.next()).value),account=privateKeyToAccount(config.privateKey);delete config.privateKey;
const emit=x=>console.log(JSON.stringify(x,(_,v)=>typeof v==='bigint'?String(v):v));const check=(v,m)=>{if(!v)throw Error(m);};
try {
 const manifest=config.manifest;check(manifest.chainId===1313161555,'testnet only');
 const id=roundIdOf(config.roundId),label=reputationLabel(id);
 const client=createPublicClient({chain:auroraTestnet,transport:http('https://testnet.aurora.dev',{retryCount:0,timeout:20000})});
 check(await client.getChainId()===1313161555,'wrong chain');
 check(account.address.toLowerCase()==='0x1903bddf6f73ee4aa8f66d170e7590d28cd3f8b9','wrong test signer');
 const address=manifest.contracts.reputation,abi=config.artifacts.AgentReputation.abi;
 const read=(functionName,args=[])=>client.readContract({address,abi,functionName,args});
 check((await read('engine')).toLowerCase()===manifest.contracts.engine.toLowerCase()&&(await read('tracker')).toLowerCase()===manifest.contracts.tracker.toLowerCase(),'wrong bindings');
 const engineAbi=parseAbi(['function winningAllocation(uint256) view returns(uint256,uint16)','function proposals(uint256,uint256) view returns(address,uint16,bool,uint256,uint256,uint256,string)','function roundStatus(uint256) view returns(uint8)','function roundExecuted(uint256) view returns(bool)']);
 const engine=(functionName,args)=>client.readContract({address:manifest.contracts.engine,abi:engineAbi,functionName,args});
 check(await engine('roundStatus',[id])===3&&await engine('roundExecuted',[id]),'Round is not settled and executed; nothing to record');
 const [winner]=await engine('winningAllocation',[id]);
 check(winner!==0n,'Hold won: AgentReputation.record reverts NoAgentWinner, so Hold rounds are never scored');
 const [agent]=await engine('proposals',[id,winner]);
 const portfolio=await client.readContract({address:manifest.contracts.tracker,abi:config.artifacts.PerformanceTracker.abi,functionName:'portfolios',args:[id]});
 const factor=portfolio[6];check(factor>0n,'Round has no observed return');
 const decode=receipt=>receipt.logs.filter(l=>l.address.toLowerCase()===address.toLowerCase()).flatMap(l=>{try{return [decodeEventLog({abi,...l})];}catch{return [];}});
 let previousStatistics=null,previousScore=null,hash;
 if(!await read('recorded',[id])) {
  previousStatistics=await read('statistics',[agent]);previousScore=await read('score',[agent]);
  const expected=expectedAfterRecord({factor,previousStatistics,previousScore});
  const tx={account,to:address,data:encodeFunctionData({abi,functionName:'record',args:[id]}),value:0n,type:'legacy'};
  const gas=(await client.estimateGas(tx))*125n/100n,gasPrice=await client.getGasPrice();check(gas*gasPrice<500000000000000n,'test gas cap');
  const nonce=await client.getTransactionCount({address:account.address,blockTag:'pending'});
  const wallet=createWalletClient({account,chain:auroraTestnet,transport:http('https://testnet.aurora.dev',{retryCount:0})});
  const raw=await wallet.signTransaction({...tx,gas,gasPrice,nonce});hash=keccak256(raw);
  emit({stage:'prepared',label,hash,nonce,gas,gasPrice});check(JSON.parse((await iterator.next()).value).ack===hash,'missing durable ack');
  check(await client.sendRawTransaction({serializedTransaction:raw})===hash,'hash mismatch');
  const receipt=await client.waitForTransactionReceipt({hash,timeout:120000,pollingInterval:1000});check(receipt.status==='success','record reverted');
  emit({stage:'confirmed',label,hash,blockNumber:receipt.blockNumber});
  checkOutcomeEvent({events:decode(receipt),roundId:id,agent,factor});
  checkRecordedOutcome({expected,statistics:await read('statistics',[agent]),score:await read('score',[agent])});
 } else {
  // Already recorded: verify this journal's own confirmed receipt instead of sending again.
  hash=config.receipts?.[label];check(hash,'Round already recorded outside this journal; verify it from its own receipt');
  const receipt=await client.getTransactionReceipt({hash});check(receipt.status==='success'&&receipt.to?.toLowerCase()===address.toLowerCase(),'recorded receipt mismatch');
  checkOutcomeEvent({events:decode(receipt),roundId:id,agent,factor});
 }
 const point=factor>1000000000000000000n?1n:factor<1000000000000000000n?-1n:0n;
 const score=await read('score',[agent]),statistics=await read('statistics',[agent]);
 emit({stage:'reputationComplete',chainId:1313161555,reputation:address,roundId:id,winner,agent,returnFactor:factor,point,score,statistics,
  ...(previousStatistics?{previousStatistics,previousScore}:{verifiedFrom:'existing-receipt'})});
} catch(error){emit({stage:'failed',reason:error.shortMessage??error.message});process.exitCode=1;}finally{lines.close();}
