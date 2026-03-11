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
}

export function DashboardClient() {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [polling, setPolling] = useState(false);
  const [marketOpen, setMarketOpen] = useState(false);
  const [chartDataMap, setChartDataMap] = useState<Record<string, { closes: number[]; times: string[] }>>({});

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
      const entries: [string, { closes: number[]; times: string[] }][] = await Promise.all(
        symbols.map(async (sym) => {
          try {
            const res = await fetch(`/api/chart/${encodeURIComponent(sym)}`);
            if (res.ok) {
              const data = await res.json();
              const candles: { close: number; time: string }[] = data.candles ?? [];
              const closes = candles.map(c => c.close);
              const times = candles.map(c => c.time);
              return [sym, { closes, times }] as [string, { closes: number[]; times: string[] }];
            }
          } catch { /* ignore */ }
          return [sym, { closes: [], times: [] }] as [string, { closes: number[]; times: string[] }];
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
        <h1 className="text-2xl font-bold">Live Opportunities</h1>
        <div className="flex items-center gap-2">
          {!marketOpen && (
            <span className="text-sm text-yellow-500">market closed</span>
          )}
          {polling && (
            <span className="text-sm text-blue-400 animate-pulse">polling…</span>
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
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-4">
          <HeroCard s={snapshots[0]} chartData={chartDataMap[snapshots[0].symbol] ?? { closes: [], times: [] }} />
          <ScoreEvolutionPanel snapshots={snapshots} />
        </div>
      )}

      {/* Remaining cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4 mt-4">
        {snapshots.slice(1).map((s) => (
          <Link
            key={s.id}
            href={`/signal/${s.symbol}`}
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

            {/* Chart — edge-to-edge, no padding */}
            {((chartDataMap[s.symbol]?.closes ?? []).length >= 2 || s.priceHistory.length >= 2) && (
              <div className="px-1" onClick={e => { e.preventDefault(); e.stopPropagation(); }}>
                <MiniChart
                  data={(chartDataMap[s.symbol]?.closes ?? []).length >= 2 ? chartDataMap[s.symbol].closes : s.priceHistory}
                  timestamps={(chartDataMap[s.symbol]?.times ?? []).length >= 2 ? chartDataMap[s.symbol].times : undefined}
                  width={400} height={150} className="w-full"
                />
              </div>
            )}

            {/* Metrics bar — visually separated from chart */}
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
  const chartTimes = candleData.times.length >= 2 ? candleData.times : undefined;

  return (
    <Link
      href={`/signal/${s.symbol}`}
      className="flex flex-col bg-gray-900 border border-gray-800 rounded-xl hover:border-gray-600 transition-colors overflow-hidden"
    >
      {/* Hero header */}
      <div className="flex items-center justify-between px-5 pt-4 pb-2">
        <div className="flex items-center gap-4">
          <h2 className="text-2xl font-bold">{s.symbol}</h2>
          <span className="text-gray-400 text-xl">${s.currentPrice.toFixed(2)}</span>
          {/* Badges inline with ticker */}
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

      {/* Full-width chart */}
      <div className="flex-1 min-h-0 px-2" onClick={e => { e.preventDefault(); e.stopPropagation(); }}>
        {chartData.length >= 2 ? (
          <MiniChart data={chartData} timestamps={chartTimes} width={900} height={400} className="w-full h-full" />
        ) : (
          <div className="h-[200px] bg-gray-800/30 rounded animate-pulse flex items-center justify-center text-gray-600 text-sm">
            Loading chart…
          </div>
        )}
      </div>

      {/* Metrics bar + footer combined */}
      <div className="px-5 pt-2 pb-4">
        <div className="flex items-center justify-between bg-gray-800/50 rounded-md px-4 py-2.5">
          {/* Change metrics */}
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

          {/* Separator */}
          <div className="h-5 w-px bg-gray-700" />

          {/* Meta info */}
          <div className="flex items-center gap-4 text-base">
            <div>
              <span className="text-gray-500 mr-1">Float</span>
              <FloatDisplay value={s.float} />
            </div>
            <TimeAgo date={s.timestamp} />
          </div>
        </div>

        {/* Explanation */}
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
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  // Build multi-line data: each stock with its scoreHistory
  const lines = snapshots
    .filter((s) => s.scoreHistory.length >= 2)
    .slice(0, 12)
    .map((s, i) => ({
      symbol: s.symbol,
      scores: s.scoreHistory,
      color: SCORE_COLORS[i % SCORE_COLORS.length],
    }));

  if (lines.length === 0) return null;

  const maxLen = Math.max(...lines.map((l) => l.scores.length));
  const w = 400, h = 300;
  const padL = 36, padR = 50, padT = 12, padB = 20;
  const chartW = w - padL - padR;
  const chartH = h - padT - padB;

  // Dynamic Y-axis: compute actual min/max from data with 10% padding
  const allScores = lines.flatMap((l) => l.scores);
  const dataMin = Math.min(...allScores);
  const dataMax = Math.max(...allScores);
  const dataRange = dataMax - dataMin || 1;
  const yMin = Math.max(0, Math.floor(dataMin - dataRange * 0.1));
  const yMax = Math.min(100, Math.ceil(dataMax + dataRange * 0.1));
  const yRange = yMax - yMin || 1;

  const xScale = (i: number) => padL + (maxLen === 1 ? chartW / 2 : (i / (maxLen - 1)) * chartW);
  const yScale = (v: number) => padT + chartH - ((v - yMin) / yRange) * chartH;

  // Generate 3–5 nice Y ticks within the actual data range
  const tickStep = yRange <= 10 ? 2 : yRange <= 30 ? 5 : yRange <= 60 ? 10 : 25;
  const yTicks: number[] = [];
  for (let t = Math.ceil(yMin / tickStep) * tickStep; t <= yMax; t += tickStep) {
    yTicks.push(t);
  }

  function handlePointer(e: React.PointerEvent) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const fraction = (screenX / rect.width - padL / w) / (chartW / w);
    const idx = Math.round(fraction * (maxLen - 1));
    if (idx >= 0 && idx < maxLen) setHoverIdx(idx);
    else setHoverIdx(null);
  }

  // Resolve vertical collisions for end-of-line labels
  const labelPositions = lines.map((line) => {
    const lastScore = line.scores[line.scores.length - 1];
    return { symbol: line.symbol, color: line.color, y: yScale(lastScore), score: lastScore };
  });
  labelPositions.sort((a, b) => a.y - b.y);
  const labelH = 11;
  for (let i = 1; i < labelPositions.length; i++) {
    if (labelPositions[i].y - labelPositions[i - 1].y < labelH) {
      labelPositions[i].y = labelPositions[i - 1].y + labelH;
    }
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden flex flex-col">
      <div className="px-4 pt-3 pb-1">
        <h3 className="text-base font-semibold text-gray-300">Score Evolution</h3>
      </div>
      <div className="flex-1 min-h-0 px-2 pb-3">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${w} ${h}`}
          preserveAspectRatio="xMidYMid slice"
          style={{ width: '100%', height: '100%' }}
          className="select-none"
          onPointerMove={handlePointer}
          onPointerLeave={() => setHoverIdx(null)}
        >
          {/* Grid + Y labels */}
          {yTicks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={w - padR} y1={yScale(t)} y2={yScale(t)} stroke="#374151" strokeWidth={0.5} />
              <text x={padL - 5} y={yScale(t) + 3} textAnchor="end" fill="#6b7280" fontSize={11}>{t}</text>
            </g>
          ))}

          {/* Lines for each stock */}
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

          {/* End-of-line inline labels (replaces bottom legend) */}
          {labelPositions.map((lp) => (
            <g key={lp.symbol}>
              <circle
                cx={xScale(maxLen - 1)}
                cy={yScale(lines.find((l) => l.symbol === lp.symbol)!.scores[lines.find((l) => l.symbol === lp.symbol)!.scores.length - 1])}
                r={3}
                fill={lp.color}
              />
              <text
                x={xScale(maxLen - 1) + 6}
                y={lp.y + 3}
                fill={lp.color}
                fontSize={10}
                fontWeight="600"
              >
                {lp.symbol}
              </text>
            </g>
          ))}

          {/* Hover crosshair */}
          {hoverIdx != null && (
            <line
              x1={xScale(hoverIdx)} x2={xScale(hoverIdx)}
              y1={padT} y2={h - padB}
              stroke="#6b7280" strokeWidth={0.5} strokeDasharray="3,2"
            />
          )}

          {/* Hover dots */}
          {hoverIdx != null && lines.map((line) => {
            if (hoverIdx >= line.scores.length) return null;
            return (
              <circle
                key={line.symbol}
                cx={xScale(hoverIdx)}
                cy={yScale(line.scores[hoverIdx])}
                r={3.5}
                fill={line.color}
                stroke="#111827"
                strokeWidth={1}
              />
            );
          })}

          {/* Hover tooltip */}
          {hoverIdx != null && (() => {
            const items = lines.filter((l) => hoverIdx < l.scores.length);
            if (items.length === 0) return null;
            const tipW = 90;
            const tipH = 12 + items.length * 14;
            let tx = xScale(hoverIdx) + 8;
            if (tx + tipW > w - padR) tx = xScale(hoverIdx) - tipW - 8;
            return (
              <g>
                <rect x={tx} y={padT} width={tipW} height={tipH} rx={3} fill="#111827" stroke="#4b5563" strokeWidth={0.5} />
                {items.map((item, i) => (
                  <g key={item.symbol}>
                    <circle cx={tx + 10} cy={padT + 10 + i * 14} r={3} fill={item.color} />
                    <text x={tx + 18} y={padT + 13 + i * 14} fill="#e5e7eb" fontSize={10} fontWeight="500">
                      {item.symbol}
                    </text>
                    <text x={tx + tipW - 6} y={padT + 13 + i * 14} textAnchor="end" fill="#9ca3af" fontSize={10}>
                      {item.scores[hoverIdx]}
                    </text>
                  </g>
                ))}
              </g>
            );
          })()}

          {/* Hit area */}
          <rect x={0} y={0} width={w} height={h} fill="transparent" />
        </svg>
      </div>
    </div>
  );
}
