/**
 * POST /api/push/subscribe — save a push subscription.
 * DELETE /api/push/subscribe — remove a push subscription.
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';

interface SubscriptionBody {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

function isValidSubscription(body: unknown): body is SubscriptionBody {
  if (typeof body !== 'object' || body === null) return false;
  const obj = body as Record<string, unknown>;
  if (typeof obj.endpoint !== 'string' || !obj.endpoint.startsWith('https://')) return false;
  if (typeof obj.keys !== 'object' || obj.keys === null) return false;
  const keys = obj.keys as Record<string, unknown>;
  if (typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') return false;
  return true;
}

export async function POST(req: NextRequest) {
  const body = await req.json();

  if (!isValidSubscription(body)) {
    return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 });
  }

  await prisma.pushSubscription.upsert({
    where: { endpoint: body.endpoint },
    update: { p256dh: body.keys.p256dh, auth: body.keys.auth },
    create: {
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
    },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const body = await req.json();
  const endpoint = typeof body?.endpoint === 'string' ? body.endpoint : null;

  if (!endpoint) {
    return NextResponse.json({ error: 'Missing endpoint' }, { status: 400 });
  }

  await prisma.pushSubscription.deleteMany({ where: { endpoint } });
  return NextResponse.json({ ok: true });
}
