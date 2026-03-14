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
      const common = {
        type: p.type,
        label: p.label,
        conviction: `${Math.round(p.conviction * 100)}%`,
        range: `candle ${p.startIndex}–${p.endIndex}`,
        startTime: p.startTime,
        endTime: p.endTime,
      };
      switch (p.type) {
        case 'volume-breakout':
          return { ...common, resistancePrice: p.resistancePrice.toFixed(2), breakoutPrice: p.breakoutPrice.toFixed(2), volumeRatio: `${p.volumeRatio.toFixed(1)}×` };
        case 'consolidation-breakout':
          return { ...common, rangeHigh: p.rangeHigh.toFixed(2), rangeLow: p.rangeLow.toFixed(2), bandwidthContraction: `${Math.round(p.bandwidthContraction * 100)}%` };
        case 'bull-flag':
          return { ...common, poleRange: `${p.poleStartIndex}–${p.poleEndIndex}`, flagRange: `${p.flagStartIndex}–${p.flagEndIndex}`, flagSlope: p.flagSlope.toFixed(4) };
        case 'ascending-triangle':
          return { ...common, resistancePrice: p.resistancePrice.toFixed(2), swingLows: p.swingLowIndices.length, trendlineSlope: p.trendlineSlope.toFixed(4) };
        case 'channel-breakout':
          return { ...common, upperSlope: p.upperSlope.toFixed(4), lowerSlope: p.lowerSlope.toFixed(4) };
        default:
          return common;
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

      {/* Chart with pattern overlays */}
      {candles.length >= 2 && (
        <div className="bg-zinc-900 rounded-lg p-3 overflow-hidden">
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

      {/* Detection results */}
      {detecting && (
        <div className="text-sm text-zinc-400">Running pattern detection…</div>
      )}

      {!loading && !detecting && activeSymbol && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-zinc-300">
            Detection Results
            <span className="ml-2 text-zinc-500 font-normal">
              {patterns.length === 0 ? 'No patterns detected' : `${patterns.length} pattern(s) found`}
            </span>
          </h2>

          {patterns.length === 0 && candles.length > 0 && (
            <div className="bg-zinc-900 rounded-lg p-4 text-sm text-zinc-400 space-y-2">
              <p>No breakout patterns detected in {candles.length} candles.</p>
              <p className="text-zinc-500">The detectors look for:</p>
              <ul className="list-disc list-inside text-xs text-zinc-500 space-y-1">
                <li><span className="text-zinc-300">Volume Breakout</span> — price above resistance + volume ≥ 1.5× avg</li>
                <li><span className="text-zinc-300">Consolidation Breakout</span> — Bollinger squeeze ≥ 40% then range break</li>
                <li><span className="text-zinc-300">Bull Flag</span> — sharp pole (≥ 1.5%) + shallow pullback + break</li>
                <li><span className="text-zinc-300">Ascending Triangle</span> — flat resistance (3+ touches) + rising lows</li>
                <li><span className="text-zinc-300">Channel Breakout</span> — parallel trendlines + upper break</li>
              </ul>
              <p className="text-zinc-500">Try a different timeframe, or a stock with more price action.</p>
            </div>
          )}

          {patternDetails && patternDetails.map((detail, i) => (
            <div
              key={i}
              className={`bg-zinc-900 rounded-lg p-4 cursor-pointer transition-all border ${
                highlightedPattern === i
                  ? 'border-yellow-500/60 ring-1 ring-yellow-500/30'
                  : 'border-transparent hover:border-yellow-700/40'
              }`}
              onMouseEnter={() => setHighlightedPattern(i)}
              onMouseLeave={() => setHighlightedPattern(null)}
              onClick={() => setHighlightedPattern(highlightedPattern === i ? null : i)}
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-yellow-900/40 text-yellow-300 border border-yellow-700/50">
                  <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" />
                  {detail.label}
                </span>
                <span className="text-xs text-zinc-500">Conviction: {detail.conviction}</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1 text-xs">
                {Object.entries(detail)
                  .filter(([k]) => !['type', 'label', 'conviction'].includes(k))
                  .map(([key, val]) => (
                    <div key={key} className="flex justify-between gap-2">
                      <span className="text-zinc-500">{key}</span>
                      <span className="text-zinc-300 font-mono">{String(val)}</span>
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Candle stats */}
      {candles.length > 0 && !loading && (
        <details className="text-xs text-zinc-500">
          <summary className="cursor-pointer hover:text-zinc-400">Candle stats ({candles.length} candles)</summary>
          <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 bg-zinc-900 rounded-lg p-3">
            <div>
              <div className="text-zinc-400">First</div>
              <div className="text-zinc-300 font-mono">{new Date(candles[0].time).toLocaleString()}</div>
            </div>
            <div>
              <div className="text-zinc-400">Last</div>
              <div className="text-zinc-300 font-mono">{new Date(candles[candles.length - 1].time).toLocaleString()}</div>
            </div>
            <div>
              <div className="text-zinc-400">Price range</div>
              <div className="text-zinc-300 font-mono">
                ${Math.min(...candles.map(c => c.low)).toFixed(2)} – ${Math.max(...candles.map(c => c.high)).toFixed(2)}
              </div>
            </div>
            <div>
              <div className="text-zinc-400">Avg volume</div>
              <div className="text-zinc-300 font-mono">
                {Math.round(candles.reduce((s, c) => s + c.volume, 0) / candles.length).toLocaleString()}
              </div>
            </div>
          </div>
        </details>
      )}

      {/* Pattern Reference */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-zinc-300">Pattern Reference</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PATTERN_REFERENCE.map((ref) => (
            <div key={ref.type} className="bg-zinc-900 rounded-lg p-4 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-lg">{ref.icon}</span>
                <span className="text-sm font-medium text-zinc-200">{ref.name}</span>
              </div>
              <p className="text-xs text-zinc-400 leading-relaxed">{ref.description}</p>
              <div className="space-y-1">
                {ref.criteria.map((c, i) => (
                  <div key={i} className="flex items-start gap-1.5 text-xs">
                    <span className="text-yellow-500 mt-0.5">•</span>
                    <span className="text-zinc-500">{c}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2 pt-1 border-t border-zinc-800">
                <span className="text-[10px] text-zinc-600">Lookback: {ref.lookback} candles</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
