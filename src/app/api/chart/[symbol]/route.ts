/**
 * GET /api/chart/[symbol] — candle data for charting.
 * Supports ?interval=1min|5min|15min|30min|1h|4h&range=1H|1D|1W|1M|Q|1Y|YTD|Max
 *
 * Short ranges (1H, 1D): uses stored SignalSnapshot history from DB (0 credits).
 *   The polling pipeline writes a price point every ~60s, so the DB has live data.
 * Longer ranges (1W+): fetches from Twelve Data API (1 credit, cached 15 min).
 * (Finnhub free tier does NOT support candle data — returns 403.)
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { getTimeSeries } from '@/lib/twelvedata/client';
import { mapTwelveDataCandles } from '@/lib/twelvedata/mappers';

interface CachedChart {
  data: ChartCandle[];
  fetchedAt: number;
  ttl: number;
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

/** Downsample raw snapshot data into OHLC candles of the requested interval. */
function downsampleSnapshots(
  raw: { time: string; price: number }[],
  interval: Interval,
): ChartCandle[] {
  if (raw.length === 0) return [];
  const bucketMs = intervalMinutes(interval) * 60_000;
  const candles: ChartCandle[] = [];
  let bucketStart = Math.floor(new Date(raw[0].time).getTime() / bucketMs) * bucketMs;
  let o = raw[0].price, h = o, l = o, c = o;
  let bucketTime = raw[0].time;

  for (const pt of raw) {
    const t = new Date(pt.time).getTime();
    const currentBucket = Math.floor(t / bucketMs) * bucketMs;
    if (currentBucket !== bucketStart) {
      candles.push({ time: bucketTime, open: o, high: h, low: l, close: c, volume: 0 });
      bucketStart = currentBucket;
      o = pt.price; h = o; l = o; c = o;
      bucketTime = pt.time;
    } else {
      h = Math.max(h, pt.price);
      l = Math.min(l, pt.price);
      c = pt.price;
    }
  }
  // push final bucket
  candles.push({ time: bucketTime, open: o, high: h, low: l, close: c, volume: 0 });
  return candles;
}

/** Build a simple chart from stored SignalSnapshot prices (fallback when API is unavailable). */
async function fetchSnapshotHistory(symbol: string, interval: Interval, range: Range): Promise<ChartCandle[]> {
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

  console.log(`[Chart] Snapshot fallback: ${snapshots.length} raw points for ${symbol} since ${since.toISOString()}`);

  const raw = snapshots.map((s) => ({ time: s.timestamp.toISOString(), price: s.currentPrice }));
  const candles = downsampleSnapshots(raw, interval);
  console.log(`[Chart] Snapshot downsampled to ${candles.length} candles (interval=${interval})`);
  return candles;
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

  // Check in-memory cache (applies to both snapshot and API-sourced data)
  const cached = chartCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < cached.ttl) {
    return NextResponse.json({
      symbol: upper, candles: cached.data, cached: true, interval, range,
      source: 'cache', candleCount: cached.data.length,
      timeRange: cached.data.length > 0
        ? { first: cached.data[0].time, last: cached.data[cached.data.length - 1].time }
        : null,
    });
  }

  let candles: ChartCandle[] = [];
  let source = 'snapshot-history';

  // 1H: prefer DB snapshots (recent data, no API credits needed).
  // 1D: prefer Twelve Data API (full trading day with real OHLCV candles).
  //     Snapshots only go back to when the server started polling, which may
  //     miss the first hours of the day.
  const snapshotFirst = range === '1H';

  if (snapshotFirst) {
    candles = await fetchSnapshotHistory(upper, interval, range);
  }

  // Use Twelve Data when snapshots are insufficient or for ranges other than 1H
  if (candles.length < 2) {
    candles = await fetchTwelveDataCandles(upper, interval, range);
    source = 'twelvedata';
  }

  // Final fallback: try snapshots if API failed
  if (candles.length === 0 && !snapshotFirst) {
    candles = await fetchSnapshotHistory(upper, interval, range);
    source = 'snapshot-history';
  }

  // For 1D / 1H ranges, filter to today's regular market hours only (9:30 AM – 4:00 PM ET)
  // so all stocks share the same X-axis timeline and don't show previous days.
  if (range === '1D' || range === '1H') {
    const todayET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const todayDate = `${todayET.getFullYear()}-${String(todayET.getMonth() + 1).padStart(2, '0')}-${String(todayET.getDate()).padStart(2, '0')}`;
    candles = candles.filter((c) => {
      const et = new Date(new Date(c.time).toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const dateStr = `${et.getFullYear()}-${String(et.getMonth() + 1).padStart(2, '0')}-${String(et.getDate()).padStart(2, '0')}`;
      if (dateStr !== todayDate) return false;
      const mins = et.getHours() * 60 + et.getMinutes();
      return mins >= 570 && mins < 960; // 9:30 = 570, 16:00 = 960
    });
  }

  if (candles.length === 0) {
    return NextResponse.json(
      { symbol: upper, candles: [], error: 'No data available', interval, range, source: 'none' },
      { status: 200 },
    );
  }

  // Cache result — short TTL for DB-sourced data, longer for API-sourced
  const ttl = source === 'snapshot-history' ? 60_000 : CACHE_TTL_MS; // 1 min vs 15 min
  chartCache.set(cacheKey, { data: candles, fetchedAt: Date.now(), ttl });

  // Evict stale entries periodically
  if (chartCache.size > 100) {
    const now = Date.now();
    for (const [key, entry] of chartCache) {
      if (now - entry.fetchedAt > entry.ttl * 2) chartCache.delete(key);
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
