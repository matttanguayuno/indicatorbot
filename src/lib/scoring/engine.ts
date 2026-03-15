/**
 * Deterministic signal scoring engine.
 * Takes computed indicators and produces a 0–100 score.
 *
 * Works in two modes depending on hasCandleData:
 *  - Full mode (Twelve Data candles): scores 5m/15m/1h momentum, RVOL, VWAP, volume spike
 *  - Quote-only mode (Finnhub): scores intraday + 1d momentum, normalises against lower max
 */

import { SCORING_WEIGHTS, SCORING_PENALTIES } from '@/lib/config';
import type { ScoringRules } from '@/lib/config';

// Build a rules object from the old static constants (used when no rules passed)
function staticRules(): ScoringRules {
  return {
    weights: {
      momentum: { weight: SCORING_WEIGHTS.momentum.weight, timeframes: { ...SCORING_WEIGHTS.momentum.timeframes } },
      rvol: { ...SCORING_WEIGHTS.rvol },
      volumeSpike: { ...SCORING_WEIGHTS.volumeSpike },
      float: { ...SCORING_WEIGHTS.float },
      vwap: { weight: SCORING_WEIGHTS.vwap.weight },
      intradayRange: { weight: SCORING_WEIGHTS.intradayRange.weight, tiers: { full: 0.85, mid: 0.65, low: 0.50 } },
      breakout: { ...SCORING_WEIGHTS.breakout },
      newsCatalyst: { ...SCORING_WEIGHTS.newsCatalyst },
      shortInterest: { ...SCORING_WEIGHTS.shortInterest },
      optionsFlow: { ...SCORING_WEIGHTS.optionsFlow },
      patterns: { weight: SCORING_WEIGHTS.patterns.weight, cap: SCORING_WEIGHTS.patterns.cap, baseBoosts: { ...SCORING_WEIGHTS.patterns.baseBoosts } },
    },
    penalties: { ...SCORING_PENALTIES },
    momentum: { maxPctForFullScore: 5 },
    vwapTiers: { full: 2, half: 0 },
    polling: { batchSize: 10 },
  };
}

export interface SignalInputs {
  // Candle-based momentum (null when no candle data)
  pctChange5m: number | null;
  pctChange15m: number | null;
  pctChange1h: number | null;

  // Always available from quote
  pctChange1d: number | null;
  pctChangeIntraday: number | null;
  intradayRangePct: number | null;   // 0–1
  gapUpPct: number | null;

  // Volume from candles (null when no candle data)
  rvol: number | null;
  volumeSpikeRatio: number | null;

  // VWAP from candles
  pctFromVwap: number | null;

  // Breakout
  isBreakout: boolean;
  nearHigh: boolean;

  // Fundamentals
  float: number | null;
  newsScore: number;
  shortInterest: number | null;
  optionsFlowValue: number | null;

  // Mode flag
  hasCandleData: boolean;

  // Pattern detection results
  patternSignals: { type: string; conviction: number }[] | null;
}

export interface ScoreBreakdown {
  momentumScore: number;
  rvolBoost: number;
  volumeSpikeBoost: number;
  intradayRangeBoost: number;
  breakoutBoost: number;
  vwapBoost: number;
  floatBoost: number;
  newsBoost: number;
  shortInterestBoost: number;
  optionsFlowBoost: number;
  patternBoost: number;
  missingPenalty: number;
  rawTotal: number;
  maxAchievable: number;
  finalScore: number;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// --- Momentum: uses whichever timeframes are available ---
function scoreMomentum(inputs: SignalInputs, r: ScoringRules): number {
  const w = r.weights.momentum;
  const tf = w.timeframes;

  const entries: [number | null, number][] = [
    [inputs.pctChange5m, tf['5m'] ?? 0],
    [inputs.pctChange15m, tf['15m'] ?? 0],
    [inputs.pctChange1h, tf['1h'] ?? 0],
    [inputs.pctChange1d, tf['1d'] ?? 0],
    [inputs.pctChangeIntraday, tf['intraday'] ?? 0],
  ];

  let totalWeight = 0;
  let weightedSum = 0;

  for (const [pct, tfWeight] of entries) {
    if (pct != null) {
      const factor = clamp(pct / r.momentum.maxPctForFullScore, 0, 1);
      weightedSum += factor * tfWeight;
      totalWeight += tfWeight;
    }
  }

  if (totalWeight === 0) return 0;
  return (weightedSum / totalWeight) * w.weight;
}

// --- RVOL ---
function scoreRvol(rvol: number | null, r: ScoringRules): number {
  if (rvol == null) return 0;
  const w = r.weights.rvol;
  if (rvol >= w.highThreshold) return w.weight;
  if (rvol >= w.moderateThreshold) return w.weight * 0.5;
  return 0;
}

// --- Volume spike ---
function scoreVolumeSpike(ratio: number | null, r: ScoringRules): number {
  if (ratio == null) return 0;
  const w = r.weights.volumeSpike;
  if (ratio >= w.spikeThreshold) return w.weight;
  if (ratio >= w.spikeThreshold * 0.5) return w.weight * 0.5;
  return 0;
}

// --- Intraday range position ---
function scoreIntradayRange(rangePct: number | null, r: ScoringRules): number {
  if (rangePct == null) return 0;
  const w = r.weights.intradayRange;
  const t = w.tiers;
  if (rangePct >= t.full) return w.weight;
  if (rangePct >= t.mid) return w.weight * 0.6;
  if (rangePct >= t.low) return w.weight * 0.3;
  return 0;
}

// --- Breakout / gap-up ---
function scoreBreakout(inputs: SignalInputs, r: ScoringRules): number {
  const w = r.weights.breakout;
  if (inputs.isBreakout) return w.weight;
  if (inputs.nearHigh) return w.weight * 0.5;
  if (inputs.gapUpPct != null && inputs.gapUpPct >= w.gapUpPct) {
    return inputs.gapUpPct >= w.gapUpPct * 2 ? w.weight : w.weight * 0.5;
  }
  return 0;
}

// --- VWAP ---
function scoreVwap(pctFromVwap: number | null, r: ScoringRules): number {
  if (pctFromVwap == null) return 0;
  const w = r.weights.vwap;
  if (pctFromVwap > r.vwapTiers.full) return w.weight;
  if (pctFromVwap > r.vwapTiers.half) return w.weight * 0.5;
  return 0;
}

// --- Float ---
function scoreFloat(floatVal: number | null, r: ScoringRules): number {
  if (floatVal == null) return 0;
  const w = r.weights.float;
  if (floatVal <= w.microFloatThreshold) return w.weight;
  if (floatVal <= w.lowFloatThreshold) return w.weight * 0.5;
  return 0;
}

// --- News catalyst ---
function scoreNewsCatalyst(newsScore: number, r: ScoringRules): number {
  return newsScore * r.weights.newsCatalyst.weight;
}

// --- Short interest ---
function scoreShortInterest(si: number | null, r: ScoringRules): number {
  if (si == null) return 0;
  const w = r.weights.shortInterest;
  if (si >= w.highThreshold) return w.weight;
  if (si >= w.moderateThreshold) return w.weight * 0.5;
  return 0;
}

// --- Options flow ---
function scoreOptionsFlow(flow: number | null, r: ScoringRules): number {
  if (flow == null) return 0;
  const w = r.weights.optionsFlow;
  if (flow >= w.bullishThreshold) return w.weight;
  return 0;
}

// --- Pattern boost: sum of (baseBoost × conviction) per detected pattern, capped ---
function scorePatterns(signals: { type: string; conviction: number }[] | null, r: ScoringRules): number {
  if (!signals || signals.length === 0) return 0;
  const pw = r.weights.patterns;
  let total = 0;
  for (const s of signals) {
    const base = pw.baseBoosts[s.type] ?? 0;
    total += base * clamp(s.conviction, 0, 1);
  }
  return Math.min(total, pw.cap);
}

// --- Missing data penalty (only for fields that COULD be available) ---
function calcMissingPenalty(inputs: SignalInputs, r: ScoringRules): number {
  const fields: (keyof SignalInputs)[] = ['float', 'shortInterest', 'optionsFlowValue'];
  let count = 0;
  for (const f of fields) {
    if (inputs[f] == null) count++;
  }
  return Math.min(count * r.penalties.missingDataPerField, r.penalties.maxMissingPenalty);
}

// --- Max achievable: lower when candle-only categories can't score ---
function calcMaxAchievable(inputs: SignalInputs, r: ScoringRules): number {
  let max = 100 + r.weights.patterns.cap;
  if (!inputs.hasCandleData) {
    max -= r.weights.rvol.weight;
    max -= r.weights.volumeSpike.weight;
    max -= r.weights.vwap.weight;
    max -= r.weights.patterns.cap; // patterns require candles
  }
  return max;
}

// --- Main scoring function ---
export function calculateScore(inputs: SignalInputs, rules?: ScoringRules): ScoreBreakdown {
  const r = rules ?? staticRules();
  const momentumScore = scoreMomentum(inputs, r);
  const rvolBoost = scoreRvol(inputs.rvol, r);
  const volumeSpikeBoost = scoreVolumeSpike(inputs.volumeSpikeRatio, r);
  const intradayRangeBoost = scoreIntradayRange(inputs.intradayRangePct, r);
  const breakoutBoost = scoreBreakout(inputs, r);
  const vwapBoost = scoreVwap(inputs.pctFromVwap, r);
  const floatBoost = scoreFloat(inputs.float, r);
  const newsBoost = scoreNewsCatalyst(inputs.newsScore, r);
  const shortInterestBoost = scoreShortInterest(inputs.shortInterest, r);
  const optionsFlowBoost = scoreOptionsFlow(inputs.optionsFlowValue, r);
  const patternBoost = scorePatterns(inputs.patternSignals, r);
  const missingPenalty = calcMissingPenalty(inputs, r);

  const rawTotal =
    momentumScore + rvolBoost + volumeSpikeBoost + intradayRangeBoost +
    breakoutBoost + vwapBoost + floatBoost + newsBoost +
    shortInterestBoost + optionsFlowBoost + patternBoost - missingPenalty;

  const maxAchievable = calcMaxAchievable(inputs, r);
  const normalised = (rawTotal / maxAchievable) * 100;
  const finalScore = clamp(Math.round(normalised), 0, 100);

  return {
    momentumScore: round1(momentumScore),
    rvolBoost: round1(rvolBoost),
    volumeSpikeBoost: round1(volumeSpikeBoost),
    intradayRangeBoost: round1(intradayRangeBoost),
    breakoutBoost: round1(breakoutBoost),
    vwapBoost: round1(vwapBoost),
    floatBoost: round1(floatBoost),
    newsBoost: round1(newsBoost),
    shortInterestBoost: round1(shortInterestBoost),
    optionsFlowBoost: round1(optionsFlowBoost),
    patternBoost: round1(patternBoost),
    missingPenalty: round1(missingPenalty),
    rawTotal: round1(rawTotal),
    maxAchievable,
    finalScore,
  };
}
