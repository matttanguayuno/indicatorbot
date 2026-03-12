'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
  const [chartWidth, setChartWidth] = useState(900);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [tickerList, setTickerList] = useState<string[]>([]);

  // Fetch ticker list ordered by score DESC (same as homepage dashboard)
  useEffect(() => {
    fetch('/api/snapshots')
      .then(r => r.ok ? r.json() : [])
      .then((snapshots: { symbol: string }[]) => setTickerList(snapshots.map(s => s.symbol)))
      .catch(() => {});
  }, []);

  const currentIdx = tickerList.indexOf(symbol);
  const prevSymbol = currentIdx > 0 ? tickerList[currentIdx - 1] : null;
  const nextSymbol = currentIdx >= 0 && currentIdx < tickerList.length - 1 ? tickerList[currentIdx + 1] : null;

  // Mobile swipe navigation between stocks
  const router = useRouter();
  const pageRef = useRef<HTMLDivElement>(null);
  // Use refs for nav targets so the touch listener doesn't need to re-attach
  const prevRef = useRef(prevSymbol);
  const nextRef = useRef(nextSymbol);
  prevRef.current = prevSymbol;
  nextRef.current = nextSymbol;
  const swipeState = useRef<{ startX: number; startY: number; locked: 'h' | 'v' | null; navigated: boolean } | null>(null);

  useEffect(() => {
    const onTouchStart = (e: TouchEvent) => {
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
        if (dx < 0 && nextRef.current) router.push(`/signal/${nextRef.current}`);
        if (dx > 0 && prevRef.current) router.push(`/signal/${prevRef.current}`);
      }
    };
    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
    };
  }, [router]);

  // Measure chart container so viewBox matches rendered size (prevents font scaling)
  // Depends on chartLoading so it re-runs once the chart div actually mounts
  useEffect(() => {
    const el = chartContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      if (w > 0) setChartWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [chartLoading]);

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
        <Link href="/" className="text-blue-400 text-sm hover:underline">← Back</Link>
        <div className="flex items-center gap-2">
          {prevSymbol ? (
            <Link href={`/signal/${prevSymbol}`} className="px-2.5 py-1 rounded text-sm font-medium bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors">
              ← {prevSymbol}
            </Link>
          ) : (
            <span className="px-2.5 py-1 rounded text-sm font-medium bg-gray-800/40 text-gray-600 cursor-default">← Prev</span>
          )}
          {tickerList.length > 0 && (
            <span className="text-xs text-gray-500">{currentIdx + 1}/{tickerList.length}</span>
          )}
          {nextSymbol ? (
            <Link href={`/signal/${nextSymbol}`} className="px-2.5 py-1 rounded text-sm font-medium bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors">
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

        {/* Time Range toggles */}
        <div className="flex flex-wrap gap-1 mb-2">
          <span className="text-xs text-gray-500 mr-1 self-center">Range</span>
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

        {/* Interval toggles */}
        <div className="flex flex-wrap gap-1 mb-3">
          <span className="text-xs text-gray-500 mr-1 self-center">Interval</span>
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
        {chartLoading ? (
          <div className="h-[200px] lg:h-[280px] bg-gray-800/30 rounded animate-pulse flex items-center justify-center text-gray-600 text-sm">
            Loading chart…
          </div>
        ) : chartCandles.length >= 2 ? (
          <div ref={chartContainerRef} className="w-full" style={{ aspectRatio: '900 / 350' }}>
            <PriceChart key={`${chartInterval}:${chartRange}:${chartWidth}`} candles={chartCandles} width={chartWidth} height={Math.round(chartWidth * 350 / 900)} />
          </div>
        ) : history.length >= 2 ? (
          <div ref={chartContainerRef} className="w-full" style={{ aspectRatio: '900 / 350' }}>
            <MiniChart
              data={[...history].reverse().map(h => h.currentPrice)}
              timestamps={[...history].reverse().map(h => h.timestamp)}
              width={chartWidth}
              height={Math.round(chartWidth * 350 / 900)}
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
                <div className="text-sm text-gray-500">
                  {n.source ? `${n.source} · ` : ''}
                  <TimeAgo date={n.publishedAt} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Score Evolution Chart */}
      {history.length > 1 && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
          <h2 className="text-base font-semibold text-gray-400 mb-2">Score Evolution</h2>
          <ScoreHistoryChart history={history} />
        </div>
      )}

      <div className="text-sm text-gray-600 text-center pb-4">
        Auto-refreshes every 60s · Last updated: <TimeAgo date={latest.timestamp} />
      </div>
    </div>
  );
}

function ScoreHistoryChart({ history }: { history: HistoryEntry[] }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [zoom, setZoom] = useState<[number, number]>([0, 1]);
  const [cWidth, setCWidth] = useState(600);

  // ResizeObserver so viewBox matches actual container width (prevents font scaling)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const cw = Math.round(entry.contentRect.width);
      if (cw > 0) setCWidth(cw);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Show oldest first (history comes newest-first)
  const fullData = [...history].reverse();

  // Visible data slice based on zoom level
  const zStart = Math.floor(zoom[0] * (fullData.length - 1));
  const zEnd = Math.ceil(zoom[1] * (fullData.length - 1));
  const data = fullData.slice(zStart, Math.max(zStart + 2, zEnd + 1));
  const scores = data.map(h => h.signalScore);
  const w = cWidth;
  const h = Math.round(cWidth * 180 / 600);
  const padL = 48, padR = 10, padT = 16, padB = 28;
  const chartW = w - padL - padR;
  const chartH = h - padT - padB;

  // Match PriceChart font sizes (13/11/13/11)
  const fontY = 13;
  const fontX = 11;
  const fontTipLg = 13;
  const fontTipSm = 11;

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

  // Mouse wheel zoom
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const frac = Math.max(0, Math.min(1,
        (sx / rect.width * w - padL) / (w - padL - padR)
      ));
      setZoom(([s, en]) => {
        const r = en - s;
        const factor = e.deltaY > 0 ? 1.2 : 0.85;
        const minRange = Math.max(0.05, 3 / (fullData.length || 1));
        const nr = Math.min(1, Math.max(minRange, r * factor));
        const center = s + frac * r;
        let ns = center - frac * nr;
        let ne = center + (1 - frac) * nr;
        if (ns < 0) { ne = Math.min(1, ne - ns); ns = 0; }
        if (ne > 1) { ns = Math.max(0, ns - (ne - 1)); ne = 1; }
        return [ns, ne];
      });
      setHoverIdx(null);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [fullData.length]);

  // Y-axis ticks
  const yTicks = [0, 25, 50, 75, 100];

  return (
    <div ref={containerRef} style={{ aspectRatio: '600 / 180' }}>
    <svg
      ref={svgRef}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ width: '100%', height: '100%' }}
      className="select-none"
      onPointerMove={handlePointer}
      onPointerLeave={() => setHoverIdx(null)}
      onDoubleClick={() => setZoom([0, 1])}
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
        if (i % step !== 0 && i !== data.length - 1) return null;
        const d = new Date(entry.timestamp);
        const label = `${d.getHours()}:${d.getMinutes().toString().padStart(2, '0')}`;
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
            const tx = Math.min(Math.max(xScale(hoverIdx), padL + 40), w - padR - 40);
            const d = new Date(data[hoverIdx].timestamp);
            const timeLabel = `${d.getHours()}:${d.getMinutes().toString().padStart(2, '0')}`;
            return (
              <g>
                <rect x={tx - 44} y={padT - 14} width={88} height={34} rx={3} fill="#1f2937" stroke="#374151" strokeWidth={0.5} />
                <text x={tx} y={padT - 1} textAnchor="middle" fill="#fff" fontSize={fontTipLg} fontWeight="bold">
                  Score: {scores[hoverIdx]}
                </text>
                <text x={tx} y={padT + 10} textAnchor="middle" fill="#9ca3af" fontSize={fontTipSm}>
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
