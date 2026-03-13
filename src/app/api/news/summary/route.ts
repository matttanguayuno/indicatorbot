/**
 * GET  /api/news/summary — fetch the latest persisted summary
 * POST /api/news/summary — generate a new AI summary for all watchlist stocks
 */

import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import prisma from '@/lib/db';

let _openai: OpenAI | null = null;
function getOpenAI() {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

const SYSTEM_PROMPT = `You are a concise financial news analyst. The user will provide recent news headlines grouped by stock ticker, along with each stock's signal score (0-100) and price change data.

Write a brief market narrative (2-3 short paragraphs) summarizing the key themes:
- Lead with the most actionable or significant stories
- Group related catalysts (e.g. sector trends, earnings, FDA, macro)
- Mention specific tickers and their momentum context
- Keep it under 200 words
- Use a professional but accessible tone — a trader scanning for opportunities
- If there are no meaningful catalysts, say so honestly

Do NOT use markdown headers or bullet points. Write in flowing paragraphs.`;

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
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: 'OPENAI_API_KEY is not configured' },
      { status: 500 },
    );
  }

  const tickers = await prisma.ticker.findMany({ where: { active: true } });

  const stocks: {
    symbol: string;
    signalScore: number;
    currentPrice: number;
    pctChangeIntraday: number | null;
    pctChange1d: number | null;
  }[] = [];

  for (const t of tickers) {
    const snap = await prisma.signalSnapshot.findFirst({
      where: { tickerId: t.id },
      orderBy: { timestamp: 'desc' },
      select: {
        symbol: true,
        signalScore: true,
        currentPrice: true,
        pctChangeIntraday: true,
        pctChange1d: true,
      },
    });
    if (snap) stocks.push(snap);
  }

  if (stocks.length === 0) {
    const summary = 'No stocks in the watchlist. Add tickers in Settings or wait for a screener sync.';
    await prisma.newsSummary.create({ data: { summary, symbols: '' } });
    return NextResponse.json({ summary, symbols: [], generatedAt: new Date().toISOString() });
  }

  // Fetch recent news (last 48h, up to 10 per ticker)
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const newsPerSymbol: Record<string, { headline: string; source: string | null; publishedAt: Date }[]> = {};

  await Promise.all(
    stocks.map(async (q) => {
      const articles = await prisma.newsItem.findMany({
        where: { symbol: q.symbol, publishedAt: { gte: cutoff } },
        orderBy: { publishedAt: 'desc' },
        take: 10,
        select: { headline: true, source: true, publishedAt: true },
      });
      if (articles.length > 0) {
        newsPerSymbol[q.symbol] = articles;
      }
    }),
  );

  const allSymbols = stocks.map((s) => s.symbol);

  if (Object.keys(newsPerSymbol).length === 0) {
    const summary = `${stocks.length} stock${stocks.length > 1 ? 's' : ''} on the watchlist but no recent news articles found in the last 48 hours. Current signals are driven by price action and volume rather than news catalysts.`;
    await prisma.newsSummary.create({ data: { summary, symbols: allSymbols.join(',') } });
    return NextResponse.json({ summary, symbols: allSymbols, generatedAt: new Date().toISOString() });
  }

  const stockSections = stocks
    .sort((a, b) => b.signalScore - a.signalScore)
    .map((q) => {
      const articles = newsPerSymbol[q.symbol];
      const pctIntra = q.pctChangeIntraday != null ? `${q.pctChangeIntraday > 0 ? '+' : ''}${q.pctChangeIntraday.toFixed(1)}%` : 'n/a';
      const pct1d = q.pctChange1d != null ? `${q.pctChange1d > 0 ? '+' : ''}${q.pctChange1d.toFixed(1)}%` : 'n/a';

      let section = `${q.symbol} — Score: ${q.signalScore}/100, Price: $${q.currentPrice.toFixed(2)}, Intraday: ${pctIntra}, 1d: ${pct1d}`;
      if (articles && articles.length > 0) {
        section += '\nRecent headlines:';
        for (const a of articles) {
          section += `\n- ${a.headline}${a.source ? ` (${a.source})` : ''}`;
        }
      } else {
        section += '\n(No recent news — movement is technical/volume-driven)';
      }
      return section;
    })
    .join('\n\n');

  const userMessage = `Here are today's watchlist stocks and their recent news:\n\n${stockSections}`;

  try {
    const response = await getOpenAI().chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 400,
      temperature: 0.7,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
    });

    const summary = response.choices[0]?.message?.content?.trim() ?? 'Unable to generate summary.';
    await prisma.newsSummary.create({ data: { summary, symbols: allSymbols.join(',') } });

    return NextResponse.json({ summary, symbols: allSymbols, generatedAt: new Date().toISOString() });
  } catch (err) {
    console.error('[News Summary] OpenAI error:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: 'Failed to generate summary. Please try again.' },
      { status: 500 },
    );
  }
}
