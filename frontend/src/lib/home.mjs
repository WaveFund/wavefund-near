// Saved completed rounds only. A newer unattested round must not inherit an older round's TEE claims.
export function homeRoundView(rounds = []) {
  const history = rounds.filter(r => r.stack?.id === 'tidepool').sort((a, b) => Number(b.roundId) - Number(a.roundId));
  const latest = history[0] ?? null;
  return { latest, completed: history.length,
    attestedExample: history.find(r => r.attestationVerified) ?? null,
    trades: latest?.forecasters.filter(f => f.action === 'buy') ?? [],
    abstentions: latest?.forecasters.filter(f => f.action === 'abstain') ?? [],
    humans: latest?.payouts.filter(p => p.external) ?? [],
  };
}
