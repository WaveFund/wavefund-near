import { createHash } from 'node:crypto';

export const AGENT_SPECS = Object.freeze([
  Object.freeze({ name: 'Momentum', role: 'proposer', accountIndex: 1, mandate: 'Seek return using trend evidence; explain downside and avoid claiming certainty.' }),
  Object.freeze({ name: 'Conservative', role: 'proposer', accountIndex: 4, mandate: 'Prioritize drawdown and stablecoin risk; consider retaining cash. No compulsory allocation cap.' }),
  Object.freeze({ name: 'Quant', role: 'forecaster', accountIndex: 2, mandate: 'Estimate strategy performance using trend, volatility and execution costs.' }),
  Object.freeze({ name: 'Guardian', role: 'forecaster', accountIndex: 3, mandate: 'Independently stress-test the proposals for downside, depeg and weak evidence.' }),
]);
export const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const ONE = 10n ** 18n;
export const CREDIT_SCALE = 10n ** 12n;

export function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) throw new Error(`Invalid ${label} fields`);
}
function integer(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Invalid ${label}`);
  return value;
}
function text(value, max, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`Invalid ${label}`);
  return value.trim();
}
function explanation(item, evidenceIds) {
  const rationale = text(item.rationale, 600, 'rationale');
  if (!Array.isArray(item.risks) || item.risks.length < 1 || item.risks.length > 4) throw new Error('Invalid risk list');
  const risks = item.risks.map((risk) => text(risk, 180, 'risk'));
  if (!Array.isArray(item.evidenceIds) || item.evidenceIds.length < 1 || item.evidenceIds.length > 8 || new Set(item.evidenceIds).size !== item.evidenceIds.length || item.evidenceIds.some((id) => !evidenceIds.includes(id))) throw new Error('Unknown or missing evidence citation');
  return { rationale, risks, evidenceIds: [...item.evidenceIds] };
}
export function validateProposal(item, { evidenceIds, minAllocationBps = 0, maxAllocationBps = 10000 }) {
  exactKeys(item, ['allocationBps', 'confidenceBps', 'rationale', 'risks', 'evidenceIds'], 'proposal');
  return { allocationBps: integer(item.allocationBps, minAllocationBps, maxAllocationBps, 'allocation'), confidenceBps: integer(item.confidenceBps, 0, 10000, 'confidence'), ...explanation(item, evidenceIds) };
}
export function validateForecast(item, { evidenceIds, proposalIds }) {
  exactKeys(item, ['forecasts'], 'forecast response');
  if (!Array.isArray(item.forecasts) || item.forecasts.length !== proposalIds.length) throw new Error('Forecast coverage must match all proposals');
  const seen = new Set();
  const forecasts = item.forecasts.map((entry) => {
    exactKeys(entry, ['proposalId', 'expectedReturnBps', 'confidenceBps', 'rationale', 'risks', 'evidenceIds'], 'forecast');
    const proposalId = integer(entry.proposalId, 0, 255, 'proposal identifier');
    if (!proposalIds.includes(proposalId) || seen.has(proposalId)) throw new Error('Unknown or duplicate proposal identifier');
    seen.add(proposalId);
    return { proposalId, expectedReturnBps: integer(entry.expectedReturnBps, -10000, 10000, 'expected return'), confidenceBps: integer(entry.confidenceBps, 0, 10000, 'confidence'), ...explanation(entry, evidenceIds) };
  });
  return { forecasts };
}
// Confidence is model self-report, not calibration. No confidence multiplier changes the payout formula.
export function expectedLongPayout(expectedReturnBps, rMin = 950000000000000000n, rMax = 1050000000000000000n) {
  integer(expectedReturnBps, -10000, 10000, 'expected return');
  if (rMin < 0n || rMax <= rMin) throw new Error('Invalid payout bounds');
  const realised = ONE + BigInt(expectedReturnBps) * ONE / 10000n;
  if (realised <= rMin) return 0n;
  if (realised >= rMax) return ONE;
  return (realised - rMin) * ONE / (rMax - rMin);
}

export function chooseTrade({ forecasts, quotes, creditAmount = 2000000n, maxSpend = 5000000n, minEdgeBps = 100, minConfidenceBps = 5000, rMin, rMax }) {
  if (typeof creditAmount !== 'bigint' || typeof maxSpend !== 'bigint' || creditAmount <= 0n || creditAmount > maxSpend || maxSpend > 10000000n) throw new Error('Trade exceeds local agent budget');
  integer(minEdgeBps, 1, 10000, 'minimum edge');
  integer(minConfidenceBps, 0, 10000, 'minimum confidence');
  let best = null;
  for (const forecast of forecasts) {
    if (forecast.confidenceBps < minConfidenceBps) continue;
    const pi = expectedLongPayout(forecast.expectedReturnBps, rMin, rMax);
    for (const side of ['long', 'short']) {
      const quote = quotes.find((q) => q.proposalId === forecast.proposalId && q.side === side);
      if (!quote || typeof quote.outcomeAmount !== 'bigint' || quote.outcomeAmount <= 0n) continue;
      const payout = side === 'long' ? pi : ONE - pi;
      const expectedValue = quote.outcomeAmount * payout / ONE / CREDIT_SCALE;
      const edge = expectedValue - creditAmount;
      if (edge * 10000n <= creditAmount * BigInt(minEdgeBps)) continue;
      if (!best || edge > best.expectedProfit) best = { proposalId: forecast.proposalId, side, creditAmount, quotedOutcomes: quote.outcomeAmount, minimumOutcomes: quote.outcomeAmount * 995n / 1000n, expectedValue, expectedProfit: edge, forecast };
    }
  }
  return best; // No edge means abstain, never force a trade to make the demo look active.
}
