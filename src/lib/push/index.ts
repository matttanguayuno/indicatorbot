/**
 * Web Push notification helper.
 * Sends push notifications to all saved subscriptions using VAPID keys.
 */

import webpush from 'web-push';
import prisma from '@/lib/db';

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY ?? '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? 'mailto:admin@indicatorbot.app';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

export interface PushPayload {
  title: string;
  body: string;
  symbol?: string;
  score?: number;
}

/**
 * Send a push notification to all saved subscriptions.
 * Automatically removes expired/unsubscribed endpoints (410 Gone).
 */
export async function sendPushToAll(payload: PushPayload): Promise<void> {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.log('[Push] VAPID keys not configured, skipping push notifications');
    return;
  }

  const subscriptions = await prisma.pushSubscription.findMany();
  if (subscriptions.length === 0) return;

  const jsonPayload = JSON.stringify(payload);

  const results = await Promise.allSettled(
    subscriptions.map(async (sub: { id: number; endpoint: string; p256dh: string; auth: string }) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          jsonPayload,
        );
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 410 || statusCode === 404) {
          // Subscription expired or unsubscribed — clean it up
          console.log(`[Push] Removing expired subscription: ${sub.endpoint.slice(0, 60)}...`);
          await prisma.pushSubscription.delete({ where: { id: sub.id } });
        } else {
          console.error(`[Push] Failed to send to ${sub.endpoint.slice(0, 60)}:`, err);
        }
      }
    }),
  );

  const sent = results.filter((r: PromiseSettledResult<void>) => r.status === 'fulfilled').length;
  console.log(`[Push] Sent ${sent}/${subscriptions.length} notifications`);
}
