/**
 * Core polling pipeline: fetches data, computes signals, stores snapshots, generates alerts.
 *
 * Supports two data sources:
 *  - "finnhub" (quote-only): OHLC from /quote, profile from /stock/profile2, news
 *  - "twelvedata": 1-min candles from Twelve Data + Finnhub quote/profile/news
 */

import prisma from '@/lib/db';
import {
  getQuote,
  getCandles,
  getCompanyProfile,
  getCompanyNews,
  mapQuote,
  mapCandles,
  mapProfile,
  mapNews,
} from '@/lib/finnhub';
import { getTimeSeries, mapTwelveDataCandles } from '@/lib/twelvedata';
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
import { POLLING_CONFIG, SCORING_WEIGHTS, ALERT_CONFIG, getScoringRules } from '@/lib/config';
import type { ScoringRules } from '@/lib/config';
import { format, subDays } from 'date-fns';
import type { NormalizedCandle } from '@/lib/finnhub/types';

interface ProcessResult {
  symbol: string;
  success: boolean;
  score?: number;
  error?: string;
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
  rules: ScoringRules,
): Promise<ProcessResult> {
  try {
    // 1) Fetch quote (OHLC + change) — always from Finnhub
    const rawQuote = await getQuote(symbol);
    if (!rawQuote || rawQuote.c === 0) {
      return { symbol, success: false, error: 'No quote data' };
    }
    const quote = mapQuote(symbol, rawQuote);

    // 2) Fetch company profile (for float)
    const rawProfile = await getCompanyProfile(symbol);
    const profile = rawProfile ? mapProfile(rawProfile) : null;

    if (profile) {
      await prisma.ticker.update({
        where: { id: tickerId },
        data: { name: profile.name, sector: profile.sector },
      });
    }

    // 3) Fetch recent news
    const today = format(new Date(), 'yyyy-MM-dd');
    const twoDaysAgo = format(subDays(new Date(), 2), 'yyyy-MM-dd');
    const rawNews = await getCompanyNews(symbol, twoDaysAgo, today);
    const newsItems = rawNews ? mapNews(symbol, rawNews) : [];

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
          tickerId,
          symbol: item.symbol,
          headline: item.headline,
          source: item.source,
          url: item.url,
          summary: item.summary,
          publishedAt: item.publishedAt,
        },
      });
    }

    // 4) Compute indicators
    const currentPrice = quote.currentPrice;
    const floatShares = profile?.sharesOutstanding ?? null;
    const hasCandleData = candles != null && candles.length > 0;

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
    const newsWindowMs = rules.weights.newsCatalyst.recentWindowMinutes * 60 * 1000;
    const recentNewsCount = newsItems.filter(
      (n) => Date.now() - n.publishedAt.getTime() < newsWindowMs
    ).length;
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
      news: newsItems.length > 0 ? 'available' : 'unavailable',
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

    return { symbol, success: true, score: scoreBreakdown.finalScore };
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
}

/**
 * Main polling entry point: processes all active tickers.
 */
export async function runPollingCycle(): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
  results: ProcessResult[];
}> {
  // Load settings
  const settings = await prisma.appSettings.findFirst();
  const scoreThreshold = settings?.scoreThreshold ?? ALERT_CONFIG.defaultScoreThreshold;
  const cooldownMin = settings?.alertCooldownMin ?? ALERT_CONFIG.cooldownMinutes;
  const dataSource = settings?.dataSource ?? 'finnhub';

  // Load dynamic scoring rules
  const rules = await getScoringRules();

  // Get active tickers
  const tickers = await prisma.ticker.findMany({
    where: { active: true },
    take: rules.polling.batchSize,
  });

  console.log(`[Pipeline] Processing ${tickers.length} tickers (source: ${dataSource})...`);

  // Pre-fetch candles
  const candleMap = new Map<string, NormalizedCandle[]>();
  if (dataSource === 'twelvedata') {
    try {
      const symbols = tickers.map((t: { symbol: string }) => t.symbol);
      // Batch: up to 8 symbols per call (free-tier credit limit)
      for (let i = 0; i < symbols.length; i += 8) {
        const batch = symbols.slice(i, i + 8);
        const result = await getTimeSeries(batch, '1min', 90);
        for (const [sym, series] of result) {
          candleMap.set(sym, mapTwelveDataCandles(series));
        }
        // Wait between batches to respect rate limits
        if (i + 8 < symbols.length) {
          await new Promise((r) => setTimeout(r, 15_000));
        }
      }
      console.log(`[Pipeline] Fetched candles for ${candleMap.size}/${symbols.length} symbols`);
    } catch (err) {
      console.error('[Pipeline] Failed to fetch Twelve Data candles:', err);
    }
  } else {
    // Finnhub candles: fetch 1-min resolution for the current trading day
    const now = Math.floor(Date.now() / 1000);
    const marketOpenToday = now - 7 * 3600; // ~7 hours back covers full trading day
    for (const ticker of tickers) {
      try {
        const raw = await getCandles(ticker.symbol, '1', marketOpenToday, now);
        if (raw && raw.s === 'ok' && raw.t && raw.t.length > 0) {
          candleMap.set(ticker.symbol, mapCandles(raw));
        }
      } catch (err) {
        console.warn(`[Pipeline] Finnhub candle fetch failed for ${ticker.symbol}:`, err);
      }
    }
    if (candleMap.size > 0) {
      console.log(`[Pipeline] Fetched Finnhub candles for ${candleMap.size}/${tickers.length} symbols`);
    }
  }

  const results: ProcessResult[] = [];
  // Process sequentially to respect API rate limits
  for (const ticker of tickers) {
    const candles = candleMap.get(ticker.symbol) ?? null;
    const result = await processTicker(ticker.symbol, ticker.id, scoreThreshold, cooldownMin, candles, rules);
    results.push(result);
  }

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  console.log(`[Pipeline] Done: ${succeeded} succeeded, ${failed} failed`);

  return { processed: tickers.length, succeeded, failed, results };
}
