/**
 * POST /api/screener/sync — Fetch top daily movers from FMP and sync the watchlist.
 *
 * No auth required (intended for local/interactive use, same pattern as /api/poll).
 * Body (optional): { topN?: number }
 *
 * Fetches the top N gainers via FMP,
 * deactivates all current tickers, and upserts the results as active.
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { screenFMP } from '@/lib/screener/fmp';

export async function POST(req: NextRequest) {
  try {
    // Get topN from body or settings
    let topN = 30;
    try {
      const body = await req.json();
      if (typeof body.topN === 'number' && body.topN > 0) topN = body.topN;
    } catch {
      // No body or invalid JSON — use settings default
    }

    if (topN === 30) {
      const settings = await prisma.appSettings.findFirst();
      topN = settings?.screenerTopN ?? 30;
    }

    console.log(`[Screener Sync] Starting FMP screen for top ${topN} symbols`);

    // Clean up inactive tickers from previous sync
    await prisma.ticker.deleteMany({ where: { active: false } });

    // Screen via FMP API
    const scraped = await screenFMP(topN);

    if (scraped.length === 0) {
      return NextResponse.json(
        { error: 'FMP screener returned 0 results' },
        { status: 500 },
      );
    }

    const scrapedSymbols = scraped.map((t) => t.symbol);

    // Count currently active tickers that will be deactivated
    const previouslyActive = await prisma.ticker.count({ where: { active: true } });

    // Deactivate all tickers
    await prisma.ticker.updateMany({
      data: { active: false },
    });

    // Upsert scraped tickers as active
    let added = 0;
    let reactivated = 0;
    for (const t of scraped) {
      const existing = await prisma.ticker.findUnique({ where: { symbol: t.symbol } });
      if (existing) {
        await prisma.ticker.update({
          where: { symbol: t.symbol },
          data: { active: true, name: t.name || existing.name },
        });
        reactivated++;
      } else {
        await prisma.ticker.create({
          data: { symbol: t.symbol, name: t.name || null, active: true },
        });
        added++;
      }
    }

    const deactivated = previouslyActive - reactivated;
    const result = {
      scraped: scraped.length,
      added,
      reactivated,
      deactivated: Math.max(0, deactivated),
      total: scraped.length,
      symbols: scrapedSymbols,
    };

    console.log(`[Screener Sync] Done — ${added} added, ${reactivated} reactivated, ${Math.max(0, deactivated)} deactivated`);

    return NextResponse.json(result);
  } catch (err) {
    console.error('[Screener Sync] Error:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Sync failed' },
      { status: 500 },
    );
  }
}
