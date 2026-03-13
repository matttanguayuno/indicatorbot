/**
 * POST /api/feedback/signal — submit feedback on a signal snapshot.
 * Body: { snapshotId: number, symbol: string, rating: "GOOD"|"BAD"|"SKIP", note?: string }
 *
 * GET /api/feedback/signal?symbols=AAPL,TSLA — get latest feedback per symbol.
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';

const VALID_RATINGS = ['GOOD', 'BAD', 'SKIP'] as const;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { snapshotId, symbol, rating, note } = body;

  if (!snapshotId || !symbol || !rating) {
    return NextResponse.json(
      { error: 'snapshotId, symbol, and rating are required' },
      { status: 400 },
    );
  }

  if (!(VALID_RATINGS as readonly string[]).includes(rating)) {
    return NextResponse.json(
      { error: `rating must be one of: ${VALID_RATINGS.join(', ')}` },
      { status: 400 },
    );
  }

  const feedback = await prisma.signalFeedback.upsert({
    where: { snapshotId },
    update: { rating, note: note ?? null, symbol },
    create: { snapshotId, symbol, rating, note: note ?? null },
  });

  return NextResponse.json(feedback);
}

export async function GET(req: NextRequest) {
  const symbolsParam = req.nextUrl.searchParams.get('symbols');
  if (!symbolsParam) {
    return NextResponse.json({ error: 'symbols query param required' }, { status: 400 });
  }

  const symbols = symbolsParam.split(',').map((s) => s.trim()).filter(Boolean);

  // Get the most recent feedback for each symbol
  const feedbacks = await Promise.all(
    symbols.map(async (symbol) => {
      const fb = await prisma.signalFeedback.findFirst({
        where: { symbol },
        orderBy: { createdAt: 'desc' },
      });
      return fb ?? null;
    }),
  );

  const result: Record<string, { rating: string; note: string | null; snapshotId: number }> = {};
  for (const fb of feedbacks) {
    if (fb) {
      result[fb.symbol] = { rating: fb.rating, note: fb.note, snapshotId: fb.snapshotId };
    }
  }

  return NextResponse.json(result);
}
