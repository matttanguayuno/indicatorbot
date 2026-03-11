/**
 * GET /api/chart/[symbol] — on-demand candle data for charting.
 * Supports ?interval=1min|5min|15min|30min|1h|4h&range=1H|1D|1W|1M|Q|1Y|YTD|Max
 * Uses whichever data source is configured in settings.
 * Auto-falls back to Finnhub when Twelve Data credits are exhausted.
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { getTimeSeries, isQuotaExhausted } from '@/lib/twelvedata/client';
import { mapTwelveDataCandles } from '@/lib/twelvedata/mappers';
import { getCandles as getFHCandles } from '@/lib/finnhub/client';
import { mapCandles as mapFHCandles } from '@/lib/finnhub/mappers';

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
 * Minimum interval required for each range so APIs return useful data.
 * Finnhub free-tier only has limited intraday history, and Twelve Data
 * caps at 5000 candles per request.
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

/** Map our interval names to Finnhub resolution strings */
function toFinnhubResolution(interval: Interval): string {
  switch (interval) {
    case '1min':  return '1';
    case '5min':  return '5';
    case '15min': return '15';
    case '30min': return '30';
    case '1h':    return '60';
    case '4h':    return 'D'; // Finnhub doesn't support 4h; use daily
    default:      return '1';
  }
}

/** Compute UNIX-timestamp range (from/to) for a given range */
function computeDateRange(range: Range): { from: number; to: number } {
  const now = new Date();
  const to = Math.floor(now.getTime() / 1000);
  let fromDate: Date;

  switch (range) {
    case '1H':
      fromDate = new Date(now.getTime() - 60 * 60 * 1000);
      break;
    case '1D':
      fromDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      break;
    case '1W':
      fromDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case '1M':
      fromDate = new Date(now);
      fromDate.setMonth(fromDate.getMonth() - 1);
      break;
    case 'Q':
      fromDate = new Date(now);
      fromDate.setMonth(fromDate.getMonth() - 3);
      break;
    case '1Y':
      fromDate = new Date(now);
      fromDate.setFullYear(fromDate.getFullYear() - 1);
      break;
    case 'YTD':
      fromDate = new Date(now.getFullYear(), 0, 1);
      break;
    case 'Max':
      fromDate = new Date(now);
      fromDate.setFullYear(fromDate.getFullYear() - 20);
      break;
    default:
      fromDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  }

  return { from: Math.floor(fromDate.getTime() / 1000), to };
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

const CACHE_TTL_MS = 5 * 60 * 1000;
const chartCache = new Map<string, CachedChart>();

async function fetchTwelveDataCandles(symbol: string, interval: Interval, range: Range): Promise<ChartCandle[]> {
  const outputsize = computeOutputSize(interval, range);
  const seriesMap = await getTimeSeries([symbol], interval, outputsize);
  const series = seriesMap.get(symbol);
  if (!series) return [];

  const normalized = mapTwelveDataCandles(series);
  return normalized.map((c) => ({
    time: c.timestamp.toISOString(),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  }));
}

async function fetchFinnhubCandles(symbol: string, interval: Interval, range: Range): Promise<ChartCandle[]> {
  const resolution = toFinnhubResolution(interval);
  const { from, to } = computeDateRange(range);
  console.log(`[Chart] Finnhub fetch: ${symbol} res=${resolution} from=${new Date(from * 1000).toISOString()} to=${new Date(to * 1000).toISOString()}`);
  const raw = await getFHCandles(symbol, resolution, from, to);
  if (!raw) {
    console.log(`[Chart] Finnhub returned null for ${symbol}`);
    return [];
  }

  const normalized = mapFHCandles(raw);
  console.log(`[Chart] Finnhub returned ${normalized.length} candles for ${symbol}`);
  if (normalized.length > 0) {
    console.log(`[Chart] Finnhub time range: ${normalized[0].timestamp.toISOString()} → ${normalized[normalized.length - 1].timestamp.toISOString()}`);
  }
  return normalized.map((c) => ({
    time: c.timestamp.toISOString(),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
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
    return NextResponse.json({ symbol: upper, candles: cached.data, cached: true, interval, range });
  }

  // Determine data source from settings, with auto-fallback
  const settings = await prisma.appSettings.findFirst();
  let source = settings?.dataSource ?? 'twelvedata';
  let fallback = false;

  if (source === 'twelvedata' && isQuotaExhausted()) {
    source = 'finnhub';
    fallback = true;
  }
  console.log(`[Chart] Source: ${source}, fallback: ${fallback}, quotaExhausted: ${isQuotaExhausted()}`);

  let candles: ChartCandle[];
  if (source === 'finnhub') {
    candles = await fetchFinnhubCandles(upper, interval, range);
  } else {
    candles = await fetchTwelveDataCandles(upper, interval, range);
    // If Twelve Data returned nothing (e.g. quota hit mid-request), try Finnhub
    if (candles.length === 0) {
      candles = await fetchFinnhubCandles(upper, interval, range);
      if (candles.length > 0) fallback = true;
    }
  }

  if (candles.length === 0) {
    return NextResponse.json(
      { symbol: upper, candles: [], error: 'No candle data available', interval, range },
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
    source: fallback ? 'finnhub (fallback)' : source,
    candleCount: candles.length,
    timeRange: candles.length > 0
      ? { first: candles[0].time, last: candles[candles.length - 1].time }
      : null,
  });
}
