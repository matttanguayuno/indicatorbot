/**
 * POST /api/patterns/detect — Run pattern detection on provided candles.
 * Body: { candles: { time: string; open: number; high: number; low: number; close: number; volume: number }[] }
 * Returns: { patterns: PatternResult[] }
 */

import { NextRequest, NextResponse } from 'next/server';
import { detectAllPatterns } from '@/lib/signals/patterns';
import type { NormalizedCandle } from '@/lib/types';
import prisma from '@/lib/db';
import { getPatternConfig } from '@/lib/config/patterns';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const rawCandles: { time: string; open: number; high: number; low: number; close: number; volume: number }[] = body.candles;

  if (!Array.isArray(rawCandles) || rawCandles.length < 2) {
    return NextResponse.json({ patterns: [], error: 'Need at least 2 candles' });
  }

  const candles: NormalizedCandle[] = rawCandles.map((c) => ({
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
    timestamp: new Date(c.time),
  }));

  const settings = await prisma.appSettings.findFirst();
  const config = getPatternConfig(settings?.patternConfigJson);

  const patterns = detectAllPatterns(candles, config);
  return NextResponse.json({ patterns, candleCount: candles.length });
}
