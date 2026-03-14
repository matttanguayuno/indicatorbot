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
  /** Slope of the flag channel (negative = declining) */
  flagSlope: number;
}

export interface AscendingTriangle extends PatternBase {
  type: 'ascending-triangle';
  resistancePrice: number;
  /** Indices of the rising swing lows */
  swingLowIndices: number[];
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

export type PatternResult =
  | VolumeBreakout
  | ConsolidationBreakout
  | BullFlag
  | AscendingTriangle
  | ChannelBreakout;
