/**
 * Central configuration for all scoring weights, thresholds, and tunable parameters.
 * Change values here to tune signal scoring without touching business logic.
 *
 * Supports two data modes:
 *  - "candle" (Twelve Data): 5m/15m/1h candle momentum + RVOL + VWAP + volume spike
 *  - "quote-only" (Finnhub): intraday + 1d momentum from /quote endpoint
 *
 * The engine normalises the final score against the max achievable points
 * so both modes produce a fair 0–100 scale.
 */

export const SCORING_WEIGHTS = {
  momentum: {
    weight: 25,
    timeframes: {
      '5m': 0.20,
      '15m': 0.20,
      '1h': 0.20,
      '1d': 0.20,
      'intraday': 0.20,
    },
  },

  rvol: {
    weight: 8,
    highThreshold: 3,
    moderateThreshold: 1.5,
  },

  volumeSpike: {
    weight: 5,
    spikeThreshold: 2.0,
  },

  float: {
    weight: 8,
    lowFloatThreshold: 20_000_000,
    microFloatThreshold: 5_000_000,
  },

  vwap: {
    weight: 5,
  },

  intradayRange: {
    weight: 8,
  },

  breakout: {
    weight: 8,
    nearHighPct: 0.02,
    gapUpPct: 0.02,
  },

  newsCatalyst: {
    weight: 8,
    recentWindowMinutes: 2880,   // 48 hours
    maxArticles: 5,
  },

  shortInterest: {
    weight: 5,
    highThreshold: 20,
    moderateThreshold: 10,
  },

  optionsFlow: {
    weight: 5,
    bullishThreshold: 0.6,
  },

  patterns: {
    weight: 15,
    cap: 15,
    baseBoosts: {
      'volume-breakout': 5,
      'consolidation-breakout': 5,
      'bull-flag': 7,
      'ascending-triangle': 7,
      'channel-breakout': 6,
      'double-bottom': 7,
      'inside-bar-breakout': 4,
      'vwap-reclaim': 4,
      'symmetrical-triangle': 6,
      'bullish-engulfing': 5,
      'morning-star': 6,
      'hammer': 4,
      'ema-crossover': 3,
      'bollinger-squeeze': 6,
      'gap-and-go': 5,
      'cup-and-handle': 8,
      'falling-wedge': 6,
    } as Record<string, number>,
  },
} as const;

export const SCORING_PENALTIES = {
  missingDataPerField: 1,
  maxMissingPenalty: 5,
} as const;

export const ALERT_CONFIG = {
  defaultScoreThreshold: 65,
  cooldownMinutes: 30,
  maxAlertsPerTickerPerDay: 5,
} as const;

export const POLLING_CONFIG = {
  intervalSeconds: 60,
  batchSize: 55, // Grow plan: 55 credits/min. Candle batch = 1 credit/symbol, quotes derived from candles = 0.
} as const;

export const DEFAULT_WATCHLIST = [
  'AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMD',
  'META', 'AMZN', 'GOOGL', 'SPY', 'QQQ',
] as const;

export type ScoringWeights = typeof SCORING_WEIGHTS;
export type AlertConfig = typeof ALERT_CONFIG;
export type PollingConfig = typeof POLLING_CONFIG;
