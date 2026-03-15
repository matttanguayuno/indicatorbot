'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { PriceChart } from '@/components/price-chart';
import { PATTERN_REFERENCE, convictionClasses, getPatternDetail, PatternIcon } from '@/components/pattern-shared';
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
  const [lockedPattern, setLockedPattern] = useState<number | null>(null);
  const [highlightedRef, setHighlightedRef] = useState<string | null>(null);
  const [popupPos, setPopupPos] = useState<{ x: number; y: number } | null>(null);
  const [chartMode, setChartMode] = useState<'line' | 'candle'>('candle');
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const highlightedPattern = lockedPattern;
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const searchRef = useRef<HTMLDivElement>(null);

  function scrollToRef(type: string) {
    const el = document.getElementById(`ref-${type}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightedRef(type);
    }
  }

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
    setLockedPattern(null);
    setPopupPos(null);

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
        case 'double-bottom':
          return { type: p.type, label: p.label, conviction: Math.round(p.conviction * 100), details: `Bottoms $${p.firstBottomPrice.toFixed(2)} / $${p.secondBottomPrice.toFixed(2)} · Neckline $${p.necklinePrice.toFixed(2)}` };
        case 'inside-bar-breakout':
          return { type: p.type, label: p.label, conviction: Math.round(p.conviction * 100), details: `${p.insideBarCount} inside bar${p.insideBarCount > 1 ? 's' : ''} · Mother high $${p.motherBarHigh.toFixed(2)}` };
        case 'vwap-reclaim':
          return { type: p.type, label: p.label, conviction: Math.round(p.conviction * 100), details: `VWAP $${p.vwapPrice.toFixed(2)} · Dip ${p.dipPercent.toFixed(1)}% · Vol ${p.volumeRatio.toFixed(1)}×` };
        case 'symmetrical-triangle':
          return { type: p.type, label: p.label, conviction: Math.round(p.conviction * 100), details: `${p.swingPointCount} swing points · Converging trendlines` };
        case 'bullish-engulfing':
          return { type: p.type, label: p.label, conviction: Math.round(p.conviction * 100), details: `Engulf $${p.engulfOpen.toFixed(2)}→$${p.engulfClose.toFixed(2)} · Vol ${p.volumeRatio.toFixed(1)}×` };
        case 'morning-star':
          return { type: p.type, label: p.label, conviction: Math.round(p.conviction * 100), details: `Doji $${p.dojiClose.toFixed(2)} · Recovery $${p.thirdClose.toFixed(2)} · Vol ${p.volumeRatio.toFixed(1)}×` };
        case 'hammer':
          return { type: p.type, label: p.label, conviction: Math.round(p.conviction * 100), details: `${p.hammerType === 'hammer' ? 'Hammer' : 'Inverted'} · Body ${p.bodyPct.toFixed(0)}% · Wick ${p.wickRatio.toFixed(1)}×` };
        case 'ema-crossover':
          return { type: p.type, label: p.label, conviction: Math.round(p.conviction * 100), details: `EMA${p.shortPeriod} ${p.shortEMA.toFixed(2)} > EMA${p.longPeriod} ${p.longEMA.toFixed(2)}` };
        case 'bollinger-squeeze':
          return { type: p.type, label: p.label, conviction: Math.round(p.conviction * 100), details: `BB $${p.upperBand.toFixed(2)} · Breakout $${p.breakoutPrice.toFixed(2)} · Vol ${p.volumeRatio.toFixed(1)}×` };
        case 'gap-and-go':
          return { type: p.type, label: p.label, conviction: Math.round(p.conviction * 100), details: `Gap +${p.gapPct.toFixed(1)}% · $${p.previousClose.toFixed(2)}→$${p.openPrice.toFixed(2)} · Vol ${p.volumeRatio.toFixed(1)}×` };
        case 'cup-and-handle':
          return { type: p.type, label: p.label, conviction: Math.round(p.conviction * 100), details: `Rim $${p.rimPrice.toFixed(2)} · Cup depth ${p.cupDepthPct.toFixed(1)}% · Handle $${p.handleLowPrice.toFixed(2)}` };
        case 'falling-wedge':
          return { type: p.type, label: p.label, conviction: Math.round(p.conviction * 100), details: `Upper slope ${p.upperSlope.toFixed(4)} · Lower ${p.lowerSlope.toFixed(4)} · Vol ${p.volumeRatio.toFixed(1)}×` };
        default:
          return { type: (p as PatternResult).type, label: (p as PatternResult).label, conviction: Math.round((p as PatternResult).conviction * 100), details: '' };
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

      {/* Chart with pattern popup */}
      {candles.length >= 2 && (
        <div ref={chartContainerRef} className="relative bg-zinc-900 rounded-lg p-3 overflow-hidden">
          {/* Line / Candle toggle */}
          <div className="flex justify-end mb-2">
            <div className="flex gap-1">
              <button
                onClick={() => setChartMode('line')}
                className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                  chartMode === 'line'
                    ? 'bg-blue-600 text-white'
                    : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                }`}
                title="Line chart"
              >
                Line
              </button>
              <button
                onClick={() => setChartMode('candle')}
                className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                  chartMode === 'candle'
                    ? 'bg-blue-600 text-white'
                    : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                }`}
                title="Candlestick chart"
              >
                Candle
              </button>
            </div>
          </div>
          <div className="w-full aspect-[900/400]">
            <PriceChart
              key={`${interval}:${range}:${chartMode}`}
              candles={candles}
              chartMode={chartMode}
              patterns={patterns.length > 0 ? patterns : undefined}
              highlightPatternIndex={highlightedPattern}
              onPatternClick={(i, pos) => {
                if (lockedPattern === i) {
                  setLockedPattern(null);
                  setPopupPos(null);
                } else {
                  setLockedPattern(i);
                  setPopupPos(pos ?? null);
                  setHighlightedRef(null);
                }
              }}
              onBackgroundClick={() => {
                setLockedPattern(null);
                setPopupPos(null);
              }}
              width={900}
              height={400}
            />
          </div>

          {/* Pattern popup */}
          {lockedPattern != null && patternDetails && patternDetails[lockedPattern] && popupPos && (() => {
            const detail = patternDetails[lockedPattern];
            const cc = convictionClasses(detail.conviction);
            const container = chartContainerRef.current;
            const cw = container?.clientWidth ?? 900;
            const ch = container?.clientHeight ?? 400;
            // Position popup near click, but keep it inside the chart
            const popupW = 260;
            const popupH = 80;
            let px = popupPos.x + 12;
            let py = popupPos.y - popupH - 8;
            if (px + popupW > cw - 12) px = popupPos.x - popupW - 12;
            if (py < 8) py = popupPos.y + 16;
            if (px < 8) px = 8;
            return (
              <div
                className={`absolute z-30 rounded-lg p-3 border shadow-xl text-sm backdrop-blur-sm ${cc.bg} ${cc.border}`}
                style={{ left: px, top: py, width: popupW }}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className={`font-semibold ${cc.accent}`}>{detail.label}</span>
                  <div className="flex items-center gap-1.5">
                    <button
                      title="View in Pattern Reference"
                      className="text-zinc-400 hover:text-zinc-200 transition-colors"
                      onClick={(e) => {
                        e.stopPropagation();
                        scrollToRef(detail.type);
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                    </button>
                    <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${cc.badge}`}>{detail.conviction}%</span>
                    <button
                      className="text-zinc-500 hover:text-zinc-300 ml-1"
                      onClick={() => { setLockedPattern(null); setPopupPos(null); }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
                <div className="text-zinc-400 text-xs">{detail.details}</div>
              </div>
            );
          })()}
        </div>
      )}

      {/* Detection summary */}
      {!loading && !detecting && activeSymbol && candles.length > 0 && patterns.length === 0 && (
        <p className="text-sm text-zinc-500">No breakout patterns detected in {candles.length} candles. Try a different timeframe or stock.</p>
      )}

      {!loading && !detecting && patterns.length > 0 && (
        <p className="text-sm text-zinc-400">{patterns.length} pattern{patterns.length > 1 ? 's' : ''} detected — click overlays on the chart for details.</p>
      )}

      {detecting && (
        <div className="text-sm text-zinc-400">Running pattern detection…</div>
      )}

      {/* Pattern Reference */}
      <div className="space-y-3">
        <h2 className="text-base font-semibold text-zinc-300">Pattern Reference</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PATTERN_REFERENCE.map((ref) => (
            <div
              key={ref.type}
              id={`ref-${ref.type}`}
              className={`bg-zinc-900 rounded-lg p-4 space-y-3 transition-all duration-700 ${
                highlightedRef === ref.type ? 'ring-2 ring-blue-500/60 bg-blue-950/40' : ''
              }`}
            >
              <div className="text-base font-semibold text-zinc-200">{ref.name}</div>
              <div className="flex justify-center">
                <PatternIcon type={ref.type} />
              </div>
              <p className="text-sm text-zinc-400 leading-relaxed">{ref.description}</p>
              <div className="space-y-1">
                {ref.criteria.map((c, i) => (
                  <div key={i} className="flex items-start gap-1.5 text-sm">
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
