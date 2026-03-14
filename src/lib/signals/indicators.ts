/**
 * Signal indicator calculation utilities.
 * Each function is pure — takes normalized data in, returns a computed value out.
 */

import { NormalizedCandle } from '@/lib/types';

// ---------------------------------------------------------------------------
// Momentum — percent change from N minutes ago to latest candle close
// ---------------------------------------------------------------------------
export function calcMomentum(
  candles: NormalizedCandle[],
  minutesAgo: number,
  latestPrice: number
): number | null {
  if (candles.length === 0) return null;

  const now = candles[candles.length - 1].timestamp.getTime();
  const targetTime = now - minutesAgo * 60 * 1000;

  // Find the candle closest to targetTime
  let closest = candles[0];
  let closestDiff = Math.abs(candles[0].timestamp.getTime() - targetTime);
  for (const c of candles) {
    const diff = Math.abs(c.timestamp.getTime() - targetTime);
    if (diff < closestDiff) {
      closest = c;
      closestDiff = diff;
    }
  }

  if (closest.close === 0) return null;
  return ((latestPrice - closest.close) / closest.close) * 100;
}

// ---------------------------------------------------------------------------
// RVOL — Relative Volume = current volume / average volume
// ---------------------------------------------------------------------------
export function calcRVOL(currentVolume: number | null, averageVolume: number | null): number | null {
  if (currentVolume == null || averageVolume == null || averageVolume === 0) return null;
  return currentVolume / averageVolume;
}

// ---------------------------------------------------------------------------
// Volume Spike Ratio — latest candle volume vs average candle volume
// ---------------------------------------------------------------------------
export function calcVolumeSpikeRatio(candles: NormalizedCandle[]): number | null {
  if (candles.length < 5) return null;

  const latestVolume = candles[candles.length - 1].volume;
  // Average of all candles except the latest
  const priorCandles = candles.slice(0, -1);
  const avgVolume = priorCandles.reduce((sum, c) => sum + c.volume, 0) / priorCandles.length;

  if (avgVolume === 0) return null;
  return latestVolume / avgVolume;
}

// ---------------------------------------------------------------------------
// VWAP — Volume-Weighted Average Price over the candle series
// ---------------------------------------------------------------------------
export function calcVWAP(candles: NormalizedCandle[]): number | null {
  if (candles.length === 0) return null;

  let cumulativeTPV = 0; // cumulative (typical price × volume)
  let cumulativeVolume = 0;

  for (const c of candles) {
    const typicalPrice = (c.high + c.low + c.close) / 3;
    cumulativeTPV += typicalPrice * c.volume;
    cumulativeVolume += c.volume;
  }

  if (cumulativeVolume === 0) return null;
  return cumulativeTPV / cumulativeVolume;
}

export function calcPctFromVWAP(currentPrice: number, vwap: number | null): number | null {
  if (vwap == null || vwap === 0) return null;
  return ((currentPrice - vwap) / vwap) * 100;
}

// ---------------------------------------------------------------------------
// Breakout detection — is price near or above recent highs?
// ---------------------------------------------------------------------------
export function calcBreakoutFlags(
  currentPrice: number,
  candles: NormalizedCandle[],
  nearHighPct: number
): { isBreakout: boolean; nearHigh: boolean; recentHigh: number | null } {
  if (candles.length === 0) {
    return { isBreakout: false, nearHigh: false, recentHigh: null };
  }

  const recentHigh = Math.max(...candles.map((c) => c.high));
  const threshold = recentHigh * (1 - nearHighPct);

  return {
    isBreakout: currentPrice >= recentHigh,
    nearHigh: currentPrice >= threshold,
    recentHigh,
  };
}

// ---------------------------------------------------------------------------
// News score — simple count-based score of recent articles
// ---------------------------------------------------------------------------
export function calcNewsScore(
  articleCount: number,
  maxArticles: number
): number {
  if (articleCount <= 0) return 0;
  // Normalized 0–1, capped at maxArticles
  return Math.min(articleCount / maxArticles, 1);
}

// ---------------------------------------------------------------------------
// Average volume from candle series (sum of volumes / number of candles)
// ---------------------------------------------------------------------------
export function calcAverageVolume(candles: NormalizedCandle[]): number | null {
  if (candles.length === 0) return null;
  return candles.reduce((sum, c) => sum + c.volume, 0) / candles.length;
}

// ---------------------------------------------------------------------------
// Total volume from today's candles
// ---------------------------------------------------------------------------
export function calcCurrentDayVolume(candles: NormalizedCandle[]): number {
  return candles.reduce((sum, c) => sum + c.volume, 0);
}

// ---------------------------------------------------------------------------
// EMA — Exponential Moving Average
// ---------------------------------------------------------------------------
export function calcEMA(candles: NormalizedCandle[], period: number): number[] {
  if (candles.length === 0) return [];
  const k = 2 / (period + 1);
  const ema: number[] = [candles[0].close];
  for (let i = 1; i < candles.length; i++) {
    ema.push(candles[i].close * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

// ---------------------------------------------------------------------------
// ATR — Average True Range
// ---------------------------------------------------------------------------
export function calcATR(candles: NormalizedCandle[], period: number): number[] {
  if (candles.length === 0) return [];
  const tr: number[] = [candles[0].high - candles[0].low];
  for (let i = 1; i < candles.length; i++) {
    tr.push(Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close),
    ));
  }
  // Smoothed ATR using Wilder's method
  const atr: number[] = [];
  const firstATR = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = 0; i < period - 1; i++) atr.push(0);
  atr.push(firstATR);
  for (let i = period; i < tr.length; i++) {
    atr.push((atr[atr.length - 1] * (period - 1) + tr[i]) / period);
  }
  return atr;
}

// ---------------------------------------------------------------------------
// Bollinger Bands — returns bandwidth (normalized), upper, middle, lower
// ---------------------------------------------------------------------------
export function calcBollingerBands(
  candles: NormalizedCandle[],
  period: number,
  mult: number = 2,
): { upper: number; middle: number; lower: number; width: number }[] {
  const result: { upper: number; middle: number; lower: number; width: number }[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) {
      result.push({ upper: 0, middle: 0, lower: 0, width: 0 });
      continue;
    }
    const slice = candles.slice(i - period + 1, i + 1).map(c => c.close);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const stddev = Math.sqrt(slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period);
    result.push({
      upper: mean + mult * stddev,
      middle: mean,
      lower: mean - mult * stddev,
      width: mean > 0 ? (mult * stddev * 2) / mean : 0,
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Linear Regression — slope, intercept, R² for a series of values
// ---------------------------------------------------------------------------
export function linearRegression(values: number[]): { slope: number; intercept: number; r2: number } {
  const n = values.length;
  if (n < 2) return { slope: 0, intercept: values[0] ?? 0, r2: 0 };
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i; sumY += values[i]; sumXY += i * values[i];
    sumX2 += i * i; sumY2 += values[i] ** 2;
  }
  const denom = n * sumX2 - sumX ** 2;
  if (denom === 0) return { slope: 0, intercept: sumY / n, r2: 0 };
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  const ssTot = sumY2 - (sumY ** 2) / n;
  const ssRes = values.reduce((s, v, i) => s + (v - (intercept + slope * i)) ** 2, 0);
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;
  return { slope, intercept, r2 };
}
