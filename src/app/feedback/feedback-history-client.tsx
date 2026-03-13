'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ScoreBadge, TimeAgo } from '@/components/signal-badges';

const RATING_LABELS: Record<string, { label: string; color: string }> = {
  GOOD: { label: '👍 Good', color: 'text-green-400' },
  BAD: { label: '👎 Bad', color: 'text-red-400' },
  TOO_LATE: { label: '⏰ Too Late', color: 'text-yellow-400' },
  FALSE_BREAKOUT: { label: '💥 False Breakout', color: 'text-orange-400' },
  OTHER: { label: '📝 Other', color: 'text-gray-400' },
};

interface FeedbackEntry {
  id: number;
  rating: string;
  note: string | null;
  createdAt: string;
  alert: {
    symbol: string;
    alertType: string;
    scoreAtAlert: number;
    explanation: string;
    createdAt: string;
  };
}

type FilterRating = 'ALL' | string;

export function FeedbackHistoryClient() {
  const [entries, setEntries] = useState<FeedbackEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterRating>('ALL');

  useEffect(() => {
    fetch('/api/feedback/history')
      .then((r) => (r.ok ? r.json() : []))
      .then(setEntries)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = filter === 'ALL' ? entries : entries.filter((e) => e.rating === filter);

  // Stats
  const stats = entries.reduce<Record<string, number>>((acc, e) => {
    acc[e.rating] = (acc[e.rating] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="pt-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Feedback History</h1>
        <Link href="/settings" className="text-sm text-blue-400 hover:underline">
          ← Settings
        </Link>
      </div>

      {/* Summary stats */}
      {entries.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setFilter('ALL')}
            className={`text-sm px-3 py-1 rounded-full transition-colors ${
              filter === 'ALL'
                ? 'bg-blue-700 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            All ({entries.length})
          </button>
          {Object.entries(RATING_LABELS).map(([key, { label }]) => {
            const count = stats[key] || 0;
            if (count === 0) return null;
            return (
              <button
                key={key}
                onClick={() => setFilter(filter === key ? 'ALL' : key)}
                className={`text-sm px-3 py-1 rounded-full transition-colors ${
                  filter === key
                    ? 'bg-blue-700 text-white'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                {label} ({count})
              </button>
            );
          })}
        </div>
      )}

      {loading && <div className="text-center text-gray-500 py-12">Loading...</div>}

      {!loading && entries.length === 0 && (
        <div className="text-center text-gray-500 py-12">
          <p className="text-lg mb-2">No feedback yet</p>
          <p className="text-sm">Leave feedback on alerts to start building your history.</p>
        </div>
      )}

      <div className="space-y-2">
        {filtered.map((entry) => {
          const ratingInfo = RATING_LABELS[entry.rating] ?? {
            label: entry.rating,
            color: 'text-gray-400',
          };
          return (
            <div
              key={entry.id}
              className="bg-gray-900 border border-gray-800 rounded-lg p-3"
            >
              <div className="flex items-start justify-between mb-1">
                <div className="flex items-center gap-2">
                  <Link
                    href={`/signal/${entry.alert.symbol}`}
                    className="font-bold text-blue-400 hover:underline"
                  >
                    {entry.alert.symbol}
                  </Link>
                  <span
                    className={`text-xs font-semibold px-1.5 py-0.5 rounded ${
                      entry.alert.alertType === 'sell'
                        ? 'bg-red-900/60 text-red-300'
                        : 'bg-green-900/60 text-green-300'
                    }`}
                  >
                    {entry.alert.alertType === 'sell' ? 'SELL' : 'BUY'}
                  </span>
                  <ScoreBadge score={entry.alert.scoreAtAlert} />
                </div>
                <span className={`text-sm font-medium ${ratingInfo.color}`}>
                  {ratingInfo.label}
                </span>
              </div>

              <p className="text-sm text-gray-400 mb-1">{entry.alert.explanation}</p>

              {entry.note && (
                <p className="text-sm text-gray-300 bg-gray-800/60 rounded px-2 py-1 mb-1">
                  &ldquo;{entry.note}&rdquo;
                </p>
              )}

              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>
                  Alert: <TimeAgo date={entry.alert.createdAt} />
                </span>
                <span>
                  Feedback: <TimeAgo date={entry.createdAt} />
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
