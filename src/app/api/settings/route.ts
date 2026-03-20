/**
 * GET /api/settings — read app settings.
 * PUT /api/settings — update app settings.
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { ALERT_CONFIG, POLLING_CONFIG } from '@/lib/config';
import { isQuotaExhausted, getQuotaResumeTime } from '@/lib/twelvedata';
import { applySentiment } from '@/lib/news/sentiment';
import { getPatternConfig } from '@/lib/config/patterns';

async function getOrCreateSettings() {
  let settings = await prisma.appSettings.findFirst();
  if (!settings) {
    settings = await prisma.appSettings.create({
      data: {
        scoreThreshold: ALERT_CONFIG.defaultScoreThreshold,
        alertCooldownMin: ALERT_CONFIG.cooldownMinutes,
        pollingIntervalSec: POLLING_CONFIG.intervalSeconds,
      },
    });
  }
  return settings;
}

export async function GET() {
  const settings = await getOrCreateSettings();
  const tdExhausted = isQuotaExhausted();
  const patternConfig = getPatternConfig(settings.patternConfigJson);
  return NextResponse.json({
    ...settings,
    patternConfig,
    twelveDataExhausted: tdExhausted,
    twelveDataResumesAt: tdExhausted ? new Date(getQuotaResumeTime()).toISOString() : null,
  });
}

const VALID_DATA_SOURCES = ['finnhub', 'twelvedata', 'polygon'] as const;

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const { scoreThreshold, watchlistThreshold, alertCooldownMin, pollingIntervalSec, staleDataMinutes, dataSource, screenerSource, screenerTopN, screenerSyncTimes, newsSummaryTimes, sentimentMethod, patternConfig } = body;

  const settings = await getOrCreateSettings();

  const validSource = typeof dataSource === 'string' && (VALID_DATA_SOURCES as readonly string[]).includes(dataSource)
    ? dataSource
    : undefined;

  const VALID_SCREENER_SOURCES = ['fmp', 'webull'] as const;
  const validScreenerSource = typeof screenerSource === 'string' && (VALID_SCREENER_SOURCES as readonly string[]).includes(screenerSource)
    ? screenerSource
    : undefined;

  const validTopN = typeof screenerTopN === 'number' && screenerTopN >= 1 && screenerTopN <= 200
    ? screenerTopN
    : undefined;

  // Validate screenerSyncTimes: comma-separated HH:MM values
  let validSyncTimes: string | undefined;
  if (typeof screenerSyncTimes === 'string') {
    const parts = screenerSyncTimes.split(',').map(s => s.trim()).filter(Boolean);
    const allValid = parts.length > 0 && parts.every(p => /^\d{1,2}:\d{2}$/.test(p) && (() => {
      const [h, m] = p.split(':').map(Number);
      return h >= 0 && h <= 23 && m >= 0 && m <= 59;
    })());
    if (allValid) validSyncTimes = parts.join(',');
  }

  // Validate newsSummaryTimes: same format
  let validNewsTimes: string | undefined;
  if (typeof newsSummaryTimes === 'string') {
    const parts = newsSummaryTimes.split(',').map(s => s.trim()).filter(Boolean);
    const allValid = parts.length > 0 && parts.every(p => /^\d{1,2}:\d{2}$/.test(p) && (() => {
      const [h, m] = p.split(':').map(Number);
      return h >= 0 && h <= 23 && m >= 0 && m <= 59;
    })());
    if (allValid) validNewsTimes = parts.join(',');
  }

  const VALID_SENTIMENT_METHODS = ['keyword', 'ai', 'off'] as const;
  const validSentimentMethod = typeof sentimentMethod === 'string' && (VALID_SENTIMENT_METHODS as readonly string[]).includes(sentimentMethod)
    ? sentimentMethod
    : undefined;

  const updated = await prisma.appSettings.update({
    where: { id: settings.id },
    data: {
      ...(scoreThreshold != null && { scoreThreshold }),
      ...(watchlistThreshold != null && { watchlistThreshold }),
      ...(alertCooldownMin != null && { alertCooldownMin }),
      ...(pollingIntervalSec != null && { pollingIntervalSec }),
      ...(staleDataMinutes != null && typeof staleDataMinutes === 'number' && staleDataMinutes >= 1 && staleDataMinutes <= 60 && { staleDataMinutes }),
      ...(validSource != null && { dataSource: validSource }),
      ...(validScreenerSource != null && { screenerSource: validScreenerSource }),
      ...(validTopN != null && { screenerTopN: validTopN }),
      ...(validSyncTimes != null && { screenerSyncTimes: validSyncTimes }),
      ...(validNewsTimes != null && { newsSummaryTimes: validNewsTimes }),
      ...(validSentimentMethod != null && { sentimentMethod: validSentimentMethod }),
      ...(patternConfig != null && typeof patternConfig === 'object' && { patternConfigJson: JSON.stringify(patternConfig) }),
    },
  });

  // If sentiment method changed, clear old scores and re-run
  if (validSentimentMethod && validSentimentMethod !== settings.sentimentMethod) {
    if (validSentimentMethod !== 'off') {
      // Null out existing sentiment so everything gets re-scored with the new method
      await prisma.newsItem.updateMany({ data: { sentiment: null } });
      // Fire-and-forget — don't block the response
      applySentiment().catch((err) =>
        console.error('[Settings] Sentiment re-score failed:', err instanceof Error ? err.message : err)
      );
    }
  }

  return NextResponse.json(updated);
}
