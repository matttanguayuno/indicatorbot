'use client';

import { useState } from 'react';

interface SignalFeedbackProps {
  snapshotId: number;
  symbol: string;
  existingRating?: string | null;
  existingNote?: string | null;
  onSaved?: (rating: string, note: string | null) => void;
}

export function SignalFeedbackInline({ snapshotId, symbol, existingRating, existingNote, onSaved }: SignalFeedbackProps) {
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState<string | null>(existingRating ?? null);
  const [note, setNote] = useState(existingNote ?? '');
  const [saving, setSaving] = useState(false);

  async function save(newRating: string) {
    setSaving(true);
    try {
      const res = await fetch('/api/feedback/signal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshotId, symbol, rating: newRating, note: note || null }),
      });
      if (res.ok) {
        setRating(newRating);
        onSaved?.(newRating, note || null);
        if (!note) setOpen(false);
      }
    } catch (err) {
      console.error('Feedback save failed:', err);
    } finally {
      setSaving(false);
    }
  }

  async function saveNote() {
    if (!rating) return;
    setSaving(true);
    try {
      await fetch('/api/feedback/signal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshotId, symbol, rating, note: note || null }),
      });
      onSaved?.(rating, note || null);
      setOpen(false);
    } catch (err) {
      console.error('Feedback note save failed:', err);
    } finally {
      setSaving(false);
    }
  }

  // Compact: just show the rating badge if already rated
  if (rating && !open) {
    return (
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); }}
        className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
          rating === 'GOOD'
            ? 'border-green-700 bg-green-900/40 text-green-400'
            : rating === 'BAD'
            ? 'border-red-700 bg-red-900/40 text-red-400'
            : 'border-gray-700 bg-gray-800/40 text-gray-400'
        }`}
        title="Edit feedback"
      >
        {rating === 'GOOD' ? '👍' : rating === 'BAD' ? '👎' : '⏭️'}
      </button>
    );
  }

  // Not rated yet: show small trigger button
  if (!open) {
    return (
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); }}
        className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
        title="Rate this signal"
      >
        Rate
      </button>
    );
  }

  // Expanded feedback panel
  return (
    <div
      className="flex flex-col gap-2 bg-gray-800/80 rounded-lg p-2.5 mt-1"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
    >
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-400">Good trade?</span>
        <div className="flex gap-1.5">
          <button
            onClick={() => save('GOOD')}
            disabled={saving}
            className={`text-sm px-2 py-0.5 rounded transition-colors ${
              rating === 'GOOD'
                ? 'bg-green-700 text-green-100'
                : 'bg-gray-700 hover:bg-green-800 text-gray-300'
            }`}
          >
            👍
          </button>
          <button
            onClick={() => save('BAD')}
            disabled={saving}
            className={`text-sm px-2 py-0.5 rounded transition-colors ${
              rating === 'BAD'
                ? 'bg-red-700 text-red-100'
                : 'bg-gray-700 hover:bg-red-800 text-gray-300'
            }`}
          >
            👎
          </button>
          <button
            onClick={() => save('SKIP')}
            disabled={saving}
            className={`text-sm px-2 py-0.5 rounded transition-colors ${
              rating === 'SKIP'
                ? 'bg-gray-600 text-gray-200'
                : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
            }`}
          >
            Skip
          </button>
        </div>
        <button
          onClick={() => setOpen(false)}
          className="ml-auto text-xs text-gray-500 hover:text-gray-300"
        >
          ✕
        </button>
      </div>
      {rating && (
        <div className="flex gap-1.5">
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note..."
            className="flex-1 text-xs bg-gray-900 border border-gray-700 rounded px-2 py-1 text-gray-200 placeholder-gray-600"
            maxLength={200}
          />
          <button
            onClick={saveNote}
            disabled={saving || !note}
            className="text-xs px-2 py-1 bg-blue-700 hover:bg-blue-600 disabled:bg-gray-700 text-white rounded transition-colors"
          >
            Save
          </button>
        </div>
      )}
    </div>
  );
}
