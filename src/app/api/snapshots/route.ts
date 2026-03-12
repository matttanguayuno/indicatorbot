/**
 * GET /api/snapshots — latest signal snapshots, ranked by score.
 * Query params: ?limit=20&history=10
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';

export async function GET(req: NextRequest) {
  const limit = Math.min(
    parseInt(req.nextUrl.searchParams.get('limit') ?? '20', 10),
    100
  );
  const historyCount = Math.min(
    parseInt(req.nextUrl.searchParams.get('history') ?? '0', 10),
    500
  );

  // For each active ticker, get the most recent snapshot
  const tickers = await prisma.ticker.findMany({ where: { active: true } });

  const snapshots = await Promise.all(
    tickers.map(async (t) => {
      const latest = await prisma.signalSnapshot.findFirst({
        where: { tickerId: t.id },
        orderBy: { timestamp: 'desc' },
      });
      if (!latest) return null;

      let scoreHistory: number[] = [];
      let priceHistory: number[] = [];
      let priceTimestamps: string[] = [];
      if (historyCount > 0) {
        const history = await prisma.signalSnapshot.findMany({
          where: { tickerId: t.id },
          orderBy: { timestamp: 'desc' },
          take: historyCount,
          select: { signalScore: true, currentPrice: true, timestamp: true },
        });
        // Reverse so chart plots oldest → newest (left to right)
        history.reverse();
        scoreHistory = history.map((h) => h.signalScore);
        priceHistory = history.map((h) => h.currentPrice);
        priceTimestamps = history.map((h) => h.timestamp.toISOString());
      }

      return { ...latest, scoreHistory, priceHistory, priceTimestamps };
    })
  );

  // Apply watchlist threshold filter (overridable via ?threshold=0)
  const settings = await prisma.appSettings.findFirst();
  const thresholdParam = req.nextUrl.searchParams.get('threshold');
  const watchlistThreshold = thresholdParam !== null
    ? parseInt(thresholdParam, 10)
    : (settings?.watchlistThreshold ?? 0);

  const results = snapshots
    .filter((s): s is NonNullable<typeof s> => s !== null)
    .filter((s) => s.signalScore >= watchlistThreshold)
    .sort((a, b) => b.signalScore - a.signalScore)
    .slice(0, limit);

  return NextResponse.json(results);
}
