import { isAddress } from 'viem';
import { createQuoteSignatureVerifier, stableStringify } from '../intents/signature.mjs';
export const TIDEPOOL = Object.freeze({ baseUrl: 'https://www.usetidepool.tech',
  publicKey: 'ed25519:U1Mu4u1nHnHmgABpCkfDGXt2FZj8k29UGqhkMAu4iWY', sourceChainId: 421614, destinationChainId: 1313161555,
  token: '0x38d81431b9f76d9699af7517040d5221d9dea252',
  originAsset: 'nep141:arb-0x38d81431b9f76d9699af7517040d5221d9dea252.tp-omft.testnet',
  destinationAsset: 'nep141:aur-0x38d81431b9f76d9699af7517040d5221d9dea252.tp-omft.testnet' });
const verify = createQuoteSignatureVerifier({ publicKey: TIDEPOOL.publicKey });
const check = (v, message) => { if (!v) throw Error(message); };
export function tidepoolRequest({ safe, refund, amount = '200000000', dry = true, now = Math.floor(Date.now()/1000) }) {
  check(isAddress(safe ?? '') && isAddress(refund ?? '') && !/^0x0{40}$/i.test(safe) && !/^0x0{40}$/i.test(refund), 'TIDEPOOL_ADDRESS');
  check(typeof dry === 'boolean' && /^(0|[1-9][0-9]*)$/.test(amount) && BigInt(amount)>0n && BigInt(amount)<=200000000n, 'TIDEPOOL_AMOUNT');
  check(Number.isSafeInteger(now) && now>0, 'TIDEPOOL_TIME');
  return { dry, swapType:'EXACT_INPUT',slippageTolerance:100,originAsset:TIDEPOOL.originAsset,depositType:'ORIGIN_CHAIN',
    destinationAsset:TIDEPOOL.destinationAsset,amount,recipient:safe,recipientType:'DESTINATION_CHAIN',refundTo:refund,refundType:'ORIGIN_CHAIN',
    deadline:new Date((now+600)*1000).toISOString() };
}
export function validateTidepoolQuote(response, request, { now=Math.floor(Date.now()/1000) }={}) {
  check(stableStringify(response?.quoteRequest)===stableStringify(request),'TIDEPOOL_REQUEST_CHANGED');
  check(verify(response).valid,'TIDEPOOL_SIGNATURE');
  check(request.originAsset===TIDEPOOL.originAsset && request.destinationAsset===TIDEPOOL.destinationAsset
    && request.depositType==='ORIGIN_CHAIN' && request.recipientType==='DESTINATION_CHAIN'
    && request.refundType==='ORIGIN_CHAIN' && request.slippageTolerance===100 && request.swapType==='EXACT_INPUT'
    && request.virtualChainRecipient===undefined, 'TIDEPOOL_ROUTE');
  const generated=Date.parse(response.timestamp)/1000, expires=Date.parse(request.deadline)/1000;
  check(Number.isFinite(generated)&&generated<=now+30&&now-generated<=300&&expires>now&&expires<=now+86400,'TIDEPOOL_EXPIRED');
  const q=response.quote;const integer=x=>typeof x==='string'&&/^[0-9]+$/.test(x);
  check(integer(q.amountIn)&&q.amountIn===request.amount&&integer(q.amountOut)&&integer(q.minAmountOut)
    && BigInt(q.minAmountOut)>0n&&BigInt(q.amountOut)>=BigInt(q.minAmountOut)
    && BigInt(q.minAmountOut)>=BigInt(request.amount)*98n/100n,'TIDEPOOL_QUOTE_AMOUNT');
  if (!request.dry) check(isAddress(q.depositAddress??'')&&!/^0x0{40}$/i.test(q.depositAddress)
    && Date.parse(q.deadline)>now*1000&&Date.parse(q.deadline)<=Date.parse(request.deadline),'TIDEPOOL_DEPOSIT');
  return { response, signatureVerified:true, testnetOnly:true, official1Click:false, expiresAt:Math.min(expires,request.dry?expires:Date.parse(q.deadline)/1000) };
}
export async function fetchTidepoolQuote(request, { fetchImpl=fetch, allowExecution=false, now=Math.floor(Date.now()/1000) }={}) {
  check(request.dry===true||allowExecution===true,'TIDEPOOL_EXECUTION_DISABLED');
  const r=await fetchImpl(TIDEPOOL.baseUrl+'/v0/quote',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(request),redirect:'error',signal:AbortSignal.timeout(20000)});
  check(r.ok,'TIDEPOOL_UNAVAILABLE');const text=await r.text();check(text.length<=1000000,'TIDEPOOL_RESPONSE_SIZE');
  return validateTidepoolQuote(JSON.parse(text),request,{now});
}

export function tidepoolGasBudget({ estimatedGas, quotedGasPrice, balance }) {
  check([estimatedGas,quotedGasPrice,balance].every(x=>typeof x==='bigint'&&x>0n),'TIDEPOOL_GAS_INPUT');
  const gas=estimatedGas*125n/100n,gasPrice=quotedGasPrice*2n;
  check(gas*gasPrice<=1000000000000000n&&gas*gasPrice<=balance,'TIDEPOOL_GAS_CAP');
  return {gas,gasPrice};
}
