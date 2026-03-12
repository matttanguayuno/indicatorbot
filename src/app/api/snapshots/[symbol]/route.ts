/**
 * GET /api/snapshots/[symbol] — detail view for a single ticker.
 * Returns latest snapshot + score breakdown + recent history.
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { calculateScore, type SignalInputs } from '@/lib/scoring';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params;
  const upperSymbol = symbol.toUpperCase();

  const [latest, history, news] = await Promise.all([
    prisma.signalSnapshot.findFirst({
      where: { symbol: upperSymbol },
      orderBy: { timestamp: 'desc' },
    }),
    prisma.signalSnapshot.findMany({
      where: { symbol: upperSymbol },
      orderBy: { timestamp: 'desc' },
      take: 500,
      select: {
        id: true,
        signalScore: true,
        currentPrice: true,
        timestamp: true,
        explanation: true,
      },
    }),
    prisma.newsItem.findMany({
      where: { symbol: upperSymbol },
      orderBy: { publishedAt: 'desc' },
      take: 50,
    }),
  ]);

  if (!latest) {
    return NextResponse.json({ error: 'No data found' }, { status: 404 });
  }

  // Re-compute score breakdown from stored snapshot fields
  const hasCandleData = latest.pctChange5m != null && latest.pctChangeIntraday != null;
  const signalInputs: SignalInputs = {
    pctChange5m: latest.pctChange5m,
    pctChange15m: latest.pctChange15m,
    pctChange1h: latest.pctChange1h,
    pctChange1d: latest.pctChange1d,
    pctChangeIntraday: latest.pctChangeIntraday,
    intradayRangePct: latest.intradayRangePct,
    gapUpPct: latest.gapUpPct,
    rvol: latest.rvol,
    volumeSpikeRatio: latest.volumeSpikeRatio,
    pctFromVwap: latest.pctFromVwap,
    isBreakout: latest.isBreakout,
    nearHigh: latest.nearHigh,
    float: latest.float,
    newsScore: latest.newsScore ?? 0,
    shortInterest: latest.shortInterest ?? null,
    optionsFlowValue: latest.optionsFlowValue ?? null,
    hasCandleData,
  };
  const breakdown = calculateScore(signalInputs);

  return NextResponse.json({ latest, breakdown, history, news });
}
