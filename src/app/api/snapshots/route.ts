/**
 * GET /api/snapshots — latest signal snapshots, ranked by score.
 * Query params: ?limit=20&history=10&since=today
 *
 * `since` accepts:
 *   - "today"  → midnight ET of the current day
 *   - relative → "1h", "4h", "7d", "1m", "1y"
 *   - ISO 8601 date string
 * When `since` is provided `history` is ignored.
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';

function parseSince(value: string): Date | null {
  if (value === 'today') {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric', minute: 'numeric', second: 'numeric',
      hour12: false,
    }).formatToParts(now);
    const h = (+parts.find(p => p.type === 'hour')!.value) % 24;
    const m = +parts.find(p => p.type === 'minute')!.value;
    const s = +parts.find(p => p.type === 'second')!.value;
    const msSinceMidnight = (h * 3600 + m * 60 + s) * 1000 + now.getMilliseconds();
    return new Date(now.getTime() - msSinceMidnight);
  }
  const rel = value.match(/^(\d+)([hdwmy])$/i);
  if (rel) {
    const n = parseInt(rel[1]);
    const u = rel[2].toLowerCase();
    const now = new Date();
    switch (u) {
      case 'h': return new Date(now.getTime() - n * 3_600_000);
      case 'd': return new Date(now.getTime() - n * 86_400_000);
      case 'w': return new Date(now.getTime() - n * 604_800_000);
      case 'm': { const d = new Date(now); d.setMonth(d.getMonth() - n); return d; }
      case 'y': { const d = new Date(now); d.setFullYear(d.getFullYear() - n); return d; }
    }
  }
  const iso = new Date(value);
  return isNaN(iso.getTime()) ? null : iso;
}

export async function GET(req: NextRequest) {
  const limit = Math.min(
    parseInt(req.nextUrl.searchParams.get('limit') ?? '20', 10),
    100
  );

  const sinceParam = req.nextUrl.searchParams.get('since');
  const sinceDate = sinceParam ? parseSince(sinceParam) : null;

  const historyCount = sinceDate
    ? 10_000
    : Math.min(parseInt(req.nextUrl.searchParams.get('history') ?? '0', 10), 500);

  // For each active ticker, get the most recent snapshot
  const tickers = await prisma.ticker.findMany({ where: { active: true } });

  const snapshots = await Promise.all(
    tickers.map(async (t) => {
      const latest = await prisma.signalSnapshot.findFirst({
        where: { tickerId: t.id },
        orderBy: { timestamp: 'desc' },
      });
      if (!latest) return null;

      let scoreHistory: number[] = [];
      let priceHistory: number[] = [];
      let priceTimestamps: string[] = [];
      if (sinceDate || historyCount > 0) {
        let effectiveSince = sinceDate;
        let effectiveTake = historyCount;

        const history = await prisma.signalSnapshot.findMany({
          where: {
            tickerId: t.id,
            ...(effectiveSince ? { timestamp: { gte: effectiveSince } } : {}),
          },
          orderBy: { timestamp: 'desc' },
          take: effectiveTake,
          select: { signalScore: true, currentPrice: true, timestamp: true },
        });

        // If "today" yielded < 2 entries, widen to last 24h for score evolution
        let finalHistory = history;
        if (effectiveSince && history.length < 2) {
          const wider = await prisma.signalSnapshot.findMany({
            where: {
              tickerId: t.id,
              timestamp: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
            },
            orderBy: { timestamp: 'desc' },
            take: effectiveTake,
            select: { signalScore: true, currentPrice: true, timestamp: true },
          });
          if (wider.length > finalHistory.length) finalHistory = wider;
        }

        // Reverse so chart plots oldest → newest (left to right)
        finalHistory.reverse();
        // Keep only the last snapshot per minute to smooth rapid-poll oscillation
        const seen = new Map<string, number>();
        for (let i = 0; i < finalHistory.length; i++) {
          seen.set(finalHistory[i].timestamp.toISOString().slice(0, 16), i);
        }
        const thinned = [...new Set(seen.values())].sort((a, b) => a - b).map(i => finalHistory[i]);
        scoreHistory = thinned.map((h) => h.signalScore);
        priceHistory = thinned.map((h) => h.currentPrice);
        priceTimestamps = thinned.map((h) => h.timestamp.toISOString());
      }

      return { ...latest, scoreHistory, priceHistory, priceTimestamps };
    })
  );

  // Apply watchlist threshold filter (overridable via ?threshold=0)
  const settings = await prisma.appSettings.findFirst();
  const thresholdParam = req.nextUrl.searchParams.get('threshold');
  const watchlistThreshold = thresholdParam !== null
    ? parseInt(thresholdParam, 10)
    : (settings?.watchlistThreshold ?? 0);

  const results = snapshots
    .filter((s): s is NonNullable<typeof s> => s !== null)
    .filter((s) => s.signalScore >= watchlistThreshold)
    .sort((a, b) => b.signalScore - a.signalScore)
    .slice(0, limit);

  return NextResponse.json(results);
}
