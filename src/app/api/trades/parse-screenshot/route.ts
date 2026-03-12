/**
 * POST /api/trades/parse-screenshot
 * Accepts a base64 image, sends it to OpenAI gpt-4o vision to extract trade details.
 * The image is NOT stored — only the parsed fields are returned.
 */

import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

let _openai: OpenAI | null = null;
function getOpenAI() {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

const SYSTEM_PROMPT = `You are a trade screenshot parser. The user will send you a screenshot of a trade confirmation, order fill, or position from a brokerage app (e.g. Webull, Robinhood, Fidelity, TD Ameritrade, IBKR, etc).

Extract the following fields from the image:
- symbol: The stock ticker symbol (e.g. "AAPL", "TSLA"). Always uppercase.
- side: "buy" or "sell"
- quantity: Number of shares (as a number)
- price: Price per share (as a number)
- tradedAt: The date/time of the trade in ISO 8601 format if visible, otherwise null

Return ONLY valid JSON with this exact structure:
{
  "symbol": "AAPL",
  "side": "buy",
  "quantity": 100,
  "price": 150.25,
  "tradedAt": "2024-01-15T10:30:00Z"
}

If a field is not visible or unclear, use null for that field. Never invent data.
If the image is not a trade screenshot, return: { "error": "Could not identify trade details in this image" }`;

export async function POST(req: NextRequest) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: 'OPENAI_API_KEY is not configured' },
      { status: 500 }
    );
  }

  const body = await req.json();
  const { image } = body;

  if (!image || typeof image !== 'string') {
    return NextResponse.json(
      { error: 'image (base64 data URL) is required' },
      { status: 400 }
    );
  }

  // Validate it looks like a data URL
  if (!image.startsWith('data:image/')) {
    return NextResponse.json(
      { error: 'image must be a base64 data URL (data:image/...)' },
      { status: 400 }
    );
  }

  try {
    const response = await getOpenAI().chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 300,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: image, detail: 'auto' },
            },
            {
              type: 'text',
              text: 'Parse the trade details from this screenshot.',
            },
          ],
        },
      ],
    });

    const content = response.choices[0]?.message?.content?.trim();
    if (!content) {
      return NextResponse.json(
        { error: 'No response from OpenAI' },
        { status: 502 }
      );
    }

    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json(
        { error: 'Could not parse response from AI', raw: content },
        { status: 502 }
      );
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // If the AI flagged an error
    if (parsed.error) {
      console.error('AI could not parse screenshot:', content);
      return NextResponse.json({ error: parsed.error, raw: content }, { status: 422 });
    }

    return NextResponse.json({
      symbol: parsed.symbol ?? null,
      side: parsed.side ?? null,
      quantity: parsed.quantity != null ? Number(parsed.quantity) : null,
      price: parsed.price != null ? Number(parsed.price) : null,
      tradedAt: parsed.tradedAt ?? null,
    });
  } catch (err) {
    console.error('Screenshot parse error:', err);
    return NextResponse.json(
      { error: 'Failed to parse screenshot' },
      { status: 500 }
    );
  }
}
