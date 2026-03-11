/**
 * Twelve Data API client — sole data source for quotes, candles, profiles, and search.
 * Free tier: 8 API credits/min, 800/day. Each symbol in a batch = 1 credit.
 * Symbol search is free (0 credits).
 */

import type {
  TwelveDataTimeSeries,
  TwelveDataBatchResponse,
  TwelveDataQuote,
  TwelveDataProfile,
  TwelveDataStatistics,
  TwelveDataSymbolSearchResult,
} from './types';

const BASE_URL = 'https://api.twelvedata.com';
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 2000;

function getApiKey(): string {
  const key = process.env.TWELVEDATA_API_KEY;
  if (!key) {
    throw new Error('TWELVEDATA_API_KEY is not configured');
  }
  return key;
}

/**
 * Fetch time-series candle data for one or more symbols.
 * Returns a Map keyed by symbol → TwelveDataTimeSeries.
 */
export async function getTimeSeries(
  symbols: string[],
  interval: string = '1min',
  outputsize: number = 90,
): Promise<Map<string, TwelveDataTimeSeries>> {
  if (symbols.length === 0) return new Map();

  const apiKey = getApiKey();
  const url = new URL(`${BASE_URL}/time_series`);
  url.searchParams.set('apikey', apiKey);
  url.searchParams.set('symbol', symbols.join(','));
  url.searchParams.set('interval', interval);
  url.searchParams.set('outputsize', outputsize.toString());
  url.searchParams.set('format', 'JSON');
  url.searchParams.set('previous_close', 'true');

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url.toString());

      if (res.status === 429) {
        console.warn(`[TwelveData] Rate limited, attempt ${attempt}`);
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt * 3));
        continue;
      }

      if (!res.ok) {
        console.error(`[TwelveData] HTTP ${res.status}: ${res.statusText}`);
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
          continue;
        }
        return new Map();
      }

      const data = await res.json();

      // Log raw response shape for diagnostics
      if (symbols.length === 1) {
        console.log(`[TwelveData] Single response status: ${data.status}, values: ${data.values?.length ?? 0}`);
        if (data.code || data.status === 'error') {
          console.error(`[TwelveData] Error detail: code=${data.code}, message=${data.message}`);
        }
      } else {
        for (const sym of symbols) {
          const s = data[sym];
          console.log(`[TwelveData] ${sym}: status=${s?.status}, values=${s?.values?.length ?? 0}`);
          if (s?.code || s?.status === 'error') {
            console.error(`[TwelveData] ${sym} error: code=${s.code}, message=${s.message}`);
          }
        }
      }

      // API-level error (e.g. missing key)
      if (data.code && data.status === 'error') {
        console.error(`[TwelveData] API error: ${data.message}`);
        return new Map();
      }

      const result = new Map<string, TwelveDataTimeSeries>();

      if (symbols.length === 1) {
        // Single-symbol response: top-level meta/values/status
        const series = data as TwelveDataTimeSeries;
        if (series.status === 'ok' && series.values) {
          result.set(symbols[0], series);
        }
      } else {
        // Batch response: keyed by symbol
        const batch = data as TwelveDataBatchResponse;
        for (const [sym, series] of Object.entries(batch)) {
          if (series?.status === 'ok' && series.values) {
            result.set(sym, series);
          }
        }
      }

      return result;
    } catch (err) {
      console.error(`[TwelveData] Network error, attempt ${attempt}:`, err);
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
        continue;
      }
    }
  }

  return new Map();
}

/**
 * Generic fetch helper with retry for Twelve Data endpoints.
 */
async function twelveDataFetch<T>(endpoint: string, params: Record<string, string> = {}): Promise<T | null> {
  const apiKey = getApiKey();
  const url = new URL(`${BASE_URL}${endpoint}`);
  url.searchParams.set('apikey', apiKey);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url.toString());
      if (res.status === 429) {
        console.warn(`[TwelveData] Rate limited on ${endpoint}, attempt ${attempt}`);
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt * 3));
        continue;
      }
      if (!res.ok) {
        console.error(`[TwelveData] HTTP ${res.status} on ${endpoint}: ${res.statusText}`);
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
          continue;
        }
        return null;
      }
      const data = await res.json();
      if (data.code && data.status === 'error') {
        console.error(`[TwelveData] API error on ${endpoint}: ${data.message}`);
        return null;
      }
      return data as T;
    } catch (err) {
      console.error(`[TwelveData] Network error on ${endpoint}, attempt ${attempt}:`, err);
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
        continue;
      }
    }
  }
  return null;
}

/**
 * Fetch real-time quote for a symbol. 1 credit per call.
 */
export async function getQuote(symbol: string): Promise<TwelveDataQuote | null> {
  return twelveDataFetch<TwelveDataQuote>('/quote', { symbol });
}

/**
 * Fetch company profile. 1 credit per call.
 */
export async function getProfile(symbol: string): Promise<TwelveDataProfile | null> {
  return twelveDataFetch<TwelveDataProfile>('/profile', { symbol });
}

/**
 * Fetch stock statistics (shares outstanding, float, short interest). 1 credit per call.
 */
export async function getStatistics(symbol: string): Promise<TwelveDataStatistics | null> {
  return twelveDataFetch<TwelveDataStatistics>('/statistics', { symbol });
}

/**
 * Search for symbols. Free — 0 credits.
 */
export async function searchSymbols(query: string): Promise<TwelveDataSymbolSearchResult | null> {
  return twelveDataFetch<TwelveDataSymbolSearchResult>('/symbol_search', {
    symbol: query,
    show_plan: 'false',
  });
}
