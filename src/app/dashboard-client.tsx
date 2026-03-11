'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ScoreBadge,
  PctChange,
  FloatDisplay,
  NewsIndicator,
  TimeAgo,
} from '@/components/signal-badges';
import { Sparkline } from '@/components/sparkline';

interface Snapshot {
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
  float: number | null;
  recentNewsCount: number;
  isBreakout: boolean;
  nearHigh: boolean;
  timestamp: string;
  scoreHistory: number[];
}

export function DashboardClient() {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [polling, setPolling] = useState(false);
  const [marketOpen, setMarketOpen] = useState(false);

  function isMarketOpen(): boolean {
    const now = new Date();
    const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const day = et.getDay();
    const hours = et.getHours();
    const minutes = et.getMinutes();
    const time = hours * 60 + minutes;
    // Mon–Fri, 9:30 AM – 4:00 PM ET
    return day >= 1 && day <= 5 && time >= 570 && time < 960;
  }

  async function fetchSnapshots() {
    try {
      const res = await fetch('/api/snapshots?history=20');
      if (res.ok) {
        const data = await res.json();
        setSnapshots(data);
        setLastRefresh(new Date());
      }
    } catch (err) {
      console.error('Failed to fetch snapshots:', err);
    } finally {
      setLoading(false);
    }
  }

  async function runPoll() {
    if (polling) return;
    setPolling(true);
    try {
      await fetch('/api/poll', { method: 'POST' });
      await fetchSnapshots();
    } catch (err) {
      console.error('Auto-poll failed:', err);
    } finally {
      setPolling(false);
    }
  }

  useEffect(() => {
    // Always load existing data
    fetchSnapshots();
    // Poll once on load if market is open
    if (isMarketOpen()) runPoll();

    // Check market status and auto-poll at configured interval
    let pollTimer: ReturnType<typeof setInterval>;
    let displayTimer: ReturnType<typeof setInterval>;

    async function startTimers() {
      let intervalSec = 60;
      try {
        const res = await fetch('/api/settings');
        if (res.ok) {
          const settings = await res.json();
          intervalSec = settings.pollingIntervalSec ?? 60;
        }
      } catch { /* default 60s */ }

      // Auto-poll only during market hours
      pollTimer = setInterval(() => {
        const open = isMarketOpen();
        setMarketOpen(open);
        if (open) runPoll();
      }, intervalSec * 1000);

      // Refresh display every 30s during market hours
      displayTimer = setInterval(() => {
        if (isMarketOpen()) fetchSnapshots();
      }, 30_000);

      setMarketOpen(isMarketOpen());
    }

    startTimers();
    return () => {
      clearInterval(pollTimer);
      clearInterval(displayTimer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="pt-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">Live Opportunities</h1>
        <div className="flex items-center gap-2">
          {!marketOpen && (
            <span className="text-[10px] text-yellow-500">market closed</span>
          )}
          {polling && (
            <span className="text-[10px] text-blue-400 animate-pulse">polling…</span>
          )}
          {lastRefresh && (
            <span className="text-[10px] text-gray-600">
              <TimeAgo date={lastRefresh.toISOString()} />
            </span>
          )}
        </div>
      </div>

      {loading && (
        <div className="text-center text-gray-500 py-12">Loading signals...</div>
      )}

      {!loading && snapshots.length === 0 && (
        <div className="text-center text-gray-500 py-12">
          <p className="text-lg mb-2">No signals yet</p>
          <p className="text-sm">Trigger a polling cycle from Settings or wait for market hours.</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {snapshots.map((s) => (
          <Link
            key={s.id}
            href={`/signal/${s.symbol}`}
            className="block bg-gray-900 border border-gray-800 rounded-lg p-3 hover:border-gray-600 transition-colors"
          >
            <div className="flex items-start justify-between mb-2">
              <div>
                <span className="font-bold text-base">{s.symbol}</span>
                <span className="text-gray-400 text-sm ml-2">
                  ${s.currentPrice.toFixed(2)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {s.scoreHistory.length >= 2 && (
                  <Sparkline data={s.scoreHistory} width={64} height={24} />
                )}
                <ScoreBadge score={s.signalScore} />
              </div>
            </div>

            {/* Key metrics row — adapts to data source */}
            <div className="grid grid-cols-3 gap-2 text-center mb-2">
              {s.pctChange5m != null && s.pctChangeIntraday != null ? (
                /* Candle mode: 5m / 1h / 1d */
                <>
                  <div>
                    <div className="text-gray-500 text-[10px]">5m</div>
                    <PctChange value={s.pctChange5m} />
                  </div>
                  <div>
                    <div className="text-gray-500 text-[10px]">1h</div>
                    <PctChange value={s.pctChange1h} />
                  </div>
                  <div>
                    <div className="text-gray-500 text-[10px]">1d</div>
                    <PctChange value={s.pctChange1d} />
                  </div>
                </>
              ) : (
                /* Quote-only mode: Intraday / 1d / Range */
                <>
                  <div>
                    <div className="text-gray-500 text-[10px]">Intraday</div>
                    <PctChange value={s.pctChangeIntraday ?? s.pctChange5m} />
                  </div>
                  <div>
                    <div className="text-gray-500 text-[10px]">1d Change</div>
                    <PctChange value={s.pctChange1d} />
                  </div>
                  <div>
                    <div className="text-gray-500 text-[10px]">Range</div>
                    <RangePosition value={s.intradayRangePct ?? s.pctChange15m} />
                  </div>
                </>
              )}
            </div>

            {/* Info row */}
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-3">
                <div>
                  <span className="text-gray-500 mr-1">Float</span>
                  <FloatDisplay value={s.float} />
                </div>
                {s.rvol != null && s.rvol >= 1.5 && (
                  <span className="text-cyan-400 font-medium">RVOL {s.rvol.toFixed(1)}x</span>
                )}
                {s.isBreakout && (
                  <span className="text-green-400 font-medium">GAP UP</span>
                )}
                {s.nearHigh && !s.isBreakout && (
                  <span className="text-yellow-400 font-medium">Near High</span>
                )}
                <NewsIndicator count={s.recentNewsCount} />
              </div>
              <TimeAgo date={s.timestamp} />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function RangePosition({ value }: { value: number | null }) {
  if (value == null) return <span className="text-gray-600 text-xs">—</span>;
  const pct = Math.round(value * 100);
  const color = pct >= 80 ? 'text-green-400' : pct >= 50 ? 'text-yellow-400' : 'text-red-400';
  return <span className={`text-xs font-medium ${color}`}>{pct}%</span>;
}
