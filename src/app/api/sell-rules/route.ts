/**
 * GET /api/sell-rules  — returns merged sell rules (defaults + DB overrides).
 * PUT /api/sell-rules  — saves sell rule overrides to DB.
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { getSellRules, getDefaultSellRules } from '@/lib/config';

export async function GET() {
  const rules = await getSellRules();
  const defaults = getDefaultSellRules();
  return NextResponse.json({ rules, defaults });
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const overrides = body.rules;
  if (overrides == null || typeof overrides !== 'object') {
    return NextResponse.json({ error: 'Invalid sell rules payload' }, { status: 400 });
  }

  let settings = await prisma.appSettings.findFirst();
  if (!settings) {
    settings = await prisma.appSettings.create({
      data: { sellRulesJson: JSON.stringify(overrides) },
    });
  } else {
    settings = await prisma.appSettings.update({
      where: { id: settings.id },
      data: { sellRulesJson: JSON.stringify(overrides) },
    });
  }

  const rules = await getSellRules();
  const defaults = getDefaultSellRules();
  return NextResponse.json({ rules, defaults });
}
