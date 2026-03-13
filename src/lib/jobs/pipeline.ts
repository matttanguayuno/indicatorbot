/**
 * Core polling pipeline: fetches data, computes signals, stores snapshots, generates alerts.
 *
 * Supports two data sources (configurable via Settings):
 *  - "finnhub": quote + profile + news from Finnhub (60 calls/min, no daily cap)
 *  - "twelvedata": candles + derived quote + profile from Twelve Data
 */

import prisma from '@/lib/db';
import { sendPushToAll } from '@/lib/push';
import { checkSellAlerts } from '@/lib/sell-alerts';
import { applySentiment } from '@/lib/news/sentiment';
import {
  getQuote as getFHQuote,
  getCompanyProfile,
  getCompanyNews,
  mapQuote as mapFHQuote,
  mapProfile as mapFHProfile,
  mapNews,
} from '@/lib/finnhub';
import {
  getTimeSeries,
  mapTwelveDataCandles,
  deriveQuoteFromCandles,
  getQuote as getTDQuote,
  mapTwelveDataQuote,
  getProfile as getTDProfile,
  getStatistics,
  mapTwelveDataProfile,
  isQuotaExhausted,
} from '@/lib/twelvedata';
import type { TwelveDataTimeSeries } from '@/lib/twelvedata';
import type { NormalizedCandle, NormalizedQuote, NormalizedProfile } from '@/lib/types';
import {
  calcMomentum,
  calcVolumeSpikeRatio,
  calcVWAP,
  calcPctFromVWAP,
  calcBreakoutFlags,
  calcNewsScore,
  calcAverageVolume,
} from '@/lib/signals';
import { calculateScore, type SignalInputs } from '@/lib/scoring';
import { generateExplanation } from '@/lib/explanations';
import { ALERT_CONFIG, getScoringRules } from '@/lib/config';
import type { ScoringRules } from '@/lib/config';
import { format, subDays } from 'date-fns';

interface ProcessResult {
  symbol: string;
  success: boolean;
  score?: number;
  error?: string;
  candleCount?: number;
}

/**
 * Process a single ticker: fetch quote → compute indicators → score → store snapshot → maybe alert.
 */
async function processTicker(
  symbol: string,
  tickerId: number,
  scoreThreshold: number,
  cooldownMin: number,
  candles: NormalizedCandle[] | null,
  series: TwelveDataTimeSeries | null,
  dataSource: string,
  rules: ScoringRules,
): Promise<ProcessResult> {
  try {
    // 1) Fetch quote — source-dependent
    let quote: NormalizedQuote;
    const hasCandleData = candles != null && candles.length > 0;

    if (dataSource === 'twelvedata') {
      // Derive from candles (0 credits) or fall back to /quote (1 credit)
      if (hasCandleData && series) {
        quote = deriveQuoteFromCandles(symbol, candles!, series);
      } else {
        const rawQuote = await getTDQuote(symbol);
        if (!rawQuote) {
          return { symbol, success: false, error: 'No quote data (Twelve Data)' };
        }
        quote = mapTwelveDataQuote(rawQuote);
      }
    } else {
      // Finnhub quote
      const rawQuote = await getFHQuote(symbol);
      if (!rawQuote || rawQuote.c === 0) {
        return { symbol, success: false, error: 'No quote data (Finnhub)' };
      }
      quote = mapFHQuote(symbol, rawQuote);
    }

    if (quote.currentPrice === 0) {
      return { symbol, success: false, error: 'Quote price is 0' };
    }

    // 2) Fetch company profile — use DB-persisted data first to avoid burning credits.
    //    Only call the API when the ticker has never had profile data populated.
    let profile: NormalizedProfile | null = null;

    // Check in-memory cache first
    const cachedProfile = profileCache.get(symbol);
    if (cachedProfile && Date.now() - cachedProfile.fetchedAt < PROFILE_CACHE_TTL_MS) {
      profile = cachedProfile.profile;
    } else {
      // Check DB — profile data is persisted on the Ticker row
      const tickerRow = await prisma.ticker.findUnique({ where: { id: tickerId }, select: { name: true, sector: true } });
      if (tickerRow?.name) {
        // DB already has profile info — reuse it (0 credits)
        profile = { name: tickerRow.name, sector: tickerRow.sector ?? undefined } as NormalizedProfile;
        profileCache.set(symbol, { profile, fetchedAt: Date.now() });
      } else if (dataSource === 'twelvedata') {
        const [rawProfile, rawStats] = await Promise.all([
          getTDProfile(symbol),
          getStatistics(symbol),
        ]);
        if (rawProfile) {
          profile = mapTwelveDataProfile(rawProfile, rawStats);
          profileCache.set(symbol, { profile, fetchedAt: Date.now() });
        }
      } else {
        const rawProfile = await getCompanyProfile(symbol);
        if (rawProfile) {
          profile = mapFHProfile(rawProfile);
          profileCache.set(symbol, { profile, fetchedAt: Date.now() });
        }
      }
    }

    if (profile) {
      await prisma.ticker.update({
        where: { id: tickerId },
        data: { name: profile.name, sector: profile.sector },
      });
    }

    // 3) News — read from DB only. Finnhub fetching happens on a separate schedule
    // (configured in Settings as newsSummaryTimes, triggered by instrumentation.ts).
    const newsWindowMs = rules.weights.newsCatalyst.recentWindowMinutes * 60 * 1000;
    let recentNewsCount = 0;
    try {
      recentNewsCount = await prisma.newsItem.count({
        where: {
          symbol,
          publishedAt: { gte: new Date(Date.now() - newsWindowMs) },
        },
      });
    } catch {
      // Non-fatal
    }

    // 4) Compute indicators
    const currentPrice = quote.currentPrice;
    const floatShares = profile?.sharesOutstanding ?? null;

    // --- Quote-derived indicators (always available) ---
    const pctChangeIntraday = quote.open > 0
      ? ((currentPrice - quote.open) / quote.open) * 100
      : null;
    const pctChange1d = quote.changePercent;

    const dayRange = quote.high - quote.low;
    const intradayRangePct = dayRange > 0
      ? (currentPrice - quote.low) / dayRange
      : null;

    const gapUpPct = quote.previousClose > 0
      ? (quote.open - quote.previousClose) / quote.previousClose
      : null;

    // --- Candle-derived indicators (only when candles available) ---
    let pctChange5m: number | null = null;
    let pctChange15m: number | null = null;
    let pctChange1h: number | null = null;
    let rvol: number | null = null;
    let volumeSpikeRatio: number | null = null;
    let currentVolume: number | null = null;
    let averageVolume: number | null = null;
    let vwap: number | null = null;
    let pctFromVwap: number | null = null;
    let isBreakout = false;
    let nearHigh = false;
    let recentHigh: number | null = null;

    if (hasCandleData) {
      pctChange5m = calcMomentum(candles!, 5, currentPrice);
      pctChange15m = calcMomentum(candles!, 15, currentPrice);
      pctChange1h = calcMomentum(candles!, 60, currentPrice);

      // Volume spike: latest candle vs average candle volume
      volumeSpikeRatio = calcVolumeSpikeRatio(candles!);

      // RVOL: approximate using recent vs earlier candles volume rate
      // (true RVOL needs multi-day data which we don't have from intraday candles)
      if (candles!.length >= 20) {
        const recentCount = 5;
        const recent = candles!.slice(-recentCount);
        const earlier = candles!.slice(0, -recentCount);
        const recentAvg = recent.reduce((s, c) => s + c.volume, 0) / recent.length;
        const earlierAvg = earlier.reduce((s, c) => s + c.volume, 0) / earlier.length;
        rvol = earlierAvg > 0 ? recentAvg / earlierAvg : null;
      }

      currentVolume = candles!.reduce((s, c) => s + c.volume, 0);
      averageVolume = calcAverageVolume(candles!);

      vwap = calcVWAP(candles!);
      pctFromVwap = calcPctFromVWAP(currentPrice, vwap);

      const breakout = calcBreakoutFlags(currentPrice, candles!, rules.weights.breakout.nearHighPct);
      isBreakout = breakout.isBreakout;
      nearHigh = breakout.nearHigh;
      recentHigh = breakout.recentHigh;
    } else {
      // Quote-only breakout detection
      isBreakout = (gapUpPct ?? 0) >= rules.weights.breakout.gapUpPct * 2;
      nearHigh = intradayRangePct != null ? intradayRangePct >= rules.weights.intradayRange.tiers.full : false;
    }

    // News scoring
    const newsScore = calcNewsScore(recentNewsCount, rules.weights.newsCatalyst.maxArticles);

    // 5) Score
    const signalInputs: SignalInputs = {
      pctChange5m,
      pctChange15m,
      pctChange1h,
      pctChange1d,
      pctChangeIntraday,
      intradayRangePct,
      gapUpPct,
      rvol,
      volumeSpikeRatio,
      pctFromVwap,
      isBreakout,
      nearHigh,
      float: floatShares,
      newsScore,
      shortInterest: null,
      optionsFlowValue: null,
      hasCandleData,
    };

    const scoreBreakdown = calculateScore(signalInputs, rules);
    const explanation = generateExplanation(signalInputs, scoreBreakdown);

    const dataSourceMeta: Record<string, string> = {
      quote: 'available',
      candles: hasCandleData ? 'available' : 'unavailable',
      profile: profile ? 'available' : 'unavailable',
      news: recentNewsCount > 0 ? 'available' : 'unavailable',
    };

    // 6) Store snapshot — use proper columns, no repurposing
    const snapshot = await prisma.signalSnapshot.create({
      data: {
        tickerId,
        symbol,
        currentPrice,
        // Candle-based (null when no candles)
        pctChange5m,
        pctChange15m,
        pctChange1h,
        pctChange1d,
        // Quote-derived (always populated)
        pctChangeIntraday,
        intradayRangePct: intradayRangePct != null ? Math.round(intradayRangePct * 100) / 100 : null,
        gapUpPct: gapUpPct != null ? Math.round(gapUpPct * 10000) / 100 : null,
        // Volume
        currentVolume,
        averageVolume,
        rvol: rvol != null ? Math.round(rvol * 100) / 100 : null,
        volumeSpikeRatio: volumeSpikeRatio != null ? Math.round(volumeSpikeRatio * 100) / 100 : null,
        // Float
        float: floatShares,
        // VWAP
        vwap: vwap != null ? Math.round(vwap * 100) / 100 : null,
        pctFromVwap: pctFromVwap != null ? Math.round(pctFromVwap * 100) / 100 : null,
        // Breakout
        isBreakout,
        nearHigh,
        high52w: recentHigh,
        // News
        recentNewsCount,
        newsScore,
        // Score
        signalScore: scoreBreakdown.finalScore,
        explanation,
        dataSourceMeta: JSON.stringify(dataSourceMeta),
      },
    });

    // 7) Alert check
    if (scoreBreakdown.finalScore >= scoreThreshold) {
      await maybeCreateAlert(symbol, tickerId, scoreBreakdown.finalScore, explanation, snapshot.id, cooldownMin);
    }

    return { symbol, success: true, score: scoreBreakdown.finalScore, candleCount: candles?.length ?? 0 };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Pipeline] Error processing ${symbol}:`, message);
    return { symbol, success: false, error: message };
  }
}

/**
 * Create an alert if cooldown has elapsed since the last alert for this ticker.
 */
async function maybeCreateAlert(
  symbol: string,
  tickerId: number,
  score: number,
  explanation: string,
  snapshotId: number,
  cooldownMin: number,
): Promise<void> {
  const cooldownDate = new Date(Date.now() - cooldownMin * 60 * 1000);

  const recentAlert = await prisma.alert.findFirst({
    where: {
      symbol,
      createdAt: { gte: cooldownDate },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (recentAlert) {
    console.log(`[Alert] Cooldown active for ${symbol}, skipping alert`);
    return;
  }

  await prisma.alert.create({
    data: {
      tickerId,
      symbol,
      scoreAtAlert: score,
      explanation,
      snapshotId,
    },
  });

  console.log(`[Alert] Created alert for ${symbol} (score: ${score})`);

  // Send push notification
  const shortExplanation = explanation.length > 100 ? explanation.slice(0, 97) + '...' : explanation;
  await sendPushToAll({
    title: `🚀 ${symbol} — Score ${Math.round(score)}`,
    body: shortExplanation,
    symbol,
    score,
  }).catch((err) => console.error('[Push] Error sending notification:', err));
}

// ── Candle cache: refetch every poll cycle for real-time data ──
// Grow plan = 55 credits/min, no daily cap. 12 tickers = 12 credits/min,
// well within budget. Fetch fresh candles every cycle for up-to-date signals.
const CANDLE_REFRESH_INTERVAL_MS = 55 * 1000; // slightly under 60s to avoid cache-hit skips from timer drift

// Use globalThis so the cache is shared between the instrumentation hook
// (which runs the pipeline) and API route handlers (which serve chart data).
// Without this, Next.js bundles them separately and each gets its own empty Map.
declare global {
  // eslint-disable-next-line no-var
  var __candleCache: Map<string, NormalizedCandle[]> | undefined;
  // eslint-disable-next-line no-var
  var __seriesCache: Map<string, TwelveDataTimeSeries> | undefined;
  // eslint-disable-next-line no-var
  var __lastCandleFetchTime: number | undefined;
}
if (!globalThis.__candleCache) globalThis.__candleCache = new Map();
if (!globalThis.__seriesCache) globalThis.__seriesCache = new Map();
if (!globalThis.__lastCandleFetchTime) globalThis.__lastCandleFetchTime = 0;

let cachedCandleMap = globalThis.__candleCache;
let cachedSeriesMap = globalThis.__seriesCache;
let lastCandleFetchTime = globalThis.__lastCandleFetchTime;

/** Expose the pipeline's cached candles so chart endpoints can serve from them (0 extra credits). */
export function getCachedCandles(): Map<string, NormalizedCandle[]> {
  return globalThis.__candleCache!;
}

// ── Profile cache: /profile + /statistics cost 2 credits per symbol ──
const PROFILE_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const profileCache = new Map<string, { profile: NormalizedProfile; fetchedAt: number }>();

/**
 * Main polling entry point: processes all active tickers.
 */
export async function runPollingCycle(): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
  results: ProcessResult[];
  dataSource: string;
  candlesAvailable: number;
  candleError: string | null;
}> {
  // Load settings
  const settings = await prisma.appSettings.findFirst();
  const scoreThreshold = settings?.scoreThreshold ?? ALERT_CONFIG.defaultScoreThreshold;
  const cooldownMin = settings?.alertCooldownMin ?? ALERT_CONFIG.cooldownMinutes;
  let dataSource = settings?.dataSource ?? 'twelvedata';

  // Auto-fallback: if Twelve Data credits are exhausted, switch to Finnhub for this cycle
  let autoFallback = false;
  if (dataSource === 'twelvedata' && isQuotaExhausted()) {
    dataSource = 'finnhub';
    autoFallback = true;
    console.warn('[Pipeline] ⚠️ Twelve Data rate-limited — auto-switching to Finnhub for this cycle');
  }

  // Load dynamic scoring rules
  const rules = await getScoringRules();

  // Get active tickers
  const tickers = await prisma.ticker.findMany({
    where: { active: true },
    take: rules.polling.batchSize,
  });

  console.log(`[Pipeline] Processing ${tickers.length} tickers (source: ${dataSource})...`);

  // Pre-fetch candles from Twelve Data (throttled to save API credits)
  const candleMap = new Map<string, NormalizedCandle[]>();
  const seriesMap = new Map<string, TwelveDataTimeSeries>();
  let candleError: string | null = null;
  const now = Date.now();
  const candleAge = now - lastCandleFetchTime;
  const needsRefresh = candleAge >= CANDLE_REFRESH_INTERVAL_MS || cachedCandleMap.size === 0;

  if (dataSource === 'twelvedata') {
    if (!process.env.TWELVEDATA_API_KEY) {
      candleError = 'TWELVEDATA_API_KEY is not set in environment variables';
      console.error(`[Pipeline] ${candleError}`);
    } else if (!needsRefresh) {
      // Reuse cached candles
      for (const [sym, candles] of cachedCandleMap) {
        candleMap.set(sym, candles);
      }
      for (const [sym, s] of cachedSeriesMap) {
        seriesMap.set(sym, s);
      }
      console.log(`[Pipeline] Using cached candles (${candleMap.size} symbols, age: ${Math.round(candleAge / 1000)}s)`);
    } else {
      try {
        const symbols = tickers.map((t: { symbol: string }) => t.symbol);
        // Grow plan: send all symbols in one batch (cost = 1 credit per symbol).
        console.log(`[Pipeline] Fetching Twelve Data candles for: ${symbols.join(', ')}`);
        const result = await getTimeSeries(symbols, '1min', 390);
        console.log(`[Pipeline] Twelve Data returned data for: ${[...result.keys()].join(', ') || '(none)'}`);
        for (const [sym, series] of result) {
          const mapped = mapTwelveDataCandles(series);
          console.log(`[Pipeline] ${sym}: ${mapped.length} candles mapped`);
          candleMap.set(sym, mapped);
          seriesMap.set(sym, series);
        }
        console.log(`[Pipeline] Fetched candles for ${candleMap.size}/${symbols.length} symbols`);
        if (candleMap.size === 0) {
          candleError = `Twelve Data returned 0 candles for ${symbols.length} symbols (API key may be invalid or rate-limited)`;
          // Fall back to cached candles so scores stay stable
          if (cachedCandleMap.size > 0) {
            for (const [sym, candles] of cachedCandleMap) {
              candleMap.set(sym, candles);
            }
            for (const [sym, s] of cachedSeriesMap) {
              seriesMap.set(sym, s);
            }
            candleError += ' (using cached candles)';
            console.warn(`[Pipeline] Falling back to ${cachedCandleMap.size} cached symbols`);
          }
        } else {
          // Update cache — write to both local vars and globalThis
          cachedCandleMap = new Map(candleMap);
          cachedSeriesMap = new Map(seriesMap);
          lastCandleFetchTime = now;
          globalThis.__candleCache = cachedCandleMap;
          globalThis.__seriesCache = cachedSeriesMap;
          globalThis.__lastCandleFetchTime = lastCandleFetchTime;
        }
      } catch (err) {
        candleError = err instanceof Error ? err.message : String(err);
        console.error('[Pipeline] Failed to fetch Twelve Data candles:', candleError);
        // Fall back to cached data if available
        if (cachedCandleMap.size > 0) {
          for (const [sym, candles] of cachedCandleMap) {
            candleMap.set(sym, candles);
          }
          for (const [sym, s] of cachedSeriesMap) {
            seriesMap.set(sym, s);
          }
          candleError += ' (using cached candles)';
        }
      }
    }
  } else {
    console.log(`[Pipeline] Data source is '${dataSource}', skipping candle fetch`);
  }

  const results: ProcessResult[] = [];
  // Process sequentially to respect API rate limits
  for (const ticker of tickers) {
    const candles = candleMap.get(ticker.symbol) ?? null;
    const series = seriesMap.get(ticker.symbol) ?? null;
    const result = await processTicker(ticker.symbol, ticker.id, scoreThreshold, cooldownMin, candles, series, dataSource, rules);
    results.push(result);
  }
  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  console.log(`[Pipeline] Done: ${succeeded} succeeded, ${failed} failed`);

  // 8) Check sell alerts for active buy entries
  try {
    const sellAlerts = await checkSellAlerts();
    if (sellAlerts.length > 0) {
      console.log(`[Pipeline] ${sellAlerts.length} sell alert(s) triggered`);
    }
  } catch (err) {
    console.error('[Pipeline] Sell alert check failed:', err instanceof Error ? err.message : err);
  }

  return {
    processed: tickers.length,
    succeeded,
    failed,
    results,
    dataSource: autoFallback ? `finnhub (auto-fallback, Twelve Data rate-limited)` : dataSource,
    candlesAvailable: candleMap.size,
    candleError: autoFallback
      ? 'Twelve Data rate-limited — using Finnhub as fallback temporarily (no candle data)'
      : candleError,
  };
}

/**
 * Fetch news from Finnhub for all active tickers and store in NewsItem table.
 * Called by the instrumentation scheduler at configured newsSummaryTimes,
 * NOT every pipeline cycle.
 */
export async function refreshNews(): Promise<{ fetched: number; symbols: number }> {
  const tickers = await prisma.ticker.findMany({ where: { active: true } });
  let totalFetched = 0;

  for (const ticker of tickers) {
    try {
      const today = format(new Date(), 'yyyy-MM-dd');
      const twoDaysAgo = format(subDays(new Date(), 2), 'yyyy-MM-dd');
      const rawNews = await getCompanyNews(ticker.symbol, twoDaysAgo, today);
      const newsItems = rawNews ? mapNews(ticker.symbol, rawNews) : [];

      for (const item of newsItems.slice(0, 20)) {
        await prisma.newsItem.upsert({
          where: {
            symbol_headline_publishedAt: {
              symbol: item.symbol,
              headline: item.headline,
              publishedAt: item.publishedAt,
            },
          },
          update: {},
          create: {
            tickerId: ticker.id,
            symbol: item.symbol,
            headline: item.headline,
            source: item.source,
            url: item.url,
            summary: item.summary,
            publishedAt: item.publishedAt,
          },
        });
      }
      totalFetched += newsItems.length;
    } catch (err) {
      console.warn(`[News] Failed to fetch news for ${ticker.symbol}:`, err instanceof Error ? err.message : err);
    }
  }

  // Apply sentiment classification to new articles
  await applySentiment();

  console.log(`[News] Fetched ${totalFetched} articles for ${tickers.length} tickers`);
  return { fetched: totalFetched, symbols: tickers.length };
}
