/**
 * POST /api/chart/batch — fetch 1D candle data for multiple symbols in a single
 * Twelve Data API call instead of N individual calls.
 *
 * Body: { symbols: string[] }
 * Returns: Record<symbol, { candles: ChartCandle[], source: string }>
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { getTimeSeries } from '@/lib/twelvedata/client';
import { mapTwelveDataCandles } from '@/lib/twelvedata/mappers';

interface ChartCandle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface CachedChart {
  data: ChartCandle[];
  fetchedAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min cache for batch
const batchCache = new Map<string, CachedChart>();

/** Filter candles to today's regular market hours (9:30-4:00 ET). */
function filterTodayMarketHours(candles: ChartCandle[]): ChartCandle[] {
  const todayET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const todayDate = `${todayET.getFullYear()}-${String(todayET.getMonth() + 1).padStart(2, '0')}-${String(todayET.getDate()).padStart(2, '0')}`;
  return candles.filter((c) => {
    const et = new Date(new Date(c.time).toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const dateStr = `${et.getFullYear()}-${String(et.getMonth() + 1).padStart(2, '0')}-${String(et.getDate()).padStart(2, '0')}`;
    if (dateStr !== todayDate) return false;
    const mins = et.getHours() * 60 + et.getMinutes();
    return mins >= 570 && mins < 960;
  });
}

/** Build candles from stored SignalSnapshot prices. */
async function snapshotFallback(symbol: string): Promise<ChartCandle[]> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const snapshots = await prisma.signalSnapshot.findMany({
    where: { symbol, timestamp: { gte: since } },
    orderBy: { timestamp: 'asc' },
    select: { currentPrice: true, timestamp: true },
    take: 5000,
  });

  return snapshots.map((s) => ({
    time: s.timestamp.toISOString(),
    open: s.currentPrice,
    high: s.currentPrice,
    low: s.currentPrice,
    close: s.currentPrice,
    volume: 0,
  }));
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const symbols: string[] = (body.symbols ?? []).map((s: string) => s.toUpperCase()).slice(0, 50);

  if (symbols.length === 0) {
    return NextResponse.json({});
  }

  const now = Date.now();
  const result: Record<string, { candles: ChartCandle[]; source: string }> = {};

  // Separate cached vs uncached symbols
  const uncachedSymbols: string[] = [];
  for (const sym of symbols) {
    const cached = batchCache.get(sym);
    if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
      result[sym] = { candles: cached.data, source: 'cache' };
    } else {
      uncachedSymbols.push(sym);
    }
  }

  if (uncachedSymbols.length > 0) {
    // Single batch Twelve Data call for all uncached symbols
    try {
      const seriesMap = await getTimeSeries(uncachedSymbols, '1min', 390);

      for (const sym of uncachedSymbols) {
        const series = seriesMap.get(sym);
        if (series) {
          const normalized = mapTwelveDataCandles(series);
          let candles: ChartCandle[] = normalized.map((c) => ({
            time: c.timestamp.toISOString(),
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume,
          }));
          candles = filterTodayMarketHours(candles);
          batchCache.set(sym, { data: candles, fetchedAt: now });
          result[sym] = { candles, source: 'twelvedata' };
        } else {
          // Twelve Data didn't return this symbol — try snapshot fallback
          let candles = await snapshotFallback(sym);
          candles = filterTodayMarketHours(candles);
          result[sym] = { candles, source: 'snapshot' };
        }
      }
    } catch (err) {
      console.error('[Chart Batch] Twelve Data error:', err instanceof Error ? err.message : err);
      // Fallback all uncached to snapshots
      for (const sym of uncachedSymbols) {
        if (!result[sym]) {
          let candles = await snapshotFallback(sym);
          candles = filterTodayMarketHours(candles);
          result[sym] = { candles, source: 'snapshot' };
        }
      }
    }
  }

  // Evict stale cache entries
  if (batchCache.size > 100) {
    for (const [key, entry] of batchCache) {
      if (now - entry.fetchedAt > CACHE_TTL_MS * 2) batchCache.delete(key);
    }
  }

  return NextResponse.json(result);
}
