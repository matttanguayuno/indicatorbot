/**
 * GET /api/settings — read app settings.
 * PUT /api/settings — update app settings.
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { ALERT_CONFIG, POLLING_CONFIG } from '@/lib/config';
import { isQuotaExhausted, getQuotaResumeTime } from '@/lib/twelvedata';

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
  return NextResponse.json({
    ...settings,
    twelveDataExhausted: tdExhausted,
    twelveDataResumesAt: tdExhausted ? new Date(getQuotaResumeTime()).toISOString() : null,
  });
}

const VALID_DATA_SOURCES = ['finnhub', 'twelvedata', 'polygon'] as const;

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const { scoreThreshold, watchlistThreshold, alertCooldownMin, pollingIntervalSec, dataSource, screenerTopN, screenerSyncTimes, newsSummaryTimes } = body;

  const settings = await getOrCreateSettings();

  const validSource = typeof dataSource === 'string' && (VALID_DATA_SOURCES as readonly string[]).includes(dataSource)
    ? dataSource
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

  const updated = await prisma.appSettings.update({
    where: { id: settings.id },
    data: {
      ...(scoreThreshold != null && { scoreThreshold }),
      ...(watchlistThreshold != null && { watchlistThreshold }),
      ...(alertCooldownMin != null && { alertCooldownMin }),
      ...(pollingIntervalSec != null && { pollingIntervalSec }),
      ...(validSource != null && { dataSource: validSource }),
      ...(validTopN != null && { screenerTopN: validTopN }),
      ...(validSyncTimes != null && { screenerSyncTimes: validSyncTimes }),
      ...(validNewsTimes != null && { newsSummaryTimes: validNewsTimes }),
    },
  });

  return NextResponse.json(updated);
}
