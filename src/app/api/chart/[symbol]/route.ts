/**
 * GET /api/chart/[symbol] — on-demand candle data for charting.
 * Supports ?interval=1min|5min|15min|30min|1h|4h&range=1H|1D|1W|1M|Q|1Y|YTD|Max
 *
 * Primary source: Twelve Data (800 credits/day free tier).
 * Fallback: builds a simple price chart from stored SignalSnapshot history.
 * (Finnhub free tier does NOT support candle data — returns 403.)
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
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

/** Ordered list of intervals from finest to coarsest */
const INTERVAL_ORDER: Interval[] = ['1min', '5min', '15min', '30min', '1h', '4h'];

/**
 * Minimum interval required for each range so the API can return useful data.
 * Twelve Data caps at 5000 candles per request.
 */
function minIntervalForRange(range: Range): Interval {
  switch (range) {
    case '1H':  return '1min';
    case '1D':  return '1min';
    case '1W':  return '5min';
    case '1M':  return '30min';
    case 'Q':   return '4h';
    case '1Y':  return '4h';
    case 'YTD': return '4h';
    case 'Max': return '4h';
    default:    return '1min';
  }
}

/** Coarsen the requested interval if it's too fine for the range */
function coarsenInterval(interval: Interval, range: Range): Interval {
  const minIdx = INTERVAL_ORDER.indexOf(minIntervalForRange(range));
  const reqIdx = INTERVAL_ORDER.indexOf(interval);
  return reqIdx < minIdx ? INTERVAL_ORDER[minIdx] : interval;
}

/** Approximate number of trading minutes per range */
function tradingMinutesForRange(range: Range): number {
  switch (range) {
    case '1H':   return 60;
    case '1D':   return 390;
    case '1W':   return 5 * 390;
    case '1M':   return 22 * 390;
    case 'Q':    return 65 * 390;
    case '1Y':   return 252 * 390;
    case 'YTD': {
      const now = new Date();
      const jan1 = new Date(now.getFullYear(), 0, 1);
      const days = Math.max(1, Math.ceil((now.getTime() - jan1.getTime()) / 86_400_000));
      const tradingDays = Math.round(days * 252 / 365);
      return tradingDays * 390;
    }
    case 'Max':  return 5000 * 60;
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
  return Math.max(1, Math.min(candles, 5000));
}

// 15-minute cache to conserve Twelve Data credits
const CACHE_TTL_MS = 15 * 60 * 1000;
const chartCache = new Map<string, CachedChart>();

async function fetchTwelveDataCandles(symbol: string, interval: Interval, range: Range): Promise<ChartCandle[]> {
  const outputsize = computeOutputSize(interval, range);
  console.log(`[Chart] TwelveData fetch: ${symbol} interval=${interval} outputsize=${outputsize}`);
  const seriesMap = await getTimeSeries([symbol], interval, outputsize);
  const series = seriesMap.get(symbol);
  if (!series) {
    console.log(`[Chart] TwelveData returned no series for ${symbol}`);
    return [];
  }

  const normalized = mapTwelveDataCandles(series);
  console.log(`[Chart] TwelveData returned ${normalized.length} candles for ${symbol}`);
  return normalized.map((c) => ({
    time: c.timestamp.toISOString(),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  }));
}

/** Build a simple chart from stored SignalSnapshot prices (fallback when API is unavailable). */
async function fetchSnapshotHistory(symbol: string, range: Range): Promise<ChartCandle[]> {
  const now = new Date();
  let since: Date;

  switch (range) {
    case '1H':  since = new Date(now.getTime() - 60 * 60 * 1000); break;
    case '1D':  since = new Date(now.getTime() - 24 * 60 * 60 * 1000); break;
    case '1W':  since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); break;
    case '1M':  since = new Date(now); since.setMonth(since.getMonth() - 1); break;
    case 'Q':   since = new Date(now); since.setMonth(since.getMonth() - 3); break;
    case '1Y':  since = new Date(now); since.setFullYear(since.getFullYear() - 1); break;
    case 'YTD': since = new Date(now.getFullYear(), 0, 1); break;
    case 'Max': since = new Date(2000, 0, 1); break;
    default:    since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  }

  const snapshots = await prisma.signalSnapshot.findMany({
    where: { symbol, timestamp: { gte: since } },
    orderBy: { timestamp: 'asc' },
    select: { currentPrice: true, timestamp: true },
    take: 5000,
  });

  console.log(`[Chart] Snapshot fallback: ${snapshots.length} points for ${symbol} since ${since.toISOString()}`);

  return snapshots.map((s) => ({
    time: s.timestamp.toISOString(),
    open: s.currentPrice,
    high: s.currentPrice,
    low: s.currentPrice,
    close: s.currentPrice,
    volume: 0,
  }));
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ symbol: string }> },
) {
  const { symbol } = await params;
  const upper = symbol.toUpperCase();

  const rawInterval = req.nextUrl.searchParams.get('interval') ?? '1min';
  const rawRange = req.nextUrl.searchParams.get('range') ?? '1D';

  const rawParsedInterval: Interval = (VALID_INTERVALS as readonly string[]).includes(rawInterval)
    ? (rawInterval as Interval)
    : '1min';
  const range: Range = (VALID_RANGES as readonly string[]).includes(rawRange)
    ? (rawRange as Range)
    : '1D';

  // Auto-coarsen interval when range is too long for fine granularity
  const interval = coarsenInterval(rawParsedInterval, range);
  console.log(`[Chart] Request: ${upper} rawInterval=${rawInterval} rawRange=${rawRange} → interval=${interval} range=${range}`);

  const cacheKey = `${upper}:${interval}:${range}`;

  // Check cache
  const cached = chartCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return NextResponse.json({
      symbol: upper, candles: cached.data, cached: true, interval, range,
      source: 'cache', candleCount: cached.data.length,
      timeRange: cached.data.length > 0
        ? { first: cached.data[0].time, last: cached.data[cached.data.length - 1].time }
        : null,
    });
  }

  // Always try Twelve Data first — chart is just 1 credit per request
  let candles = await fetchTwelveDataCandles(upper, interval, range);
  let source = 'twelvedata';

  // If TD fails, fall back to snapshot-based price history from our DB
  if (candles.length === 0) {
    candles = await fetchSnapshotHistory(upper, range);
    source = 'snapshot-history';
  }

  if (candles.length === 0) {
    return NextResponse.json(
      { symbol: upper, candles: [], error: 'No data available', interval, range, source: 'none' },
      { status: 200 },
    );
  }

  // Cache result
  chartCache.set(cacheKey, { data: candles, fetchedAt: Date.now() });

  // Evict stale entries periodically
  if (chartCache.size > 100) {
    const now = Date.now();
    for (const [key, entry] of chartCache) {
      if (now - entry.fetchedAt > CACHE_TTL_MS * 2) chartCache.delete(key);
    }
  }

  return NextResponse.json({
    symbol: upper,
    candles,
    cached: false,
    interval,
    range,
    source,
    candleCount: candles.length,
    timeRange: candles.length > 0
      ? { first: candles[0].time, last: candles[candles.length - 1].time }
      : null,
  });
}
