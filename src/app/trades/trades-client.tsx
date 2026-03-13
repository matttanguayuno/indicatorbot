'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { ScoreBadge } from '@/components/signal-badges';

interface TradeData {
  id: number;
  symbol: string;
  side: string;
  quantity: number;
  price: number;
  total: number;
  scoreAtTrade: number | null;
  notes: string | null;
  tradedAt: string;
  ticker: { name: string | null };
}

type ViewMode = 'by-time' | 'by-stock' | 'by-score';

export function TradesClient() {
  const [trades, setTrades] = useState<TradeData[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('by-time');

  // Upload state
  const [uploading, setUploading] = useState(false);
  const [parsed, setParsed] = useState<{
    symbol: string | null;
    side: string | null;
    quantity: number | null;
    price: number | null;
    tradedAt: string | null;
    unrealizedPnl?: number | null;
  } | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notes, setNotes] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // Manual entry state
  const [showManual, setShowManual] = useState(false);
  const [manualForm, setManualForm] = useState({
    symbol: '',
    side: 'buy' as 'buy' | 'sell',
    quantity: '',
    price: '',
    tradedAt: '',
    notes: '',
  });

  useEffect(() => {
    fetchTrades();
  }, []);

  async function fetchTrades() {
    try {
      const res = await fetch('/api/trades');
      if (res.ok) setTrades(await res.json());
    } catch (err) {
      console.error('Failed to fetch trades:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setParseError(null);
    setParsed(null);

    try {
      const dataUrl = await resizeImage(file, 1568);
      const res = await fetch('/api/trades/parse-screenshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: dataUrl }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        setParseError(data.error || 'Failed to parse screenshot');
      } else {
        setParsed(data);
      }
    } catch (err) {
      console.error('Upload error:', err);
      setParseError('Failed to upload and parse screenshot');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function saveParsedTrade() {
    if (!parsed?.symbol || !parsed?.side || !parsed?.quantity || !parsed?.price) return;
    setSaving(true);
    try {
      const res = await fetch('/api/trades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: parsed.symbol,
          side: parsed.side,
          quantity: parsed.quantity,
          price: parsed.price,
          tradedAt: parsed.tradedAt,
          notes: notes || null,
        }),
      });
      if (res.ok) {
        setParsed(null);
        setNotes('');
        fetchTrades();
      }
    } catch (err) {
      console.error('Save error:', err);
    } finally {
      setSaving(false);
    }
  }

  async function saveManualTrade() {
    const { symbol, side, quantity, price, tradedAt, notes: manualNotes } = manualForm;
    if (!symbol || !quantity || !price) return;
    setSaving(true);
    try {
      const res = await fetch('/api/trades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          side,
          quantity: parseFloat(quantity),
          price: parseFloat(price),
          tradedAt: tradedAt || null,
          notes: manualNotes || null,
        }),
      });
      if (res.ok) {
        setShowManual(false);
        setManualForm({ symbol: '', side: 'buy', quantity: '', price: '', tradedAt: '', notes: '' });
        fetchTrades();
      }
    } catch (err) {
      console.error('Save error:', err);
    } finally {
      setSaving(false);
    }
  }

  async function deleteTrade(id: number) {
    try {
      await fetch(`/api/trades?id=${id}`, { method: 'DELETE' });
      fetchTrades();
    } catch (err) {
      console.error('Delete error:', err);
    }
  }

  // Group trades by symbol
  function groupByStock() {
    const map = new Map<string, TradeData[]>();
    for (const t of trades) {
      const existing = map.get(t.symbol) || [];
      existing.push(t);
      map.set(t.symbol, existing);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }

  // Sort trades by time (newest first)
  function sortByTime() {
    return [...trades].sort((a, b) => new Date(b.tradedAt).getTime() - new Date(a.tradedAt).getTime());
  }

  // Sort trades by score (highest first)
  function sortByScore() {
    return [...trades].sort((a, b) => (b.scoreAtTrade ?? -1) - (a.scoreAtTrade ?? -1));
  }

  return (
    <div className="pt-4 pb-20 lg:pb-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Trades</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setShowManual(!showManual)}
            className="text-sm bg-gray-800 hover:bg-gray-700 text-gray-200 px-3 py-1.5 rounded-lg transition-colors"
          >
            ✏️ Manual
          </button>
          <label className="text-sm bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg cursor-pointer transition-colors">
            📸 Upload
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileUpload}
            />
          </label>
        </div>
      </div>

      {/* Screenshot parsing in progress */}
      {uploading && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 mb-4 text-center">
          <span className="text-gray-400">Parsing screenshot...</span>
        </div>
      )}

      {/* Parse error */}
      {parseError && (
        <div className="bg-red-900/30 border border-red-800 rounded-lg p-4 mb-4">
          <p className="text-red-400 text-sm">{parseError}</p>
          <button onClick={() => setParseError(null)} className="text-sm text-gray-400 hover:text-gray-200 mt-1">
            Dismiss
          </button>
        </div>
      )}

      {/* Parsed trade preview */}
      {parsed && (
        <div className="bg-gray-900 border border-blue-800 rounded-lg p-4 mb-4">
          <h3 className="text-sm font-medium text-blue-400 mb-3">Parsed Trade — Review & Save</h3>
          <div className="grid grid-cols-2 gap-3 mb-3 text-sm">
            <div>
              <span className="text-gray-500">Symbol:</span>{' '}
              <span className="text-gray-200 font-mono">{parsed.symbol ?? '—'}</span>
            </div>
            <div>
              <span className="text-gray-500">Side:</span>{' '}
              <span className={parsed.side === 'buy' ? 'text-green-400' : 'text-red-400'}>
                {parsed.side ?? '—'}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Qty:</span>{' '}
              <span className="text-gray-200 font-mono">{parsed.quantity ?? '—'}</span>
            </div>
            <div>
              <span className="text-gray-500">Price:</span>{' '}
              <span className="text-gray-200 font-mono">
                {parsed.price != null ? `$${parsed.price.toFixed(2)}` : '—'}
              </span>
            </div>
            {parsed.unrealizedPnl != null && (
              <div>
                <span className="text-gray-500">P&L:</span>{' '}
                <span className={parsed.unrealizedPnl >= 0 ? 'text-green-400 font-mono' : 'text-red-400 font-mono'}>
                  {parsed.unrealizedPnl >= 0 ? '+' : ''}{parsed.unrealizedPnl.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
                </span>
              </div>
            )}
            {parsed.tradedAt && (
              <div className="col-span-2">
                <span className="text-gray-500">Date:</span>{' '}
                <span className="text-gray-200">{new Date(parsed.tradedAt).toLocaleString()}</span>
              </div>
            )}
          </div>
          <input
            type="text"
            placeholder="Optional notes..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200 placeholder-gray-600 mb-3"
          />
          <div className="flex gap-2">
            <button
              onClick={saveParsedTrade}
              disabled={saving || !parsed.symbol || !parsed.side || !parsed.quantity || !parsed.price}
              className="bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-sm px-4 py-1.5 rounded transition-colors"
            >
              {saving ? 'Saving...' : 'Save Trade'}
            </button>
            <button
              onClick={() => { setParsed(null); setNotes(''); }}
              className="text-sm text-gray-400 hover:text-gray-200 px-3 py-1.5"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Manual entry form */}
      {showManual && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 mb-4">
          <h3 className="text-sm font-medium text-gray-300 mb-3">Manual Trade Entry</h3>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <input
              type="text"
              placeholder="Symbol (e.g. AAPL)"
              value={manualForm.symbol}
              onChange={(e) => setManualForm({ ...manualForm, symbol: e.target.value })}
              className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200 placeholder-gray-600"
            />
            <select
              value={manualForm.side}
              onChange={(e) => setManualForm({ ...manualForm, side: e.target.value as 'buy' | 'sell' })}
              className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200"
            >
              <option value="buy">Buy</option>
              <option value="sell">Sell</option>
            </select>
            <input
              type="number"
              placeholder="Quantity"
              value={manualForm.quantity}
              onChange={(e) => setManualForm({ ...manualForm, quantity: e.target.value })}
              className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200 placeholder-gray-600"
            />
            <input
              type="number"
              step="0.01"
              placeholder="Price"
              value={manualForm.price}
              onChange={(e) => setManualForm({ ...manualForm, price: e.target.value })}
              className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200 placeholder-gray-600"
            />
            <input
              type="datetime-local"
              value={manualForm.tradedAt}
              onChange={(e) => setManualForm({ ...manualForm, tradedAt: e.target.value })}
              className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200 col-span-2"
            />
            <input
              type="text"
              placeholder="Optional notes..."
              value={manualForm.notes}
              onChange={(e) => setManualForm({ ...manualForm, notes: e.target.value })}
              className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200 placeholder-gray-600 col-span-2"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={saveManualTrade}
              disabled={saving || !manualForm.symbol || !manualForm.quantity || !manualForm.price}
              className="bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-sm px-4 py-1.5 rounded transition-colors"
            >
              {saving ? 'Saving...' : 'Save Trade'}
            </button>
            <button
              onClick={() => setShowManual(false)}
              className="text-sm text-gray-400 hover:text-gray-200 px-3 py-1.5"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* View mode toggle */}
      <div className="flex gap-1 mb-4 bg-gray-900 rounded-lg p-1 w-fit">
        <button
          onClick={() => setViewMode('by-time')}
          className={`text-sm px-3 py-1.5 rounded-md transition-colors ${
            viewMode === 'by-time' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          By Time
        </button>
        <button
          onClick={() => setViewMode('by-stock')}
          className={`text-sm px-3 py-1.5 rounded-md transition-colors ${
            viewMode === 'by-stock' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          By Stock
        </button>
        <button
          onClick={() => setViewMode('by-score')}
          className={`text-sm px-3 py-1.5 rounded-md transition-colors ${
            viewMode === 'by-score' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          By Score
        </button>
      </div>

      {/* Loading */}
      {loading && <div className="text-center text-gray-500 py-12">Loading trades...</div>}

      {/* Empty state */}
      {!loading && trades.length === 0 && (
        <div className="text-center text-gray-500 py-12">
          <p className="text-lg mb-2">No trades logged yet</p>
          <p className="text-sm">Upload a screenshot or manually enter a trade to get started.</p>
        </div>
      )}

      {/* By Time view */}
      {!loading && trades.length > 0 && viewMode === 'by-time' && (
        <div className="space-y-2">
          {sortByTime().map((t) => (
            <div key={t.id} className="bg-gray-900 border border-gray-800 rounded-lg p-3">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <Link href={`/signal/${t.symbol}`} className="font-bold text-blue-400 hover:underline">
                    {t.symbol}
                  </Link>
                  <span className={`text-sm font-medium ${t.side === 'buy' ? 'text-green-400' : 'text-red-400'}`}>
                    {t.side.toUpperCase()}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {t.scoreAtTrade != null && <ScoreBadge score={t.scoreAtTrade} />}
                  <button
                    onClick={() => deleteTrade(t.id)}
                    className="text-gray-600 hover:text-red-400 text-sm transition-colors"
                    title="Delete trade"
                  >
                    ✕
                  </button>
                </div>
              </div>
              <div className="text-sm text-gray-400">
                {t.quantity} × ${t.price.toFixed(2)} = ${t.total.toFixed(2)}
              </div>
              {t.notes && <p className="text-sm text-gray-500 mt-1">{t.notes}</p>}
              <div className="text-xs text-gray-600 mt-1">
                {new Date(t.tradedAt).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* By Stock view */}
      {!loading && trades.length > 0 && viewMode === 'by-stock' && (
        <div className="space-y-4">
          {groupByStock().map(([symbol, symbolTrades]) => (
            <div key={symbol} className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
                <Link href={`/signal/${symbol}`} className="font-bold text-blue-400 hover:underline text-lg">
                  {symbol}
                </Link>
                <span className="text-sm text-gray-500">{symbolTrades.length} trade{symbolTrades.length !== 1 ? 's' : ''}</span>
              </div>
              <div className="divide-y divide-gray-800">
                {symbolTrades.map((t) => (
                  <TradeRow key={t.id} trade={t} onDelete={deleteTrade} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* By Score view */}
      {!loading && trades.length > 0 && viewMode === 'by-score' && (
        <div className="space-y-2">
          {sortByScore().map((t) => (
            <div key={t.id} className="bg-gray-900 border border-gray-800 rounded-lg p-3">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <Link href={`/signal/${t.symbol}`} className="font-bold text-blue-400 hover:underline">
                    {t.symbol}
                  </Link>
                  <span className={`text-sm font-medium ${t.side === 'buy' ? 'text-green-400' : 'text-red-400'}`}>
                    {t.side.toUpperCase()}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {t.scoreAtTrade != null && <ScoreBadge score={t.scoreAtTrade} />}
                  <button
                    onClick={() => deleteTrade(t.id)}
                    className="text-gray-600 hover:text-red-400 text-sm transition-colors"
                    title="Delete trade"
                  >
                    ✕
                  </button>
                </div>
              </div>
              <div className="text-sm text-gray-400">
                {t.quantity} × ${t.price.toFixed(2)} = ${t.total.toFixed(2)}
              </div>
              {t.notes && <p className="text-sm text-gray-500 mt-1">{t.notes}</p>}
              <div className="text-xs text-gray-600 mt-1">
                {new Date(t.tradedAt).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TradeRow({ trade, onDelete }: { trade: TradeData; onDelete: (id: number) => void }) {
  return (
    <div className="px-4 py-3 flex items-center justify-between">
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-0.5">
          <span className={`text-sm font-medium ${trade.side === 'buy' ? 'text-green-400' : 'text-red-400'}`}>
            {trade.side.toUpperCase()}
          </span>
          <span className="text-sm text-gray-300">
            {trade.quantity} × ${trade.price.toFixed(2)}
          </span>
          <span className="text-sm text-gray-500">= ${trade.total.toFixed(2)}</span>
        </div>
        {trade.notes && <p className="text-sm text-gray-500">{trade.notes}</p>}
        <div className="text-xs text-gray-600">{new Date(trade.tradedAt).toLocaleString()}</div>
      </div>
      <div className="flex items-center gap-2">
        {trade.scoreAtTrade != null && <ScoreBadge score={trade.scoreAtTrade} />}
        <button
          onClick={() => onDelete(trade.id)}
          className="text-gray-600 hover:text-red-400 text-sm transition-colors"
          title="Delete trade"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

function resizeImage(file: File, maxDim: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}
