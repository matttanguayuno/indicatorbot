/**
 * POST /api/screener/parse-screenshot
 * Accepts a base64 image of a Webull top-movers table, uses GPT-4o vision
 * to extract ticker symbols, then syncs the watchlist.
 */

import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import prisma from '@/lib/db';

let _openai: OpenAI | null = null;
function getOpenAI() {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

const SYSTEM_PROMPT = `You are a stock ticker extractor. The user will send you a screenshot of a stock screener table (e.g. from Webull, Finviz, or similar). The table shows a numbered list of stock tickers/symbols.

Extract ALL ticker symbols visible in the image. Ticker symbols are typically 1-5 uppercase letters (e.g. AAPL, TSLA, BIAF, SVCO).

Return ONLY valid JSON with this exact structure:
{
  "symbols": ["BIAF", "SVCO", "PLYX", "ISPC"]
}

Rules:
- Only include stock ticker symbols, not row numbers, prices, or other data.
- Symbols should be uppercase.
- Preserve the order they appear in the table.
- If you cannot identify any symbols, return: { "symbols": [], "error": "Could not identify ticker symbols in this image" }`;

export async function POST(req: NextRequest) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: 'OPENAI_API_KEY is not configured' },
      { status: 500 },
    );
  }

  const body = await req.json();
  const { image } = body;

  if (!image || typeof image !== 'string') {
    return NextResponse.json(
      { error: 'image (base64 data URL) is required' },
      { status: 400 },
    );
  }

  if (!image.startsWith('data:image/')) {
    return NextResponse.json(
      { error: 'image must be a base64 data URL (data:image/...)' },
      { status: 400 },
    );
  }

  try {
    // Extract symbols via GPT-4o vision
    const response = await getOpenAI().chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 500,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: image, detail: 'low' },
            },
            {
              type: 'text',
              text: 'Extract all stock ticker symbols from this screener table.',
            },
          ],
        },
      ],
    });

    const content = response.choices[0]?.message?.content?.trim();
    if (!content) {
      return NextResponse.json({ error: 'No response from OpenAI' }, { status: 502 });
    }

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ error: 'Could not parse AI response', raw: content }, { status: 502 });
    }

    const parsed = JSON.parse(jsonMatch[0]);

    if (parsed.error || !Array.isArray(parsed.symbols) || parsed.symbols.length === 0) {
      return NextResponse.json(
        { error: parsed.error || 'No symbols found in image', raw: content },
        { status: 422 },
      );
    }

    // Validate: only allow uppercase alpha symbols 1-5 chars
    const symbols: string[] = parsed.symbols
      .map((s: unknown) => typeof s === 'string' ? s.toUpperCase().trim() : '')
      .filter((s: string) => /^[A-Z]{1,5}$/.test(s));

    if (symbols.length === 0) {
      return NextResponse.json({ error: 'No valid ticker symbols extracted' }, { status: 422 });
    }

    // Sync watchlist — same logic as /api/screener/sync
    await prisma.ticker.deleteMany({ where: { active: false } });

    const previouslyActive = await prisma.ticker.count({ where: { active: true } });

    await prisma.ticker.updateMany({ data: { active: false } });

    let added = 0;
    let reactivated = 0;
    for (const symbol of symbols) {
      const existing = await prisma.ticker.findUnique({ where: { symbol } });
      if (existing) {
        await prisma.ticker.update({
          where: { symbol },
          data: { active: true },
        });
        reactivated++;
      } else {
        await prisma.ticker.create({
          data: { symbol, active: true },
        });
        added++;
      }
    }

    const deactivated = Math.max(0, previouslyActive - reactivated);

    return NextResponse.json({
      symbols,
      total: symbols.length,
      added,
      reactivated,
      deactivated,
    });
  } catch (err) {
    console.error('[Screener Parse] Error:', err);
    const message = err instanceof Error ? err.message : 'Failed to parse screenshot';
    return NextResponse.json(
      { error: message },
      { status: 500 },
    );
  }
}
