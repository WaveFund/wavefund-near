// Public-data-only dry quote. No keys, executable quote, signing, or broadcasting.
import { readFile } from 'node:fs/promises';
import { createIntentsClient } from '../runtime/intents/index.mjs';
import { fundingDemoPreviewInput, FUNDING_DEMO_LIMITS } from '../runtime/funding/demo-plan.mjs';
const manifest = JSON.parse(await readFile(new URL('../deployments/aurora-mainnet-funding-safe.json', import.meta.url), 'utf8'));
const now = Math.floor(Date.now() / 1000);
const request = fundingDemoPreviewInput({ manifest, fundingId: `funding-demo-${now}`, expiresAt: now + FUNDING_DEMO_LIMITS.maxQuoteSeconds, now });
try {
  const client = createIntentsClient(); // executable quotes stay disabled
  const quote = await client.previewOrder(request);
  console.log(JSON.stringify({ purpose: 'bounded-first-delivery-proof', funded: false, deliveryProven: false,
    mainnetRoundReady: false, request, quote }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ code: error.code ?? 'PREVIEW_UNAVAILABLE', message: 'Dry quote unavailable; no executable quote or transfer attempted.' }));
  process.exitCode = 1;
}
