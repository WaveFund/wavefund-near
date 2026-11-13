// Synthetic cryptographic fixture. This is not hardware attestation and must never be published as a live result.
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { replayRtmr3, sha256 } from '../../agents/tee.mjs';

export async function syntheticTee() {
  const account = privateKeyToAccount(generatePrivateKey());
  const model = 'Qwen/Qwen3.6-35B-A3B-FP8'; const nonce = '17'.repeat(32); const at = 1794500000;
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'secp384r1' });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'synthetic-only', alg: 'ES384' };
  const compose = '{"services":{"test":"synthetic-not-hardware"}}';
  const config = Buffer.concat([Buffer.from([1]), createHash('sha256').update(compose).digest(), Buffer.alloc(15)]);
  const td = { tdAttributes: Buffer.alloc(8), reportData: Buffer.concat([Buffer.from(account.address.slice(2), 'hex'), Buffer.alloc(12), Buffer.from(nonce, 'hex')]), mrConfigId: config, mrTd: Buffer.alloc(48, 1), rtMr3: replayRtmr3([]) };
  const quoteResult = { status: 'UpToDate', report: { asTd10: () => td } };
  const quoteVerifier = async () => quoteResult;
  const report = { model_name: model, signing_address: account.address, signing_algo: 'ecdsa', request_nonce: nonce, intel_quote: '0102', event_log: [], info: { tcb_info: { app_compose: compose } }, nvidia_payload: JSON.stringify({ nonce, evidence_list: [] }) };
  const measurement = `${td.mrTd.toString('hex')}:${config.toString('hex')}`;
  const policy = { schemaVersion: 1, gatewayMeasurements: [measurement], modelMeasurements: [measurement], nrasKeys: [jwk] };
  function gpuToken(overrides = {}) {
    const enc = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const head = enc({ alg: 'ES384', kid: jwk.kid }); const body = enc({ iss: 'https://nras.attestation.nvidia.com', sub: 'NVIDIA-PLATFORM-ATTESTATION', eat_nonce: nonce, iat: at - 5, exp: at + 100, 'x-nvidia-overall-att-result': true, ...overrides });
    const text = `${head}.${body}`; return `${text}.${sign('sha384', Buffer.from(text), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
  }
  const requestBody = JSON.stringify({ model, messages: [{ role: 'system', content: 'system' }, { role: 'user', content: '{}' }] });
  const responseBody = JSON.stringify({ id: 'chat-test', choices: [{ finish_reason: 'stop', message: { content: '{"allocationBps":4500}' } }] });
  async function signature(req = requestBody, resp = responseBody) {
    const text = `${model}:${sha256(Buffer.from(req))}:${sha256(Buffer.from(resp))}`;
    return { text, signature: await account.signMessage({ message: text }), signing_address: account.address, signing_algo: 'ecdsa', signature_kind: 'provider_tee' };
  }
  const evidence = { schemaVersion: 1, nonce, preflightTime: at - 1, verificationTime: at, requestBody, responseBody, signature: await signature(), attestationReport: { gateway_attestation: structuredClone(report), model_attestations: [structuredClone(report)] }, collateral: [{}, {}], gpuTokens: [gpuToken()] };
  return { model, nonce, at, td, quoteResult, quoteVerifier, report, policy, gpuToken, signature, evidence };
}
