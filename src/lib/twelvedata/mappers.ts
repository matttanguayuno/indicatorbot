/**
 * Map Twelve Data API responses to normalized internal types.
 */

import type { TwelveDataTimeSeries } from './types';
import type { NormalizedCandle } from '@/lib/finnhub/types';

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
