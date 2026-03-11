/**
 * GET /api/chart/[symbol] — on-demand candle data for charting.
 * Supports ?interval=1min|5min|15min|30min|1h|4h&range=1H|1D|1W|1M|Q|1Y|YTD|Max
 * Fetches from Twelve Data with a 5-minute in-memory cache keyed by symbol+interval+range.
 * Costs 1 API credit per unique combo per 5 minutes.
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

const VALID_INTERVALS = ['1min', '5min', '15min', '30min', '1h', '4h'] as const;
const VALID_RANGES = ['1H', '1D', '1W', '1M', 'Q', '1Y', 'YTD', 'Max'] as const;

type Interval = (typeof VALID_INTERVALS)[number];
type Range = (typeof VALID_RANGES)[number];

/** Approximate number of trading minutes per range */
function tradingMinutesForRange(range: Range): number {
  switch (range) {
    case '1H':   return 60;
    case '1D':   return 390;          // 6.5 hrs
    case '1W':   return 5 * 390;      // 1,950
    case '1M':   return 22 * 390;     // 8,580
    case 'Q':    return 65 * 390;     // 25,350
    case '1Y':   return 252 * 390;    // 98,280
    case 'YTD': {
      const now = new Date();
      const jan1 = new Date(now.getFullYear(), 0, 1);
      const days = Math.max(1, Math.ceil((now.getTime() - jan1.getTime()) / 86_400_000));
      const tradingDays = Math.round(days * 252 / 365);
      return tradingDays * 390;
    }
    case 'Max':  return 5000 * 60;    // just use max outputsize
    default:     return 390;
  }
}

function intervalMinutes(interval: Interval): number {
  switch (interval) {
    case '1min':  return 1;
    case '5min':  return 5;
    case '15min': return 15;
    case '30min': return 30;
    case '1h':    return 60;
    case '4h':    return 240;
    default:      return 1;
  }
}

function computeOutputSize(interval: Interval, range: Range): number {
  const mins = tradingMinutesForRange(range);
  const intMins = intervalMinutes(interval);
  const candles = Math.ceil(mins / intMins);
  return Math.max(1, Math.min(candles, 5000)); // Twelve Data max is 5000
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const chartCache = new Map<string, CachedChart>();

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ symbol: string }> },
) {
  const { symbol } = await params;
  const upper = symbol.toUpperCase();

  const url = new URL(req.url);
  const rawInterval = url.searchParams.get('interval') ?? '1min';
  const rawRange = url.searchParams.get('range') ?? '1D';

  const interval: Interval = (VALID_INTERVALS as readonly string[]).includes(rawInterval)
    ? (rawInterval as Interval)
    : '1min';
  const range: Range = (VALID_RANGES as readonly string[]).includes(rawRange)
    ? (rawRange as Range)
    : '1D';

  const cacheKey = `${upper}:${interval}:${range}`;

  // Check cache
  const cached = chartCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return NextResponse.json({ symbol: upper, candles: cached.data, cached: true, interval, range });
  }

  const outputsize = computeOutputSize(interval, range);
  const seriesMap = await getTimeSeries([upper], interval, outputsize);
  const series = seriesMap.get(upper);

  if (!series) {
    return NextResponse.json(
      { symbol: upper, candles: [], error: 'No candle data available', interval, range },
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
  chartCache.set(cacheKey, { data: candles, fetchedAt: Date.now() });

  // Evict stale entries periodically
  if (chartCache.size > 100) {
    const now = Date.now();
    for (const [key, entry] of chartCache) {
      if (now - entry.fetchedAt > CACHE_TTL_MS * 2) chartCache.delete(key);
    }
  }

  return NextResponse.json({ symbol: upper, candles, cached: false, interval, range });
}
