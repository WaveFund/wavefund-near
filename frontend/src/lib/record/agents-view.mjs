// View-model rules for the Agents screen. Pure functions over the validated reputation board and saved rounds,
// so `node --test` exercises exactly what the page renders.

const INT = /^-?(0|[1-9]\d*)$/;
const big = (value) => (typeof value === 'string' && INT.test(value) ? BigInt(value) : null);

/**
 * One row per agent on a stack's reputation board. A row is `available` only when the contract read succeeded
 * and every counter is a well-formed integer string; anything else is "unavailable" and is never coerced to 0.
 * Order: available rows by score descending, then name; unavailable rows last, by name.
 */
export function rankAgents(board) {
  if (!board || !Array.isArray(board.agents)) return [];
  const rows = board.agents.map((agent) => {
    const rep = agent.status === 'ok' ? agent.reputation : null;
    const score = rep ? big(rep.score) : null;
    const samples = rep ? big(rep.samples) : null;
    const available = rep !== null && score !== null && samples !== null && big(rep.positive) !== null && big(rep.negative) !== null && big(rep.flat) !== null;
    return {
      name: agent.name, address: agent.address ?? null, code: agent.code ?? null, available,
      score: available ? rep.score : null, samples: available ? rep.samples : null,
      positive: available ? rep.positive : null, negative: available ? rep.negative : null, flat: available ? rep.flat : null,
      blockNumber: available ? rep.blockNumber : null,
    };
  });
  return rows.sort((a, b) => {
    if (a.available !== b.available) return a.available ? -1 : 1;
    if (a.available) { const diff = BigInt(b.score) - BigInt(a.score); if (diff !== 0n) return diff > 0n ? 1 : -1; }
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
}

/**
 * Saved rounds on one reputation stack where this agent's strategy was selected and was not Hold.
 * `delta` is that round's own reputation change (null when the round recorded none); it is not the cumulative score.
 * Newest round first.
 */
export function attributableRounds(rounds, stackId, agentName) {
  if (!Array.isArray(rounds)) return [];
  return rounds
    .filter((round) => round.stack.id === stackId && !round.winner.isHold && round.winner.name === agentName)
    .map((round) => ({
      slug: round.slug, roundId: round.roundId, allocationBps: round.winner.allocationBps,
      returnX18: round.realisedReturnX18 ?? null,
      delta: round.reputation && big(round.reputation.score) !== null ? round.reputation.score : null,
    }))
    .sort((a, b) => (BigInt(a.roundId) < BigInt(b.roundId) ? 1 : -1));
}

/**
 * Every saved round on one stack where this agent proposed a strategy, newest first, with that proposal (and so its
 * AI provenance). The first entry is the agent's latest recorded model on the stack.
 */
export function agentProposals(rounds, stackId, agentName) {
  if (!Array.isArray(rounds)) return [];
  return rounds
    .filter((round) => round.stack.id === stackId)
    .flatMap((round) => round.proposals.filter((p) => p.id !== '0' && p.name === agentName).map((proposal) => ({ slug: round.slug, roundId: round.roundId, round, proposal })))
    .sort((a, b) => (BigInt(a.roundId) < BigInt(b.roundId) ? 1 : -1));
}
