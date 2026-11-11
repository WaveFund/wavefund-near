// A read-only retry for one specific contract rejection. Never replaces proof
// authentication or relaxes the consumer's freshness checks. Reuses the SAME proof.
export async function verifySupraAtChainTime({ verify, blockTime, waitUntil }) {
  try { return await verify(); } catch (error) {
    let decoded;
    for (let cause = error, depth = 0; cause && depth < 10; cause = cause.cause, depth++) {
      if (cause.data?.errorName === 'IncorrectFutureUpdate') { decoded = cause.data; break; }
    }
    const lead = decoded?.args?.[0];
    if (typeof lead !== 'bigint' || lead <= 0n || lead > 30000n) throw error;
    const current = await blockTime();
    await waitUntil(current + (lead + 999n) / 1000n + 1n);
    return verify(); // exactly one re-verification; any further rejection propagates
  }
}
