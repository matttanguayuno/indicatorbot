/**
 * GET    /api/alerts          — recent alerts, ordered by most recent.
 * PATCH  /api/alerts?id=N     — acknowledge (dismiss) an alert.
 * DELETE /api/alerts?id=N     — permanently delete an alert.
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';

export async function GET(req: NextRequest) {
  const limit = Math.min(
    parseInt(req.nextUrl.searchParams.get('limit') ?? '50', 10),
    200
  );

  const alerts = await prisma.alert.findMany({
    where: { acknowledged: false },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { feedback: true },
  });

  return NextResponse.json(alerts);
}

export async function PATCH(req: NextRequest) {
  const idStr = req.nextUrl.searchParams.get('id');
  const id = idStr ? parseInt(idStr, 10) : NaN;

  if (isNaN(id)) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  await prisma.alert.update({
    where: { id },
    data: { acknowledged: true },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const idStr = req.nextUrl.searchParams.get('id');
  const id = idStr ? parseInt(idStr, 10) : NaN;

  if (isNaN(id)) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  await prisma.alert.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
