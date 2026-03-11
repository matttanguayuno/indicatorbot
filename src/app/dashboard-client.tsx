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
import { MiniChart } from '@/components/mini-chart';

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
  explanation: string;
  timestamp: string;
  scoreHistory: number[];
  priceHistory: number[];
}

export function DashboardClient() {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [polling, setPolling] = useState(false);
  const [marketOpen, setMarketOpen] = useState(false);
  const [chartDataMap, setChartDataMap] = useState<Record<string, number[]>>({});

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

  // Fetch intraday candle data for all current symbols
  useEffect(() => {
    if (snapshots.length === 0) return;
    const symbols = snapshots.map((s) => s.symbol);
    let cancelled = false;
    async function fetchCharts() {
      const entries: [string, number[]][] = await Promise.all(
        symbols.map(async (sym) => {
          try {
            const res = await fetch(`/api/chart/${encodeURIComponent(sym)}`);
            if (res.ok) {
              const data = await res.json();
              const closes: number[] = (data.candles ?? []).map((c: { close: number }) => c.close);
              return [sym, closes] as [string, number[]];
            }
          } catch { /* ignore */ }
          return [sym, []] as [string, number[]];
        })
      );
      if (!cancelled) {
        setChartDataMap(Object.fromEntries(entries));
      }
    }
    fetchCharts();
    return () => { cancelled = true; };
  }, [snapshots]);

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

      {/* Hero card — top-scoring stock on desktop */}
      {snapshots.length > 0 && <HeroCard s={snapshots[0]} chartData={chartDataMap[snapshots[0].symbol] ?? []} />}

      {/* Remaining cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mt-4">
        {snapshots.slice(1).map((s) => (
          <Link
            key={s.id}
            href={`/signal/${s.symbol}`}
            className="block bg-gray-900 border border-gray-800 rounded-lg p-4 hover:border-gray-600 transition-colors"
          >
            <div className="flex items-start justify-between mb-2">
              <div>
                <span className="font-bold text-lg">{s.symbol}</span>
                <span className="text-gray-400 text-sm ml-2">
                  ${s.currentPrice.toFixed(2)}
                </span>
              </div>
              <ScoreBadge score={s.signalScore} />
            </div>

            {/* Mini intraday chart */}
            {((chartDataMap[s.symbol] ?? []).length >= 2 || s.priceHistory.length >= 2) && (
              <div className="mb-2">
                <MiniChart data={(chartDataMap[s.symbol] ?? []).length >= 2 ? chartDataMap[s.symbol] : s.priceHistory} width={400} height={140} className="w-full" />
              </div>
            )}

            {/* Key metrics row — adapts to data source */}
            <div className="grid grid-cols-3 gap-2 text-center mb-2">
              {s.pctChange5m != null && s.pctChangeIntraday != null ? (
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

function HeroCard({ s, chartData: candleData }: { s: Snapshot; chartData: number[] }) {
  const hasCandleData = s.pctChange5m != null && s.pctChangeIntraday != null;
  // Use intraday candle closes, fall back to snapshot priceHistory
  const chartData = candleData.length >= 2 ? candleData : s.priceHistory;

  return (
    <Link
      href={`/signal/${s.symbol}`}
      className="block bg-gray-900 border border-gray-800 rounded-xl p-5 hover:border-gray-600 transition-colors"
    >
      {/* Hero header */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold">{s.symbol}</h2>
            <span className="text-gray-400 text-xl">${s.currentPrice.toFixed(2)}</span>
          </div>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {s.isBreakout && (
              <span className="px-2 py-0.5 rounded text-xs font-semibold bg-green-900/60 text-green-300 border border-green-700">
                {hasCandleData ? 'BREAKOUT' : 'GAP UP'}
              </span>
            )}
            {s.nearHigh && !s.isBreakout && (
              <span className="px-2 py-0.5 rounded text-xs font-semibold bg-yellow-900/60 text-yellow-300 border border-yellow-700">
                Near High
              </span>
            )}
            {s.rvol != null && s.rvol >= 1.5 && (
              <span className="px-2 py-0.5 rounded text-xs font-semibold bg-cyan-900/60 text-cyan-300 border border-cyan-700">
                RVOL {s.rvol.toFixed(1)}x
              </span>
            )}
            <NewsIndicator count={s.recentNewsCount} />
          </div>
        </div>
        <ScoreBadge score={s.signalScore} />
      </div>

      {/* Hero chart + metrics side by side on desktop */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Intraday price chart — larger for hero */}
        <div className="lg:col-span-2">
          {chartData.length >= 2 ? (
            <MiniChart data={chartData} width={600} height={200} className="w-full" />
          ) : (
            <div className="h-[200px] bg-gray-800/30 rounded animate-pulse flex items-center justify-center text-gray-600 text-sm">
              Loading chart…
            </div>
          )}
        </div>

        {/* Metrics */}
        <div className="space-y-2">
          <div className="grid grid-cols-4 lg:grid-cols-2 gap-2 text-center">
            {hasCandleData ? (
              <>
                <div>
                  <div className="text-gray-500 text-[10px]">5m</div>
                  <PctChange value={s.pctChange5m} />
                </div>
                <div>
                  <div className="text-gray-500 text-[10px]">15m</div>
                  <PctChange value={s.pctChange15m} />
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
              <>
                <div>
                  <div className="text-gray-500 text-[10px]">Intraday</div>
                  <PctChange value={s.pctChangeIntraday ?? s.pctChange5m} />
                </div>
                <div>
                  <div className="text-gray-500 text-[10px]">1d Change</div>
                  <PctChange value={s.pctChange1d} />
                </div>
              </>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs">
            <div>
              <span className="text-gray-500 mr-1">Float</span>
              <FloatDisplay value={s.float} />
            </div>
            <TimeAgo date={s.timestamp} />
          </div>
        </div>
      </div>

      {/* Explanation visible on hero */}
      {s.explanation && (
        <p className="text-sm text-gray-400 mt-3 line-clamp-2">{s.explanation}</p>
      )}
    </Link>
  );
}
