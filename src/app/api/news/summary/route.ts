/**
 * GET  /api/news/summary — fetch the latest persisted summary
 * POST /api/news/summary — generate a new AI summary for all watchlist stocks
 */

import { NextResponse } from 'next/server';
import { generateNewsSummary } from '@/lib/news/summary';
import prisma from '@/lib/db';

// GET: return the latest stored summary
export async function GET() {
  const latest = await prisma.newsSummary.findFirst({
    orderBy: { generatedAt: 'desc' },
  });

  if (!latest) {
    return NextResponse.json({ summary: null, symbols: [], generatedAt: null });
  }

  return NextResponse.json({
    summary: latest.summary,
    symbols: latest.symbols.split(',').filter(Boolean),
    generatedAt: latest.generatedAt.toISOString(),
  });
}

// POST: generate a fresh summary and persist it
export async function POST() {
  try {
    const result = await generateNewsSummary();
    return NextResponse.json(result);
  } catch (err) {
    console.error('[News Summary] Error:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: 'Failed to generate summary. Please try again.' },
      { status: 500 },
    );
  }
}
