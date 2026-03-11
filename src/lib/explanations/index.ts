/**
 * Rule-based explanation generator.
 * Produces a human-readable summary of why a signal scored as it did.
 */

import { SignalInputs, ScoreBreakdown } from '@/lib/scoring';

export function generateExplanation(inputs: SignalInputs, breakdown: ScoreBreakdown): string {
  const parts: string[] = [];
  const caveats: string[] = [];

  // Momentum commentary
  if (breakdown.momentumScore > 15) {
    const details: string[] = [];
    if (inputs.pctChange5m != null && inputs.pctChange5m > 1) details.push(`5m +${inputs.pctChange5m.toFixed(1)}%`);
    if (inputs.pctChange15m != null && inputs.pctChange15m > 1) details.push(`15m +${inputs.pctChange15m.toFixed(1)}%`);
    if (inputs.pctChange1h != null && inputs.pctChange1h > 1) details.push(`1h +${inputs.pctChange1h.toFixed(1)}%`);
    if (inputs.pctChangeIntraday != null && inputs.pctChangeIntraday > 1) details.push(`intraday +${inputs.pctChangeIntraday.toFixed(1)}%`);
    if (inputs.pctChange1d != null && inputs.pctChange1d > 1) details.push(`1d +${inputs.pctChange1d.toFixed(1)}%`);
    parts.push(details.length > 0 ? `Strong momentum (${details.join(', ')})` : 'Strong momentum');
  } else if (breakdown.momentumScore > 8) {
    parts.push('Moderate momentum');
  } else if (breakdown.momentumScore > 0) {
    parts.push('Weak momentum');
  }

  // RVOL
  if (breakdown.rvolBoost > 0 && inputs.rvol != null) {
    parts.push(`High relative volume (${inputs.rvol.toFixed(1)}x)`);
  }

  // Volume spike
  if (breakdown.volumeSpikeBoost > 0) {
    parts.push('Volume spike detected');
  }

  // Intraday range
  if (breakdown.intradayRangeBoost > 0 && inputs.intradayRangePct != null) {
    const pct = Math.round(inputs.intradayRangePct * 100);
    parts.push(`Trading in upper ${100 - pct}% of today's range`);
  }

  // Breakout
  if (breakdown.breakoutBoost > 0) {
    if (inputs.isBreakout) {
      parts.push('Breaking out above recent highs');
    } else if (inputs.nearHigh) {
      parts.push('Near recent highs');
    } else if (inputs.gapUpPct != null && inputs.gapUpPct > 0) {
      parts.push(`Gapped up ${(inputs.gapUpPct * 100).toFixed(1)}% at open`);
    }
  }

  // VWAP
  if (breakdown.vwapBoost > 0 && inputs.pctFromVwap != null) {
    parts.push(`Trading ${inputs.pctFromVwap.toFixed(1)}% above VWAP`);
  }

  // Float
  if (breakdown.floatBoost > 0 && inputs.float != null) {
    const floatM = (inputs.float / 1_000_000).toFixed(1);
    parts.push(`Low float (${floatM}M shares)`);
  }

  // News
  if (breakdown.newsBoost > 0) {
    parts.push('Recent news catalyst present');
  }

  // Short interest
  if (breakdown.shortInterestBoost > 0) {
    parts.push('Elevated short interest');
  }

  // Options flow
  if (breakdown.optionsFlowBoost > 0) {
    parts.push('Bullish options flow detected');
  }

  // Caveats
  if (!inputs.hasCandleData) {
    caveats.push('intraday candle data unavailable (quote-only mode)');
  }

  const missingFields: string[] = [];
  if (inputs.shortInterest == null) missingFields.push('short interest');
  if (inputs.optionsFlowValue == null) missingFields.push('options flow');
  if (inputs.float == null) missingFields.push('float');
  if (missingFields.length > 0) {
    caveats.push(`${missingFields.join(' and ')} data unavailable`);
  }

  let explanation = parts.length > 0 ? parts.join('. ') + '.' : 'No strong signals detected.';
  if (caveats.length > 0) {
    explanation += ' ' + caveats.join('. ') + '.';
  }

  return explanation;
}
