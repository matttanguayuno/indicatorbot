/**
 * News sentiment classification — two approaches:
 *   "keyword" — fast, free, pattern-matching heuristic
 *   "ai"      — GPT-4o-mini batch classification
 */

import OpenAI from 'openai';
import prisma from '@/lib/db';

let _openai: OpenAI | null = null;
function getOpenAI() {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

type Sentiment = 'bullish' | 'bearish' | 'neutral';

// ── Keyword heuristic ──────────────────────────────────────────────────

const BULLISH_PATTERNS = [
  /\bupgrade[ds]?\b/i, /\bbeat[s]?\b/i, /\bsurpass/i, /\brecord\s+(high|revenue|earnings|profit)/i,
  /\braise[ds]?\s+(price\s+)?target/i, /\bstrong\s+(buy|growth|demand|earnings)/i,
  /\bpartnership/i, /\bapproval/i, /\bFDA\s+approv/i, /\bbullish/i,
  /\bsurge[ds]?\b/i, /\bsoar[s]?\b/i, /\bjump[s]?\b/i, /\brall(y|ies|ied)\b/i,
  /\boutperform/i, /\bbreakout\b/i, /\bbuy\s+rating/i, /\boverweight\b/i,
  /\bgrowth\b/i, /\boptimis(m|tic)\b/i,
  /\bpositive\b/i, /\bcontract\s+award/i,
];

const BEARISH_PATTERNS = [
  /\bdowngrade[ds]?\b/i, /\bmiss(es|ed)?\b/i, /\bwarn(s|ed|ing)?\b/i,
  /\blower[s]?\s+(price\s+)?target/i, /\bcut[s]?\s+(price\s+)?target/i,
  /\bweak(er|ness)?\b/i, /\bdecline[ds]?\b/i,
  /\bsell\s+rating/i, /\bbearish/i, /\bunderperform/i, /\bunderweight\b/i,
  /\blawsuit/i, /\bfraud/i, /\brecall[s]?\b/i, /\bFDA\s+reject/i,
  /\bdelisting/i, /\bshort\s+seller/i, /\bplunge[ds]?\b/i, /\bcrash/i,
  /\blay\s*off/i, /\brestructur/i, /\bdefault/i, /\bbankrupt/i,
  /\bpenalt(y|ies)/i, /\binvestigat/i, /\bnegative\b/i,
];

export function classifyKeyword(headline: string): Sentiment {
  const bullishHits = BULLISH_PATTERNS.filter(p => p.test(headline)).length;
  const bearishHits = BEARISH_PATTERNS.filter(p => p.test(headline)).length;
  if (bullishHits > bearishHits) return 'bullish';
  if (bearishHits > bullishHits) return 'bearish';
  return 'neutral';
}

// ── AI classification ──────────────────────────────────────────────────

const AI_SYSTEM = `You classify financial news headlines as bullish, bearish, or neutral for the stock mentioned.
Respond with ONLY a JSON array of objects: [{"id": number, "sentiment": "bullish"|"bearish"|"neutral"}]
No explanation, no markdown — just the JSON array.`;

export async function classifyAI(items: { id: number; headline: string }[]): Promise<Map<number, Sentiment>> {
  const result = new Map<number, Sentiment>();
  if (items.length === 0) return result;

  try {
    const openai = getOpenAI();
    const userMsg = items.map(i => `${i.id}: ${i.headline}`).join('\n');
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0,
      messages: [
        { role: 'system', content: AI_SYSTEM },
        { role: 'user', content: userMsg },
      ],
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? '[]';
    const parsed = JSON.parse(raw) as { id: number; sentiment: string }[];
    for (const entry of parsed) {
      const s = entry.sentiment?.toLowerCase();
      if (s === 'bullish' || s === 'bearish' || s === 'neutral') {
        result.set(entry.id, s);
      }
    }
  } catch (err) {
    console.error('[Sentiment] AI classification failed:', err instanceof Error ? err.message : err);
  }

  return result;
}

// ── Apply sentiment to unscored news items ─────────────────────────────

export async function applySentiment(keywordOnly = false): Promise<number> {
  const settings = await prisma.appSettings.findFirst();
  const method = keywordOnly ? 'keyword' : (settings?.sentimentMethod ?? 'keyword');

  if (method === 'off') return 0;

  const unscored = await prisma.newsItem.findMany({
    where: { sentiment: null },
    select: { id: true, headline: true },
    take: 200,
  });

  if (unscored.length === 0) return 0;

  let classified: Map<number, Sentiment>;

  if (method === 'ai') {
    classified = await classifyAI(unscored);
    // Fill any AI didn't return with keyword fallback
    for (const item of unscored) {
      if (!classified.has(item.id)) {
        classified.set(item.id, classifyKeyword(item.headline));
      }
    }
  } else {
    classified = new Map();
    for (const item of unscored) {
      classified.set(item.id, classifyKeyword(item.headline));
    }
  }

  let count = 0;
  for (const [id, sentiment] of classified) {
    await prisma.newsItem.update({ where: { id }, data: { sentiment } });
    count++;
  }

  console.log(`[Sentiment] Classified ${count} articles via ${method}`);
  return count;
}
