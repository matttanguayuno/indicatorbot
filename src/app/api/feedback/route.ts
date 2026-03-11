/**
 * POST /api/feedback — submit feedback on an alert.
 * Body: { alertId: number, rating: string, note?: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';

const VALID_RATINGS = ['GOOD', 'BAD', 'TOO_LATE', 'FALSE_BREAKOUT', 'OTHER'] as const;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { alertId, rating, note } = body;

  if (!alertId || !rating) {
    return NextResponse.json({ error: 'alertId and rating are required' }, { status: 400 });
  }

  if (!VALID_RATINGS.includes(rating)) {
    return NextResponse.json(
      { error: `rating must be one of: ${VALID_RATINGS.join(', ')}` },
      { status: 400 }
    );
  }

  // Check alert exists
  const alert = await prisma.alert.findUnique({ where: { id: alertId } });
  if (!alert) {
    return NextResponse.json({ error: 'Alert not found' }, { status: 404 });
  }

  const feedback = await prisma.feedback.upsert({
    where: { alertId },
    update: { rating, note: note ?? null },
    create: { alertId, rating, note: note ?? null },
  });

  return NextResponse.json(feedback);
}
