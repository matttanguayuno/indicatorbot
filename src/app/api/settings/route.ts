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
  const { scoreThreshold, alertCooldownMin, pollingIntervalSec, dataSource } = body;

  const settings = await getOrCreateSettings();

  const validSource = typeof dataSource === 'string' && (VALID_DATA_SOURCES as readonly string[]).includes(dataSource)
    ? dataSource
    : undefined;

  const updated = await prisma.appSettings.update({
    where: { id: settings.id },
    data: {
      ...(scoreThreshold != null && { scoreThreshold }),
      ...(alertCooldownMin != null && { alertCooldownMin }),
      ...(pollingIntervalSec != null && { pollingIntervalSec }),
      ...(validSource != null && { dataSource: validSource }),
    },
  });

  return NextResponse.json(updated);
}
