'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { PriceChart } from '@/components/price-chart';
import type { PatternResult } from '@/lib/types';

interface ChartCandle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const RANGES = ['1H', '1D', '1W', '1M'] as const;
const INTERVALS = ['1min', '5min', '15min', '30min', '1h'] as const;

const PATTERN_REFERENCE = [
  {
    type: 'volume-breakout',
    name: 'Volume Breakout',
    icon: '📈',
    description: 'Price closes above resistance (highest high over 20 candles) with strong volume confirmation.',
    criteria: [
      '2 consecutive closes above resistance',
      'Volume ≥ 1.5× average on breakout candle',
    ],
    lookback: 22,
  },
  {
    type: 'consolidation-breakout',
    name: 'Consolidation Breakout',
    icon: '📦',
    description: 'Bollinger Bands squeeze tightly, then price breaks out of the narrow range with volume.',
    criteria: [
      'Bandwidth contracts ≥ 40% from peak',
      'Price closes above range high',
      'Volume ≥ 1.5× average',
    ],
    lookback: 35,
  },
  {
    type: 'bull-flag',
    name: 'Bull Flag',
    icon: '🚩',
    description: 'Sharp upward pole followed by a shallow, declining pullback (flag), then breakout above the flag.',
    criteria: [
      'Pole gain ≥ 1.5% over 8–15 candles',
      'Pullback retraces ≤ 50% of pole',
      'Flag has declining volume and flat/negative slope',
      'Close above flag high',
    ],
    lookback: 45,
  },
  {
    type: 'ascending-triangle',
    name: 'Ascending Triangle',
    icon: '🔺',
    description: 'Flat resistance with rising swing lows forming a triangle, followed by an upside breakout.',
    criteria: [
      'Flat resistance with ≥ 3 touches (0.3% tolerance)',
      'Rising swing lows (R² ≥ 0.5)',
      'Breakout close above resistance',
      'Volume ≥ 1.2× average',
    ],
    lookback: 60,
  },
  {
    type: 'channel-breakout',
    name: 'Channel Breakout',
    icon: '📐',
    description: 'Price trends within parallel trendlines (channel), then breaks above the upper boundary.',
    criteria: [
      'Parallel upper/lower trendlines (slopes within 15%)',
      'Both trendlines R² ≥ 0.6',
      '≥ 3 swing points on each line',
      'Close above upper channel + volume ≥ 1.3×',
    ],
    lookback: 53,
  },
];

export function PatternsClient() {
  const [symbol, setSymbol] = useState('');
  const [activeSymbol, setActiveSymbol] = useState('');
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ symbol: string; description: string }[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [interval, setInterval] = useState<string>('1min');
  const [range, setRange] = useState<string>('1D');
  const [candles, setCandles] = useState<ChartCandle[]>([]);
  const [patterns, setPatterns] = useState<PatternResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [chartSource, setChartSource] = useState('');
  const [highlightedPattern, setHighlightedPattern] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const searchRef = useRef<HTMLDivElement>(null);

  // Close search dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Search for tickers
  useEffect(() => {
    if (query.trim().length < 1) {
      setSearchResults([]);
      setSearchOpen(false);
      return;
    }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`);
        if (res.ok) {
          const data = await res.json();
          setSearchResults(data.results ?? []);
          setSearchOpen(data.results?.length > 0);
        }
      } catch {}
    }, 300);
  }, [query]);

  function selectSymbol(sym: string) {
    setSymbol(sym);
    setQuery(sym);
    setSearchOpen(false);
  }

  async function loadAndDetect() {
    if (!symbol) return;
    setActiveSymbol(symbol.toUpperCase());
    setLoading(true);
    setPatterns([]);
    setCandles([]);

    try {
      // 1. Fetch chart candles
      const chartRes = await fetch(
        `/api/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&noFilter=1&forceApi=1`
      );
      if (!chartRes.ok) {
        setLoading(false);
        return;
      }
      const chartData = await chartRes.json();
      const fetchedCandles: ChartCandle[] = chartData.candles ?? [];
      setCandles(fetchedCandles);
      setChartSource(`${chartData.source} | ${chartData.candleCount} candles | ${interval} / ${range}`);

      if (fetchedCandles.length < 10) {
        setLoading(false);
        return;
      }

      // 2. Run pattern detection on those candles
      setDetecting(true);
      const detectRes = await fetch('/api/patterns/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candles: fetchedCandles }),
      });
      if (detectRes.ok) {
        const detectData = await detectRes.json();
        setPatterns(detectData.patterns ?? []);
      }
    } catch (err) {
      console.error('Pattern detection failed:', err);
    } finally {
      setLoading(false);
      setDetecting(false);
    }
  }

  // Remap pattern indices (they're already aligned since we pass chart candles directly)
  // No remapping needed here — indices match the candles array

  const patternDetails = useMemo(() => {
    if (patterns.length === 0) return null;
    return patterns.map((p) => {
      switch (p.type) {
        case 'volume-breakout':
          return { type: p.type, label: p.label, conviction: Math.round(p.conviction * 100), details: `Resistance $${p.resistancePrice.toFixed(2)} · Volume ${p.volumeRatio.toFixed(1)}×` };
        case 'consolidation-breakout':
          return { type: p.type, label: p.label, conviction: Math.round(p.conviction * 100), details: `Range $${p.rangeLow.toFixed(2)}–$${p.rangeHigh.toFixed(2)} · Squeeze ${Math.round(p.bandwidthContraction * 100)}%` };
        case 'bull-flag':
          return { type: p.type, label: p.label, conviction: Math.round(p.conviction * 100), details: `Pole ${p.poleStartIndex}–${p.poleEndIndex} · Flag slope ${p.flagSlope.toFixed(4)}` };
        case 'ascending-triangle':
          return { type: p.type, label: p.label, conviction: Math.round(p.conviction * 100), details: `Resistance $${p.resistancePrice.toFixed(2)} · ${p.swingLowIndices.length} swing lows` };
        case 'channel-breakout':
          return { type: p.type, label: p.label, conviction: Math.round(p.conviction * 100), details: `Upper slope ${p.upperSlope.toFixed(4)} · Lower ${p.lowerSlope.toFixed(4)}` };
      }
    });
  }, [patterns]);

  return (
    <div className="space-y-4 pb-24">
      <h1 className="text-xl font-bold">Patterns Lab</h1>
      <p className="text-sm text-zinc-400">Test breakout pattern detection on any stock. Select a ticker, choose a timeframe, and run detection.</p>

      {/* Controls */}
      <div className="flex flex-wrap items-end gap-3">
        {/* Ticker search */}
        <div className="relative" ref={searchRef}>
          <label className="block text-xs text-zinc-500 mb-1">Ticker</label>
          <input
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSymbol(e.target.value); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { setSearchOpen(false); loadAndDetect(); } }}
            placeholder="AAPL"
            className="w-32 px-3 py-2 bg-zinc-900 border border-zinc-700 rounded text-sm focus:outline-none focus:border-blue-500"
          />
          {searchOpen && searchResults.length > 0 && (
            <div className="absolute z-20 top-full mt-1 w-64 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl max-h-48 overflow-y-auto">
              {searchResults.map((r) => (
                <button
                  key={r.symbol}
                  onClick={() => selectSymbol(r.symbol)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-800 flex items-center justify-between"
                >
                  <span className="font-medium text-white">{r.symbol}</span>
                  <span className="text-zinc-500 text-xs truncate ml-2">{r.description}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Range */}
        <div>
          <label className="block text-xs text-zinc-500 mb-1">Range</label>
          <div className="flex gap-1">
            {RANGES.map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-2.5 py-2 text-xs rounded font-medium ${
                  range === r ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        {/* Interval */}
        <div>
          <label className="block text-xs text-zinc-500 mb-1">Interval</label>
          <div className="flex gap-1">
            {INTERVALS.map((iv) => (
              <button
                key={iv}
                onClick={() => setInterval(iv)}
                className={`px-2.5 py-2 text-xs rounded font-medium ${
                  interval === iv ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                }`}
              >
                {iv}
              </button>
            ))}
          </div>
        </div>

        {/* Run button */}
        <button
          onClick={loadAndDetect}
          disabled={!symbol || loading}
          className="px-4 py-2 rounded font-medium text-sm bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading ? 'Loading…' : 'Detect Patterns'}
        </button>
      </div>

      {/* Source info */}
      {chartSource && (
        <div className="text-xs text-zinc-500">{activeSymbol} — {chartSource}</div>
      )}

      {/* Chart + Results side by side */}
      {(candles.length >= 2 || (activeSymbol && !loading)) && (
        <div className="flex gap-4 flex-col lg:flex-row">
          {/* Chart */}
          {candles.length >= 2 && (
            <div className="bg-zinc-900 rounded-lg p-3 overflow-hidden flex-1 min-w-0">
              <div className="w-full aspect-[900/400]">
                <PriceChart
                  candles={candles}
                  patterns={patterns.length > 0 ? patterns : undefined}
                  highlightPatternIndex={highlightedPattern}
                  onPatternClick={(i) => setHighlightedPattern(highlightedPattern === i ? null : i)}
                  width={900}
                  height={400}
                />
              </div>
            </div>
          )}

          {/* Results panel */}
          {!loading && !detecting && activeSymbol && (
            <div className="lg:w-72 shrink-0 space-y-2">
              <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                {patterns.length === 0 ? 'No Patterns' : `${patterns.length} Pattern${patterns.length > 1 ? 's' : ''}`}
              </h2>

              {patterns.length === 0 && candles.length > 0 && (
                <p className="text-xs text-zinc-500">No breakout patterns detected in {candles.length} candles. Try a different timeframe or stock.</p>
              )}

              {patternDetails && patternDetails.map((detail, i) => (
                <div
                  key={i}
                  className={`rounded-lg p-3 cursor-pointer transition-all border text-xs ${
                    highlightedPattern === i
                      ? 'bg-yellow-900/20 border-yellow-500/60 ring-1 ring-yellow-500/30'
                      : 'bg-zinc-900 border-transparent hover:border-yellow-700/40'
                  }`}
                  onMouseEnter={() => setHighlightedPattern(i)}
                  onMouseLeave={() => setHighlightedPattern(null)}
                  onClick={() => setHighlightedPattern(highlightedPattern === i ? null : i)}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-yellow-300">{detail.label}</span>
                    <span className="text-zinc-500">{detail.conviction}%</span>
                  </div>
                  <div className="text-zinc-400">{detail.details}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {detecting && (
        <div className="text-sm text-zinc-400">Running pattern detection…</div>
      )}

      {/* Pattern Reference */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-zinc-300">Pattern Reference</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {PATTERN_REFERENCE.map((ref) => (
            <div key={ref.type} className="bg-zinc-900 rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2">
                <PatternIcon type={ref.type} />
                <span className="text-sm font-medium text-zinc-200">{ref.name}</span>
              </div>
              <p className="text-[11px] text-zinc-400 leading-relaxed">{ref.description}</p>
              <div className="space-y-0.5">
                {ref.criteria.map((c, i) => (
                  <div key={i} className="flex items-start gap-1.5 text-[11px]">
                    <span className="text-yellow-500 mt-0.5">•</span>
                    <span className="text-zinc-500">{c}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Abstract SVG icon showing the general shape of each pattern */
function PatternIcon({ type }: { type: string }) {
  const w = 36;
  const h = 24;
  const stroke = '#facc15';
  const fill = '#facc1530';

  switch (type) {
    case 'volume-breakout':
      // Flat resistance line, price pops above with tall volume bar
      return (
        <svg width={w} height={h} viewBox="0 0 36 24" className="shrink-0">
          <line x1="2" y1="10" x2="26" y2="10" stroke={stroke} strokeWidth="1" strokeDasharray="2,1" />
          <polyline points="2,18 10,14 18,12 22,11 26,10 30,6 34,4" fill="none" stroke={stroke} strokeWidth="1.5" />
          <rect x="28" y="16" width="4" height="8" fill={stroke} opacity="0.5" rx="0.5" />
        </svg>
      );
    case 'consolidation-breakout':
      // Narrowing bands then breakout
      return (
        <svg width={w} height={h} viewBox="0 0 36 24" className="shrink-0">
          <path d="M2,4 Q10,2 18,8 Q24,10 28,10" fill="none" stroke={stroke} strokeWidth="0.7" opacity="0.5" />
          <path d="M2,20 Q10,22 18,16 Q24,14 28,14" fill="none" stroke={stroke} strokeWidth="0.7" opacity="0.5" />
          <rect x="8" y="8" width="18" height="8" fill={fill} rx="1" />
          <polyline points="2,14 10,13 18,12 24,12 28,12 32,5 34,3" fill="none" stroke={stroke} strokeWidth="1.5" />
        </svg>
      );
    case 'bull-flag':
      // Sharp pole up, then shallow pullback flag
      return (
        <svg width={w} height={h} viewBox="0 0 36 24" className="shrink-0">
          <polyline points="2,20 6,18 10,6 12,4" fill="none" stroke="#4ade80" strokeWidth="1.5" />
          <rect x="12" y="4" width="16" height="8" fill={fill} rx="1" />
          <polyline points="12,4 16,6 20,7 24,8 28,9" fill="none" stroke={stroke} strokeWidth="1" strokeDasharray="2,1" />
          <polyline points="28,9 32,5 34,3" fill="none" stroke={stroke} strokeWidth="1.5" />
        </svg>
      );
    case 'ascending-triangle':
      // Flat top, rising lows forming triangle
      return (
        <svg width={w} height={h} viewBox="0 0 36 24" className="shrink-0">
          <line x1="4" y1="6" x2="30" y2="6" stroke={stroke} strokeWidth="1" strokeDasharray="2,1" />
          <polyline points="4,20 12,16 20,12 28,8" fill="none" stroke={stroke} strokeWidth="1" />
          <polygon points="4,6 4,20 28,6" fill={fill} />
          <polyline points="28,8 32,4 34,2" fill="none" stroke={stroke} strokeWidth="1.5" />
        </svg>
      );
    case 'channel-breakout':
      // Two parallel lines, breakout above upper
      return (
        <svg width={w} height={h} viewBox="0 0 36 24" className="shrink-0">
          <line x1="2" y1="6" x2="26" y2="10" stroke={stroke} strokeWidth="0.7" />
          <line x1="2" y1="16" x2="26" y2="20" stroke={stroke} strokeWidth="0.7" />
          <polygon points="2,6 26,10 26,20 2,16" fill={fill} />
          <polyline points="8,14 14,12 20,13 26,10 30,5 34,3" fill="none" stroke={stroke} strokeWidth="1.5" />
        </svg>
      );
    default:
      return <span className="text-lg">📊</span>;
  }
}
