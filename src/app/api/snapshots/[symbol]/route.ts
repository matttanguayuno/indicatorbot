/**
 * GET /api/snapshots/[symbol] — detail view for a single ticker.
 * Returns latest snapshot + score breakdown + recent history.
 * Query params: ?since=today  (same syntax as /api/snapshots)
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { calculateScore, type SignalInputs } from '@/lib/scoring';

function parseSince(value: string): Date | null {
  if (value === 'today') {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric', minute: 'numeric', second: 'numeric',
      hour12: false,
    }).formatToParts(now);
    const h = (+parts.find(p => p.type === 'hour')!.value) % 24;
    const m = +parts.find(p => p.type === 'minute')!.value;
    const s = +parts.find(p => p.type === 'second')!.value;
    const msSinceMidnight = (h * 3600 + m * 60 + s) * 1000 + now.getMilliseconds();
    return new Date(now.getTime() - msSinceMidnight);
  }
  const rel = value.match(/^(\d+)([hdwmy])$/i);
  if (rel) {
    const n = parseInt(rel[1]);
    const u = rel[2].toLowerCase();
    const now = new Date();
    switch (u) {
      case 'h': return new Date(now.getTime() - n * 3_600_000);
      case 'd': return new Date(now.getTime() - n * 86_400_000);
      case 'w': return new Date(now.getTime() - n * 604_800_000);
      case 'm': { const d = new Date(now); d.setMonth(d.getMonth() - n); return d; }
      case 'y': { const d = new Date(now); d.setFullYear(d.getFullYear() - n); return d; }
    }
  }
  const iso = new Date(value);
  return isNaN(iso.getTime()) ? null : iso;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params;
  const upperSymbol = symbol.toUpperCase();

  const sinceParam = _req.nextUrl.searchParams.get('since');
  const sinceDate = sinceParam ? parseSince(sinceParam) : null;

  const [latest, history, news] = await Promise.all([
    prisma.signalSnapshot.findFirst({
      where: { symbol: upperSymbol },
      orderBy: { timestamp: 'desc' },
    }),
    prisma.signalSnapshot.findMany({
      where: {
        symbol: upperSymbol,
        ...(sinceDate ? { timestamp: { gte: sinceDate } } : {}),
      },
      orderBy: { timestamp: 'desc' },
      take: sinceDate ? 10_000 : 500,
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

  // Keep only the last snapshot per minute to smooth rapid-poll oscillation
  const seen = new Map<string, number>();
  for (let i = 0; i < history.length; i++) {
    seen.set(history[i].timestamp.toISOString().slice(0, 16), i);
  }
  const thinnedIdx = [...new Set(seen.values())].sort((a, b) => a - b);
  const thinnedHistory = thinnedIdx.map(i => history[i]);

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

  return NextResponse.json({ latest, breakdown, history: thinnedHistory, news });
}
