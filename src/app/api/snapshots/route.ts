/**
 * GET /api/snapshots — latest signal snapshots, ranked by score.
 * Query params: ?limit=20
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';

export async function GET(req: NextRequest) {
  const limit = Math.min(
    parseInt(req.nextUrl.searchParams.get('limit') ?? '20', 10),
    100
  );

  // For each active ticker, get the most recent snapshot
  const tickers = await prisma.ticker.findMany({ where: { active: true } });

  const snapshots = await Promise.all(
    tickers.map((t) =>
      prisma.signalSnapshot.findFirst({
        where: { tickerId: t.id },
        orderBy: { timestamp: 'desc' },
      })
    )
  );

  const results = snapshots
    .filter((s): s is NonNullable<typeof s> => s !== null)
    .sort((a, b) => b.signalScore - a.signalScore)
    .slice(0, limit);

  return NextResponse.json(results);
}
