/**
 * GET /api/snapshots/[symbol] — detail view for a single ticker.
 * Returns latest snapshot + recent history.
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';

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
      take: 20,
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
      take: 10,
    }),
  ]);

  if (!latest) {
    return NextResponse.json({ error: 'No data found' }, { status: 404 });
  }

  return NextResponse.json({ latest, history, news });
}
