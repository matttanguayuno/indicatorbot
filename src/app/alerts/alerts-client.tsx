'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ScoreBadge, TimeAgo } from '@/components/signal-badges';

interface AlertData {
  id: number;
  symbol: string;
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

export function AlertsClient() {
  const [alerts, setAlerts] = useState<AlertData[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedbackAlert, setFeedbackAlert] = useState<number | null>(null);
  const [feedbackNote, setFeedbackNote] = useState('');

  useEffect(() => {
    fetchAlerts();
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
          <p className="text-lg mb-2">No alerts yet</p>
          <p className="text-sm">Alerts appear when a ticker crosses the score threshold.</p>
        </div>
      )}

      <div className="space-y-2">
        {alerts.map((a) => (
          <div key={a.id} className="bg-gray-900 border border-gray-800 rounded-lg p-3">
            <div className="flex items-start justify-between mb-1">
              <Link href={`/signal/${a.symbol}`} className="font-bold text-blue-400 hover:underline">
                {a.symbol}
              </Link>
              <ScoreBadge score={a.scoreAtAlert} />
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
        ))}
      </div>
    </div>
  );
}
