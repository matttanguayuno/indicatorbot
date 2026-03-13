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

/** Get today's 9:30 AM ET (market open) as a UTC Date. */
function getMarketOpenUTC(): Date {
  const now = new Date();
  const etStr = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
  const etDate = new Date(etStr);
  const offsetMs = now.getTime() - etDate.getTime();
  const openET = new Date(etDate);
  openET.setHours(9, 30, 0, 0);
  return new Date(openET.getTime() + offsetMs);
}

/**
 * Ensure candles start at market open (9:30 ET / 7:30 MT).
 * If the first candle is after market open, prepend a synthetic candle
 * at 9:30 ET using the first candle's open price so all charts align.
 * Pre-market candles (before 9:30 ET) are kept as-is.
 */
function ensureMarketOpenStart(candles: ChartCandle[]): ChartCandle[] {
  if (candles.length === 0) return candles;
  const marketOpen = getMarketOpenUTC();
  const firstTime = new Date(candles[0].time);
  // If first candle is already at or before market open, no padding needed
  if (firstTime <= marketOpen) return candles;
  // Prepend a synthetic candle at market open with the first candle's open price
  const synthetic: ChartCandle = {
    time: marketOpen.toISOString(),
    open: candles[0].open,
    high: candles[0].open,
    low: candles[0].open,
    close: candles[0].open,
    volume: 0,
  };
  return [synthetic, ...candles];
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
      result[sym] = { candles: ensureMarketOpenStart(todayCandles), source: 'pipeline-cache' };
    } else {
      // Pipeline hasn't cached this symbol yet — fall back to DB snapshots
      const candles = await snapshotFallback(sym);
      result[sym] = { candles: ensureMarketOpenStart(candles), source: 'snapshot' };
    }
  }

  return NextResponse.json(result);
}
