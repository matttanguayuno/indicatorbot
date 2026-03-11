'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ScoreBadge, PctChange, DataStatus, TimeAgo } from '@/components/signal-badges';

interface SnapshotDetail {
  id: number;
  symbol: string;
  currentPrice: number;
  signalScore: number;
  pctChange5m: number | null;
  pctChange15m: number | null;
  pctChange1h: number | null;
  pctChange1d: number | null;
  pctChangeIntraday: number | null;
  intradayRangePct: number | null;
  gapUpPct: number | null;
  rvol: number | null;
  volumeSpikeRatio: number | null;
  vwap: number | null;
  pctFromVwap: number | null;
  float: number | null;
  isBreakout: boolean;
  nearHigh: boolean;
  recentNewsCount: number;
  newsScore: number | null;
  shortInterest: number | null;
  optionsFlowValue: number | null;
  explanation: string;
  dataSourceMeta: string | null;
  timestamp: string;
}

interface HistoryEntry {
  id: number;
  signalScore: number;
  currentPrice: number;
  timestamp: string;
  explanation: string;
}

interface NewsEntry {
  id: number;
  headline: string;
  source: string | null;
  url: string | null;
  publishedAt: string;
}

export function SignalDetailClient({ symbol }: { symbol: string }) {
  const [latest, setLatest] = useState<SnapshotDetail | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [news, setNews] = useState<NewsEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/snapshots/${encodeURIComponent(symbol)}`);
        if (res.ok) {
          const data = await res.json();
          setLatest(data.latest);
          setHistory(data.history);
          setNews(data.news);
        }
      } catch (err) {
        console.error('Failed to load signal detail:', err);
      } finally {
        setLoading(false);
      }
    }
    load();

    const interval = setInterval(load, 60_000);
    return () => clearInterval(interval);
  }, [symbol]);

  if (loading) return <div className="text-center text-gray-500 py-12">Loading...</div>;
  if (!latest) return <div className="text-center text-gray-500 py-12">No data for {symbol}</div>;

  const meta: Record<string, string> = latest.dataSourceMeta ? JSON.parse(latest.dataSourceMeta) : {};
  const hasCandleData = latest.pctChange5m != null && latest.pctChangeIntraday != null;
  const rangePct = latest.intradayRangePct != null ? latest.intradayRangePct * 100
    : latest.pctChange15m != null ? latest.pctChange15m * 100
    : null;
  const gapUpPct = latest.gapUpPct ?? latest.pctChange1h;

  return (
    <div className="pt-4 space-y-4">
      <Link href="/" className="text-blue-400 text-sm hover:underline">← Back</Link>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{symbol}</h1>
          <span className="text-gray-400 text-lg">${latest.currentPrice.toFixed(2)}</span>
        </div>
        <ScoreBadge score={latest.signalScore} />
      </div>

      {/* Badges */}
      <div className="flex gap-2 flex-wrap">
        {latest.isBreakout && (
          <span className="px-2 py-0.5 rounded text-xs font-semibold bg-green-900/60 text-green-300 border border-green-700">
            {hasCandleData ? 'BREAKOUT' : 'GAP UP'}
          </span>
        )}
        {latest.nearHigh && !latest.isBreakout && (
          <span className="px-2 py-0.5 rounded text-xs font-semibold bg-yellow-900/60 text-yellow-300 border border-yellow-700">
            Near High
          </span>
        )}
        {latest.rvol != null && latest.rvol >= 1.5 && (
          <span className="px-2 py-0.5 rounded text-xs font-semibold bg-cyan-900/60 text-cyan-300 border border-cyan-700">
            RVOL {latest.rvol.toFixed(1)}x
          </span>
        )}
      </div>

      {/* Explanation */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
        <h2 className="text-sm font-semibold text-gray-400 mb-1">Signal Summary</h2>
        <p className="text-sm">{latest.explanation}</p>
      </div>

      {/* Price Action */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
        <h2 className="text-sm font-semibold text-gray-400 mb-2">Price Action</h2>
        {hasCandleData ? (
          <div className="grid grid-cols-4 gap-2 text-center">
            <div>
              <div className="text-gray-500 text-xs mb-1">5m</div>
              <PctChange value={latest.pctChange5m} />
            </div>
            <div>
              <div className="text-gray-500 text-xs mb-1">15m</div>
              <PctChange value={latest.pctChange15m} />
            </div>
            <div>
              <div className="text-gray-500 text-xs mb-1">1h</div>
              <PctChange value={latest.pctChange1h} />
            </div>
            <div>
              <div className="text-gray-500 text-xs mb-1">1d</div>
              <PctChange value={latest.pctChange1d} />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 text-center">
            <div>
              <div className="text-gray-500 text-xs mb-1">Intraday</div>
              <PctChange value={latest.pctChangeIntraday ?? latest.pctChange5m} />
            </div>
            <div>
              <div className="text-gray-500 text-xs mb-1">1d Change</div>
              <PctChange value={latest.pctChange1d} />
            </div>
          </div>
        )}
      </div>

      {/* Volume & VWAP (only when candle data available) */}
      {hasCandleData && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
          <h2 className="text-sm font-semibold text-gray-400 mb-2">Volume & VWAP</h2>
          <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-sm">
            <MetricRow label="RVOL" value={latest.rvol?.toFixed(1)} suffix="x" />
            <MetricRow label="Vol Spike" value={latest.volumeSpikeRatio?.toFixed(1)} suffix="x" />
            <MetricRow label="VWAP" value={latest.vwap?.toFixed(2)} prefix="$" />
            <MetricRow label="% from VWAP" value={latest.pctFromVwap?.toFixed(1)} suffix="%" />
          </div>
        </div>
      )}

      {/* Range & Gap */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
        <h2 className="text-sm font-semibold text-gray-400 mb-2">Range & Gap</h2>
        <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-sm">
          <MetricRow label="Range Position" value={rangePct != null ? rangePct.toFixed(0) : null} suffix="%" />
          <MetricRow label="Gap-Up" value={gapUpPct != null ? gapUpPct.toFixed(2) : null} suffix="%" />
        </div>
        {rangePct != null && (
          <div className="mt-2">
            <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${
                  rangePct >= 80 ? 'bg-green-500' : rangePct >= 50 ? 'bg-yellow-500' : 'bg-red-500'
                }`}
                style={{ width: `${Math.min(100, Math.max(0, rangePct))}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-gray-600 mt-0.5">
              <span>Low</span>
              <span>High</span>
            </div>
          </div>
        )}
      </div>

      {/* Fundamentals */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
        <h2 className="text-sm font-semibold text-gray-400 mb-2">Fundamentals</h2>
        <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-sm">
          <MetricRow label="Float" value={latest.float ? formatNum(latest.float) : null} />
          <MetricRow label="Recent News" value={String(latest.recentNewsCount)} />
          <MetricRow label="Short Interest" value={latest.shortInterest?.toFixed(2)} suffix="%" />
          <MetricRow label="Options Flow" value={latest.optionsFlowValue ? formatNum(latest.optionsFlowValue) : null} prefix="$" />
        </div>
      </div>

      {/* Data availability */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
        <h2 className="text-sm font-semibold text-gray-400 mb-2">Data Sources</h2>
        <div className="grid grid-cols-2 gap-y-1 text-sm">
          {Object.entries(meta).map(([key, status]) => (
            <div key={key} className="flex items-center gap-2">
              <DataStatus status={status} />
              <span className="text-gray-400 capitalize">{key}</span>
            </div>
          ))}
        </div>
      </div>

      {/* News */}
      {news.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
          <h2 className="text-sm font-semibold text-gray-400 mb-2">Recent News</h2>
          <div className="space-y-2">
            {news.map((n) => (
              <div key={n.id} className="text-sm">
                {n.url ? (
                  <a
                    href={n.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:underline"
                  >
                    {n.headline}
                  </a>
                ) : (
                  <span>{n.headline}</span>
                )}
                <div className="text-xs text-gray-500">
                  {n.source ? `${n.source} · ` : ''}
                  <TimeAgo date={n.publishedAt} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent history */}
      {history.length > 1 && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
          <h2 className="text-sm font-semibold text-gray-400 mb-2">Recent Snapshots</h2>
          <div className="space-y-1">
            {history.map((h) => (
              <div key={h.id} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <ScoreBadge score={h.signalScore} />
                  <span className="text-gray-400">${h.currentPrice.toFixed(2)}</span>
                </div>
                <TimeAgo date={h.timestamp} />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="text-xs text-gray-600 text-center pb-4">
        Auto-refreshes every 60s · Last updated: <TimeAgo date={latest.timestamp} />
      </div>
    </div>
  );
}

function MetricRow({
  label,
  value,
  prefix = '',
  suffix = '',
}: {
  label: string;
  value: string | null | undefined;
  prefix?: string;
  suffix?: string;
}) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-500">{label}</span>
      <span className="font-mono">
        {value != null ? `${prefix}${value}${suffix}` : <span className="text-gray-600">—</span>}
      </span>
    </div>
  );
}

function formatNum(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toFixed(0);
}
