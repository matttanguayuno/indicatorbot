'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import { ScoreBadge, TimeAgo } from '@/components/signal-badges';

interface AlertData {
  id: number;
  symbol: string;
  alertType: string;
  scoreAtAlert: number;
  explanation: string;
  createdAt: string;
  feedback: { rating: string; note: string | null } | null;
}

const RATINGS = [
  { value: 'GOOD', label: '👍 Good', color: 'bg-green-700' },
  { value: 'BAD', label: '👎 Bad', color: 'bg-red-700' },
  { value: 'TOO_LATE', label: '⏰ Too Late', color: 'bg-yellow-700' },
  { value: 'FALSE_BREAKOUT', label: '💥 False BO', color: 'bg-orange-700' },
  { value: 'OTHER', label: '📝 Other', color: 'bg-gray-700' },
] as const;

const SWIPE_THRESHOLD = 100;

function SwipeableAlert({
  alert,
  onDismiss,
  children,
}: {
  alert: AlertData;
  onDismiss: (id: number) => void;
  children: React.ReactNode;
}) {
  const [offsetX, setOffsetX] = useState(0);
  const [dismissing, setDismissing] = useState(false);
  const startX = useRef(0);
  const startY = useRef(0);
  const locked = useRef<'h' | 'v' | null>(null);
  const swiping = useRef(false);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    startX.current = t.clientX;
    startY.current = t.clientY;
    locked.current = null;
    swiping.current = true;
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!swiping.current) return;
    const t = e.touches[0];
    const dx = t.clientX - startX.current;
    const dy = t.clientY - startY.current;

    if (!locked.current && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
      locked.current = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
    }

    if (locked.current !== 'h') return;
    // Only allow left swipe
    setOffsetX(Math.min(0, dx));
  }, []);

  const onTouchEnd = useCallback(() => {
    swiping.current = false;
    if (offsetX < -SWIPE_THRESHOLD) {
      setDismissing(true);
      setOffsetX(-500);
      setTimeout(() => onDismiss(alert.id), 200);
    } else {
      setOffsetX(0);
    }
  }, [offsetX, alert.id, onDismiss]);

  return (
    <div className="relative overflow-hidden rounded-lg">
      {/* Red background behind */}
      <div className="absolute inset-0 bg-red-900/80 flex items-center justify-end pr-6 rounded-lg">
        <span className="text-red-300 text-sm font-semibold">Dismiss</span>
      </div>
      <div
        className={`relative transition-transform ${dismissing ? 'duration-200' : offsetX === 0 ? 'duration-150' : 'duration-0'}`}
        style={{ transform: `translateX(${offsetX}px)` }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {children}
      </div>
    </div>
  );
}

export function AlertsClient() {
  const [alerts, setAlerts] = useState<AlertData[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedbackAlert, setFeedbackAlert] = useState<number | null>(null);
  const [feedbackNote, setFeedbackNote] = useState('');

  useEffect(() => {
    fetchAlerts();
    // Auto-refresh every 30s during market hours
    const interval = setInterval(fetchAlerts, 30_000);
    return () => clearInterval(interval);
  }, []);

  async function fetchAlerts() {
    try {
      const res = await fetch('/api/alerts');
      if (res.ok) setAlerts(await res.json());
    } catch (err) {
      console.error('Failed to fetch alerts:', err);
    } finally {
      setLoading(false);
    }
  }

  const dismissAlert = useCallback(async (id: number) => {
    setAlerts(prev => prev.filter(a => a.id !== id));
    await fetch(`/api/alerts?id=${id}`, { method: 'PATCH' }).catch(() => {});
  }, []);

  async function submitFeedback(alertId: number, rating: string) {
    try {
      await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alertId, rating, note: feedbackNote || null }),
      });
      setFeedbackAlert(null);
      setFeedbackNote('');
      fetchAlerts();
    } catch (err) {
      console.error('Failed to submit feedback:', err);
    }
  }

  return (
    <div className="pt-4">
      <h1 className="text-2xl font-bold mb-4">Alerts</h1>

      {loading && <div className="text-center text-gray-500 py-12">Loading alerts...</div>}

      {!loading && alerts.length === 0 && (
        <div className="text-center text-gray-500 py-12">
          <p className="text-lg mb-2">No alerts</p>
          <p className="text-sm">Alerts appear when a ticker crosses the score threshold.</p>
        </div>
      )}

      <div className="space-y-2">
        {alerts.map((a) => (
          <SwipeableAlert key={a.id} alert={a} onDismiss={dismissAlert}>
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
              <div className="flex items-start justify-between mb-1">
                <div className="flex items-center gap-2">
                  <Link href={`/signal/${a.symbol}`} className="font-bold text-blue-400 hover:underline">
                    {a.symbol}
                  </Link>
                  <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${
                    a.alertType === 'sell'
                      ? 'bg-red-900/60 text-red-300'
                      : 'bg-green-900/60 text-green-300'
                  }`}>
                    {a.alertType === 'sell' ? 'SELL' : 'BUY'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <ScoreBadge score={a.scoreAtAlert} />
                  {/* Desktop dismiss button */}
                  <button
                    onClick={() => dismissAlert(a.id)}
                    className="hidden sm:block text-gray-600 hover:text-gray-300 transition-colors text-lg px-1"
                    title="Dismiss alert"
                  >
                    ✕
                  </button>
                </div>
              </div>
              <p className="text-sm text-gray-400 mb-2">{a.explanation}</p>
              <div className="flex items-center justify-between">
                <TimeAgo date={a.createdAt} />
                {a.feedback ? (
                  <span className="text-sm text-gray-400">
                    Rated: {RATINGS.find((r) => r.value === a.feedback!.rating)?.label ?? a.feedback.rating}
                    {a.feedback.note && ` — "${a.feedback.note}"`}
                  </span>
                ) : (
                  <button
                    onClick={() => setFeedbackAlert(feedbackAlert === a.id ? null : a.id)}
                    className="text-sm text-blue-400 hover:underline"
                  >
                    Leave feedback
                  </button>
                )}
              </div>

              {feedbackAlert === a.id && (
                <div className="mt-3 border-t border-gray-800 pt-3">
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {RATINGS.map((r) => (
                      <button
                        key={r.value}
                        onClick={() => submitFeedback(a.id, r.value)}
                        className={`${r.color} text-white text-sm px-2.5 py-1.5 rounded hover:opacity-80 transition-opacity`}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                  <input
                    type="text"
                    placeholder="Optional note..."
                    value={feedbackNote}
                    onChange={(e) => setFeedbackNote(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200 placeholder-gray-600"
                  />
                </div>
              )}
            </div>
          </SwipeableAlert>
        ))}
      </div>
    </div>
  );
}
