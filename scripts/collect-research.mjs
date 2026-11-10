import { mkdir, writeFile, rename } from 'node:fs/promises';
import { collectResearch } from '../runtime/operator/research.mjs';
// Public read-only market data, no credentials, trading or settlement update.
try {
  const market = await collectResearch();
  await mkdir('.run/research', { recursive: true });
  await writeFile('.run/research/latest.json.tmp', JSON.stringify(market, null, 2) + '\n');
  await rename('.run/research/latest.json.tmp', '.run/research/latest.json');
  console.log(JSON.stringify({ file: '.run/research/latest.json', source: market.source, asOf: market.asOf, observations: market.history.length, settlementEligible: false }));
} catch (error) { console.error(error.message); process.exitCode = 1; }
