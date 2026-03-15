/**
 * Normalized internal types shared across the application.
 * These are data-source agnostic — any provider's raw data gets mapped to these.
 */

export interface NormalizedQuote {
  symbol: string;
  currentPrice: number;
  change: number;
  changePercent: number;
  high: number;
  low: number;
  open: number;
  previousClose: number;
  timestamp: Date;
}

export interface NormalizedCandle {
  close: number;
  high: number;
  low: number;
  open: number;
  volume: number;
  timestamp: Date;
}

export interface NormalizedProfile {
  symbol: string;
  name: string;
  sector: string;
  sharesOutstanding: number;
  marketCap: number;
}

export interface NormalizedNews {
  symbol: string;
  headline: string;
  source: string;
  url: string;
  summary: string;
  publishedAt: Date;
}

// ---------------------------------------------------------------------------
// Breakout pattern detection result types
// ---------------------------------------------------------------------------

export interface PatternBase {
  /** Index into the candle array where the pattern starts */
  startIndex: number;
  /** Index where the pattern ends (breakout candle) */
  endIndex: number;
  /** ISO timestamps for time-based alignment with chart candles */
  startTime: string;
  endTime: string;
  /** Conviction score 0–1 (volume ratio × R² etc.) */
  conviction: number;
  /** Human-readable label */
  label: string;
}

export interface VolumeBreakout extends PatternBase {
  type: 'volume-breakout';
  resistancePrice: number;
  breakoutPrice: number;
  volumeRatio: number;
}

export interface ConsolidationBreakout extends PatternBase {
  type: 'consolidation-breakout';
  rangeHigh: number;
  rangeLow: number;
  bandwidthContraction: number;
}

export interface BullFlag extends PatternBase {
  type: 'bull-flag';
  poleStartIndex: number;
  poleEndIndex: number;
  flagStartIndex: number;
  flagEndIndex: number;
  poleStartTime: string;
  poleEndTime: string;
  flagStartTime: string;
  flagEndTime: string;
  /** Slope of the flag channel (negative = declining) */
  flagSlope: number;
}

export interface AscendingTriangle extends PatternBase {
  type: 'ascending-triangle';
  resistancePrice: number;
  /** Indices of the rising swing lows */
  swingLowIndices: number[];
  swingLowTimes: string[];
  trendlineSlope: number;
  trendlineIntercept: number;
}

export interface ChannelBreakout extends PatternBase {
  type: 'channel-breakout';
  upperSlope: number;
  upperIntercept: number;
  lowerSlope: number;
  lowerIntercept: number;
}

export interface DoubleBottom extends PatternBase {
  type: 'double-bottom';
  /** Price of the first bottom */
  firstBottomPrice: number;
  /** Price of the second bottom */
  secondBottomPrice: number;
  /** Index of the first bottom */
  firstBottomIndex: number;
  /** Index of the second bottom */
  secondBottomIndex: number;
  /** Neckline (high between the two bottoms) */
  necklinePrice: number;
}

export interface InsideBarBreakout extends PatternBase {
  type: 'inside-bar-breakout';
  /** Index of the mother bar */
  motherBarIndex: number;
  /** Number of inside bars before breakout */
  insideBarCount: number;
  /** High of the mother bar (breakout level) */
  motherBarHigh: number;
  /** Low of the mother bar */
  motherBarLow: number;
}

export interface VWAPReclaim extends PatternBase {
  type: 'vwap-reclaim';
  /** VWAP value at reclaim */
  vwapPrice: number;
  /** How far below VWAP price dipped (as %) */
  dipPercent: number;
  /** Volume ratio on the reclaim candle */
  volumeRatio: number;
}

export interface SymmetricalTriangle extends PatternBase {
  type: 'symmetrical-triangle';
  /** Descending resistance trendline */
  upperSlope: number;
  upperIntercept: number;
  /** Ascending support trendline */
  lowerSlope: number;
  lowerIntercept: number;
  /** Number of swing points used */
  swingPointCount: number;
}

export type PatternResult =
  | VolumeBreakout
  | ConsolidationBreakout
  | BullFlag
  | AscendingTriangle
  | ChannelBreakout
  | DoubleBottom
  | InsideBarBreakout
  | VWAPReclaim
  | SymmetricalTriangle
  | BullishEngulfing
  | MorningStar
  | HammerPattern
  | EMACrossover
  | BollingerSqueeze
  | GapAndGo
  | CupAndHandle
  | FallingWedge;

// ---------------------------------------------------------------------------
// New pattern types
// ---------------------------------------------------------------------------

export interface BullishEngulfing extends PatternBase {
  type: 'bullish-engulfing';
  priorClose: number;
  priorOpen: number;
  engulfOpen: number;
  engulfClose: number;
  volumeRatio: number;
}

export interface MorningStar extends PatternBase {
  type: 'morning-star';
  firstClose: number;
  dojiClose: number;
  thirdClose: number;
  volumeRatio: number;
}

export interface HammerPattern extends PatternBase {
  type: 'hammer';
  hammerType: 'hammer' | 'inverted-hammer';
  bodyPct: number;
  wickRatio: number;
  volumeRatio: number;
}

export interface EMACrossover extends PatternBase {
  type: 'ema-crossover';
  shortPeriod: number;
  longPeriod: number;
  shortEMA: number;
  longEMA: number;
  crossoverPrice: number;
}

export interface BollingerSqueeze extends PatternBase {
  type: 'bollinger-squeeze';
  bandwidthAtSqueeze: number;
  breakoutPrice: number;
  upperBand: number;
  volumeRatio: number;
}

export interface GapAndGo extends PatternBase {
  type: 'gap-and-go';
  gapPct: number;
  previousClose: number;
  openPrice: number;
  volumeRatio: number;
}

export interface CupAndHandle extends PatternBase {
  type: 'cup-and-handle';
  cupStartPrice: number;
  cupBottomPrice: number;
  cupEndPrice: number;
  handleLowPrice: number;
  rimPrice: number;
  cupDepthPct: number;
}

export interface FallingWedge extends PatternBase {
  type: 'falling-wedge';
  upperSlope: number;
  upperIntercept: number;
  lowerSlope: number;
  lowerIntercept: number;
  breakoutPrice: number;
  volumeRatio: number;
}
