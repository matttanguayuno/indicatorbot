/**
 * GET /api/alerts — recent alerts, ordered by most recent.
 * POST /api/alerts/:id/acknowledge — mark alert as acknowledged.
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';

export async function GET(req: NextRequest) {
  const limit = Math.min(
    parseInt(req.nextUrl.searchParams.get('limit') ?? '50', 10),
    200
  );

  const alerts = await prisma.alert.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { feedback: true },
  });

  return NextResponse.json(alerts);
}
