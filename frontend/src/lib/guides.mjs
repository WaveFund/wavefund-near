// Role-specific navigation only. No funds, signing, network or invented round.
export function roleGuides(rounds = []) {
  const saved = (id, stage) => {
    const round = rounds.find((r) => r.stack?.id === 'tidepool' && r.roundId === String(id));
    return round ? `/rounds/${round.slug}${stage ? `?stage=${stage}` : ''}` : '/rounds';
  };
  const step = (title, line, button, href) => ({ title, line, button, href });
  return [
    { id: 'manager', title: 'Manager', line: 'Let AI strategies compete for your Safe.', steps: [
      step('Inspect the demo Safe', 'This is a configured demo portfolio; connecting your own Safe is not available yet.', 'View portfolio', '/portfolio'),
      step('Follow the funding', 'Manager capital arrives separately from forecasting collateral.', 'See funding', '/portfolio?tab=funding'),
      step('See the selected strategy execute', 'Inspect the recorded trade and measured result, not a promise of yield.', 'View execution', saved(3, 'executed')),
      step('Review the limits', 'Check the configured permissions before authorizing any integration.', 'View permissions', '/portfolio?tab=permissions'),
    ] },
    { id: 'forecaster', title: 'Forecaster', line: 'Back or doubt a strategy with your own wallet.', steps: [
      step('Connect on Aurora testnet', 'The app holds no keys; your wallet signs each testnet transaction.', 'Connect wallet', '/rounds/live#wallet'),
      step('Request test assets', 'Copy your connected address and ask the team for 10 Tidepool test USDC and test ETH for gas. No in-app faucet is available.', 'Copy address in wallet panel', '/rounds/live#wallet'),
      step('Take LONG or SHORT', 'During forecasting, approve, deposit separate collateral, claim credits and review the trade.', 'Open forecasting', '/rounds/live#wallet'),
      step('Redeem after settlement', 'Redemption depends on your selected-world balances; profit is not guaranteed.', 'Check redemption', '/rounds/live#wallet'),
    ] },
    { id: 'observer', title: 'Just looking', line: 'See real rounds, step by step.', steps: [
      step('Replay a completed round', 'Saved history is separate from new live activity.', 'Explore round', saved(1)),
      step('Read the AI proposals', 'Compare the allocation targets and recorded reasoning.', 'See proposals', saved(1, 'proposals')),
      step('Inspect agent outcomes', 'Scores count executed outcomes, not how often an agent was selected.', 'View agents', '/agents'),
      step('Watch the current round', 'Between rounds you can still inspect your wallet.', 'Watch live', '/rounds/live'),
    ] },
  ];
}
export function guideFor(role, rounds = []) { return roleGuides(rounds).find((g) => g.id === role) ?? null; }
export const ROUND_STEPS = Object.freeze(['Funded', 'Proposals', 'Forecasting', 'Selected', 'Executed', 'Measured']);
