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

  if (!alertId) {
    return NextResponse.json({ error: 'alertId is required' }, { status: 400 });
  }

  if (!rating && !note) {
    return NextResponse.json({ error: 'rating or note is required' }, { status: 400 });
  }

  if (rating && !VALID_RATINGS.includes(rating)) {
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

  // Build update/create data — preserve existing rating if only note is being set
  const existing = await prisma.feedback.findUnique({ where: { alertId } });
  const finalRating = rating ?? existing?.rating ?? 'OTHER';
  const finalNote = note !== undefined ? (note || null) : (existing?.note ?? null);

  const feedback = await prisma.feedback.upsert({
    where: { alertId },
    update: { rating: finalRating, note: finalNote },
    create: { alertId, rating: finalRating, note: finalNote },
  });

  return NextResponse.json(feedback);
}
