import { NextRequest, NextResponse } from 'next/server';
import { searchSymbols } from '@/lib/twelvedata';
import { searchSymbol } from '@/lib/finnhub/client';
import prisma from '@/lib/db';

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q');
  if (!q || q.trim().length < 1) {
    return NextResponse.json({ results: [] });
  }

  const query = q.trim();

  // Check which data source is selected
  const settings = await prisma.appSettings.findFirst();
  const dataSource = settings?.dataSource ?? 'twelvedata';

  if (dataSource === 'twelvedata') {
    const data = await searchSymbols(query);
    if (!data || !data.data) {
      return NextResponse.json({ results: [] });
    }

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
  } else {
    const data = await searchSymbol(query);
    if (!data) {
      return NextResponse.json({ results: [] });
    }

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
}
