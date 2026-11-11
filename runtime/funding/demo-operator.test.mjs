import test from 'node:test';
import assert from 'node:assert/strict';
import { privateKeyToAccount } from 'viem/accounts';
import { keccak256 } from 'viem';
import { createFundingDemoOperator } from './demo-operator.mjs';
import { fundingDemoRequest } from './demo-plan.mjs';
import { fundingHash } from './schema.mjs';
const account = privateKeyToAccount('0x' + '11'.repeat(32)); // Public deterministic unit-test identity only.
const addr = n => '0x' + String(n).padStart(40,'0');
function fixture() {
  let state = { schemaVersion: 1, records: {} }; let broadcasts=0; let signs=0;
  const store = { read: () => structuredClone(state), transaction(fn) { const copy=structuredClone(state); const result=fn(copy); state=copy; return structuredClone(result); } };
  const manifest={purpose:'mainnet-funding-proof-only',chainId:1313161554,wavefundModuleEnabled:false,manager:account.address,safe:addr(2),refundRecipient:account.address};
  const request=fundingDemoRequest({manifest,fundingId:'test-1',expiresAt:1200,now:1000});
  const quote={requestHash:fundingHash(request),reference:'quote-1',depositAddress:addr(3),amountIn:'1000000',minAmountOut:'989800',expiresAt:1190,evidenceQuality:'live-verified'};
  const input={manifest,request,providerQuote:{},verifyQuote:async()=>quote,sourceState:{chainId:42161,manager:account.address,token:request.source.token,balanceUSDC:'1000000',balanceETH:'10000000000000',nonce:0,gasLimit:'100000',gasPrice:'20000000',observedAt:1000}};
  const capabilities={store,preparation:async()=>input,clock:()=>1000,simulate:async()=>true,
    sign:async tx=>{signs++; return account.signTransaction({...tx,value:BigInt(tx.value),gas:BigInt(tx.gas),gasPrice:BigInt(tx.gasPrice)});},
    broadcast:async raw=>{broadcasts++; const r=Object.values(store.read().records)[0]; assert.equal(r.state,'prepared');assert.equal(r.transactionHash,keccak256(raw));assert.equal(r.rawTransaction,raw);return keccak256(raw);} };
  return {store,input,capabilities,counts:()=>({broadcasts,signs})};
}
test('one exact approved funding send persists signed hash before broadcast and never means delivery',async()=>{
 const f=fixture();const op=createFundingDemoOperator(f.capabilities);const p=await op.preview();
 assert.equal(Object.keys(f.store.read().records).length,0);
 const result=await op.execute({approvedPlanHash:p.planHash});assert.equal(result.state,'submitted');assert.equal(result.deliveryProven,false);assert.equal(result.productionRoundReady,false);
 await assert.rejects(op.execute({approvedPlanHash:p.planHash}),{code:'DEMO_ATTEMPT_EXISTS'});assert.equal(f.counts().broadcasts,1);
});
test('changed approval and failed simulation cannot sign or broadcast',async()=>{
 const f=fixture();let op=createFundingDemoOperator(f.capabilities);
 await assert.rejects(op.execute({approvedPlanHash:'wrong'}),{code:'DEMO_APPROVAL_CHANGED'});assert.equal(Object.keys(f.store.read().records).length,0);
 f.capabilities.simulate=async()=>false;op=createFundingDemoOperator(f.capabilities);const p=await op.preview();
 await assert.rejects(op.execute({approvedPlanHash:p.planHash}),{code:'DEMO_SIMULATION_FAILED'});assert.deepEqual(f.counts(),{broadcasts:0,signs:0});
});
test('unknown broadcast remains durable and blocks another send',async()=>{
 const f=fixture();f.capabilities.broadcast=async()=>{throw new Error('network lost');};const op=createFundingDemoOperator(f.capabilities);const p=await op.preview();
 await assert.rejects(op.execute({approvedPlanHash:p.planHash}),/network lost/);
 const record=Object.values(f.store.read().records)[0];assert.equal(record.state,'needs_review');assert.ok(record.transactionHash);assert.ok(record.rawTransaction);
 await assert.rejects(op.execute({approvedPlanHash:p.planHash}),{code:'DEMO_ATTEMPT_EXISTS'});assert.equal(f.counts().signs,1);
});
test('signer cannot substitute recipient or amount',async()=>{
 const f=fixture();const original=f.capabilities.sign;f.capabilities.sign=tx=>original({...tx,to:addr(9)});
 const op=createFundingDemoOperator(f.capabilities);const p=await op.preview();
 await assert.rejects(op.execute({approvedPlanHash:p.planHash}),{code:'DEMO_SIGNED_TRANSACTION_CHANGED'});assert.equal(f.counts().broadcasts,0);
});
