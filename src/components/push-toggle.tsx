'use client';

import { useEffect, useState, useCallback } from 'react';

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr.buffer as ArrayBuffer;
}

type PushState = 'loading' | 'unsupported' | 'prompt' | 'denied' | 'subscribed' | 'unsubscribed';

export function PushToggle() {
  const [state, setState] = useState<PushState>('loading');
  const [busy, setBusy] = useState(false);
  const [isStandalone, setIsStandalone] = useState(true);

  const checkState = useCallback(async () => {
    // Check if browser supports push
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setState('unsupported');
      return;
    }

    // Check if running as installed PWA (iOS requirement)
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsStandalone(standalone);

    // Check notification permission
    if (Notification.permission === 'denied') {
      setState('denied');
      return;
    }

    // Check existing subscription
    try {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js');
      if (reg) {
        const sub = await reg.pushManager.getSubscription();
        setState(sub ? 'subscribed' : 'unsubscribed');
      } else {
        setState('unsubscribed');
      }
    } catch {
      setState('unsubscribed');
    }
  }, []);

  useEffect(() => {
    checkState();
  }, [checkState]);

  async function subscribe() {
    if (!VAPID_PUBLIC_KEY) {
      console.error('VAPID public key not configured');
      return;
    }

    setBusy(true);
    try {
      // Register service worker
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;

      // Request permission
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'prompt');
        return;
      }

      // Subscribe to push
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });

      // Save subscription on server
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub.toJSON()),
      });

      if (res.ok) {
        setState('subscribed');
      }
    } catch (err) {
      console.error('Push subscription failed:', err);
    } finally {
      setBusy(false);
    }
  }

  async function unsubscribe() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js');
      if (reg) {
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          // Remove from server
          await fetch('/api/push/subscribe', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: sub.endpoint }),
          });
          // Unsubscribe locally
          await sub.unsubscribe();
        }
      }
      setState('unsubscribed');
    } catch (err) {
      console.error('Push unsubscription failed:', err);
    } finally {
      setBusy(false);
    }
  }

  if (state === 'loading') {
    return (
      <div className="text-sm text-gray-400">Checking notification support…</div>
    );
  }

  if (state === 'unsupported') {
    return (
      <div className="text-sm text-gray-500">
        Push notifications are not supported in this browser.
      </div>
    );
  }

  if (state === 'denied') {
    return (
      <div className="text-sm text-red-400">
        Notification permission was denied. To enable, update your browser/device notification settings for this site.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {!isStandalone && (
        <div className="text-sm text-yellow-400/80 bg-yellow-400/10 rounded-lg px-3 py-2">
          📱 On iPhone, you must <strong>Add to Home Screen</strong> first for push notifications to work.
          Tap the Share button → &quot;Add to Home Screen&quot;.
        </div>
      )}

      {state === 'subscribed' ? (
        <div className="flex items-center gap-3">
          <span className="text-sm text-green-400">✓ Notifications enabled</span>
          <button
            onClick={unsubscribe}
            disabled={busy}
            className="text-sm text-gray-400 hover:text-red-400 transition-colors disabled:opacity-50"
          >
            {busy ? 'Disabling…' : 'Disable'}
          </button>
        </div>
      ) : (
        <button
          onClick={subscribe}
          disabled={busy}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
        >
          {busy ? 'Enabling…' : 'Enable Push Notifications'}
        </button>
      )}
    </div>
  );
}
