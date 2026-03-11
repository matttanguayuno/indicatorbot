/**
 * Map Twelve Data API responses to normalized internal types.
 */

import type { TwelveDataTimeSeries, TwelveDataQuote, TwelveDataProfile, TwelveDataStatistics } from './types';
import type { NormalizedCandle, NormalizedQuote, NormalizedProfile } from '@/lib/types';

/**
 * Convert Twelve Data time-series values to NormalizedCandle[],
 * sorted oldest-first by timestamp.
 */
export function mapTwelveDataCandles(series: TwelveDataTimeSeries): NormalizedCandle[] {
  if (!series.values || series.values.length === 0) return [];

  return series.values
    .map((v) => ({
      close: parseFloat(v.close),
      high: parseFloat(v.high),
      low: parseFloat(v.low),
      open: parseFloat(v.open),
      volume: parseInt(v.volume, 10) || 0,
      timestamp: new Date(v.datetime.replace(' ', 'T')),
    }))
    .filter((c) => !isNaN(c.close) && c.close > 0)
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}

/**
 * Derive a NormalizedQuote from candle data (avoids extra API call).
 * Uses first candle's open, last candle's close, and previous_close from candle values.
 */
export function deriveQuoteFromCandles(symbol: string, candles: NormalizedCandle[], series: TwelveDataTimeSeries): NormalizedQuote {
  const latest = candles[candles.length - 1];
  const first = candles[0];

  const high = Math.max(...candles.map((c) => c.high));
  const low = Math.min(...candles.map((c) => c.low));

  // previous_close is available on the first candle value if we requested it
  const prevCloseStr = series.values[series.values.length - 1]?.previous_close;
  const previousClose = prevCloseStr ? parseFloat(prevCloseStr) : first.open;

  const change = latest.close - previousClose;
  const changePercent = previousClose > 0 ? (change / previousClose) * 100 : 0;

  return {
    symbol,
    currentPrice: latest.close,
    change,
    changePercent,
    high,
    low,
    open: first.open,
    previousClose,
    timestamp: latest.timestamp,
  };
}

/**
 * Map Twelve Data /quote response to NormalizedQuote.
 */
export function mapTwelveDataQuote(raw: TwelveDataQuote): NormalizedQuote {
  return {
    symbol: raw.symbol,
    currentPrice: parseFloat(raw.close),
    change: parseFloat(raw.change),
    changePercent: parseFloat(raw.percent_change),
    high: parseFloat(raw.high),
    low: parseFloat(raw.low),
    open: parseFloat(raw.open),
    previousClose: parseFloat(raw.previous_close),
    timestamp: new Date(raw.timestamp * 1000),
  };
}

/**
 * Map Twelve Data /profile + /statistics to NormalizedProfile.
 * Statistics are optional (may not be available on free tier for all symbols).
 */
export function mapTwelveDataProfile(
  raw: TwelveDataProfile,
  stats: TwelveDataStatistics | null,
): NormalizedProfile {
  const stockStats = stats?.statistics?.stock_statistics;
  const valuation = stats?.statistics?.valuations_metrics;

  return {
    symbol: raw.symbol,
    name: raw.name,
    sector: raw.sector || raw.industry || '',
    sharesOutstanding: stockStats?.float_shares ?? stockStats?.shares_outstanding ?? 0,
    marketCap: valuation?.market_capitalization ?? 0,
  };
}
