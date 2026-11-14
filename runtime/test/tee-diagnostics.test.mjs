import test from 'node:test';
import assert from 'node:assert/strict';
import { responseFailureDetails, createTeeProvider } from '../agents/tee-client.mjs';
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
