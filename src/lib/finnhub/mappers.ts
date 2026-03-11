/**
 * Mapping functions: Finnhub raw responses → internal normalized models.
 */

import {
  FinnhubQuote,
  FinnhubCandle,
  FinnhubCompanyProfile,
  FinnhubNewsItem,
  NormalizedQuote,
  NormalizedCandle,
  NormalizedProfile,
  NormalizedNews,
} from './types';

export function mapQuote(symbol: string, raw: FinnhubQuote): NormalizedQuote {
  return {
    symbol,
    currentPrice: raw.c,
    change: raw.d,
    changePercent: raw.dp,
    high: raw.h,
    low: raw.l,
    open: raw.o,
    previousClose: raw.pc,
    timestamp: new Date(raw.t * 1000),
  };
}

export function mapCandles(raw: FinnhubCandle): NormalizedCandle[] {
  if (!raw.t || raw.t.length === 0) return [];
  return raw.t.map((t, i) => ({
    close: raw.c[i],
    high: raw.h[i],
    low: raw.l[i],
    open: raw.o[i],
    volume: raw.v[i],
    timestamp: new Date(t * 1000),
  }));
}

export function mapProfile(raw: FinnhubCompanyProfile): NormalizedProfile {
  return {
    symbol: raw.ticker,
    name: raw.name,
    sector: raw.finnhubIndustry,
    sharesOutstanding: raw.shareOutstanding * 1_000_000, // Finnhub reports in millions
    marketCap: raw.marketCapitalization * 1_000_000,
  };
}

export function mapNews(symbol: string, items: FinnhubNewsItem[]): NormalizedNews[] {
  return items.map((item) => ({
    symbol,
    headline: item.headline,
    source: item.source,
    url: item.url,
    summary: item.summary,
    publishedAt: new Date(item.datetime * 1000),
  }));
}
