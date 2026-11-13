// Public, read-only verification. No wallet/model key, inference, executable quote or signing.
import {readFile} from 'node:fs/promises';
import {createPublicClient,http,parseAbi,decodeEventLog} from 'viem';
import {createReputationReader} from '../runtime/agents/reputation-readonly.mjs';
import {tidepoolRequest,fetchTidepoolQuote} from '../runtime/tidepool/client.mjs';
import {createIntentsClient} from '../runtime/intents/index.mjs';
import {fundingDemoPreviewInput,FUNDING_DEMO_LIMITS} from '../runtime/funding/demo-plan.mjs';
import {readTidepoolFundingProof} from '../runtime/tidepool/read-model.mjs';
import {readdir} from 'node:fs/promises';
import {verifyTeeProposals} from '../runtime/agents/tee-proof.mjs';
import {runSuite,buildAttacks} from './attack-suite.mjs';
import {ATTACK_ABIS,verifySavedRound,verifyOutsideWallet,fetchNearTx,checkNearSettlement,statusOf} from './lib/judge-checks.mjs';
const load=async p=>JSON.parse(await readFile(new URL('../'+p,import.meta.url),'utf8'));
const result={schemaVersion:1,mode:'public-read-only',paidInference:false,fundsMoved:false,checks:[]};
// passed | failed (public data contradicts the claim) | amber (network unavailable, not a failed claim) | unavailable
async function check(name,fn,required=true){try{result.checks.push({name,required,status:'passed',...await fn()});}catch(error){
 const status=statusOf(error);
 result.checks.push({name,required,status,code:error.code??'PUBLIC_READ_UNAVAILABLE',...(status==='amber'?{note:'network unavailable, not a failed claim'}:{}),...(status==='failed'?{reason:error.message}:{})});
 if(required&&status!=='amber')process.exitCode=1;}}
const aurora=()=>createPublicClient({transport:http('https://testnet.aurora.dev',{retryCount:2,timeout:20000})});
const ROUNDS_DIR='docs/test-evidence/tidepool-rounds';
await check('live-aurora-outcome-reputation',async()=>{
 const manifest=await load('deployments/aurora-testnet-reputation.json');
 const client=createPublicClient({transport:http('https://testnet.aurora.dev',{retryCount:0,timeout:15000})});
 return {observation:await createReputationReader({client,manifest}).read('0x8B6aF0B1738b941c0C7dd4deeC6fabEe3447888F')};
});
await check('live-tidepool-outcome-reputation',async()=>{
 const manifest=await load('deployments/aurora-testnet-tidepool-reputation.json');
 const client=createPublicClient({transport:http('https://testnet.aurora.dev',{retryCount:0,timeout:15000})});
 return {observation:await createReputationReader({client,manifest}).read('0x8B6aF0B1738b941c0C7dd4deeC6fabEe3447888F')};
});
await check('tidepool-signed-dry-quote',async()=>{
 const manifest=await load('deployments/aurora-testnet-tidepool.json');
 const request=tidepoolRequest({safe:manifest.contracts.safe,refund:'0x1903bDDF6F73eE4aA8F66D170E7590D28CD3f8B9'});
 const verified=await fetchTidepoolQuote(request);
 return {provider:'Tidepool community testnet, not official production 1Click',signatureVerified:verified.signatureVerified,
   safe:request.recipient,amountIn:request.amount,minAmountOut:verified.response.quote.minAmountOut,expiresAt:verified.expiresAt,
   deliveryProven:false,note:'A dry quote proves quoting, not funding or strategy execution.'};
});
if(process.argv.includes('--include-mainnet-quote')) await check('official-1click-signed-dry-quote',async()=>{
 const manifest=await load('deployments/aurora-mainnet-funding-safe.json');const now=Math.floor(Date.now()/1000);
 const request=fundingDemoPreviewInput({manifest,fundingId:`judge-${now}`,expiresAt:now+FUNDING_DEMO_LIMITS.maxQuoteSeconds,now});
 const quote=await createIntentsClient().previewOrder(request);
 return {provider:'official production 1Click',dry:true,signatureVerified:quote.signature?.verified===true,
   amountIn:quote.amounts.amountIn,minAmountOut:quote.amounts.minAmountOut,deliveryProven:false,
   note:'Mainnet dry quote only. No mainnet execution or same-network testnet funding is claimed.'};
},false);
await check('live-tidepool-delivery-receipts',async()=>{
 const saved=await load('docs/test-evidence/tidepool-v1/funding-proof.json');
 const manifest=await load('deployments/aurora-testnet-tidepool.json');
 if(saved.destination.safe.toLowerCase()!==manifest.contracts.safe.toLowerCase())throw Error('Safe mismatch');
 const proof=await readTidepoolFundingProof({response:saved.status.quoteResponse,sourceHash:saved.source.transactionHash});
 return {provider:'Tidepool community testnet',deliveryProven:proof.deliveryProven,source:proof.source,destination:proof.destination};
});
await check('live-near-testnet-execute-intents',async()=>{
 const saved=await load('docs/test-evidence/tidepool-v1/near-settlement.json');
 const {rpc,result,attempts}=await fetchNearTx({hash:saved.transaction.hash,signer:saved.transaction.signer_id});
 return {...checkNearSettlement(result),rpc,attempts};
});
await check('live-tidepool-strategy-and-redemptions',async()=>{
 const manifest=await load('deployments/aurora-testnet-tidepool.json');
 const report=await load('docs/test-evidence/tidepool-v1/happy-path.json');const id=BigInt(report.completion.roundId);
 const c=createPublicClient({transport:http('https://testnet.aurora.dev',{retryCount:0,timeout:15000})});
 if(await c.getChainId()!==1313161555)throw Error('Wrong chain');
 const abi=parseAbi(['function roundStatus(uint256) view returns(uint8)','function roundExecuted(uint256) view returns(bool)',
  'function winningAllocation(uint256) view returns(uint256,uint16)','function liabilitiesClear(uint256) view returns(bool)',
  'function redeemed(uint256,address) view returns(bool)']);
 const read=(functionName,args=[id])=>c.readContract({address:manifest.contracts.engine,abi,functionName,args});
 const [status,executed,winner,clear]=await Promise.all(['roundStatus','roundExecuted','winningAllocation','liabilitiesClear'].map(x=>read(x)));
 if(status!==3||executed!==true||clear!==true||winner[0]!==BigInt(report.completion.winner))throw Error('Round not settled');
 const tx=report.confirmedTransactions.find(x=>x.label===`round${id}:execute`);const receipt=await c.getTransactionReceipt({hash:tx.hash});
 const swapAbi=parseAbi(['event Swap(address indexed sender,uint256 amount0In,uint256 amount1In,uint256 amount0Out,uint256 amount1Out,address indexed to)']);
 const events=receipt.logs.filter(x=>x.address.toLowerCase()===manifest.integrations.investmentPair.toLowerCase()).flatMap(x=>{try{return[decodeEventLog({abi:swapAbi,...x})];}catch{return[];}});
 if(receipt.status!=='success'||events.length!==1||events[0].args.to.toLowerCase()!==manifest.contracts.safe.toLowerCase())throw Error('No Safe swap');
 const redeemers=await Promise.all(report.completion.payouts.map(x=>read('redeemed',[id,x.address])));
 if(!redeemers.every(Boolean))throw Error('Redemptions incomplete');
 return {network:'Aurora testnet',engine:manifest.contracts.engine,roundId:String(id),winner:String(winner[0]),allocationBps:winner[1],
   investmentSwapTransaction:tx.hash,pair:manifest.integrations.investmentPair,redeemedForecasters:redeemers.length,
   proposers:'four genuine NEAR AI calls',forecasters:'four scripted test actors',scope:'Test assets, not predictive alpha'};
});
await check('tidepool-rounds-independently-verified',async()=>{
 const manifest=await load('deployments/aurora-testnet-tidepool.json');const c=aurora();
 const rounds=(await readdir(new URL('../'+ROUNDS_DIR,import.meta.url))).map(d=>/^round([0-9]+)$/.exec(d)?.[1]).filter(Boolean).map(Number).sort((a,b)=>a-b);
 const verified=[];
 for(const n of rounds){
  const [independent,report]=await Promise.all([load(`${ROUNDS_DIR}/round${n}/independent.json`),load(`${ROUNDS_DIR}/round${n}/report.json`)]);
  verified.push(await verifySavedRound({client:c,engine:manifest.contracts.engine,chainId:manifest.chainId,independent,report}));
 }
 return {source:'saved independent.json re-checked against public Aurora testnet receipts and engine state',engine:manifest.contracts.engine,
   rounds:verified,notIncluded:'round 1 (checked above), round 4 (failed and cancelled with refunds; disclosed in SCHEDULE.md)'};
});
await check('round9-tee-proofs-offline',async()=>{
 const [plan,proof,policy]=await Promise.all([load(`${ROUNDS_DIR}/round9/plan.json`),load(`${ROUNDS_DIR}/round9/tee.json`),load('docs/tee-policy.json')]);
 const proposals=await verifyTeeProposals(plan,proof.receipts,policy);
 return {round:'9',policy:'docs/tee-policy.json',verifiedProposals:proposals.length,same:'node scripts/verify-tee.mjs 9 --policy docs/tee-policy.json',
   note:'Offline recheck of captured attestations and on-chain bindings; not a fresh attestation.'};
});
await check('round9-outside-wallet-receipts',async()=>{
 const manifest=await load('deployments/aurora-testnet-tidepool.json');
 const [outside,report,independent]=await Promise.all(['outside-wallet','report','independent'].map(f=>load(`${ROUNDS_DIR}/round9/${f}.json`)));
 return verifyOutsideWallet({client:aurora(),engine:manifest.contracts.engine,stable:manifest.contracts.stable,outside,report,independent});
});
await check('live-attack-suite',async()=>{
 const manifest=await load('deployments/aurora-testnet-tidepool.json');const c=aurora();
 if(await c.getChainId()!==manifest.chainId)throw Error('Wrong chain');
 const block=await c.getBlockNumber();
 const results=await runSuite({client:c,manifest,abis:ATTACK_ABIS,block,attacks:buildAttacks(manifest.contracts)});
 const blocked=results.filter(r=>r.pass).length;
 if(blocked!==results.length){const e=Error(`${results.length-blocked} attack(s) not blocked with the expected error`);e.code='CLAIM_MISMATCH';throw e;}
 return {method:'eth_call at one pinned block; no keys, no transactions',blockNumber:String(block),blocked:`${blocked}/${results.length}`,
   attacks:results.map(r=>({name:r.name,expectedError:r.expectedError,observedError:r.observedError}))};
});
result.summary=Object.fromEntries(['passed','failed','amber','unavailable'].map(k=>[k,result.checks.filter(c=>c.status===k).length]));
console.log(JSON.stringify(result,null,2));
