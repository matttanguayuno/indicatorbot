import { NextRequest, NextResponse } from 'next/server';
import { searchSymbol } from '@/lib/finnhub/client';

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q');
  if (!q || q.trim().length < 1) {
    return NextResponse.json({ results: [] });
  }

  const data = await searchSymbol(q.trim());
  if (!data) {
    return NextResponse.json({ results: [] });
  }

  // Filter to common US stock types and limit results
  const filtered = data.result
    .filter((r) => r.type === 'Common Stock' || r.type === 'ETP' || r.type === 'ETF')
    .filter((r) => !r.symbol.includes('.'))
    .slice(0, 10)
    .map((r) => ({
      symbol: r.displaySymbol,
      description: r.description,
      type: r.type,
    }));

  return NextResponse.json({ results: filtered });
}
