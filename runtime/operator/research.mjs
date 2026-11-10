import { readFile } from 'node:fs/promises';
import { validateMarket } from '../agents/market.mjs';

export const RESEARCH_URLS = Object.freeze({ candles: 'https://api.exchange.coinbase.com/products/ETH-USD/candles?granularity=300', ticker: 'https://api.exchange.coinbase.com/products/ETH-USD/ticker', stable: 'https://api.coinbase.com/v2/prices/USDC-USD/spot' });
export function decimal18(value) {
  const text = String(value);
  if (!/^(0|[1-9]\d{0,7})(\.\d{1,18})?$/.test(text)) throw new Error('Invalid research price');
  const [whole, fraction = ''] = text.split('.');
  const result = BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, '0'));
  if (result <= 0n) throw new Error('Research price must be positive');
  return result.toString();
}
export function normalizeResearch({ candles, ticker, stable }, { now = Math.floor(Date.now() / 1000) } = {}) {
  const asOf = Math.floor(Date.parse(ticker?.time) / 1000);
  if (!Number.isSafeInteger(asOf) || asOf > now || now - asOf > 120) throw new Error('Research ticker is stale or future-dated');
  if (stable?.data?.base !== 'USDC' || stable.data.currency !== 'USD') throw new Error('Wrong stablecoin research pair');
  if (!Array.isArray(candles) || candles.length < 3 || candles.length > 512) throw new Error('Invalid research candle count');
  const closed = new Map();
  for (const row of candles) {
    if (!Array.isArray(row) || row.length !== 6 || !Number.isSafeInteger(row[0]) || row[0] < 0) throw new Error('Invalid research candle schema');
    const low = BigInt(decimal18(row[1])); const high = BigInt(decimal18(row[2])); const open = BigInt(decimal18(row[3])); const close = BigInt(decimal18(row[4]));
    if (low > high || open < low || open > high || close < low || close > high || !Number.isFinite(row[5]) || row[5] < 0) throw new Error('Inconsistent research candle');
    // Never use an unfinished candle or pretend its eventual close was known in advance.
    const end = row[0] + 300;
    if (end >= asOf) continue;
    if (closed.has(end)) throw new Error('Duplicate research candle');
    closed.set(end, close.toString());
  }
  const history = [...closed].sort((a, b) => a[0] - b[0]).slice(-12).map(([timestamp, assetUsdX18]) => ({ timestamp, assetUsdX18 }));
  if (history.length < 3 || asOf - history.at(-1).timestamp > 900) throw new Error('Insufficient recent completed candles');
  history.push({ timestamp: asOf, assetUsdX18: decimal18(ticker.price) });
  const market = validateMarket({ source: 'external-unverified', asOf, stableUsdX18: decimal18(stable.data.amount), history }, { now });
  return { ...market, provenance: { provider: 'Coinbase public REST', retrievedAt: now, ethObservationAt: asOf, stableObservationAt: null, stableTimestampMeaning: 'retrieval only; upstream spot response has no publication timestamp', settlementEligible: false, warning: 'Single-provider research data, not a cryptographically verified settlement oracle.' } };
}
async function fetchJSON(url, fetchImpl) {
  const response = await fetchImpl(url, { redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(8000), headers: { Accept: 'application/json', 'User-Agent': 'Wavefund-research/0.1' } });
  if (!response.ok) throw new Error(`Research source HTTP ${response.status}`);
  if (!response.body) throw new Error('Research source returned no body');
  let size = 0; const chunks = []; const reader = response.body.getReader();
  try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 262144) throw new Error('Research response too large'); chunks.push(value); } } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
export async function collectResearch({ fetchImpl = fetch, now } = {}) {
  const values = await Promise.all(Object.values(RESEARCH_URLS).map((url) => fetchJSON(url, fetchImpl)));
  return normalizeResearch(Object.fromEntries(Object.keys(RESEARCH_URLS).map((key, i) => [key, values[i]])), { now });
}
export async function researchStatus(file, now = Math.floor(Date.now() / 1000)) {
  try {
    const input = JSON.parse(await readFile(file, 'utf8')); const market = validateMarket(input, { now });
    return { status: 'available', settlementEligible: false, source: market.source, asOf: market.asOf, assetUsdX18: market.history.at(-1).assetUsdX18, stableUsdX18: market.stableUsdX18, features: market.features, evidenceId: market.evidenceId };
  } catch (error) {
    return { status: error.code === 'ENOENT' ? 'not-configured' : 'unavailable', settlementEligible: false, message: error.code === 'ENOENT' ? 'Collect a research snapshot first; no live data has been assumed.' : 'Research data is stale or invalid; refresh explicitly.' };
  }
}
