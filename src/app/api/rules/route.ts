/**
 * GET /api/rules  — returns merged rules (defaults + DB overrides).
 * PUT /api/rules  — saves rule overrides to DB.
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { getScoringRules, getDefaultRules } from '@/lib/config';

export async function GET() {
  const rules = await getScoringRules();
  const defaults = getDefaultRules();
  return NextResponse.json({ rules, defaults });
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const overrides = body.rules;
  if (overrides == null || typeof overrides !== 'object') {
    return NextResponse.json({ error: 'Invalid rules payload' }, { status: 400 });
  }

  let settings = await prisma.appSettings.findFirst();
  if (!settings) {
    settings = await prisma.appSettings.create({
      data: { rulesJson: JSON.stringify(overrides) },
    });
  } else {
    settings = await prisma.appSettings.update({
      where: { id: settings.id },
      data: { rulesJson: JSON.stringify(overrides) },
    });
  }

  const rules = await getScoringRules();
  const defaults = getDefaultRules();
  return NextResponse.json({ rules, defaults });
}
