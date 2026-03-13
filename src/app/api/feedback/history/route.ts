/**
 * GET /api/feedback/history — all alert feedback, newest first.
 * Includes the associated alert data (symbol, score, type, explanation).
 */

import { NextResponse } from 'next/server';
import prisma from '@/lib/db';

export async function GET() {
  const feedback = await prisma.feedback.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      alert: {
        select: {
          symbol: true,
          alertType: true,
          scoreAtAlert: true,
          explanation: true,
          createdAt: true,
        },
      },
    },
  });

  return NextResponse.json(feedback);
}
