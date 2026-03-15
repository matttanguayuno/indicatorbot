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
  {
    type: 'double-bottom',
    name: 'Double Bottom',
    icon: 'W',
    description: 'Two swing lows at similar price forming a "W" shape, followed by a breakout above the neckline.',
    criteria: [
      'Two swing lows within 0.5% of each other',
      'At least 8 candles apart',
      'Neckline = highest high between bottoms',
      'Close above neckline + volume ≥ 1.2×',
    ],
    lookback: 50,
  },
  {
    type: 'inside-bar-breakout',
    name: 'Inside Bar Breakout',
    icon: '▯',
    description: 'One or more candles contained within the prior "mother" bar\'s range, then price breaks above.',
    criteria: [
      'Child bar high ≤ mother bar high',
      'Child bar low ≥ mother bar low',
      'Breakout close above mother bar high',
    ],
    lookback: 10,
  },
  {
    type: 'vwap-reclaim',
    name: 'VWAP Reclaim',
    icon: '↗',
    description: 'Price dips below VWAP then reclaims it with volume, signaling buyers regaining control.',
    criteria: [
      'Price dips ≥ 0.3% below VWAP',
      'Close returns above VWAP',
      'Volume ≥ 1.3× average on reclaim candle',
    ],
    lookback: 30,
  },
  {
    type: 'symmetrical-triangle',
    name: 'Symmetrical Triangle',
    icon: '◇',
    description: 'Converging trendlines — descending highs and ascending lows — squeezing price into an apex breakout.',
    criteria: [
      'Upper trendline slopes down, lower slopes up',
      'Both trendlines R² ≥ 0.5',
      '≥ 3 swing points on each line',
      'Close above upper trendline + volume ≥ 1.2×',
    ],
    lookback: 50,
  },
  {
    type: 'bullish-engulfing',
    name: 'Bullish Engulfing',
    icon: '🟩',
    description: 'A large green candle fully engulfs the prior red candle\'s body, signaling a reversal.',
    criteria: [
      'Prior candle is bearish',
      'Current candle opens below prior close',
      'Current candle closes above prior open',
      'Volume ≥ 1.2× average',
    ],
    lookback: 2,
  },
  {
    type: 'morning-star',
    name: 'Morning Star',
    icon: '⭐',
    description: 'Three-candle reversal: bearish candle → small doji/star → bullish candle closing above midpoint.',
    criteria: [
      'First candle is bearish with decent body',
      'Second candle has small body (≤ 30% of first)',
      'Third candle is bullish, closes above first candle midpoint',
      'Volume ≥ 1.2× average on third candle',
    ],
    lookback: 3,
  },
  {
    type: 'hammer',
    name: 'Hammer / Inv. Hammer',
    icon: '🔨',
    description: 'Single-candle reversal with a small body and long wick after a downtrend.',
    criteria: [
      'Body ≤ 30% of candle range',
      'Lower wick (hammer) or upper wick (inverted) ≥ 2× body',
      'Preceded by a 5-bar downtrend',
    ],
    lookback: 6,
  },
  {
    type: 'ema-crossover',
    name: 'EMA Crossover',
    icon: '✂️',
    description: 'Short-period EMA crosses above long-period EMA (golden cross), signaling trend reversal.',
    criteria: [
      'Short EMA (9) was below long EMA (21)',
      'Short EMA crosses above long EMA',
    ],
    lookback: 21,
  },
  {
    type: 'bollinger-squeeze',
    name: 'BB Squeeze Breakout',
    icon: '💥',
    description: 'Bollinger Bands contract to a squeeze, then price breaks above the upper band with volume.',
    criteria: [
      'Bandwidth in bottom 20th percentile (squeeze)',
      'Price closes above upper Bollinger Band',
      'Volume ≥ 1.3× average',
    ],
    lookback: 40,
  },
  {
    type: 'gap-and-go',
    name: 'Gap & Go',
    icon: '🚀',
    description: 'Price gaps up significantly on volume and continues higher without filling the gap.',
    criteria: [
      'Gap up ≥ 2% from prior close',
      'Gap holds for 3+ bars (no fill)',
      'Price continues higher after gap',
      'Volume ≥ 1.5× average',
    ],
    lookback: 5,
  },
  {
    type: 'cup-and-handle',
    name: 'Cup & Handle',
    icon: '☕',
    description: 'U-shaped base (cup) with matching rims, followed by a small pullback (handle) and breakout.',
    criteria: [
      'Cup ≥ 15 bars wide with left & right rims within 3%',
      'Cup depth 3–35% from rim',
      'Handle retraces ≤ 50% of cup depth',
      'Breakout close above rim price',
    ],
    lookback: 80,
  },
  {
    type: 'falling-wedge',
    name: 'Falling Wedge',
    icon: '🔻',
    description: 'Both trendlines slope downward and converge, then price breaks above the upper trendline.',
    criteria: [
      'Upper and lower trendlines both slope down',
      'Upper slopes more steeply (converging)',
      'Both R² ≥ 0.5 with ≥ 3 swing points',
      'Close above upper trendline + volume ≥ 1.2×',
    ],
    lookback: 50,
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
  const [lockedPattern, setLockedPattern] = useState<number | null>(null);
  const [highlightedRef, setHighlightedRef] = useState<string | null>(null);
  const [popupPos, setPopupPos] = useState<{ x: number; y: number } | null>(null);
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
          <div className="w-full aspect-[900/400]">
            <PriceChart
              candles={candles}
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

function convictionClasses(pct: number) {
  if (pct >= 70) return { accent: 'text-emerald-300', bg: 'bg-emerald-900/20', border: 'border-emerald-500/50', ring: 'ring-emerald-500/30', badge: 'bg-emerald-900/40 text-emerald-300' };
  if (pct >= 45) return { accent: 'text-yellow-300', bg: 'bg-yellow-900/20', border: 'border-yellow-500/50', ring: 'ring-yellow-500/30', badge: 'bg-yellow-900/40 text-yellow-300' };
  return { accent: 'text-orange-300', bg: 'bg-orange-900/20', border: 'border-orange-500/50', ring: 'ring-orange-500/30', badge: 'bg-orange-900/40 text-orange-300' };
}

/** Abstract SVG icon showing the general shape of each pattern */
function PatternIcon({ type }: { type: string }) {
  const w = 160;
  const h = 100;
  const stroke = '#60a5fa';
  const fill = '#60a5fa20';
  const accent = '#4ade80';

  switch (type) {
    case 'volume-breakout':
      return (
        <svg width={w} height={h} viewBox="0 0 120 80" className="shrink-0">
          <line x1="8" y1="35" x2="85" y2="35" stroke={stroke} strokeWidth="1.5" strokeDasharray="5,3" />
          <polyline points="8,60 25,50 42,44 58,40 72,36 85,34 98,20 112,12" fill="none" stroke={stroke} strokeWidth="2.5" />
          <rect x="92" y="50" width="12" height="26" fill={stroke} opacity="0.5" rx="1.5" />
          <rect x="78" y="58" width="10" height="18" fill={stroke} opacity="0.25" rx="1" />
        </svg>
      );
    case 'consolidation-breakout':
      return (
        <svg width={w} height={h} viewBox="0 0 120 80" className="shrink-0">
          <path d="M8,14 Q30,8 55,28 Q75,36 90,36" fill="none" stroke={stroke} strokeWidth="1" opacity="0.5" />
          <path d="M8,66 Q30,72 55,52 Q75,44 90,44" fill="none" stroke={stroke} strokeWidth="1" opacity="0.5" />
          <rect x="25" y="28" width="60" height="24" fill={fill} rx="2" />
          <polyline points="8,46 25,44 42,40 58,40 75,40 90,38 102,18 112,10" fill="none" stroke={stroke} strokeWidth="2.5" />
        </svg>
      );
    case 'bull-flag':
      return (
        <svg width={w} height={h} viewBox="0 0 120 80" className="shrink-0">
          <polyline points="8,68 18,60 30,22 38,14" fill="none" stroke={accent} strokeWidth="2.5" />
          <rect x="38" y="14" width="50" height="26" fill={fill} rx="2" />
          <polyline points="38,14 50,20 62,24 75,27 88,30" fill="none" stroke={stroke} strokeWidth="1.5" strokeDasharray="4,2" />
          <polyline points="88,30 100,16 112,10" fill="none" stroke={stroke} strokeWidth="2.5" />
        </svg>
      );
    case 'ascending-triangle':
      return (
        <svg width={w} height={h} viewBox="0 0 120 80" className="shrink-0">
          <line x1="12" y1="20" x2="95" y2="20" stroke={stroke} strokeWidth="1.5" strokeDasharray="5,3" />
          <polyline points="12,68 35,54 58,40 82,28" fill="none" stroke={stroke} strokeWidth="1.5" />
          <polygon points="12,20 12,68 90,20" fill={fill} />
          <polyline points="82,28 100,14 112,8" fill="none" stroke={stroke} strokeWidth="2.5" />
          <circle cx="12" cy="68" r="3" fill={stroke} opacity="0.5" />
          <circle cx="35" cy="54" r="3" fill={stroke} opacity="0.5" />
          <circle cx="58" cy="40" r="3" fill={stroke} opacity="0.5" />
        </svg>
      );
    case 'channel-breakout':
      return (
        <svg width={w} height={h} viewBox="0 0 120 80" className="shrink-0">
          <line x1="8" y1="20" x2="85" y2="34" stroke={stroke} strokeWidth="1" />
          <line x1="8" y1="52" x2="85" y2="66" stroke={stroke} strokeWidth="1" />
          <polygon points="8,20 85,34 85,66 8,52" fill={fill} />
          <polyline points="22,46 40,40 58,44 75,36 85,34 100,16 112,10" fill="none" stroke={stroke} strokeWidth="2.5" />
        </svg>
      );
    case 'double-bottom':
      // W shape with neckline
      return (
        <svg width={w} height={h} viewBox="0 0 120 80" className="shrink-0">
          <line x1="8" y1="22" x2="112" y2="22" stroke={stroke} strokeWidth="1" strokeDasharray="5,3" opacity="0.5" />
          <polyline points="12,24 25,62 42,24 60,64 78,24 95,18 112,10" fill="none" stroke={stroke} strokeWidth="2.5" />
          <circle cx="25" cy="62" r="4" fill={stroke} opacity="0.6" />
          <circle cx="60" cy="64" r="4" fill={stroke} opacity="0.6" />
          <text x="42" y="18" fill={stroke} fontSize="9" opacity="0.6" textAnchor="middle">neckline</text>
        </svg>
      );
    case 'inside-bar-breakout':
      // Mother bar with smaller bars inside, then breakout
      return (
        <svg width={w} height={h} viewBox="0 0 120 80" className="shrink-0">
          <rect x="20" y="12" width="16" height="56" fill={fill} stroke={stroke} strokeWidth="1.5" rx="1" />
          <rect x="40" y="22" width="12" height="36" fill={fill} stroke={stroke} strokeWidth="1" rx="1" opacity="0.6" />
          <rect x="56" y="26" width="12" height="28" fill={fill} stroke={stroke} strokeWidth="1" rx="1" opacity="0.6" />
          <rect x="72" y="24" width="12" height="32" fill={fill} stroke={stroke} strokeWidth="1" rx="1" opacity="0.6" />
          <line x1="20" y1="12" x2="100" y2="12" stroke={stroke} strokeWidth="1" strokeDasharray="4,2" />
          <polyline points="88,14 96,8 112,4" fill="none" stroke={accent} strokeWidth="2.5" />
          <text x="28" y="76" fill={stroke} fontSize="8" textAnchor="middle" opacity="0.6">mother</text>
        </svg>
      );
    case 'vwap-reclaim':
      // Price dips below VWAP line then reclaims
      return (
        <svg width={w} height={h} viewBox="0 0 120 80" className="shrink-0">
          <line x1="8" y1="36" x2="112" y2="36" stroke={stroke} strokeWidth="1.5" strokeDasharray="6,3" />
          <polyline points="8,30 22,32 36,38 50,52 62,58 72,48 82,38 92,34 102,28 112,20" fill="none" stroke={stroke} strokeWidth="2.5" />
          <text x="112" y="46" fill={stroke} fontSize="9" opacity="0.6">VWAP</text>
          <polygon points="102,24 97,32 107,32" fill={accent} opacity="0.7" />
        </svg>
      );
    case 'symmetrical-triangle':
      // Converging trendlines
      return (
        <svg width={w} height={h} viewBox="0 0 120 80" className="shrink-0">
          <line x1="8" y1="12" x2="85" y2="36" stroke={stroke} strokeWidth="1" />
          <line x1="8" y1="68" x2="85" y2="44" stroke={stroke} strokeWidth="1" />
          <polygon points="8,12 85,36 85,44 8,68" fill={fill} />
          <polyline points="12,16 25,60 40,22 55,52 70,34 85,40 100,18 112,10" fill="none" stroke={stroke} strokeWidth="2" />
          <polyline points="85,38 100,18 112,10" fill="none" stroke={accent} strokeWidth="2.5" />
        </svg>
      );
    case 'bullish-engulfing':
      // Red candle followed by larger green candle that engulfs it
      return (
        <svg width={w} height={h} viewBox="0 0 120 80" className="shrink-0">
          {/* Context candles - prior downtrend */}
          <line x1="15" y1="18" x2="15" y2="58" stroke="#666" strokeWidth="1" />
          <rect x="11" y="22" width="8" height="30" fill="#ef4444" rx="1" opacity="0.4" />
          <line x1="32" y1="24" x2="32" y2="64" stroke="#666" strokeWidth="1" />
          <rect x="28" y="28" width="8" height="30" fill="#ef4444" rx="1" opacity="0.4" />
          {/* Prior bearish candle (red) */}
          <line x1="52" y1="28" x2="52" y2="68" stroke="#ef4444" strokeWidth="1.5" />
          <rect x="46" y="34" width="12" height="24" fill="#ef4444" rx="1" />
          {/* Engulfing bullish candle (green, larger) */}
          <line x1="74" y1="20" x2="74" y2="72" stroke={accent} strokeWidth="1.5" />
          <rect x="66" y="26" width="16" height="38" fill={accent} rx="1.5" opacity="0.8" />
          {/* Arrow showing reversal */}
          <polyline points="92,50 100,36 108,22" fill="none" stroke={stroke} strokeWidth="2" strokeDasharray="4,2" />
          <polygon points="108,18 104,26 112,26" fill={stroke} opacity="0.7" />
        </svg>
      );
    case 'morning-star':
      // Three candles: big red, small doji, big green
      return (
        <svg width={w} height={h} viewBox="0 0 120 80" className="shrink-0">
          {/* Prior bearish candle (tall red) */}
          <line x1="22" y1="10" x2="22" y2="60" stroke="#ef4444" strokeWidth="1.5" />
          <rect x="16" y="14" width="12" height="38" fill="#ef4444" rx="1" />
          {/* Small doji / star (tiny body, long wicks) */}
          <line x1="48" y1="42" x2="48" y2="72" stroke={stroke} strokeWidth="1.5" />
          <rect x="44" y="54" width="8" height="5" fill={stroke} rx="1" />
          {/* Star marker */}
          <text x="48" y="40" fill="#fbbf24" fontSize="12" textAnchor="middle">★</text>
          {/* Bullish recovery candle (tall green) */}
          <line x1="74" y1="16" x2="74" y2="62" stroke={accent} strokeWidth="1.5" />
          <rect x="68" y="20" width="12" height="34" fill={accent} rx="1" opacity="0.8" />
          {/* Midpoint reference line */}
          <line x1="12" y1="33" x2="84" y2="33" stroke={stroke} strokeWidth="1" strokeDasharray="3,3" opacity="0.4" />
          <text x="90" y="36" fill={stroke} fontSize="7" opacity="0.5">mid</text>
          {/* Recovery arrow */}
          <polyline points="90,46 100,34 110,20" fill="none" stroke={stroke} strokeWidth="1.5" strokeDasharray="4,2" />
        </svg>
      );
    case 'hammer':
      // Candle with small body at top and long lower wick (hammer), plus inverted variant
      return (
        <svg width={w} height={h} viewBox="0 0 120 80" className="shrink-0">
          {/* Prior downtrend */}
          <polyline points="8,20 20,30 32,38 44,48" fill="none" stroke="#ef4444" strokeWidth="1.5" opacity="0.5" />
          {/* Hammer candle — small body at top, long lower wick */}
          <line x1="58" y1="30" x2="58" y2="74" stroke={accent} strokeWidth="2" />
          <rect x="52" y="30" width="12" height="10" fill={accent} rx="1.5" opacity="0.9" />
          <text x="58" y="26" fill={stroke} fontSize="7" textAnchor="middle" opacity="0.6">body</text>
          {/* Wick label */}
          <line x1="66" y1="55" x2="72" y2="55" stroke={stroke} strokeWidth="0.5" opacity="0.4" />
          <text x="76" y="58" fill={stroke} fontSize="7" opacity="0.5">wick ≥2×</text>
          {/* Inverted hammer (smaller, to the right) */}
          <line x1="96" y1="14" x2="96" y2="56" stroke={accent} strokeWidth="1.5" />
          <rect x="91" y="46" width="10" height="10" fill={accent} rx="1" opacity="0.6" />
          <text x="96" y="66" fill={stroke} fontSize="7" textAnchor="middle" opacity="0.5">inv.</text>
          {/* Recovery arrow */}
          <polyline points="108,42 112,30 114,22" fill="none" stroke={stroke} strokeWidth="1.5" strokeDasharray="3,2" />
        </svg>
      );
    case 'ema-crossover':
      // Two EMA lines crossing — short crosses above long
      return (
        <svg width={w} height={h} viewBox="0 0 120 80" className="shrink-0">
          {/* Long EMA (21) — smoother, wider curve */}
          <path d="M8,28 Q30,38 55,42 Q80,46 112,44" fill="none" stroke="#f59e0b" strokeWidth="2" opacity="0.7" />
          {/* Short EMA (9) — crosses from below to above */}
          <path d="M8,44 Q30,48 50,46 Q65,42 75,38 Q90,30 112,22" fill="none" stroke={accent} strokeWidth="2.5" />
          {/* Crossover point marker */}
          <circle cx="62" cy="42" r="5" fill="none" stroke={stroke} strokeWidth="1.5" />
          <line x1="57" y1="37" x2="67" y2="47" stroke={stroke} strokeWidth="1.5" />
          <line x1="67" y1="37" x2="57" y2="47" stroke={stroke} strokeWidth="1.5" />
          {/* Labels */}
          <text x="112" y="20" fill={accent} fontSize="8" opacity="0.7">EMA 9</text>
          <text x="112" y="52" fill="#f59e0b" fontSize="8" opacity="0.7">EMA 21</text>
          {/* Price line underneath */}
          <polyline points="8,46 20,50 35,48 50,46 62,42 75,36 88,30 100,26 112,20" fill="none" stroke={stroke} strokeWidth="1" opacity="0.3" />
        </svg>
      );
    case 'bollinger-squeeze':
      // Bollinger Bands squeeze then expand with breakout
      return (
        <svg width={w} height={h} viewBox="0 0 120 80" className="shrink-0">
          {/* Upper band — wide, narrows, then expands */}
          <path d="M8,12 Q20,14 35,22 Q50,30 60,34 Q70,30 85,20 Q100,8 112,4" fill="none" stroke={stroke} strokeWidth="1.5" opacity="0.6" />
          {/* Lower band — mirror */}
          <path d="M8,68 Q20,66 35,58 Q50,50 60,46 Q70,50 85,58 Q100,62 112,56" fill="none" stroke={stroke} strokeWidth="1.5" opacity="0.6" />
          {/* Fill between bands */}
          <path d="M8,12 Q20,14 35,22 Q50,30 60,34 Q70,30 85,20 Q100,8 112,4 L112,56 Q100,62 85,58 Q70,50 60,46 Q50,50 35,58 Q20,66 8,68 Z" fill={fill} opacity="0.3" />
          {/* Middle band */}
          <path d="M8,40 Q30,40 60,40 Q90,40 112,30" fill="none" stroke={stroke} strokeWidth="1" strokeDasharray="3,2" opacity="0.4" />
          {/* Squeeze zone label */}
          <rect x="46" y="32" width="28" height="16" fill="none" stroke="#f59e0b" strokeWidth="1" strokeDasharray="3,2" rx="2" opacity="0.5" />
          <text x="60" y="56" fill="#f59e0b" fontSize="7" textAnchor="middle" opacity="0.6">squeeze</text>
          {/* Price breakout above upper band */}
          <polyline points="50,42 60,40 70,36 82,24 95,12 108,6" fill="none" stroke={accent} strokeWidth="2.5" />
          {/* Breakout arrow */}
          <polygon points="108,2 104,10 112,10" fill={accent} opacity="0.7" />
        </svg>
      );
    case 'gap-and-go':
      // Price gaps up leaving a visible gap zone, then continues higher
      return (
        <svg width={w} height={h} viewBox="0 0 120 80" className="shrink-0">
          {/* Prior candles */}
          <line x1="15" y1="40" x2="15" y2="70" stroke="#666" strokeWidth="1" />
          <rect x="11" y="46" width="8" height="18" fill={stroke} rx="1" opacity="0.3" />
          <line x1="32" y1="38" x2="32" y2="68" stroke="#666" strokeWidth="1" />
          <rect x="28" y="42" width="8" height="20" fill={stroke} rx="1" opacity="0.3" />
          {/* Last pre-gap candle */}
          <line x1="50" y1="36" x2="50" y2="65" stroke="#666" strokeWidth="1.5" />
          <rect x="45" y="40" width="10" height="18" fill={stroke} rx="1" opacity="0.5" />
          {/* Gap zone */}
          <rect x="57" y="24" width="32" height="16" fill="#fbbf2420" stroke="#fbbf24" strokeWidth="1" strokeDasharray="3,2" rx="2" />
          <text x="73" y="35" fill="#fbbf24" fontSize="8" textAnchor="middle" opacity="0.6">GAP</text>
          {/* Gap-up candle (bullish) */}
          <line x1="72" y1="8" x2="72" y2="24" stroke={accent} strokeWidth="1.5" />
          <rect x="67" y="10" width="10" height="14" fill={accent} rx="1" opacity="0.8" />
          {/* Continuation candles */}
          <line x1="88" y1="4" x2="88" y2="20" stroke={accent} strokeWidth="1" />
          <rect x="84" y="6" width="8" height="12" fill={accent} rx="1" opacity="0.6" />
          <line x1="102" y1="2" x2="102" y2="16" stroke={accent} strokeWidth="1" />
          <rect x="98" y="4" width="8" height="10" fill={accent} rx="1" opacity="0.6" />
        </svg>
      );
    case 'cup-and-handle':
      // U-shaped cup with matching rims, small dip handle, then breakout
      return (
        <svg width={w} height={h} viewBox="0 0 120 80" className="shrink-0">
          {/* Rim line */}
          <line x1="8" y1="22" x2="100" y2="22" stroke={stroke} strokeWidth="1" strokeDasharray="4,2" opacity="0.4" />
          <text x="104" y="25" fill={stroke} fontSize="7" opacity="0.5">rim</text>
          {/* Cup — U shape */}
          <path d="M10,22 Q10,70 55,70 Q100,70 100,22" fill="none" stroke={stroke} strokeWidth="2.5" />
          {/* Cup fill */}
          <path d="M10,22 Q10,70 55,70 Q100,70 100,22 Z" fill={fill} opacity="0.3" />
          {/* Rim dots */}
          <circle cx="10" cy="22" r="3" fill={stroke} opacity="0.5" />
          <circle cx="100" cy="22" r="3" fill={stroke} opacity="0.5" />
          {/* Handle — small dip */}
          <path d="M100,22 Q100,36 106,36 Q112,36 112,26" fill="none" stroke={stroke} strokeWidth="2" />
          {/* Breakout above rim */}
          <polyline points="112,26 114,18 116,10" fill="none" stroke={accent} strokeWidth="2.5" />
          <polygon points="116,6 113,14 119,14" fill={accent} opacity="0.7" />
        </svg>
      );
    case 'falling-wedge':
      // Both trendlines slope down & converge, breakout above upper
      return (
        <svg width={w} height={h} viewBox="0 0 120 80" className="shrink-0">
          {/* Upper trendline (steeper decline) */}
          <line x1="8" y1="10" x2="82" y2="42" stroke={stroke} strokeWidth="1.5" />
          {/* Lower trendline (shallower decline) */}
          <line x1="8" y1="20" x2="82" y2="48" stroke={stroke} strokeWidth="1.5" />
          {/* Wedge fill */}
          <polygon points="8,10 82,42 82,48 8,20" fill={fill} opacity="0.3" />
          {/* Price zigzag inside wedge */}
          <polyline points="10,18 22,12 32,22 44,18 54,30 64,26 72,38 80,36 82,44" fill="none" stroke={stroke} strokeWidth="2" />
          {/* Swing point dots */}
          <circle cx="22" cy="12" r="2.5" fill={stroke} opacity="0.5" />
          <circle cx="44" cy="18" r="2.5" fill={stroke} opacity="0.5" />
          <circle cx="64" cy="26" r="2.5" fill={stroke} opacity="0.5" />
          <circle cx="32" cy="22" r="2.5" fill={stroke} opacity="0.5" />
          <circle cx="54" cy="30" r="2.5" fill={stroke} opacity="0.5" />
          <circle cx="72" cy="38" r="2.5" fill={stroke} opacity="0.5" />
          {/* Breakout above upper trendline */}
          <polyline points="82,44 92,32 104,20 112,12" fill="none" stroke={accent} strokeWidth="2.5" />
          <polygon points="112,8 108,16 116,16" fill={accent} opacity="0.7" />
        </svg>
      );
    default:
      return <span className="text-lg">📊</span>;
  }
}
