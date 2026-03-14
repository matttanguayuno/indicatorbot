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
  | SymmetricalTriangle;
