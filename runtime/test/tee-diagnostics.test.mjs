import test from 'node:test';
import assert from 'node:assert/strict';
import { responseFailureDetails, createTeeProvider, verifyGpuWithRotation, NVIDIA_JWKS } from '../agents/tee-client.mjs';
import { inspectReport, verifyCompletion } from '../agents/tee.mjs';
import { syntheticTee } from './fixtures/tee-synthetic.mjs';

test('response diagnostics distinguish exact-hash, signature and attestation failures without exposing provider text', async () => {
  const f = await syntheticTee();
  const report = { ...inspectReport(f.report, f.quoteResult, { nonce:f.nonce, allowedMeasurements:f.policy.modelMeasurements }), gpuAttested:true, signingAddress:f.report.signing_address, algorithm:'ecdsa' };
  const cases = [
    [e => { e.signature.signature_kind = 'gateway'; }, 'MODEL_SIGNATURE_REQUIRED'],
    [e => { e.signature.text = e.signature.text.replace(f.model, 'another-model'); }, 'SIGNATURE_TEXT_MODEL_MISMATCH'],
    [e => { e.requestBody += ' '; }, 'SIGNED_REQUEST_HASH_MISMATCH'],
    [e => { e.responseBody += ' '; }, 'SIGNED_RESPONSE_HASH_MISMATCH'],
    [e => { e.signature.signing_address = '0x'+'12'.repeat(20); }, 'INVALID_RESPONSE_SIGNATURE'],
  ];
  for (const [mutate, expected] of cases) {
    const e=structuredClone(f.evidence);mutate(e);
    const privacy=await verifyCompletion({ model:f.model,nonce:f.nonce,requestBody:e.requestBody,responseBody:e.responseBody,signature:e.signature,modelReports:[report] });
    assert.equal(privacy.verified,false);assert.equal(responseFailureDetails(e,privacy).reason,expected);
  }
  const e=structuredClone(f.evidence);e.signature.error_code='synthetic-private-provider-error';e.signature.extra='synthetic-private-provider-error';
  const details=responseFailureDetails(e,{signatureValid:false});
  assert.equal(details.checks.providerError,true);assert.equal(details.evidence.signature.error_code,'REDACTED_PROVIDER_ERROR');
  assert.ok(!JSON.stringify(details).includes('synthetic-private-provider-error'));
  const privacy=await verifyCompletion({model:f.model,nonce:f.nonce,requestBody:e.requestBody,responseBody:e.responseBody,signature:f.evidence.signature,modelReports:[{...report,signingAddress:'0x'+'12'.repeat(20)}]});
  assert.equal(responseFailureDetails({...f.evidence},privacy).reason,'SIGNER_ATTESTATION_MISMATCH');
});

test('the live-provider failure hook retains rejected proof before throwing, with no repeat generation',async()=>{
  const f=await syntheticTee();let saved;let calls=0;let req;
  const provider=createTeeProvider({mode:'near-ai',model:f.model,apiKey:'synthetic-placeholder'}, {
    policy:f.policy,quoteVerifier:f.quoteVerifier,getCollateral:async()=>({}),now:()=>f.at,nonceFactory:()=>f.nonce,maxCalls:1,
    onVerificationFailure:async details=>{saved=details;},
    fetchImpl:async(url,options)=>{
      if(url.includes('/attestation/report'))return Response.json(f.evidence.attestationReport);
      if(url.includes('nras.attestation'))return Response.json([['JWT',f.gpuToken()]]);
      if(url.endsWith('/chat/completions')){calls++;req=options.body;return new Response(f.evidence.responseBody);}
      if(url.includes('/signature/'))return Response.json({...await f.signature(req,f.evidence.responseBody),signature_kind:'gateway'});
      throw Error('unexpected endpoint');
    }
  });
  await assert.rejects(provider.complete({system:'system',context:{}}),/TEE_RESPONSE_REJECTED/);
  assert.equal(saved.reason,'MODEL_SIGNATURE_REQUIRED');assert.equal(saved.evidence.requestBody,req);assert.equal(calls,1);
  assert.ok(!JSON.stringify(saved).includes('synthetic-placeholder'));
});

test('a rotated GPU signing key is identified before any completion and the verdict is retained',async()=>{
  const f=await syntheticTee();let saved;let paid=0;const token=f.gpuToken();
  const policy={...f.policy,nrasKeys:f.policy.nrasKeys.map(k=>({...k,kid:'different-pinned-key'}))};
  const p=createTeeProvider({mode:'near-ai',model:f.model,apiKey:'synthetic-placeholder'}, {
    policy,quoteVerifier:f.quoteVerifier,getCollateral:async()=>({}),now:()=>f.at,nonceFactory:()=>f.nonce,
    onVerificationFailure:async d=>{saved=d;},
    fetchImpl:async url=>{
      if(url.includes('/attestation/report'))return Response.json(f.evidence.attestationReport);
      if(url.includes('nras.attestation'))return Response.json([['JWT',token]]);
      paid++;throw Error('paid request must not be reached');
    }
  });
  await assert.rejects(p.complete({system:'test',context:{}}),/TEE_GPU_REJECTED/);
  assert.equal(saved.reason,'GPU_SIGNING_KEY_NOT_PINNED');assert.equal(saved.checks.policyHasKey,false);
  assert.equal(saved.evidence.token,token);assert.equal(paid,0);
});

test('optional official-key rotation verifies the verdict and persists before pinning; invalid evidence never adds trust',async()=>{
  const f=await syntheticTee();const token=f.gpuToken();const freshKey=f.policy.nrasKeys[0];
  const policy=()=>({...f.policy,nrasKeys:f.policy.nrasKeys.map(k=>({...k,kid:'previous-key'})),allowOfficialNvidiaRotation:true});
  const p=policy();let persisted=0;
  assert.equal(await verifyGpuWithRotation(token,f.nonce,p,{at:f.at,fetchKeys:async()=>({keys:[freshKey]}),onRotation:async update=>{
    assert.equal(p.nrasKeys.length,1,'must not mutate policy before durable parent acknowledgement');
    assert.equal(update.source,NVIDIA_JWKS);assert.deepEqual(update.key,Object.fromEntries(['kty','crv','kid','x','y'].map(k=>[k,freshKey[k]])));persisted++;
  }}),true);
  assert.equal(p.nrasKeys.length,2);assert.equal(persisted,1);
  for(const mutate of [p=>{p.allowOfficialNvidiaRotation=false;},p=>{p.nrasKeys=[{...freshKey,x:'A'.repeat(64)}];}]){
    const bad=policy();mutate(bad);let fetches=0;
    assert.equal(await verifyGpuWithRotation(token,f.nonce,bad,{at:f.at,fetchKeys:async()=>{fetches++;return{keys:[freshKey]};},onRotation:async()=>{throw Error('must not persist');}}),false);
    assert.equal(fetches,0);
  }
  for(const keys of [[],[freshKey,freshKey],[{...freshKey,d:''}],[{...freshKey,x:'A'.repeat(64)}]]){
    const bad=policy();assert.equal(await verifyGpuWithRotation(token,f.nonce,bad,{at:f.at,fetchKeys:async()=>({keys}),onRotation:async()=>{throw Error('must not persist');}}),false);assert.equal(bad.nrasKeys.length,1);
  }
  const bad=policy();assert.equal(await verifyGpuWithRotation(f.gpuToken({'x-nvidia-overall-att-result':false}),f.nonce,bad,{at:f.at,fetchKeys:async()=>({keys:[freshKey]}),onRotation:async()=>{throw Error('must not persist');}}),false);
  await assert.rejects(verifyGpuWithRotation(token,f.nonce,policy(),{at:f.at,fetchKeys:async()=>({keys:[freshKey]}),onRotation:async()=>{throw Error('synthetic persistence failed');}}),/synthetic persistence failed/);
});

test('unattested inference failures expose only fixed diagnostic codes and never provider text',async()=>{
  const {createProvider}=await import('../agents/provider.mjs');
  for(const [response,code] of [
    [new Response('synthetic-private-text'),'INVALID_RESPONSE_JSON'],
    [Response.json({choices:[{finish_reason:'length',message:{content:'synthetic-private-text'}}]}),'INCOMPLETE_LENGTH'],
    [Response.json({choices:[{finish_reason:'stop',message:{content:'synthetic-private-text'}}]}),'INVALID_CONTENT_JSON'],
  ]){
    let calls=0;const p=createProvider({mode:'near-ai',model:'synthetic-model',apiKey:'synthetic-key'},{maxCalls:1,fetchImpl:async()=>{calls++;return response;}});
    await assert.rejects(p.complete({system:'test',context:{}}),new RegExp(`Inference failed: ${code};`));assert.equal(calls,1);
  }
});
