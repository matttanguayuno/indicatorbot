import { NextResponse } from 'next/server';
import { getApiCallLog, clearApiCallLog, setLoggingEnabledCache } from '@/lib/twelvedata';
import prisma from '@/lib/db';

export async function GET() {
  const [entries, settings] = await Promise.all([
    getApiCallLog(),
    prisma.appSettings.findFirst(),
  ]);
  return NextResponse.json({
    entries,
    enabled: settings?.apiLoggingEnabled ?? true,
  });
}

export async function DELETE() {
  await clearApiCallLog();
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request) {
  const { enabled } = await req.json() as { enabled: boolean };
  await prisma.appSettings.upsert({
    where: { id: 1 },
    create: { apiLoggingEnabled: enabled },
    update: { apiLoggingEnabled: enabled },
  });
  setLoggingEnabledCache(enabled);
  return NextResponse.json({ ok: true, enabled });
}
