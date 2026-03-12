/**
 * GET /api/trades — list all trades (newest first).
 * POST /api/trades — create a new trade, auto-linking to nearest snapshot.
 * DELETE /api/trades?id=N — delete a trade.
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';

export async function GET() {
  const trades = await prisma.trade.findMany({
    orderBy: { tradedAt: 'desc' },
    include: { ticker: { select: { name: true } } },
  });
  return NextResponse.json(trades);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { symbol, side, quantity, price, notes, screenshot, tradedAt } = body;

  if (!symbol || typeof symbol !== 'string') {
    return NextResponse.json({ error: 'symbol is required' }, { status: 400 });
  }
  if (!side || !['buy', 'sell'].includes(side)) {
    return NextResponse.json({ error: 'side must be "buy" or "sell"' }, { status: 400 });
  }
  if (!quantity || quantity <= 0) {
    return NextResponse.json({ error: 'quantity must be positive' }, { status: 400 });
  }
  if (!price || price <= 0) {
    return NextResponse.json({ error: 'price must be positive' }, { status: 400 });
  }

  const upper = symbol.toUpperCase().trim();
  const total = Math.round(quantity * price * 100) / 100;
  const tradeTime = tradedAt ? new Date(tradedAt) : new Date();

  // Ensure ticker exists (create if needed)
  let ticker = await prisma.ticker.findUnique({ where: { symbol: upper } });
  if (!ticker) {
    ticker = await prisma.ticker.create({
      data: { symbol: upper, active: false },
    });
  }

  // Find the nearest snapshot to the trade time for score linkage
  const nearestSnapshot = await prisma.signalSnapshot.findFirst({
    where: { symbol: upper },
    orderBy: {
      timestamp: 'desc',
    },
    // Get the most recent snapshot at or before trade time
    ...(tradedAt ? { where: { symbol: upper, timestamp: { lte: tradeTime } } } : {}),
    select: { id: true, signalScore: true },
  });

  const trade = await prisma.trade.create({
    data: {
      tickerId: ticker.id,
      symbol: upper,
      side,
      quantity,
      price,
      total,
      notes: notes || null,
      screenshot: screenshot || null,
      snapshotId: nearestSnapshot?.id ?? null,
      scoreAtTrade: nearestSnapshot?.signalScore ?? null,
      tradedAt: tradeTime,
    },
  });

  return NextResponse.json(trade, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'id query param required' }, { status: 400 });
  }

  const tradeId = parseInt(id, 10);
  if (isNaN(tradeId)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  const trade = await prisma.trade.findUnique({ where: { id: tradeId } });
  if (!trade) {
    return NextResponse.json({ error: 'Trade not found' }, { status: 404 });
  }

  await prisma.trade.delete({ where: { id: tradeId } });
  return NextResponse.json({ success: true });
}
