/**
 * POST /api/chart/batch — serve 1D chart candles from the pipeline's
 * in-memory cache.  Zero extra Twelve Data credits consumed.
 *
 * Body: { symbols: string[] }
 * Returns: Record<symbol, { candles: ChartCandle[], source: string }>
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { getCachedCandles } from '@/lib/jobs';

interface ChartCandle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Get midnight ET today as a UTC Date (includes pre-market). */
function getTodayStartET(): Date {
  const now = new Date();
  const etStr = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
  const etDate = new Date(etStr);
  const offsetMs = now.getTime() - etDate.getTime();
  const midnightET = new Date(etDate);
  midnightET.setHours(0, 0, 0, 0);
  return new Date(midnightET.getTime() + offsetMs);
}

/** Build candles from stored SignalSnapshot prices. */
async function snapshotFallback(symbol: string): Promise<ChartCandle[]> {
  const todayStart = getTodayStartET();
  const snapshots = await prisma.signalSnapshot.findMany({
    where: { symbol, timestamp: { gte: todayStart } },
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

  const pipelineCandles = getCachedCandles();
  const todayStart = getTodayStartET();
  const result: Record<string, { candles: ChartCandle[]; source: string }> = {};

  for (const sym of symbols) {
    const cached = pipelineCandles.get(sym);
    if (cached && cached.length > 0) {
      // Filter to today only (includes pre-market)
      const todayCandles: ChartCandle[] = cached
        .filter((c) => c.timestamp >= todayStart)
        .map((c) => ({
          time: c.timestamp.toISOString(),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
        }));
      result[sym] = { candles: todayCandles, source: 'pipeline-cache' };
    } else {
      // Pipeline hasn't cached this symbol yet — fall back to DB snapshots
      const candles = await snapshotFallback(sym);
      result[sym] = { candles, source: 'snapshot' };
    }
  }

  return NextResponse.json(result);
}
