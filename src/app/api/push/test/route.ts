/**
 * POST /api/push/test — send a test push notification to all subscribers.
 */

import { NextResponse } from 'next/server';
import { sendPushToAll } from '@/lib/push';

export async function POST() {
  try {
    await sendPushToAll({
      title: '🔔 Test Notification',
      body: 'Push notifications are working! You will receive alerts when signals fire.',
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[Push Test] Error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Failed to send test notification' }, { status: 500 });
  }
}
