import { collectResearch, decimal18 } from '../operator/research.mjs';
import { digest, ONE } from './policy.mjs';
export const CONTEXT_URLS = Object.freeze({
  stats24h: 'https://api.exchange.coinbase.com/products/ETH-USD/stats',
  spread: 'https://api.exchange.coinbase.com/products/ETH-USD/book?level=1',
  crossExchange: 'https://api.kraken.com/0/public/Ticker?pair=ETHUSD',
});
const check = (value, message) => { if (!value) throw new Error(message); };
const bps = (a, b) => Number((a - b) * 100000000n / b) / 10000;
function volume(value) { check(typeof value === 'string' && /^(0|[1-9]\d{0,13})(\.\d{1,18})?$/.test(value), 'Invalid research volume'); return value; }
function normalize(key, raw, market, now) {
  const base = { status: 'available', url: CONTEXT_URLS[key], retrievedAt: now, publisherTimestamp: null, timestampMeaning: 'Retrieval time only; exchange response has no publication timestamp.' };
  if (key === 'stats24h') {
    const open = BigInt(decimal18(raw.open)), high = BigInt(decimal18(raw.high)), low = BigInt(decimal18(raw.low)), last = BigInt(decimal18(raw.last));
    check(low <= open && open <= high && low <= last && last <= high, 'Inconsistent 24h range');
    return { ...base, openUsdX18: String(open), highUsdX18: String(high), lowUsdX18: String(low), lastUsdX18: String(last), return24hBpsApprox: bps(last, open), volume24hETH: volume(raw.volume) };
  }
  if (key === 'spread') {
    check(Array.isArray(raw.bids) && Array.isArray(raw.asks) && raw.bids.length && raw.asks.length, 'Missing orderbook sides');
    const bid = BigInt(decimal18(raw.bids[0][0])), ask = BigInt(decimal18(raw.asks[0][0]));
    check(ask >= bid, 'Crossed orderbook');
    if (raw.time !== undefined) {
      const published = Math.floor(Date.parse(raw.time) / 1000);
      check(Number.isSafeInteger(published) && published <= now && now - published <= 120, 'Stale orderbook');
      base.publisherTimestamp = published; base.timestampMeaning = 'Exchange-provided orderbook time.';
    }
    return { ...base, bidUsdX18: String(bid), askUsdX18: String(ask), spreadBpsApprox: bps(ask, bid), warning: 'Coinbase spread is not Aurora pool depth or execution slippage.' };
  }
  check(Array.isArray(raw.error) && raw.error.length === 0 && raw.result?.XETHZUSD, 'Kraken ETH/USD unavailable');
  const data = raw.result.XETHZUSD, last = BigInt(decimal18(data.c?.[0]));
  const difference = bps(last, BigInt(market.history.at(-1).assetUsdX18));
  return { ...base, pair: 'ETH/USD', lastUsdX18: String(last), volume24hETH: volume(data.v?.[1]), differenceFromCoinbaseBpsApprox: difference, pricesAgreeWithin50Bps: Math.abs(difference) <= 50, warning: 'Cross-exchange agreement is not an oracle quorum or proof of freshness.' };
}
export function researchContext(results, { market, now }) {
  const observations = {};
  for (const key of Object.keys(CONTEXT_URLS)) {
    try { check(results[key]?.status === 'fulfilled', 'Source unavailable'); observations[key] = normalize(key, results[key].value, market, now); }
    catch { observations[key] = { status: 'unavailable', url: CONTEXT_URLS[key], retrievedAt: now, reason: 'Source unavailable, stale, or schema validation failed.' }; }
  }
  const clean = { schemaVersion: 1, marketEvidenceId: market.evidenceId, asOf: now, settlementEligible: false,
    stableDeviationBpsApprox: bps(BigInt(market.stableUsdX18), ONE), observations,
    warning: 'Unverified external research, not investment advice, settlement data or demonstrated alpha. Missing sources are not zero. Testnet tokens and operator-seeded AMM prices are artificial.' };
  return { ...clean, evidenceId: `research-${digest(clean).slice(0, 16)}` };
}
export function validateResearchContext(input, { market, now }) {
  check(input?.schemaVersion === 1 && input.settlementEligible === false && input.marketEvidenceId === market.evidenceId, 'Research context identity mismatch');
  check(Number.isSafeInteger(input.asOf) && input.asOf <= now && now - input.asOf <= 300, 'Research context stale');
  const { evidenceId, ...clean } = input;
  check(evidenceId === `research-${digest(clean).slice(0, 16)}`, 'Research context changed');
  return input;
}
async function getJSON(url, fetchImpl) {
  const response = await fetchImpl(url, { redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(8000), headers: { Accept: 'application/json' } });
  check(response.ok && response.body, 'Research HTTP unavailable');
  const reader = response.body.getReader(); let size = 0; const parts = [];
  try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; check(size <= 131072, 'Research response oversized'); parts.push(part.value); } }
  finally { await reader.cancel().catch(() => {}); }
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
}
export async function collectAgentResearch({ fetchImpl = fetch } = {}) {
  const market = await collectResearch({ fetchImpl });
  const keys = Object.keys(CONTEXT_URLS);
  const results = await Promise.allSettled(keys.map(key => getJSON(CONTEXT_URLS[key], fetchImpl)));
  const context = researchContext(Object.fromEntries(keys.map((key, i) => [key, results[i]])), { market, now: Math.floor(Date.now() / 1000) });
  return { market, researchContext: context };
}
