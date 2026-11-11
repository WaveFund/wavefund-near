import test from 'node:test';
import assert from 'node:assert/strict';
import {tidepoolRequest,fetchTidepoolQuote,TIDEPOOL} from '../tidepool/client.mjs';
const address='0x'+'11'.repeat(20);
test('Tidepool route is explicitly testnet and uses direct Safe recipient',()=>{
 const r=tidepoolRequest({safe:address,refund:address,now:1000});
 assert.equal(TIDEPOOL.sourceChainId,421614);assert.equal(TIDEPOOL.destinationChainId,1313161555);
 assert.equal(r.originAsset,TIDEPOOL.originAsset);assert.equal(r.destinationAsset,TIDEPOOL.destinationAsset);
 assert.equal(r.recipient,address);assert.equal(r.virtualChainRecipient,undefined);assert.equal(r.dry,true);
 assert.throws(()=>tidepoolRequest({safe:address,refund:address,amount:'200000001',now:1000}),/TIDEPOOL_AMOUNT/);
});
test('execution quotes remain opt-in and send no request by default',async()=>{
 let calls=0;const r=tidepoolRequest({safe:address,refund:address,dry:false,now:1000});
 await assert.rejects(fetchTidepoolQuote(r,{fetchImpl:async()=>{calls++;},now:1000}),/TIDEPOOL_EXECUTION_DISABLED/);assert.equal(calls,0);
});

import { readFileSync } from 'node:fs';
import { validateTidepoolQuote } from '../tidepool/client.mjs';
const capture=JSON.parse(readFileSync(new URL('../test/fixtures/tidepool/dry-new-safe.json',import.meta.url)));
const issued=Math.ceil(Date.parse(capture.response.timestamp)/1000);
test('captured live Tidepool quote re-verifies and changed Safe or signed amount fails',()=>{
 const response=structuredClone(capture.response),request=structuredClone(response.quoteRequest);
 assert.equal(validateTidepoolQuote(response,request,{now:issued}).signatureVerified,true);
 response.quote.minAmountOut='1';assert.throws(()=>validateTidepoolQuote(response,request,{now:issued}),/TIDEPOOL_SIGNATURE/);
 const changed={...request,recipient:'0x'+'22'.repeat(20)};
 assert.throws(()=>validateTidepoolQuote(capture.response,changed,{now:issued}),/TIDEPOOL_REQUEST_CHANGED/);
 assert.throws(()=>validateTidepoolQuote(capture.response,request,{now:issued+1000}),/TIDEPOOL_EXPIRED/);
});

import {tidepoolGasBudget} from '../tidepool/client.mjs';
test('testnet source fee buffer covers a moving base fee and stays capped',()=>{
 const budget=tidepoolGasBudget({estimatedGas:52000n,quotedGasPrice:20052000n,balance:10000000000000000n});
 assert.equal(budget.gas,65000n);assert.equal(budget.gasPrice,40104000n);assert.ok(budget.gasPrice>20058000n);
 assert.throws(()=>tidepoolGasBudget({estimatedGas:1000000n,quotedGasPrice:1000000000n,balance:10000000000000000n}),/TIDEPOOL_GAS_CAP/);
});

import {tidepoolDeliveryHash} from '../tidepool/delivery.mjs';
test('NEAR settlement hash is not mistaken for the Aurora payout hash',()=>{
 const hash='0x'+'ab'.repeat(32);
 assert.equal(tidepoolDeliveryHash({swapDetails:{destinationChainTxHashes:[{hash:'NEARbase58hash'},{hash}]}}),hash);
 assert.throws(()=>tidepoolDeliveryHash({swapDetails:{destinationChainTxHashes:[{hash},{hash:'0x'+'cd'.repeat(32)}]}}),/TIDEPOOL_AMBIGUOUS/);
});

import {verifyTidepoolDelivery} from '../tidepool/delivery.mjs';
import {encodeEventTopics,encodeAbiParameters,parseAbi,parseAbiParameters} from 'viem';
const delivered=JSON.parse(readFileSync(new URL('../test/fixtures/tidepool/delivered.json',import.meta.url)));
function deliveryFixture(){
 const response=structuredClone(delivered.status.quoteResponse),request=response.quoteRequest;
 const transfer=(from,to,value)=>({address:TIDEPOOL.token,topics:encodeEventTopics({abi:parseAbi(['event Transfer(address indexed from,address indexed to,uint256 value)']),eventName:'Transfer',args:{from,to}}),data:encodeAbiParameters(parseAbiParameters('uint256'),[value])});
 const sourceReceipt={status:'success',transactionHash:delivered.source.transactionHash,blockNumber:1n,blockHash:'0x'+'11'.repeat(32),logs:[transfer(request.refundTo,response.quote.depositAddress,200000000n)]};
 const destinationReceipt={status:'success',transactionHash:delivered.destination.transactionHash,blockNumber:2n,blockHash:'0x'+'22'.repeat(32),logs:[transfer('0x'+'33'.repeat(20),request.recipient,199480000n)]};
 return {response,status:structuredClone(delivered.status),sourceReceipt,destinationReceipt,sourceChainId:421614,destinationChainId:1313161555,sourceCanonicalHash:sourceReceipt.blockHash,destinationCanonicalHash:destinationReceipt.blockHash,sourceBlockTimestamp:Math.ceil(Date.parse(response.timestamp)/1000)};
}
test('delivery needs exact source value and correct token/Safe receipts, not provider success alone',()=>{
 const f=deliveryFixture();assert.equal(verifyTidepoolDelivery(f).deliveryProven,true);
 f.sourceReceipt.logs[0].data=encodeAbiParameters(parseAbiParameters('uint256'),[199999999n]);
 assert.throws(()=>verifyTidepoolDelivery(f),/TIDEPOOL_SOURCE_AMOUNT/);
 const g=deliveryFixture();g.destinationReceipt.logs[0].address='0x'+'44'.repeat(20);
 assert.throws(()=>verifyTidepoolDelivery(g),/TIDEPOOL_DELIVERY_AMOUNT/);
 const h=deliveryFixture();h.sourceChainId=42161;assert.throws(()=>verifyTidepoolDelivery(h),/TIDEPOOL_PROOF_NETWORK/);
});
test('delivery rejects reverted, unlinked and noncanonical receipts',()=>{
 const f=deliveryFixture();f.destinationReceipt.status='reverted';assert.throws(()=>verifyTidepoolDelivery(f),/TIDEPOOL_RECEIPT/);
 const g=deliveryFixture();g.status.swapDetails.destinationChainTxHashes=[];assert.throws(()=>verifyTidepoolDelivery(g),/TIDEPOOL_LINKAGE/);
 const h=deliveryFixture();h.destinationCanonicalHash='0x'+'55'.repeat(32);assert.throws(()=>verifyTidepoolDelivery(h),/TIDEPOOL_RECEIPT/);
});
