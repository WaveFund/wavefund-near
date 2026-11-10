const check = (condition, message) => { if (!condition) throw new Error(message); };

// This validates authenticated return metadata; it does not replace proof verification.
export function normalizeAuthenticatedPrices(p, nowMs) {
  check(['pairs', 'prices', 'timestamp', 'decimal', 'round'].every(key => Array.isArray(p[key]) && p[key].length === 2), 'Malformed authenticated prices');
  check(new Set(p.pairs.map(String)).size === 2 && p.pairs.includes(19n) && p.pairs.includes(89n), 'Unexpected authenticated feeds');
  const oldest = p.timestamp.reduce((a, b) => a < b ? a : b);
  const latest = p.timestamp.reduce((a, b) => a > b ? a : b);
  check(oldest > 0n && latest <= nowMs && nowMs - oldest <= 120000n, 'Authenticated prices are stale or future-dated');
  check(latest - oldest <= 30000n, 'Authenticated feed skew too large');
  const value = id => {
    const index = p.pairs.indexOf(BigInt(id));
    check(p.decimal[index] >= 0n && p.decimal[index] <= 36n && p.prices[index] > 0n && p.round[index] > 0n, 'Invalid authenticated price');
    const normalized = p.prices[index] * 10n ** 18n / 10n ** p.decimal[index];
    check(normalized > 0n, 'Invalid normalized price'); return normalized;
  };
  return { stable: value(89), asset: value(19) };
}

