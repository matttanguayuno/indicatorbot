'use client';

import { useEffect, useRef, useState } from 'react';
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
  priceTimestamps: string[];
}

export function WatchlistClient() {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [marketOpen, setMarketOpen] = useState(false);
  const [chartDataMap, setChartDataMap] = useState<Record<string, { closes: number[]; times: string[] }>>({});
  const [summaryText, setSummaryText] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryGeneratedAt, setSummaryGeneratedAt] = useState<string | null>(null);
  const [summaryExpanded, setSummaryExpanded] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [dropStatus, setDropStatus] = useState<{ type: 'loading' | 'success' | 'error'; message: string } | null>(null);
  const dragCounter = useRef(0);

  function isMarketOpen(): boolean {
    const now = new Date();
    const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const day = et.getDay();
    const hours = et.getHours();
    const minutes = et.getMinutes();
    const time = hours * 60 + minutes;
    return day >= 1 && day <= 5 && time >= 570 && time < 960;
  }

  async function fetchSnapshots() {
    try {
      const res = await fetch('/api/snapshots?since=today&threshold=0');
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

  // Fetch intraday candle data for all symbols in a single batch call
  useEffect(() => {
    if (snapshots.length === 0) return;
    const symbols = snapshots.map((s) => s.symbol);
    let cancelled = false;
    async function fetchCharts() {
      try {
        const res = await fetch('/api/chart/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbols }),
        });
        if (res.ok) {
          const data: Record<string, { candles: { close: number; time: string }[]; source?: string }> = await res.json();
          if (!cancelled) {
            // Debug: log chart data per symbol
            for (const sym of symbols) {
              const entry = data[sym];
              if (entry?.candles?.length) {
                const first = entry.candles[0].time;
                const last = entry.candles[entry.candles.length - 1].time;
                const firstMT = new Date(first).toLocaleTimeString('en-US', { timeZone: 'America/Denver', hour12: false });
                const lastMT = new Date(last).toLocaleTimeString('en-US', { timeZone: 'America/Denver', hour12: false });
                console.log(`[Chart] ${sym}: ${entry.candles.length} candles, ${firstMT} → ${lastMT} MT, source: ${entry.source ?? 'unknown'}`);
                // Extra detail for sparse data (< 30 candles)
                if (entry.candles.length < 30) {
                  console.log(`[Chart] ${sym} all timestamps:`, entry.candles.map(c => new Date(c.time).toLocaleTimeString('en-US', { timeZone: 'America/Denver', hour12: false })));
                }
              } else {
                console.warn(`[Chart] ${sym}: 0 candles, source: ${entry?.source ?? 'unknown'}`);
              }
            }
            const map: Record<string, { closes: number[]; times: string[] }> = {};
            for (const sym of symbols) {
              const entry = data[sym];
              if (entry?.candles?.length) {
                map[sym] = {
                  closes: entry.candles.map(c => c.close),
                  times: entry.candles.map(c => c.time),
                };
              } else {
                map[sym] = { closes: [], times: [] };
              }
            }
            setChartDataMap(map);
          }
        }
      } catch (err) {
        console.error('Failed to fetch batch chart data:', err);
      }
    }
    fetchCharts();
    return () => { cancelled = true; };
  }, [snapshots]);

  useEffect(() => {
    fetchSnapshots();

    // Load latest persisted summary
    fetch('/api/news/summary')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.summary) {
          setSummaryText(data.summary);
          setSummaryGeneratedAt(data.generatedAt);
        }
      })
      .catch(() => {});

    let refreshTimer: ReturnType<typeof setInterval>;

    async function startTimers() {
      let intervalSec = 60;
      try {
        const res = await fetch('/api/settings');
        if (res.ok) {
          const settings = await res.json();
          intervalSec = settings.pollingIntervalSec ?? 60;
        }
      } catch { /* default 60s */ }

      refreshTimer = setInterval(() => {
        const open = isMarketOpen();
        setMarketOpen(open);
        if (open) fetchSnapshots();
      }, intervalSec * 1000);

      setMarketOpen(isMarketOpen());
    }

    startTimers();
    return () => clearInterval(refreshTimer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleDrop(file: File) {
    setDropStatus({ type: 'loading', message: 'Parsing screenshot…' });
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const res = await fetch('/api/screener/parse-screenshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: dataUrl }),
      });
      const data = await res.json();
      if (res.ok) {
        setDropStatus({ type: 'success', message: `Synced ${data.total} tickers (${data.added} new): ${data.symbols?.join(', ')}` });
        setLoading(true);
        await fetchSnapshots();
      } else {
        setDropStatus({ type: 'error', message: data.error || 'Failed to parse screenshot' });
      }
    } catch {
      setDropStatus({ type: 'error', message: 'Network error' });
    }
    setTimeout(() => setDropStatus(null), 6000);
  }

  return (
    <div
      className="pt-4 relative"
      onDragEnter={(e) => { e.preventDefault(); dragCounter.current++; setDragging(true); }}
      onDragOver={(e) => { e.preventDefault(); }}
      onDragLeave={(e) => { e.preventDefault(); dragCounter.current--; if (dragCounter.current <= 0) { dragCounter.current = 0; setDragging(false); } }}
      onDrop={(e) => {
        e.preventDefault();
        dragCounter.current = 0;
        setDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file && file.type.startsWith('image/')) handleDrop(file);
      }}
    >
      {/* Drag overlay */}
      {dragging && (
        <div className="fixed inset-0 z-50 bg-emerald-900/40 border-4 border-dashed border-emerald-400 flex items-center justify-center pointer-events-none">
          <div className="bg-gray-900/90 rounded-xl px-8 py-6 text-center">
            <span className="text-3xl">📥</span>
            <p className="text-lg font-semibold text-emerald-300 mt-2">Drop Webull screenshot to sync watchlist</p>
          </div>
        </div>
      )}

      {/* Drop status toast */}
      {dropStatus && (
        <div className={`mb-4 px-4 py-2.5 rounded-lg text-sm ${
          dropStatus.type === 'loading' ? 'bg-blue-900/40 border border-blue-700 text-blue-300'
            : dropStatus.type === 'success' ? 'bg-green-900/40 border border-green-700 text-green-300'
            : 'bg-red-900/40 border border-red-700 text-red-300'
        }`}>
          {dropStatus.type === 'loading' && '⏳ '}{dropStatus.message}
        </div>
      )}

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Watchlist</h1>
        <div className="flex items-center gap-2">
          {!marketOpen && (
            <span className="text-sm text-yellow-500">market closed</span>
          )}
          {lastRefresh && (
            <span className="text-sm text-gray-600">
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

      {/* Hero section — top-scoring stock + score evolution */}
      {snapshots.length > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_1fr] gap-4">
          <HeroCard s={snapshots[0]} chartData={chartDataMap[snapshots[0].symbol] ?? { closes: [], times: [] }} />
          <ScoreEvolutionPanel snapshots={snapshots} />
        </div>
      )}

      {/* AI News Summary */}
      {(summaryText || summaryLoading) && (
        <div className="mt-4">
          <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5">
              <button
                onClick={() => setSummaryExpanded(!summaryExpanded)}
                className="flex items-center gap-2 text-sm font-semibold text-gray-300 hover:text-gray-100 transition-colors"
              >
                <span className={`transition-transform ${summaryExpanded ? 'rotate-90' : ''}`}>▸</span>
                📰 AI News Summary
              </button>
              <div className="flex items-center gap-3">
                {summaryGeneratedAt && (
                  <span className="text-xs text-gray-600">
                    <TimeAgo date={summaryGeneratedAt} />
                  </span>
                )}
                <button
                  onClick={async () => {
                    setSummaryLoading(true);
                    try {
                      const res = await fetch('/api/news/summary', { method: 'POST' });
                      const data = await res.json();
                      if (res.ok) {
                        setSummaryText(data.summary);
                        setSummaryGeneratedAt(data.generatedAt);
                      } else {
                        setSummaryText(data.error || 'Failed to generate summary.');
                      }
                    } catch {
                      setSummaryText('Network error — could not reach the server.');
                    } finally {
                      setSummaryLoading(false);
                    }
                  }}
                  disabled={summaryLoading}
                  className="text-xs text-gray-500 hover:text-gray-300 disabled:text-gray-700 transition-colors"
                  title="Regenerate summary"
                >
                  {summaryLoading ? '⏳' : '🔄'}
                </button>
              </div>
            </div>
            {summaryExpanded && (
              <div className="px-4 pb-3 text-sm text-gray-400 leading-relaxed whitespace-pre-line">
                {summaryLoading ? 'Generating summary…' : summaryText}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Remaining cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4 mt-4">
        {snapshots.slice(1).map((s) => (
          <Link
            key={s.id}
            href={`/signal/${s.symbol}?from=watchlist`}
            className="block bg-gray-900 border border-gray-800 rounded-lg hover:border-gray-600 transition-colors overflow-hidden"
          >
            {/* Card header */}
            <div className="flex items-center justify-between px-4 pt-3 pb-2">
              <div className="flex items-center gap-2">
                <span className="font-bold text-lg">{s.symbol}</span>
                <span className="text-gray-400 text-sm">
                  ${s.currentPrice.toFixed(2)}
                </span>
              </div>
              <ScoreBadge score={s.signalScore} />
            </div>

            {/* Chart */}
            {((chartDataMap[s.symbol]?.closes ?? []).length >= 2 || s.priceHistory.length >= 2) && (
              <div className="px-1" onClick={e => { e.preventDefault(); e.stopPropagation(); }}>
                <MiniChart
                  data={(chartDataMap[s.symbol]?.closes ?? []).length >= 2 ? chartDataMap[s.symbol].closes : s.priceHistory}
                  timestamps={(chartDataMap[s.symbol]?.times ?? []).length >= 2 ? chartDataMap[s.symbol].times : undefined}
                  width={400} height={150} className="w-full"
                />
              </div>
            )}

            {/* Metrics bar */}
            <div className="mx-3 mt-1 mb-2 bg-gray-800/50 rounded-md px-3 py-2">
              <div className="flex items-center justify-between">
                {s.pctChange5m != null && s.pctChangeIntraday != null ? (
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1.5">
                      <span className="text-gray-500 text-sm">5m</span>
                      <PctChange value={s.pctChange5m} />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-gray-500 text-sm">1h</span>
                      <PctChange value={s.pctChange1h} />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-gray-500 text-sm">1d</span>
                      <PctChange value={s.pctChange1d} />
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1.5">
                      <span className="text-gray-500 text-sm">Intraday</span>
                      <PctChange value={s.pctChangeIntraday ?? s.pctChange5m} />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-gray-500 text-sm">1d</span>
                      <PctChange value={s.pctChange1d} />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Footer — badges & meta */}
            <div className="flex items-center justify-between px-4 pb-3 text-base">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-gray-500 text-sm">Float</span>
                <FloatDisplay value={s.float} />
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
              <span className="shrink-0"><TimeAgo date={s.timestamp} /></span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function HeroCard({ s, chartData: candleData }: { s: Snapshot; chartData: { closes: number[]; times: string[] } }) {
  const hasCandleData = s.pctChange5m != null && s.pctChangeIntraday != null;
  const chartData = candleData.closes.length >= 2 ? candleData.closes : s.priceHistory;
  const chartTimes = candleData.times.length >= 2 ? candleData.times : (s.priceTimestamps?.length >= 2 ? s.priceTimestamps : undefined);

  return (
    <Link
      href={`/signal/${s.symbol}?from=watchlist`}
      className="flex flex-col bg-gray-900 border border-gray-800 rounded-xl hover:border-gray-600 transition-colors overflow-hidden"
    >
      <div className="flex items-center justify-between px-5 pt-4 pb-2">
        <div className="flex items-center gap-4">
          <h2 className="text-2xl font-bold">{s.symbol}</h2>
          <span className="text-gray-400 text-xl">${s.currentPrice.toFixed(2)}</span>
          <div className="flex items-center gap-2">
            {s.isBreakout && (
              <span className="px-2 py-0.5 rounded text-sm font-semibold bg-green-900/60 text-green-300 border border-green-700">
                {hasCandleData ? 'BREAKOUT' : 'GAP UP'}
              </span>
            )}
            {s.nearHigh && !s.isBreakout && (
              <span className="px-2 py-0.5 rounded text-sm font-semibold bg-yellow-900/60 text-yellow-300 border border-yellow-700">
                Near High
              </span>
            )}
            {s.rvol != null && s.rvol >= 1.5 && (
              <span className="px-2 py-0.5 rounded text-sm font-semibold bg-cyan-900/60 text-cyan-300 border border-cyan-700">
                RVOL {s.rvol.toFixed(1)}x
              </span>
            )}
            <NewsIndicator count={s.recentNewsCount} />
          </div>
        </div>
        <ScoreBadge score={s.signalScore} />
      </div>

      <div className="flex-1 min-h-0 px-2" onClick={e => { e.preventDefault(); e.stopPropagation(); }}>
        {chartData.length >= 2 ? (
          <MiniChart data={chartData} timestamps={chartTimes} width={900} height={400} className="w-full h-full" />
        ) : (
          <div className="h-[200px] bg-gray-800/30 rounded animate-pulse flex items-center justify-center text-gray-600 text-sm">
            Loading chart…
          </div>
        )}
      </div>

      <div className="px-5 pt-2 pb-4">
        <div className="flex items-center justify-between bg-gray-800/50 rounded-md px-4 py-2.5">
          <div className="flex items-center gap-5">
            {hasCandleData ? (
              <>
                <div className="flex items-center gap-1.5">
                  <span className="text-gray-500 text-sm">5m</span>
                  <PctChange value={s.pctChange5m} />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-gray-500 text-sm">15m</span>
                  <PctChange value={s.pctChange15m} />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-gray-500 text-sm">1h</span>
                  <PctChange value={s.pctChange1h} />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-gray-500 text-sm">1d</span>
                  <PctChange value={s.pctChange1d} />
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-1.5">
                  <span className="text-gray-500 text-sm">Intraday</span>
                  <PctChange value={s.pctChangeIntraday ?? s.pctChange5m} />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-gray-500 text-sm">1d</span>
                  <PctChange value={s.pctChange1d} />
                </div>
              </>
            )}
          </div>
          <div className="h-5 w-px bg-gray-700" />
          <div className="flex items-center gap-4 text-base">
            <div>
              <span className="text-gray-500 mr-1">Float</span>
              <FloatDisplay value={s.float} />
            </div>
            <TimeAgo date={s.timestamp} />
          </div>
        </div>
        {s.explanation && (
          <p className="text-base text-gray-400 mt-2 line-clamp-2">{s.explanation}</p>
        )}
      </div>
    </Link>
  );
}

const SCORE_COLORS = ['#3b82f6', '#22c55e', '#eab308', '#f97316', '#a855f7', '#ec4899', '#06b6d4', '#f43e5c'];

function ScoreEvolutionPanel({ snapshots }: { snapshots: Snapshot[] }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const modalRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const modalContainerRef = useRef<HTMLDivElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [cSize, setCSize] = useState<[number, number]>([600, 270]);
  const [mSize, setMSize] = useState<[number, number]>([900, 500]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w > 0 && h > 0) setCSize([w, h]);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!expanded) return;
    const el = modalContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w > 0 && h > 0) setMSize([w, h]);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [expanded]);

  const lines = snapshots
    .filter((s) => s.scoreHistory.length >= 1)
    .sort((a, b) => b.signalScore - a.signalScore)
    .slice(0, 3)
    .map((s, i) => ({
      symbol: s.symbol,
      scores: s.scoreHistory,
      color: SCORE_COLORS[i % SCORE_COLORS.length],
    }));

  if (lines.length === 0) return null;

  const maxLen = Math.max(...lines.map((l) => l.scores.length));
  const timestamps = snapshots[0]?.priceTimestamps ?? [];

  // Build time-based X-axis spanning 7:30 AM – 2:00 PM MT
  const parsedTimes = timestamps.map(t => new Date(t).getTime());
  const refDate = timestamps.length > 0 ? new Date(timestamps[0]) : new Date();
  const mtDateStr = refDate.toLocaleDateString('en-US', { timeZone: 'America/Denver' });
  const marketOpenMs = new Date(`${mtDateStr} 07:30:00 AM`).getTime();
  const marketCloseMs = new Date(`${mtDateStr} 02:00:00 PM`).getTime();
  const xDomainMin = parsedTimes.length > 0 ? Math.min(marketOpenMs, Math.min(...parsedTimes)) : marketOpenMs;
  const xDomainMax = parsedTimes.length > 0 ? Math.max(marketCloseMs, Math.max(...parsedTimes)) : marketCloseMs;
  const xDomainRange = xDomainMax - xDomainMin || 1;

  function fmtTimeLabel(d: Date): string {
    const mt = new Date(d.toLocaleString('en-US', { timeZone: 'America/Denver' }));
    const h = mt.getHours();
    const m = mt.getMinutes();
    return `${h % 12 || 12}:${m.toString().padStart(2, '0')}${h >= 12 ? 'p' : 'a'}`;
  }

  const allScores = lines.flatMap((l) => l.scores);
  const dataMin = Math.min(...allScores);
  const dataMax = Math.max(...allScores);
  const dataRange = dataMax - dataMin || 1;
  const yMin = Math.max(0, Math.floor(dataMin - dataRange * 0.1));
  const yMax = Math.min(100, Math.ceil(dataMax + dataRange * 0.1));
  const yRange = yMax - yMin || 1;

  const tickStep = yRange <= 10 ? 2 : yRange <= 30 ? 5 : yRange <= 60 ? 10 : 25;
  const yTicks: number[] = [];
  for (let t = Math.ceil(yMin / tickStep) * tickStep; t <= yMax; t += tickStep) {
    yTicks.push(t);
  }

  // X-axis: generate evenly-spaced hour labels across the trading day
  const xTimeTicks: number[] = [];
  {
    const halfHour = 30 * 60 * 1000;
    let tick = Math.ceil(xDomainMin / halfHour) * halfHour;
    while (tick <= xDomainMax) {
      xTimeTicks.push(tick);
      tick += halfHour;
    }
    while (xTimeTicks.length > 7) {
      const filtered = xTimeTicks.filter((_, i) => i % 2 === 0);
      xTimeTicks.length = 0;
      xTimeTicks.push(...filtered);
    }
  }

  const chartSvg = (ref: React.RefObject<SVGSVGElement | null>, vw: number, vh: number) => {
    const padL = 44, padR = 64, padT = 12, padB = 24;
    const chartW = vw - padL - padR;
    const chartH = vh - padT - padB;

    const xScale = (i: number) => {
      if (i >= parsedTimes.length) return padL + (maxLen === 1 ? chartW / 2 : (i / (maxLen - 1)) * chartW);
      return padL + ((parsedTimes[i] - xDomainMin) / xDomainRange) * chartW;
    };
    const yScale = (v: number) => padT + chartH - ((v - yMin) / yRange) * chartH;

    const onPointerMove = (e: React.PointerEvent) => {
      const svg = ref.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const fraction = (screenX / rect.width - padL / vw) / (chartW / vw);
      const hoverTime = xDomainMin + fraction * xDomainRange;
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let i = 0; i < parsedTimes.length; i++) {
        const dist = Math.abs(parsedTimes[i] - hoverTime);
        if (dist < bestDist) { bestDist = dist; bestIdx = i; }
      }
      if (fraction >= 0 && fraction <= 1 && bestIdx < maxLen) setHoverIdx(bestIdx);
      else setHoverIdx(null);
    };

    const fontY = 12;
    const fontX = 10;
    const fontLabel = 12;
    const fontTip = 12;
    const tipLineH = 18;
    const labelH = 16;
    const dotR = 3;

    const labelPositions = lines.map((line) => {
      const lastScore = line.scores[line.scores.length - 1];
      return { symbol: line.symbol, color: line.color, y: yScale(lastScore), score: lastScore };
    });
    labelPositions.sort((a, b) => a.y - b.y);
    for (let i = 1; i < labelPositions.length; i++) {
      if (labelPositions[i].y - labelPositions[i - 1].y < labelH) {
        labelPositions[i].y = labelPositions[i - 1].y + labelH;
      }
    }

    return (
      <svg
        ref={ref}
        viewBox={`0 0 ${vw} ${vh}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%' }}
        className="select-none"
        onPointerMove={onPointerMove}
        onPointerLeave={() => setHoverIdx(null)}
      >
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={vw - padR} y1={yScale(t)} y2={yScale(t)} stroke="#374151" strokeWidth={0.5} />
            <text x={padL - 4} y={yScale(t) + fontY * 0.35} textAnchor="end" fill="#6b7280" fontSize={fontY}>{t}</text>
          </g>
        ))}

        {xTimeTicks.map((ms) => {
          const xPos = padL + ((ms - xDomainMin) / xDomainRange) * chartW;
          return (
            <text key={ms} x={xPos} y={vh - 4} textAnchor="middle" fill="#6b7280" fontSize={fontX}>
              {fmtTimeLabel(new Date(ms))}
            </text>
          );
        })}

        {lines.map((line) => {
          const pts = line.scores.map((s, i) => `${xScale(i)},${yScale(s)}`).join(' ');
          return (
            <polyline
              key={line.symbol}
              points={pts}
              fill="none"
              stroke={line.color}
              strokeWidth={1.5}
              strokeLinejoin="round"
              opacity={0.85}
            />
          );
        })}

        {labelPositions.map((lp) => (
          <g key={lp.symbol}>
            <circle
              cx={xScale(maxLen - 1)}
              cy={yScale(lines.find((l) => l.symbol === lp.symbol)!.scores[lines.find((l) => l.symbol === lp.symbol)!.scores.length - 1])}
              r={dotR}
              fill={lp.color}
            />
            <text
              x={xScale(maxLen - 1) + 5}
              y={lp.y + fontLabel * 0.35}
              fill={lp.color}
              fontSize={fontLabel}
              fontWeight="600"
            >
              {lp.symbol}
            </text>
          </g>
        ))}

        {hoverIdx != null && (
          <line
            x1={xScale(hoverIdx)} x2={xScale(hoverIdx)}
            y1={padT} y2={vh - padB}
            stroke="#6b7280" strokeWidth={0.5} strokeDasharray="3,2"
          />
        )}

        {hoverIdx != null && lines.map((line) => {
          if (hoverIdx >= line.scores.length) return null;
          return (
            <circle
              key={line.symbol}
              cx={xScale(hoverIdx)}
              cy={yScale(line.scores[hoverIdx])}
              r={dotR + 0.5}
              fill={line.color}
              stroke="#111827"
              strokeWidth={1}
            />
          );
        })}

        {hoverIdx != null && (() => {
          const items = lines.filter((l) => hoverIdx < l.scores.length);
          if (items.length === 0) return null;
          const tipW = 130;
          const tipH = tipLineH + (items.length + 1) * tipLineH;
          let tx = xScale(hoverIdx) + 8;
          if (tx + tipW > vw - padR) tx = xScale(hoverIdx) - tipW - 8;
          const hd = hoverIdx < timestamps.length ? new Date(timestamps[hoverIdx]) : null;
          const timeStr = hd ? hd.toLocaleString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: false, timeZone: 'America/Denver' }) : '';
          return (
            <g>
              <rect x={tx} y={padT} width={tipW} height={tipH} rx={3} fill="#111827" stroke="#4b5563" strokeWidth={0.5} />
              <text x={tx + tipW / 2} y={padT + tipLineH * 0.78} textAnchor="middle" fill="#9ca3af" fontSize={fontTip - 1}>
                {timeStr}
              </text>
              {items.map((item, i) => (
                <g key={item.symbol}>
                  <circle cx={tx + 10} cy={padT + tipLineH * 0.6 + (i + 1) * tipLineH} r={dotR} fill={item.color} />
                  <text x={tx + 18} y={padT + tipLineH * 0.78 + (i + 1) * tipLineH} fill="#e5e7eb" fontSize={fontTip} fontWeight="500">
                    {item.symbol}
                  </text>
                  <text x={tx + tipW - 6} y={padT + tipLineH * 0.78 + (i + 1) * tipLineH} textAnchor="end" fill="#9ca3af" fontSize={fontTip}>
                    {item.scores[hoverIdx]}
                  </text>
                </g>
              ))}
            </g>
          );
        })()}

        <rect x={0} y={0} width={vw} height={vh} fill="transparent" />
      </svg>
    );
  };

  return (
    <>
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-4 pt-3 pb-1">
          <h3 className="text-base font-semibold text-gray-300">Score Evolution</h3>
          <button
            onClick={() => setExpanded(true)}
            className="text-gray-500 hover:text-gray-300 text-sm transition-colors"
            title="Expand chart"
          >
            ⛶
          </button>
        </div>
        <div ref={containerRef} className="flex-1 min-h-[250px] px-2 pb-3">
          {chartSvg(svgRef, cSize[0], cSize[1])}
        </div>
      </div>

      {expanded && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-3"
          style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top, 0.75rem))' }}
          onClick={() => { setExpanded(false); setHoverIdx(null); }}
        >
          <div
            className="bg-gray-900 border border-gray-700 rounded-xl w-full h-full flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 pt-3 pb-1">
              <h3 className="text-lg font-semibold text-gray-200">Score Evolution</h3>
              <button
                onClick={() => { setExpanded(false); setHoverIdx(null); }}
                className="text-gray-400 hover:text-gray-200 text-2xl transition-colors p-1"
              >
                ✕
              </button>
            </div>
            <div ref={modalContainerRef} className="flex-1 min-h-0 px-3 pb-3">
              {chartSvg(modalRef, mSize[0], mSize[1])}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
