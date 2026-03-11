/**
 * Signal indicator calculation utilities.
 * Each function is pure — takes normalized data in, returns a computed value out.
 */

import { NormalizedCandle } from '@/lib/finnhub/types';

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
