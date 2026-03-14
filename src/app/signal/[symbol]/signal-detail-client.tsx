'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ScoreBadge, PctChange, DataStatus, TimeAgo } from '@/components/signal-badges';
import { RadarChart } from '@/components/radar-chart';
import { Sparkline } from '@/components/sparkline';
import { PriceChart } from '@/components/price-chart';
import { MiniChart } from '@/components/mini-chart';

interface ChartCandle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

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

interface ScoreBreakdown {
  momentumScore: number;
  rvolBoost: number;
  volumeSpikeBoost: number;
  intradayRangeBoost: number;
  breakoutBoost: number;
  vwapBoost: number;
  floatBoost: number;
  newsBoost: number;
  shortInterestBoost: number;
  optionsFlowBoost: number;
  missingPenalty: number;
  rawTotal: number;
  maxAchievable: number;
  finalScore: number;
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
  sentiment: string | null;
  sentimentSource: string | null;
  publishedAt: string;
}

const SCORE_CATEGORIES = [
  { key: 'momentumScore', label: 'Momentum', max: 30 },
  { key: 'rvolBoost', label: 'RVOL', max: 10 },
  { key: 'volumeSpikeBoost', label: 'Vol Spike', max: 5 },
  { key: 'intradayRangeBoost', label: 'Range', max: 10 },
  { key: 'breakoutBoost', label: 'Breakout', max: 10 },
  { key: 'vwapBoost', label: 'VWAP', max: 5 },
  { key: 'floatBoost', label: 'Float', max: 10 },
  { key: 'newsBoost', label: 'News', max: 10 },
  { key: 'shortInterestBoost', label: 'Short Int', max: 5 },
  { key: 'optionsFlowBoost', label: 'Options', max: 5 },
] as const;

export function SignalDetailClient({ symbol }: { symbol: string }) {
  const [latest, setLatest] = useState<SnapshotDetail | null>(null);
  const [breakdown, setBreakdown] = useState<ScoreBreakdown | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [news, setNews] = useState<NewsEntry[]>([]);
  const [chartCandles, setChartCandles] = useState<ChartCandle[]>([]);
  const [chartLoading, setChartLoading] = useState(true);
  const [chartDebug, setChartDebug] = useState<string>('');
  const [chartInterval, setChartInterval] = useState<string>('1min');
  const [chartRange, setChartRange] = useState<string>('1D');
  const [loading, setLoading] = useState(true);
  const chartContainerRef = useRef<HTMLDivElement>(null); // kept for layout
  const [tickerList, setTickerList] = useState<string[]>([]);
  const [buyEntry, setBuyEntry] = useState<{ id: number; entryPrice: number; scoreAtEntry: number; peakScoreSinceEntry: number; lastSellAlertLevel: number; boughtAt: string } | null>(null);
  const [buyLoading, setBuyLoading] = useState(false);
  const [stockAlerts, setStockAlerts] = useState<{ id: number; alertType: string; scoreAtAlert: number; explanation: string; createdAt: string }[]>([]);
  const searchParams = useSearchParams();
  const from = searchParams.get('from') ?? 'opportunities';

  // Fetch ticker list matching the source page context
  useEffect(() => {
    const url = from === 'watchlist' ? '/api/snapshots?threshold=0' : '/api/snapshots';
    fetch(url)
      .then(r => r.ok ? r.json() : [])
      .then((snapshots: { symbol: string }[]) => setTickerList(snapshots.map(s => s.symbol)))
      .catch(() => {});
  }, [from]);

  const currentIdx = tickerList.indexOf(symbol);
  const prevSymbol = currentIdx > 0 ? tickerList[currentIdx - 1] : null;
  const nextSymbol = currentIdx >= 0 && currentIdx < tickerList.length - 1 ? tickerList[currentIdx + 1] : null;

  // Mobile swipe navigation between stocks
  const router = useRouter();
  const pageRef = useRef<HTMLDivElement>(null);
  // Use refs for nav targets so the touch listener doesn't need to re-attach
  const prevRef = useRef(prevSymbol);
  const nextRef = useRef(nextSymbol);
  const fromRef = useRef(from);
  prevRef.current = prevSymbol;
  nextRef.current = nextSymbol;
  fromRef.current = from;
  const swipeState = useRef<{ startX: number; startY: number; locked: 'h' | 'v' | null; navigated: boolean } | null>(null);

  useEffect(() => {
    const onTouchStart = (e: TouchEvent) => {
      // Disable nav swipe when touching a chart (SVG or its container) so
      // chart interactivity (tap/drag to inspect values) isn't hijacked
      const el = e.target as HTMLElement;
      if (el.closest('svg') || el.closest('[data-chart]')) {
        swipeState.current = null;
        return;
      }
      const t = e.touches[0];
      swipeState.current = { startX: t.clientX, startY: t.clientY, locked: null, navigated: false };
    };
    const onTouchMove = (e: TouchEvent) => {
      const s = swipeState.current;
      if (!s || s.navigated) return;
      const t = e.touches[0];
      const dx = t.clientX - s.startX;
      const dy = t.clientY - s.startY;

      // Lock direction after 10px of movement
      if (!s.locked && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
        s.locked = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
      }

      // Only act on horizontal lock; let vertical scroll happen naturally
      if (s.locked !== 'h') return;

      // Navigate after 50px horizontal swipe
      if (Math.abs(dx) > 50) {
        s.navigated = true;
        if (dx < 0 && nextRef.current) router.push(`/signal/${nextRef.current}?from=${fromRef.current}`);
        if (dx > 0 && prevRef.current) router.push(`/signal/${prevRef.current}?from=${fromRef.current}`);
      }
    };
    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
    };
  }, [router]);

  // Fixed chart dimensions — viewBox is constant so font sizes scale
  // proportionally with the chart rather than with the container
  const chartWidth = 900;
  const chartHeight = 350;

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/snapshots/${encodeURIComponent(symbol)}`);
        if (res.ok) {
          const data = await res.json();
          setLatest(data.latest);
          setBreakdown(data.breakdown ?? null);
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

    // Load active buy entry for this symbol
    fetch(`/api/buy-entries?symbol=${encodeURIComponent(symbol)}`)
      .then(r => r.ok ? r.json() : [])
      .then((entries: { id: number; entryPrice: number; scoreAtEntry: number; peakScoreSinceEntry: number; lastSellAlertLevel: number; boughtAt: string }[]) => {
        setBuyEntry(entries.length > 0 ? entries[0] : null);
      })
      .catch(() => {});

    // Load latest 5 alerts for this symbol
    fetch(`/api/alerts?symbol=${encodeURIComponent(symbol)}&limit=5`)
      .then(r => r.ok ? r.json() : [])
      .then(setStockAlerts)
      .catch(() => {});

    const interval = setInterval(load, 60_000);
    return () => clearInterval(interval);
  }, [symbol]);

  // Fetch chart data (re-fetches when interval or range changes)
  useEffect(() => {
    let cancelled = false;
    async function loadChart() {
      setChartLoading(true);
      try {
        const params = new URLSearchParams({ interval: chartInterval, range: chartRange });
        const url = `/api/chart/${encodeURIComponent(symbol)}?${params}`;
        console.log(`[Chart] Fetching: ${url}`);
        const res = await fetch(url);
        if (res.ok && !cancelled) {
          const data = await res.json();
          console.log('[Chart] Response:', { source: data.source, interval: data.interval, range: data.range, cached: data.cached, candleCount: data.candleCount, timeRange: data.timeRange });
          setChartCandles(data.candles ?? []);
          setChartDebug(`src=${data.source ?? '?'} int=${data.interval} rng=${data.range} cached=${data.cached} n=${data.candleCount ?? data.candles?.length ?? 0}`);
        }
      } catch (err) {
        console.error('Failed to load chart:', err);
      } finally {
        if (!cancelled) setChartLoading(false);
      }
    }
    loadChart();
    return () => { cancelled = true; };
  }, [symbol, chartInterval, chartRange]);

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
      {/* Navigation: Back + Prev/Next */}
      <div className="flex items-center justify-between">
        <Link href={from === 'watchlist' ? '/watchlist' : '/'} className="text-blue-400 text-sm hover:underline">← {from === 'watchlist' ? 'Watchlist' : 'Back'}</Link>
        <div className="flex items-center gap-2">
          {prevSymbol ? (
            <Link href={`/signal/${prevSymbol}?from=${from}`} className="px-2.5 py-1 rounded text-sm font-medium bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors">
              ← {prevSymbol}
            </Link>
          ) : (
            <span className="px-2.5 py-1 rounded text-sm font-medium bg-gray-800/40 text-gray-600 cursor-default">← Prev</span>
          )}
          {tickerList.length > 0 && (
            <span className="text-xs text-gray-500">{currentIdx + 1}/{tickerList.length}</span>
          )}
          {nextSymbol ? (
            <Link href={`/signal/${nextSymbol}?from=${from}`} className="px-2.5 py-1 rounded text-sm font-medium bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors">
              {nextSymbol} →
            </Link>
          ) : (
            <span className="px-2.5 py-1 rounded text-sm font-medium bg-gray-800/40 text-gray-600 cursor-default">Next →</span>
          )}
        </div>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-3xl font-bold">{symbol}</h1>
            <span className="text-gray-400 text-xl">${latest.currentPrice.toFixed(2)}</span>
          </div>
          {history.length >= 2 && (
            <Sparkline data={history.map(h => h.signalScore).reverse()} width={80} height={32} />
          )}
        </div>
        <ScoreBadge score={latest.signalScore} />
      </div>

      {/* Alerts for this stock */}
      {stockAlerts.length > 0 && (
        <div className="space-y-1.5">
          {stockAlerts.map((a) => (
            <div key={a.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm border ${
              a.alertType === 'sell'
                ? 'bg-red-900/30 border-red-800/50'
                : 'bg-green-900/30 border-green-800/50'
            }`}>
              <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                a.alertType === 'sell' ? 'bg-red-900/60 text-red-300' : 'bg-green-900/60 text-green-300'
              }`}>
                {a.alertType === 'sell' ? 'SELL' : 'BUY'}
              </span>
              <span className="text-gray-300 flex-1 truncate">{a.explanation}</span>
              <TimeAgo date={a.createdAt} />
            </div>
          ))}
        </div>
      )}

      {/* Buy Entry */}
      <div className="flex items-center gap-3 flex-wrap">
        {buyEntry ? (
          <>
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm border ${
              buyEntry.lastSellAlertLevel >= 3 ? 'bg-red-900/60 border-red-600' :
              buyEntry.lastSellAlertLevel >= 2 ? 'bg-red-900/40 border-red-700/50' :
              buyEntry.lastSellAlertLevel >= 1 ? 'bg-yellow-900/40 border-yellow-700/50' :
              'bg-green-900/40 border-green-700/50'
            }`}>
              {buyEntry.lastSellAlertLevel >= 3 && <span title="EXIT NOW">🚨</span>}
              {buyEntry.lastSellAlertLevel === 2 && <span title="Hard Sell">🔴</span>}
              {buyEntry.lastSellAlertLevel === 1 && <span title="Soft Warning">⚠️</span>}
              <span className={
                buyEntry.lastSellAlertLevel >= 2 ? 'text-red-400 font-semibold' :
                buyEntry.lastSellAlertLevel === 1 ? 'text-yellow-400 font-semibold' :
                'text-green-400 font-semibold'
              }>Bought</span>
              <span className="text-gray-300">${buyEntry.entryPrice.toFixed(2)}</span>
              <span className="text-gray-500">score {buyEntry.scoreAtEntry}</span>
              {buyEntry.peakScoreSinceEntry > buyEntry.scoreAtEntry && (
                <span className="text-gray-500">peak {buyEntry.peakScoreSinceEntry.toFixed(0)}</span>
              )}
              <span className="text-gray-600"><TimeAgo date={buyEntry.boughtAt} /></span>
              {latest && (
                <span className={`font-medium ${latest.currentPrice >= buyEntry.entryPrice ? 'text-green-400' : 'text-red-400'}`}>
                  {((latest.currentPrice - buyEntry.entryPrice) / buyEntry.entryPrice * 100).toFixed(1)}%
                </span>
              )}
            </div>
          </>
        ) : (
          <button
            onClick={async () => {
              setBuyLoading(true);
              try {
                const res = await fetch('/api/buy-entries', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ symbol }),
                });
                if (res.ok) {
                  const entry = await res.json();
                  setBuyEntry(entry);
                }
              } finally {
                setBuyLoading(false);
              }
            }}
            disabled={buyLoading}
            className="px-4 py-1.5 bg-green-700 hover:bg-green-600 disabled:bg-gray-700 rounded-lg text-sm font-semibold transition-colors"
          >
            {buyLoading ? '⏳' : '💰 Buy'}
          </button>
        )}
      </div>

      {/* Badges */}
      <div className="flex gap-2 flex-wrap">
        {latest.isBreakout && (
          <span className="px-2.5 py-0.5 rounded text-sm font-semibold bg-green-900/60 text-green-300 border border-green-700">
            {hasCandleData ? 'BREAKOUT' : 'GAP UP'}
          </span>
        )}
        {latest.nearHigh && !latest.isBreakout && (
          <span className="px-2.5 py-0.5 rounded text-sm font-semibold bg-yellow-900/60 text-yellow-300 border border-yellow-700">
            Near High
          </span>
        )}
        {latest.rvol != null && latest.rvol >= 1.5 && (
          <span className="px-2.5 py-0.5 rounded text-sm font-semibold bg-cyan-900/60 text-cyan-300 border border-cyan-700">
            RVOL {latest.rvol.toFixed(1)}x
          </span>
        )}
      </div>

      {/* Explanation */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
        <h2 className="text-base font-semibold text-gray-400 mb-1">Signal Summary</h2>
        <p className="text-sm">{latest.explanation}</p>
      </div>

      {/* Price Chart */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
        <h2 className="text-base font-semibold text-gray-400 mb-2">Chart</h2>

        {/* Time Range — dropdown on mobile, buttons on sm+ */}
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs text-gray-500">Range</span>
          {/* Mobile dropdown */}
          <select
            value={chartRange}
            onChange={(e) => setChartRange(e.target.value as typeof chartRange)}
            className="sm:hidden bg-gray-800 text-gray-200 text-sm rounded px-2 py-1.5 border border-gray-700 focus:border-blue-500 outline-none"
          >
            {(['1H', '1D', '1W', '1M', 'Q', '1Y', 'YTD', 'Max'] as const).map((r) => (
              <option key={r} value={r}>{r === 'Q' ? 'Quarter' : r}</option>
            ))}
          </select>
          {/* Desktop buttons */}
          <div className="hidden sm:flex flex-wrap gap-1.5">
            {(['1H', '1D', '1W', '1M', 'Q', '1Y', 'YTD', 'Max'] as const).map((r) => (
              <button
                key={r}
                onClick={() => setChartRange(r)}
                className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                  chartRange === r
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                {r === 'Q' ? 'Quarter' : r}
              </button>
            ))}
          </div>
        </div>

        {/* Interval — dropdown on mobile, buttons on sm+ */}
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs text-gray-500">Interval</span>
          {/* Mobile dropdown */}
          <select
            value={chartInterval}
            onChange={(e) => setChartInterval(e.target.value as typeof chartInterval)}
            className="sm:hidden bg-gray-800 text-gray-200 text-sm rounded px-2 py-1.5 border border-gray-700 focus:border-blue-500 outline-none"
          >
            {([
              ['1min', '1m'],
              ['5min', '5m'],
              ['15min', '15m'],
              ['30min', '30m'],
              ['1h', '1h'],
              ['4h', '4h'],
            ] as const).map(([val, label]) => (
              <option key={val} value={val}>{label}</option>
            ))}
          </select>
          {/* Desktop buttons */}
          <div className="hidden sm:flex flex-wrap gap-1.5">
            {([
              ['1min', '1m'],
              ['5min', '5m'],
              ['15min', '15m'],
              ['30min', '30m'],
              ['1h', '1h'],
              ['4h', '4h'],
            ] as const).map(([val, label]) => (
              <button
                key={val}
                onClick={() => setChartInterval(val)}
                className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                  chartInterval === val
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {chartLoading ? (
          <div className="h-[280px] lg:h-[280px] bg-gray-800/30 rounded animate-pulse flex items-center justify-center text-gray-600 text-sm">
            Loading chart…
          </div>
        ) : chartCandles.length >= 2 ? (
          <div ref={chartContainerRef} className="w-full aspect-[900/900] sm:aspect-[900/450]">
            <PriceChart key={`${chartInterval}:${chartRange}`} candles={chartCandles} width={chartWidth} height={chartHeight} />
          </div>
        ) : history.length >= 2 ? (
          <div ref={chartContainerRef} className="w-full aspect-[900/900] sm:aspect-[900/450]">
            <MiniChart
              data={[...history].reverse().map(h => h.currentPrice)}
              timestamps={[...history].reverse().map(h => h.timestamp)}
              width={chartWidth}
              height={chartHeight}
            />
          </div>
        ) : (
          <div className="h-[120px] bg-gray-800/30 rounded flex items-center justify-center text-gray-600 text-sm">
            No intraday data available
          </div>
        )}
        {chartDebug && (
          <div className="mt-1 px-2 py-1 bg-gray-800/60 rounded text-[10px] font-mono text-gray-500">
            {chartDebug}
          </div>
        )}
      </div>

      {/* Two-column layout on desktop */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Main content — left 2 cols */}
        <div className="lg:col-span-2 space-y-4">
          {/* Price Action */}
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
            <h2 className="text-base font-semibold text-gray-400 mb-2">Price Action</h2>
            {hasCandleData ? (
              <div className="grid grid-cols-4 gap-2 text-center">
                <div>
                <div className="text-gray-500 text-sm mb-1">5m</div>
                  <PctChange value={latest.pctChange5m} />
                </div>
                <div>
                <div className="text-gray-500 text-sm mb-1">15m</div>
                  <PctChange value={latest.pctChange15m} />
                </div>
                <div>
                <div className="text-gray-500 text-sm mb-1">1h</div>
                  <PctChange value={latest.pctChange1h} />
                </div>
                <div>
                <div className="text-gray-500 text-sm mb-1">1d</div>
                  <PctChange value={latest.pctChange1d} />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 text-center">
                <div>
                  <div className="text-gray-500 text-sm mb-1">Intraday</div>
                  <PctChange value={latest.pctChangeIntraday ?? latest.pctChange5m} />
                </div>
                <div>
                  <div className="text-gray-500 text-sm mb-1">1d Change</div>
                  <PctChange value={latest.pctChange1d} />
                </div>
              </div>
            )}
          </div>

          {/* Volume & VWAP (only when candle data available) */}
          {hasCandleData && (
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
              <h2 className="text-base font-semibold text-gray-400 mb-2">Volume & VWAP</h2>
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
            <h2 className="text-base font-semibold text-gray-400 mb-2">Range & Gap</h2>
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
                <div className="flex justify-between text-sm text-gray-600 mt-0.5">
                  <span>Low</span>
                  <span>High</span>
                </div>
              </div>
            )}
          </div>

          {/* Fundamentals */}
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
            <h2 className="text-base font-semibold text-gray-400 mb-2">Fundamentals</h2>
            <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-sm">
              <MetricRow label="Float" value={latest.float ? formatNum(latest.float) : null} />
              <MetricRow label="Recent News" value={String(latest.recentNewsCount)} />
              <MetricRow label="Short Interest" value={latest.shortInterest?.toFixed(2)} suffix="%" />
              <MetricRow label="Options Flow" value={latest.optionsFlowValue ? formatNum(latest.optionsFlowValue) : null} prefix="$" />
            </div>
          </div>

          {/* Data availability */}
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
            <h2 className="text-base font-semibold text-gray-400 mb-2">Data Sources</h2>
            <div className="grid grid-cols-2 gap-y-1 text-sm">
              {Object.entries(meta).map(([key, status]) => (
                <div key={key} className="flex items-center gap-2">
                  <DataStatus status={status} />
                  <span className="text-gray-400 capitalize">{key}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Score Evolution Chart */}
          {history.length > 1 && (
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
              <h2 className="text-base font-semibold text-gray-400 mb-2">Score Evolution</h2>
              <ScoreHistoryChart history={history} range={chartRange} />
            </div>
          )}
        </div>

        {/* Sidebar — right col: Radar chart + Score Breakdown */}
        <div className="space-y-4">
          {breakdown && (
            <>
              {/* Radar Chart */}
              <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
                <h2 className="text-base font-semibold text-gray-400 mb-2">Score Radar</h2>
                <div className="flex justify-center">
                  <RadarChart
                    categories={SCORE_CATEGORIES.map(c => ({
                      label: c.label,
                      value: (breakdown[c.key] ?? 0) / c.max,
                      max: c.max,
                      actual: breakdown[c.key] ?? 0,
                    }))}
                    size={260}
                  />
                </div>
                {!hasCandleData && (
                  <p className="text-xs text-gray-600 text-center mt-1">
                    Some categories show 0 — intraday candle data not available for this source.
                  </p>
                )}
              </div>

              {/* Score Breakdown Bars */}
              <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
                <h2 className="text-base font-semibold text-gray-400 mb-3">Score Breakdown</h2>
                <div className="space-y-2">
                  {SCORE_CATEGORIES.map(c => {
                    const val = breakdown[c.key] ?? 0;
                    const pct = c.max > 0 ? (val / c.max) * 100 : 0;
                    return (
                      <div key={c.key}>
                        <div className="flex justify-between text-sm mb-0.5">
                          <span className="text-gray-400">{c.label}</span>
                          <span className="font-mono text-gray-300">
                            {val.toFixed(1)}/{c.max}
                          </span>
                        </div>
                        <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              pct >= 70 ? 'bg-green-500' : pct >= 30 ? 'bg-blue-500' : 'bg-gray-500'
                            }`}
                            style={{ width: `${Math.min(100, pct)}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
                {breakdown.missingPenalty > 0 && (
                  <div className="mt-3 text-sm text-gray-500">
                    Missing data penalty: −{breakdown.missingPenalty.toFixed(1)} pts
                  </div>
                )}
                <div className="mt-3 pt-2 border-t border-gray-800 flex justify-between text-sm">
                  <span className="text-gray-400">Final Score</span>
                  <span className="font-bold">
                    {breakdown.rawTotal.toFixed(1)} / {breakdown.maxAchievable.toFixed(0)} → {breakdown.finalScore.toFixed(0)}%
                  </span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* News */}
      {news.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
          <h2 className="text-base font-semibold text-gray-400 mb-2">Recent News ({latest.recentNewsCount} found)</h2>
          <div className="space-y-2">
            {news.map((n) => (
              <div key={n.id} className="text-sm flex items-start gap-2">
                {n.sentiment && (
                  <span
                    className={`mt-0.5 shrink-0 text-xs font-semibold px-1.5 py-0.5 rounded ${
                      n.sentiment === 'bullish' ? 'bg-green-900/50 text-green-400' :
                      n.sentiment === 'bearish' ? 'bg-red-900/50 text-red-400' :
                      'bg-gray-800 text-gray-500'
                    }`}
                    title={n.sentimentSource === 'ai' ? 'AI sentiment (headline + content)' : 'Keyword sentiment (headline only)'}
                  >
                    {n.sentiment === 'bullish' ? '▲' : n.sentiment === 'bearish' ? '▼' : '—'}
                    <span className="ml-0.5 text-[9px] opacity-60 font-normal">{n.sentimentSource === 'ai' ? 'AI' : 'K'}</span>
                  </span>
                )}
                <div>
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
                  <div className="text-sm text-gray-500">
                    {n.source ? `${n.source} · ` : ''}
                    <TimeAgo date={n.publishedAt} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="text-sm text-gray-600 text-center pb-4">
        Auto-refreshes every 60s · Last updated: <TimeAgo date={latest.timestamp} />
      </div>
    </div>
  );
}

function ScoreHistoryChart({ history, range }: { history: HistoryEntry[]; range: string }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [vSize, setVSize] = useState<[number, number]>([600, 180]);

  // ResizeObserver: viewBox = CSS pixels so font sizes are real screen pixels
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w > 0 && h > 0) setVSize([w, h]);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Show oldest first (history comes newest-first)
  const fullData = [...history].reverse();

  // Filter data by selected range
  const data = (() => {
    if (fullData.length === 0) return fullData;
    const now = new Date();
    let cutoff: Date;
    switch (range) {
      case '1H': cutoff = new Date(now.getTime() - 3_600_000); break;
      case '1D': cutoff = new Date(now.getTime() - 86_400_000); break;
      case '1W': cutoff = new Date(now.getTime() - 7 * 86_400_000); break;
      case '1M': cutoff = new Date(now.getTime() - 30 * 86_400_000); break;
      case 'Q':  cutoff = new Date(now.getTime() - 90 * 86_400_000); break;
      case '1Y': cutoff = new Date(now.getTime() - 365 * 86_400_000); break;
      case 'YTD': cutoff = new Date(now.getFullYear(), 0, 1); break;
      default: return fullData; // 'Max' or unknown
    }
    const filtered = fullData.filter(d => new Date(d.timestamp) >= cutoff);
    return filtered.length >= 2 ? filtered : fullData.slice(-2);
  })();
  const scores = data.map(h => h.signalScore);

  const w = vSize[0];
  const h = vSize[1];
  const padL = 36, padR = 8, padT = 12, padB = 22;
  const chartW = w - padL - padR;
  const chartH = h - padT - padB;

  const fontY = 12;
  const fontX = 10;
  const fontTipLg = 14;
  const fontTipSm = 12;

  const minS = 0, maxS = 100;
  const yScale = (v: number) => padT + chartH - ((v - minS) / (maxS - minS)) * chartH;
  const xScale = (i: number) => padL + (scores.length === 1 ? chartW / 2 : (i / (scores.length - 1)) * chartW);

  const points = scores.map((s, i) => `${xScale(i)},${yScale(s)}`).join(' ');

  function scoreColor(s: number) {
    if (s >= 75) return '#22c55e';
    if (s >= 50) return '#eab308';
    if (s >= 25) return '#f97316';
    return '#ef4444';
  }

  const yTicks = [0, 25, 50, 75, 100];

  function handlePointer(e: React.PointerEvent) {
    const svg = svgRef.current;
    if (!svg || scores.length < 2) return;
    const rect = svg.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const fraction = (screenX / rect.width - padL / w) / (chartW / w);
    const idx = Math.round(fraction * (scores.length - 1));
    if (idx >= 0 && idx < scores.length) setHoverIdx(idx);
    else setHoverIdx(null);
  }

  return (
    <div ref={containerRef} className="aspect-[600/360] sm:aspect-[600/180]">
    <svg
      ref={svgRef}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ width: '100%', height: '100%' }}
      className="select-none"
      onPointerMove={handlePointer}
      onPointerLeave={() => setHoverIdx(null)}
    >
      {/* Grid lines + Y labels */}
      {yTicks.map(t => (
        <g key={t}>
          <line x1={padL} x2={w - padR} y1={yScale(t)} y2={yScale(t)} stroke="#374151" strokeWidth={0.5} />
          <text x={padL - 6} y={yScale(t) + 3} textAnchor="end" fill="#6b7280" fontSize={fontY}>{t}</text>
        </g>
      ))}

      {/* X-axis time labels */}
      {data.map((entry, i) => {
        // Show max ~6 labels evenly
        const step = Math.max(1, Math.floor(data.length / 6));
        const isLast = i === data.length - 1;
        const prevLabel = Math.floor(i / step) * step;
        if (i % step !== 0 && !(isLast && (i - prevLabel) >= step * 0.5)) return null;
        const d = new Date(entry.timestamp);
        const label = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: false, timeZone: 'America/Denver' });
        return (
          <text key={i} x={xScale(i)} y={h - 4} textAnchor="middle" fill="#6b7280" fontSize={fontX}>
            {label}
          </text>
        );
      })}

      {/* Area fill */}
      <polygon
        points={`${xScale(0)},${yScale(0)} ${points} ${xScale(scores.length - 1)},${yScale(0)}`}
        fill="url(#scoreGrad)"
        opacity={0.15}
      />
      <defs>
        <linearGradient id="scoreGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
        </linearGradient>
      </defs>

      {/* Line */}
      <polyline points={points} fill="none" stroke="#3b82f6" strokeWidth={2} strokeLinejoin="round" />

      {/* Dots — colored by score */}
      {scores.map((s, i) => (
        <circle
          key={i}
          cx={xScale(i)}
          cy={yScale(s)}
          r={hoverIdx === i ? 5 : 3}
          fill={scoreColor(s)}
          stroke={hoverIdx === i ? '#fff' : 'none'}
          strokeWidth={hoverIdx === i ? 1.5 : 0}
        />
      ))}

      {/* Hover crosshair + tooltip */}
      {hoverIdx != null && hoverIdx < scores.length && (
        <>
          <line
            x1={xScale(hoverIdx)} x2={xScale(hoverIdx)}
            y1={padT} y2={h - padB}
            stroke="#6b7280" strokeWidth={0.5} strokeDasharray="3,2"
          />
          <line
            x1={padL} x2={w - padR}
            y1={yScale(scores[hoverIdx])} y2={yScale(scores[hoverIdx])}
            stroke="#6b7280" strokeWidth={0.5} strokeDasharray="3,2"
          />
          {/* Tooltip */}
          {(() => {
            const dotX = xScale(hoverIdx);
            const dotY = yScale(scores[hoverIdx]);
            const tipW = 148;
            const tipH = 38;
            const tx = Math.min(Math.max(dotX, padL + tipW / 2), w - padR - tipW / 2);
            // On touch devices, push tooltip higher so the finger doesn't obscure it
            let ty = dotY - tipH - 40;
            if (ty < 2) ty = 2;
            const d = new Date(data[hoverIdx].timestamp);
            const timeLabel = d.toLocaleString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: false, timeZone: 'America/Denver' });
            return (
              <g>
                <rect x={tx - tipW / 2} y={ty} width={tipW} height={tipH} rx={3} fill="#1f2937" stroke="#374151" strokeWidth={0.5} />
                <text x={tx} y={ty + 15} textAnchor="middle" fill="#fff" fontSize={fontTipLg} fontWeight="bold">
                  Score: {scores[hoverIdx]}
                </text>
                <text x={tx} y={ty + 29} textAnchor="middle" fill="#9ca3af" fontSize={fontTipSm}>
                  {timeLabel} · ${data[hoverIdx].currentPrice.toFixed(2)}
                </text>
              </g>
            );
          })()}
        </>
      )}

      {/* Hit area */}
      <rect x={0} y={0} width={w} height={h} fill="transparent" />
    </svg>
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
