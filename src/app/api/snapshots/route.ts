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
    50
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
      if (historyCount > 0) {
        const history = await prisma.signalSnapshot.findMany({
          where: { tickerId: t.id },
          orderBy: { timestamp: 'asc' },
          take: historyCount,
          select: { signalScore: true },
        });
        scoreHistory = history.map((h) => h.signalScore);
      }

      return { ...latest, scoreHistory };
    })
  );

  const results = snapshots
    .filter((s): s is NonNullable<typeof s> => s !== null)
    .sort((a, b) => b.signalScore - a.signalScore)
    .slice(0, limit);

  return NextResponse.json(results);
}
