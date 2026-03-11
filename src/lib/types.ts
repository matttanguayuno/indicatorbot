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
