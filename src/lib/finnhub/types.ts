/** Typed response shapes from the Finnhub API */

export interface FinnhubQuote {
  c: number;   // current price
  d: number;   // change
  dp: number;  // percent change
  h: number;   // high of the day
  l: number;   // low of the day
  o: number;   // open
  pc: number;  // previous close
  t: number;   // timestamp
}

export interface FinnhubCandle {
  c: number[];  // close prices
  h: number[];  // high prices
  l: number[];  // low prices
  o: number[];  // open prices
  v: number[];  // volume
  t: number[];  // timestamps
  s: string;    // status: "ok" or "no_data"
}

export interface FinnhubCompanyProfile {
  country: string;
  currency: string;
  exchange: string;
  finnhubIndustry: string;
  ipo: string;
  logo: string;
  marketCapitalization: number;
  name: string;
  phone: string;
  shareOutstanding: number; // used as float proxy
  ticker: string;
  weburl: string;
}

export interface FinnhubNewsItem {
  category: string;
  datetime: number;
  headline: string;
  id: number;
  image: string;
  related: string;
  source: string;
  summary: string;
  url: string;
}

export interface FinnhubSymbolLookupResult {
  count: number;
  result: Array<{
    description: string;
    displaySymbol: string;
    symbol: string;
    type: string;
  }>;
}

// Internal normalized types used throughout the app
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
  sharesOutstanding: number; // float proxy
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
