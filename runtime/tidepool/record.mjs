// Explicit permissionless testnet outcome recording; no fund movement.
import readline from 'node:readline';
import {createPublicClient,createWalletClient,http,parseAbi,encodeFunctionData,keccak256} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {auroraTestnet} from 'viem/chains';
const lines=readline.createInterface({input:process.stdin,crlfDelay:Infinity}),iterator=lines[Symbol.asyncIterator]();
const config=JSON.parse((await iterator.next()).value),account=privateKeyToAccount(config.privateKey);delete config.privateKey;
const emit=x=>console.log(JSON.stringify(x,(_,v)=>typeof v==='bigint'?String(v):v));const check=(v,m)=>{if(!v)throw Error(m);};
try {
 const manifest=config.manifest;check(manifest.chainId===1313161555,'testnet only');
 const client=createPublicClient({chain:auroraTestnet,transport:http('https://testnet.aurora.dev',{retryCount:0,timeout:20000})});
 check(await client.getChainId()===1313161555,'wrong chain');
 check(account.address.toLowerCase()==='0x1903bddf6f73ee4aa8f66d170e7590d28cd3f8b9','wrong test signer');
 const address=manifest.contracts.reputation,abi=config.artifacts.AgentReputation.abi,id=1n;
 const read=(functionName,args=[])=>client.readContract({address,abi,functionName,args});
 check((await read('engine')).toLowerCase()===manifest.contracts.engine.toLowerCase()&&(await read('tracker')).toLowerCase()===manifest.contracts.tracker.toLowerCase(),'wrong bindings');
 if(!await read('recorded',[id])) {
  const tx={account,to:address,data:encodeFunctionData({abi,functionName:'record',args:[id]}),value:0n,type:'legacy'};
  const gas=(await client.estimateGas(tx))*125n/100n,gasPrice=await client.getGasPrice();check(gas*gasPrice<500000000000000n,'test gas cap');
  const nonce=await client.getTransactionCount({address:account.address,blockTag:'pending'});
  const wallet=createWalletClient({account,chain:auroraTestnet,transport:http('https://testnet.aurora.dev',{retryCount:0})});
  const raw=await wallet.signTransaction({...tx,gas,gasPrice,nonce}),hash=keccak256(raw);
  emit({stage:'prepared',label:'reputation:round1',hash,nonce,gas,gasPrice});check(JSON.parse((await iterator.next()).value).ack===hash,'missing durable ack');
  check(await client.sendRawTransaction({serializedTransaction:raw})===hash,'hash mismatch');
  const receipt=await client.waitForTransactionReceipt({hash,timeout:120000,pollingInterval:1000});check(receipt.status==='success','record reverted');
  emit({stage:'confirmed',label:'reputation:round1',hash,blockNumber:receipt.blockNumber});
 }
 const engineAbi=parseAbi(['function winningAllocation(uint256) view returns(uint256,uint16)','function proposals(uint256,uint256) view returns(address,uint16,bool,uint256,uint256,uint256,string)']);
 const [winner]=await client.readContract({address:manifest.contracts.engine,abi:engineAbi,functionName:'winningAllocation',args:[id]});
 const [agent]=await client.readContract({address:manifest.contracts.engine,abi:engineAbi,functionName:'proposals',args:[id,winner]});
 const portfolio=await client.readContract({address:manifest.contracts.tracker,abi:config.artifacts.PerformanceTracker.abi,functionName:'portfolios',args:[id]});
 const expected=portfolio[6]>1000000000000000000n?1n:portfolio[6]<1000000000000000000n?-1n:0n;
 const score=await read('score',[agent]),statistics=await read('statistics',[agent]);check(score===expected&&statistics[0]===1n,'unexpected first outcome');
 emit({stage:'reputationComplete',chainId:1313161555,reputation:address,roundId:id,winner,agent,returnFactor:portfolio[6],score,statistics});
} catch(error){emit({stage:'failed',reason:error.shortMessage??error.message});process.exitCode=1;}finally{lines.close();}
