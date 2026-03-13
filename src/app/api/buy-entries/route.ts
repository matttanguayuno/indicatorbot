/**
 * GET    /api/buy-entries?symbol=X  — get active buy entry for a symbol (or all if no symbol)
 * POST   /api/buy-entries           — record a new buy entry at current price & score
 * DELETE /api/buy-entries?id=N      — dismiss / close a buy entry
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get('symbol');

  const where: { active: boolean; symbol?: string } = { active: true };
  if (symbol) where.symbol = symbol.toUpperCase().trim();

  const entries = await prisma.buyEntry.findMany({
    where,
    orderBy: { boughtAt: 'desc' },
  });

  return NextResponse.json(entries);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { symbol } = body;

  if (!symbol || typeof symbol !== 'string') {
    return NextResponse.json({ error: 'symbol is required' }, { status: 400 });
  }

  const upper = symbol.toUpperCase().trim();

  // Ensure ticker exists
  let ticker = await prisma.ticker.findUnique({ where: { symbol: upper } });
  if (!ticker) {
    ticker = await prisma.ticker.create({ data: { symbol: upper, active: false } });
  }

  // Get latest snapshot for current price & score
  const snap = await prisma.signalSnapshot.findFirst({
    where: { tickerId: ticker.id },
    orderBy: { timestamp: 'desc' },
  });

  if (!snap) {
    return NextResponse.json({ error: 'No snapshot data for this symbol' }, { status: 404 });
  }

  const entry = await prisma.buyEntry.create({
    data: {
      tickerId: ticker.id,
      symbol: upper,
      entryPrice: snap.currentPrice,
      scoreAtEntry: snap.signalScore,
      peakScoreSinceEntry: snap.signalScore,
      snapshotId: snap.id,
    },
  });

  return NextResponse.json(entry, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const idStr = req.nextUrl.searchParams.get('id');
  const id = idStr ? parseInt(idStr, 10) : NaN;

  if (isNaN(id)) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  await prisma.buyEntry.update({
    where: { id },
    data: { active: false },
  });

  return NextResponse.json({ ok: true });
}
