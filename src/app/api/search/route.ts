import { NextRequest, NextResponse } from 'next/server';
import { searchSymbols } from '@/lib/twelvedata';

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q');
  if (!q || q.trim().length < 1) {
    return NextResponse.json({ results: [] });
  }

  const data = await searchSymbols(q.trim());
  if (!data || !data.data) {
    return NextResponse.json({ results: [] });
  }

  // Filter to common US stock types and limit results
  const filtered = data.data
    .filter((r) => r.instrument_type === 'Common Stock' || r.instrument_type === 'ETF')
    .filter((r) => !r.symbol.includes('.'))
    .slice(0, 10)
    .map((r) => ({
      symbol: r.symbol,
      description: r.instrument_name,
      type: r.instrument_type,
    }));

  return NextResponse.json({ results: filtered });
}
