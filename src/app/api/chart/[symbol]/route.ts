/**
 * GET /api/chart/[symbol] — on-demand intraday candle data for charting.
 * Fetches 1-min candles from Twelve Data with a 5-minute in-memory cache.
 * Costs 1 API credit per unique symbol per 5 minutes.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getTimeSeries } from '@/lib/twelvedata/client';
import { mapTwelveDataCandles } from '@/lib/twelvedata/mappers';

interface CachedChart {
  data: ChartCandle[];
  fetchedAt: number;
}

interface ChartCandle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const chartCache = new Map<string, CachedChart>();

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ symbol: string }> },
) {
  const { symbol } = await params;
  const upper = symbol.toUpperCase();

  // Check cache
  const cached = chartCache.get(upper);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return NextResponse.json({ symbol: upper, candles: cached.data, cached: true });
  }

  // Fetch ~390 1-min candles (full trading day: 6.5 hrs)
  const seriesMap = await getTimeSeries([upper], '1min', 390);
  const series = seriesMap.get(upper);

  if (!series) {
    return NextResponse.json(
      { symbol: upper, candles: [], error: 'No candle data available' },
      { status: 200 },
    );
  }

  const normalized = mapTwelveDataCandles(series);
  const candles: ChartCandle[] = normalized.map((c) => ({
    time: c.timestamp.toISOString(),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  }));

  // Cache result
  chartCache.set(upper, { data: candles, fetchedAt: Date.now() });

  // Evict stale entries periodically
  if (chartCache.size > 50) {
    const now = Date.now();
    for (const [key, entry] of chartCache) {
      if (now - entry.fetchedAt > CACHE_TTL_MS * 2) chartCache.delete(key);
    }
  }

  return NextResponse.json({ symbol: upper, candles, cached: false });
}
