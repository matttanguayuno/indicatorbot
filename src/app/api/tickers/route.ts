/**
 * GET/POST /api/tickers — manage the watchlist.
 * GET returns all tickers, POST adds a new ticker.
 * DELETE /api/tickers?symbol=AAPL removes (deactivates) a ticker.
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';

export async function GET() {
  const tickers = await prisma.ticker.findMany({
    orderBy: { symbol: 'asc' },
  });
  return NextResponse.json(tickers);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { symbol, name } = body;

  if (!symbol || typeof symbol !== 'string') {
    return NextResponse.json({ error: 'symbol is required' }, { status: 400 });
  }

  const upper = symbol.toUpperCase().trim();
  if (!/^[A-Z]{1,5}$/.test(upper)) {
    return NextResponse.json({ error: 'Invalid ticker symbol' }, { status: 400 });
  }

  const ticker = await prisma.ticker.upsert({
    where: { symbol: upper },
    update: { active: true, name: name ?? undefined },
    create: { symbol: upper, name: name ?? null },
  });

  return NextResponse.json(ticker);
}

export async function DELETE(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get('symbol');
  if (!symbol) {
    return NextResponse.json({ error: 'symbol query param required' }, { status: 400 });
  }

  const upper = symbol.toUpperCase().trim();
  const ticker = await prisma.ticker.findUnique({ where: { symbol: upper } });
  if (!ticker) {
    return NextResponse.json({ error: 'Ticker not found' }, { status: 404 });
  }

  await prisma.ticker.delete({
    where: { symbol: upper },
  });

  return NextResponse.json({ success: true });
}
