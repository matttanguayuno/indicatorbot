'use client';

import type { PatternResult } from '@/lib/types';

/* ── Pattern Reference Data ──────────────────────────────────── */

export const PATTERN_REFERENCE = [
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

/* ── Conviction colour helpers ───────────────────────────────── */

export function convictionClasses(pct: number) {
  if (pct >= 70) return { accent: 'text-emerald-300', bg: 'bg-emerald-900/20', border: 'border-emerald-500/50', ring: 'ring-emerald-500/30', badge: 'bg-emerald-900/40 text-emerald-300' };
  if (pct >= 45) return { accent: 'text-yellow-300', bg: 'bg-yellow-900/20', border: 'border-yellow-500/50', ring: 'ring-yellow-500/30', badge: 'bg-yellow-900/40 text-yellow-300' };
  return { accent: 'text-orange-300', bg: 'bg-orange-900/20', border: 'border-orange-500/50', ring: 'ring-orange-500/30', badge: 'bg-orange-900/40 text-orange-300' };
}

/* ── Pattern detail text (for tooltips) ──────────────────────── */

export function getPatternDetail(p: PatternResult): { type: string; label: string; conviction: number; details: string } {
  const base = { type: p.type, label: p.label, conviction: Math.round(p.conviction * 100) };
  switch (p.type) {
    case 'volume-breakout':
      return { ...base, details: `Resistance $${p.resistancePrice.toFixed(2)} · Volume ${p.volumeRatio.toFixed(1)}×` };
    case 'consolidation-breakout':
      return { ...base, details: `Range $${p.rangeLow.toFixed(2)}–$${p.rangeHigh.toFixed(2)} · Squeeze ${Math.round(p.bandwidthContraction * 100)}%` };
    case 'bull-flag':
      return { ...base, details: `Pole ${p.poleStartIndex}–${p.poleEndIndex} · Flag slope ${p.flagSlope.toFixed(4)}` };
    case 'ascending-triangle':
      return { ...base, details: `Resistance $${p.resistancePrice.toFixed(2)} · ${p.swingLowIndices.length} swing lows` };
    case 'channel-breakout':
      return { ...base, details: `Upper slope ${p.upperSlope.toFixed(4)} · Lower ${p.lowerSlope.toFixed(4)}` };
    case 'double-bottom':
      return { ...base, details: `Bottoms $${p.firstBottomPrice.toFixed(2)} / $${p.secondBottomPrice.toFixed(2)} · Neckline $${p.necklinePrice.toFixed(2)}` };
    case 'inside-bar-breakout':
      return { ...base, details: `${p.insideBarCount} inside bar${p.insideBarCount > 1 ? 's' : ''} · Mother high $${p.motherBarHigh.toFixed(2)}` };
    case 'vwap-reclaim':
      return { ...base, details: `VWAP $${p.vwapPrice.toFixed(2)} · Dip ${p.dipPercent.toFixed(1)}% · Vol ${p.volumeRatio.toFixed(1)}×` };
    case 'symmetrical-triangle':
      return { ...base, details: `${p.swingPointCount} swing points · Converging trendlines` };
    case 'bullish-engulfing':
      return { ...base, details: `Engulf $${p.engulfOpen.toFixed(2)}→$${p.engulfClose.toFixed(2)} · Vol ${p.volumeRatio.toFixed(1)}×` };
    case 'morning-star':
      return { ...base, details: `Doji $${p.dojiClose.toFixed(2)} · Recovery $${p.thirdClose.toFixed(2)} · Vol ${p.volumeRatio.toFixed(1)}×` };
    case 'hammer':
      return { ...base, details: `${p.hammerType === 'hammer' ? 'Hammer' : 'Inverted'} · Body ${p.bodyPct.toFixed(0)}% · Wick ${p.wickRatio.toFixed(1)}×` };
    case 'ema-crossover':
      return { ...base, details: `EMA${p.shortPeriod} ${p.shortEMA.toFixed(2)} > EMA${p.longPeriod} ${p.longEMA.toFixed(2)}` };
    case 'bollinger-squeeze':
      return { ...base, details: `BB $${p.upperBand.toFixed(2)} · Breakout $${p.breakoutPrice.toFixed(2)} · Vol ${p.volumeRatio.toFixed(1)}×` };
    case 'gap-and-go':
      return { ...base, details: `Gap +${p.gapPct.toFixed(1)}% · $${p.previousClose.toFixed(2)}→$${p.openPrice.toFixed(2)} · Vol ${p.volumeRatio.toFixed(1)}×` };
    case 'cup-and-handle':
      return { ...base, details: `Rim $${p.rimPrice.toFixed(2)} · Cup depth ${p.cupDepthPct.toFixed(1)}% · Handle $${p.handleLowPrice.toFixed(2)}` };
    case 'falling-wedge':
      return { ...base, details: `Upper slope ${p.upperSlope.toFixed(4)} · Lower ${p.lowerSlope.toFixed(4)} · Vol ${p.volumeRatio.toFixed(1)}×` };
    default:
      return { ...base, details: '' };
  }
}

/* ── Abstract SVG icon for each pattern ──────────────────────── */

export function PatternIcon({ type }: { type: string }) {
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
      return (
        <svg width={w} height={h} viewBox="0 0 120 80" className="shrink-0">
          <line x1="8" y1="36" x2="112" y2="36" stroke={stroke} strokeWidth="1.5" strokeDasharray="6,3" />
          <polyline points="8,30 22,32 36,38 50,52 62,58 72,48 82,38 92,34 102,28 112,20" fill="none" stroke={stroke} strokeWidth="2.5" />
          <text x="112" y="46" fill={stroke} fontSize="9" opacity="0.6">VWAP</text>
          <polygon points="102,24 97,32 107,32" fill={accent} opacity="0.7" />
        </svg>
      );
    case 'symmetrical-triangle':
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
      return (
        <svg width={w} height={h} viewBox="0 0 120 80" className="shrink-0">
          <line x1="15" y1="18" x2="15" y2="58" stroke="#666" strokeWidth="1" />
          <rect x="11" y="22" width="8" height="30" fill="#ef4444" rx="1" opacity="0.4" />
          <line x1="32" y1="24" x2="32" y2="64" stroke="#666" strokeWidth="1" />
          <rect x="28" y="28" width="8" height="30" fill="#ef4444" rx="1" opacity="0.4" />
          <line x1="52" y1="28" x2="52" y2="68" stroke="#ef4444" strokeWidth="1.5" />
          <rect x="46" y="34" width="12" height="24" fill="#ef4444" rx="1" />
          <line x1="74" y1="20" x2="74" y2="72" stroke={accent} strokeWidth="1.5" />
          <rect x="66" y="26" width="16" height="38" fill={accent} rx="1.5" opacity="0.8" />
          <polyline points="92,50 100,36 108,22" fill="none" stroke={stroke} strokeWidth="2" strokeDasharray="4,2" />
          <polygon points="108,18 104,26 112,26" fill={stroke} opacity="0.7" />
        </svg>
      );
    case 'morning-star':
      return (
        <svg width={w} height={h} viewBox="0 0 120 80" className="shrink-0">
          <line x1="22" y1="10" x2="22" y2="60" stroke="#ef4444" strokeWidth="1.5" />
          <rect x="16" y="14" width="12" height="38" fill="#ef4444" rx="1" />
          <line x1="48" y1="42" x2="48" y2="72" stroke={stroke} strokeWidth="1.5" />
          <rect x="44" y="54" width="8" height="5" fill={stroke} rx="1" />
          <text x="48" y="40" fill="#fbbf24" fontSize="12" textAnchor="middle">★</text>
          <line x1="74" y1="16" x2="74" y2="62" stroke={accent} strokeWidth="1.5" />
          <rect x="68" y="20" width="12" height="34" fill={accent} rx="1" opacity="0.8" />
          <line x1="12" y1="33" x2="84" y2="33" stroke={stroke} strokeWidth="1" strokeDasharray="3,3" opacity="0.4" />
          <text x="90" y="36" fill={stroke} fontSize="7" opacity="0.5">mid</text>
          <polyline points="90,46 100,34 110,20" fill="none" stroke={stroke} strokeWidth="1.5" strokeDasharray="4,2" />
        </svg>
      );
    case 'hammer':
      return (
        <svg width={w} height={h} viewBox="0 0 120 80" className="shrink-0">
          <polyline points="8,20 20,30 32,38 44,48" fill="none" stroke="#ef4444" strokeWidth="1.5" opacity="0.5" />
          <line x1="58" y1="30" x2="58" y2="74" stroke={accent} strokeWidth="2" />
          <rect x="52" y="30" width="12" height="10" fill={accent} rx="1.5" opacity="0.9" />
          <text x="58" y="26" fill={stroke} fontSize="7" textAnchor="middle" opacity="0.6">body</text>
          <line x1="66" y1="55" x2="72" y2="55" stroke={stroke} strokeWidth="0.5" opacity="0.4" />
          <text x="76" y="58" fill={stroke} fontSize="7" opacity="0.5">wick ≥2×</text>
          <line x1="96" y1="14" x2="96" y2="56" stroke={accent} strokeWidth="1.5" />
          <rect x="91" y="46" width="10" height="10" fill={accent} rx="1" opacity="0.6" />
          <text x="96" y="66" fill={stroke} fontSize="7" textAnchor="middle" opacity="0.5">inv.</text>
          <polyline points="108,42 112,30 114,22" fill="none" stroke={stroke} strokeWidth="1.5" strokeDasharray="3,2" />
        </svg>
      );
    case 'ema-crossover':
      return (
        <svg width={w} height={h} viewBox="0 0 120 80" className="shrink-0">
          <path d="M8,28 Q30,38 55,42 Q80,46 112,44" fill="none" stroke="#f59e0b" strokeWidth="2" opacity="0.7" />
          <path d="M8,44 Q30,48 50,46 Q65,42 75,38 Q90,30 112,22" fill="none" stroke={accent} strokeWidth="2.5" />
          <circle cx="62" cy="42" r="5" fill="none" stroke={stroke} strokeWidth="1.5" />
          <line x1="57" y1="37" x2="67" y2="47" stroke={stroke} strokeWidth="1.5" />
          <line x1="67" y1="37" x2="57" y2="47" stroke={stroke} strokeWidth="1.5" />
          <text x="112" y="20" fill={accent} fontSize="8" opacity="0.7">EMA 9</text>
          <text x="112" y="52" fill="#f59e0b" fontSize="8" opacity="0.7">EMA 21</text>
          <polyline points="8,46 20,50 35,48 50,46 62,42 75,36 88,30 100,26 112,20" fill="none" stroke={stroke} strokeWidth="1" opacity="0.3" />
        </svg>
      );
    case 'bollinger-squeeze':
      return (
        <svg width={w} height={h} viewBox="0 0 120 80" className="shrink-0">
          <path d="M8,12 Q20,14 35,22 Q50,30 60,34 Q70,30 85,20 Q100,8 112,4" fill="none" stroke={stroke} strokeWidth="1.5" opacity="0.6" />
          <path d="M8,68 Q20,66 35,58 Q50,50 60,46 Q70,50 85,58 Q100,62 112,56" fill="none" stroke={stroke} strokeWidth="1.5" opacity="0.6" />
          <path d="M8,12 Q20,14 35,22 Q50,30 60,34 Q70,30 85,20 Q100,8 112,4 L112,56 Q100,62 85,58 Q70,50 60,46 Q50,50 35,58 Q20,66 8,68 Z" fill={fill} opacity="0.3" />
          <path d="M8,40 Q30,40 60,40 Q90,40 112,30" fill="none" stroke={stroke} strokeWidth="1" strokeDasharray="3,2" opacity="0.4" />
          <rect x="46" y="32" width="28" height="16" fill="none" stroke="#f59e0b" strokeWidth="1" strokeDasharray="3,2" rx="2" opacity="0.5" />
          <text x="60" y="56" fill="#f59e0b" fontSize="7" textAnchor="middle" opacity="0.6">squeeze</text>
          <polyline points="50,42 60,40 70,36 82,24 95,12 108,6" fill="none" stroke={accent} strokeWidth="2.5" />
          <polygon points="108,2 104,10 112,10" fill={accent} opacity="0.7" />
        </svg>
      );
    case 'gap-and-go':
      return (
        <svg width={w} height={h} viewBox="0 0 120 80" className="shrink-0">
          <line x1="15" y1="40" x2="15" y2="70" stroke="#666" strokeWidth="1" />
          <rect x="11" y="46" width="8" height="18" fill={stroke} rx="1" opacity="0.3" />
          <line x1="32" y1="38" x2="32" y2="68" stroke="#666" strokeWidth="1" />
          <rect x="28" y="42" width="8" height="20" fill={stroke} rx="1" opacity="0.3" />
          <line x1="50" y1="36" x2="50" y2="65" stroke="#666" strokeWidth="1.5" />
          <rect x="45" y="40" width="10" height="18" fill={stroke} rx="1" opacity="0.5" />
          <rect x="57" y="24" width="32" height="16" fill="#fbbf2420" stroke="#fbbf24" strokeWidth="1" strokeDasharray="3,2" rx="2" />
          <text x="73" y="35" fill="#fbbf24" fontSize="8" textAnchor="middle" opacity="0.6">GAP</text>
          <line x1="72" y1="8" x2="72" y2="24" stroke={accent} strokeWidth="1.5" />
          <rect x="67" y="10" width="10" height="14" fill={accent} rx="1" opacity="0.8" />
          <line x1="88" y1="4" x2="88" y2="20" stroke={accent} strokeWidth="1" />
          <rect x="84" y="6" width="8" height="12" fill={accent} rx="1" opacity="0.6" />
          <line x1="102" y1="2" x2="102" y2="16" stroke={accent} strokeWidth="1" />
          <rect x="98" y="4" width="8" height="10" fill={accent} rx="1" opacity="0.6" />
        </svg>
      );
    case 'cup-and-handle':
      return (
        <svg width={w} height={h} viewBox="0 0 120 80" className="shrink-0">
          <line x1="8" y1="22" x2="100" y2="22" stroke={stroke} strokeWidth="1" strokeDasharray="4,2" opacity="0.4" />
          <text x="104" y="25" fill={stroke} fontSize="7" opacity="0.5">rim</text>
          <path d="M10,22 Q10,70 55,70 Q100,70 100,22" fill="none" stroke={stroke} strokeWidth="2.5" />
          <path d="M10,22 Q10,70 55,70 Q100,70 100,22 Z" fill={fill} opacity="0.3" />
          <circle cx="10" cy="22" r="3" fill={stroke} opacity="0.5" />
          <circle cx="100" cy="22" r="3" fill={stroke} opacity="0.5" />
          <path d="M100,22 Q100,36 106,36 Q112,36 112,26" fill="none" stroke={stroke} strokeWidth="2" />
          <polyline points="112,26 114,18 116,10" fill="none" stroke={accent} strokeWidth="2.5" />
          <polygon points="116,6 113,14 119,14" fill={accent} opacity="0.7" />
        </svg>
      );
    case 'falling-wedge':
      return (
        <svg width={w} height={h} viewBox="0 0 120 80" className="shrink-0">
          <line x1="8" y1="10" x2="82" y2="42" stroke={stroke} strokeWidth="1.5" />
          <line x1="8" y1="20" x2="82" y2="48" stroke={stroke} strokeWidth="1.5" />
          <polygon points="8,10 82,42 82,48 8,20" fill={fill} opacity="0.3" />
          <polyline points="10,18 22,12 32,22 44,18 54,30 64,26 72,38 80,36 82,44" fill="none" stroke={stroke} strokeWidth="2" />
          <circle cx="22" cy="12" r="2.5" fill={stroke} opacity="0.5" />
          <circle cx="44" cy="18" r="2.5" fill={stroke} opacity="0.5" />
          <circle cx="64" cy="26" r="2.5" fill={stroke} opacity="0.5" />
          <circle cx="32" cy="22" r="2.5" fill={stroke} opacity="0.5" />
          <circle cx="54" cy="30" r="2.5" fill={stroke} opacity="0.5" />
          <circle cx="72" cy="38" r="2.5" fill={stroke} opacity="0.5" />
          <polyline points="82,44 92,32 104,20 112,12" fill="none" stroke={accent} strokeWidth="2.5" />
          <polygon points="112,8 108,16 116,16" fill={accent} opacity="0.7" />
        </svg>
      );
    default:
      return <span className="text-lg">📊</span>;
  }
}
