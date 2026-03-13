/**
 * GET /api/feedback/history — all alert feedback, newest first.
 * Includes the associated alert data (symbol, score, type, explanation).
 */

import { NextRequest, NextResponse } from 'next/server';
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

export async function DELETE(req: NextRequest) {
  const idStr = req.nextUrl.searchParams.get('id');
  const id = idStr ? parseInt(idStr, 10) : NaN;

  if (isNaN(id)) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  await prisma.feedback.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
