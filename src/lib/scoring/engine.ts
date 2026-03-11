/**
 * Deterministic signal scoring engine.
 * Takes computed indicators and produces a 0–100 score.
 *
 * Works in two modes depending on hasCandleData:
 *  - Full mode (Twelve Data candles): scores 5m/15m/1h momentum, RVOL, VWAP, volume spike
 *  - Quote-only mode (Finnhub): scores intraday + 1d momentum, normalises against lower max
 */

import { SCORING_WEIGHTS, SCORING_PENALTIES } from '@/lib/config';

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
function scoreMomentum(inputs: SignalInputs): number {
  const w = SCORING_WEIGHTS.momentum;
  const tf = w.timeframes;

  const entries: [number | null, number][] = [
    [inputs.pctChange5m, tf['5m']],
    [inputs.pctChange15m, tf['15m']],
    [inputs.pctChange1h, tf['1h']],
    [inputs.pctChange1d, tf['1d']],
    [inputs.pctChangeIntraday, tf['intraday']],
  ];

  let totalWeight = 0;
  let weightedSum = 0;

  for (const [pct, tfWeight] of entries) {
    if (pct != null) {
      const factor = clamp(pct / 5, 0, 1);
      weightedSum += factor * tfWeight;
      totalWeight += tfWeight;
    }
  }

  if (totalWeight === 0) return 0;
  return (weightedSum / totalWeight) * w.weight;
}

// --- RVOL ---
function scoreRvol(rvol: number | null): number {
  if (rvol == null) return 0;
  const w = SCORING_WEIGHTS.rvol;
  if (rvol >= w.highThreshold) return w.weight;
  if (rvol >= w.moderateThreshold) return w.weight * 0.5;
  return 0;
}

// --- Volume spike ---
function scoreVolumeSpike(ratio: number | null): number {
  if (ratio == null) return 0;
  const w = SCORING_WEIGHTS.volumeSpike;
  if (ratio >= w.spikeThreshold) return w.weight;
  if (ratio >= w.spikeThreshold * 0.5) return w.weight * 0.5;
  return 0;
}

// --- Intraday range position ---
function scoreIntradayRange(rangePct: number | null): number {
  if (rangePct == null) return 0;
  const w = SCORING_WEIGHTS.intradayRange;
  if (rangePct >= 0.85) return w.weight;
  if (rangePct >= 0.65) return w.weight * 0.6;
  if (rangePct >= 0.50) return w.weight * 0.3;
  return 0;
}

// --- Breakout / gap-up ---
function scoreBreakout(inputs: SignalInputs): number {
  const w = SCORING_WEIGHTS.breakout;
  if (inputs.isBreakout) return w.weight;
  if (inputs.nearHigh) return w.weight * 0.5;
  if (inputs.gapUpPct != null && inputs.gapUpPct >= w.gapUpPct) {
    return inputs.gapUpPct >= w.gapUpPct * 2 ? w.weight : w.weight * 0.5;
  }
  return 0;
}

// --- VWAP ---
function scoreVwap(pctFromVwap: number | null): number {
  if (pctFromVwap == null) return 0;
  const w = SCORING_WEIGHTS.vwap;
  if (pctFromVwap > 2) return w.weight;
  if (pctFromVwap > 0) return w.weight * 0.5;
  return 0;
}

// --- Float ---
function scoreFloat(floatVal: number | null): number {
  if (floatVal == null) return 0;
  const w = SCORING_WEIGHTS.float;
  if (floatVal <= w.microFloatThreshold) return w.weight;
  if (floatVal <= w.lowFloatThreshold) return w.weight * 0.5;
  return 0;
}

// --- News catalyst ---
function scoreNewsCatalyst(newsScore: number): number {
  return newsScore * SCORING_WEIGHTS.newsCatalyst.weight;
}

// --- Short interest ---
function scoreShortInterest(si: number | null): number {
  if (si == null) return 0;
  const w = SCORING_WEIGHTS.shortInterest;
  if (si >= w.highThreshold) return w.weight;
  if (si >= w.moderateThreshold) return w.weight * 0.5;
  return 0;
}

// --- Options flow ---
function scoreOptionsFlow(flow: number | null): number {
  if (flow == null) return 0;
  const w = SCORING_WEIGHTS.optionsFlow;
  if (flow >= w.bullishThreshold) return w.weight;
  return 0;
}

// --- Missing data penalty (only for fields that COULD be available) ---
function calcMissingPenalty(inputs: SignalInputs): number {
  const fields: (keyof SignalInputs)[] = ['float', 'shortInterest', 'optionsFlowValue'];
  let count = 0;
  for (const f of fields) {
    if (inputs[f] == null) count++;
  }
  return Math.min(count * SCORING_PENALTIES.missingDataPerField, SCORING_PENALTIES.maxMissingPenalty);
}

// --- Max achievable: lower when candle-only categories can't score ---
function calcMaxAchievable(inputs: SignalInputs): number {
  let max = 100;
  if (!inputs.hasCandleData) {
    max -= SCORING_WEIGHTS.rvol.weight;        // 10
    max -= SCORING_WEIGHTS.volumeSpike.weight;  // 5
    max -= SCORING_WEIGHTS.vwap.weight;         // 5
  }
  return max;
}

// --- Main scoring function ---
export function calculateScore(inputs: SignalInputs): ScoreBreakdown {
  const momentumScore = scoreMomentum(inputs);
  const rvolBoost = scoreRvol(inputs.rvol);
  const volumeSpikeBoost = scoreVolumeSpike(inputs.volumeSpikeRatio);
  const intradayRangeBoost = scoreIntradayRange(inputs.intradayRangePct);
  const breakoutBoost = scoreBreakout(inputs);
  const vwapBoost = scoreVwap(inputs.pctFromVwap);
  const floatBoost = scoreFloat(inputs.float);
  const newsBoost = scoreNewsCatalyst(inputs.newsScore);
  const shortInterestBoost = scoreShortInterest(inputs.shortInterest);
  const optionsFlowBoost = scoreOptionsFlow(inputs.optionsFlowValue);
  const missingPenalty = calcMissingPenalty(inputs);

  const rawTotal =
    momentumScore + rvolBoost + volumeSpikeBoost + intradayRangeBoost +
    breakoutBoost + vwapBoost + floatBoost + newsBoost +
    shortInterestBoost + optionsFlowBoost - missingPenalty;

  const maxAchievable = calcMaxAchievable(inputs);
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
    missingPenalty: round1(missingPenalty),
    rawTotal: round1(rawTotal),
    maxAchievable,
    finalScore,
  };
}
