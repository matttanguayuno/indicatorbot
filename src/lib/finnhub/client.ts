/**
 * Centralized Finnhub API client with rate-limiting, retry, and error handling.
 */

import {
  FinnhubQuote,
  FinnhubCandle,
  FinnhubCompanyProfile,
  FinnhubNewsItem,
  FinnhubSymbolLookupResult,
} from './types';

const BASE_URL = 'https://finnhub.io/api/v1';
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
// Finnhub free tier: 60 calls/min. We space requests to stay under.
const MIN_REQUEST_GAP_MS = 200;

let lastRequestTime = 0;

function getApiKey(): string {
  const key = process.env.FINNHUB_API_KEY;
  if (!key || key === 'your_finnhub_api_key_here') {
    throw new Error('FINNHUB_API_KEY is not configured');
  }
  return key;
}

async function rateLimitWait(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_REQUEST_GAP_MS) {
    await new Promise((r) => setTimeout(r, MIN_REQUEST_GAP_MS - elapsed));
  }
  lastRequestTime = Date.now();
}

async function finnhubFetch<T>(endpoint: string, params: Record<string, string> = {}): Promise<T | null> {
  const apiKey = getApiKey();
  const url = new URL(`${BASE_URL}${endpoint}`);
  url.searchParams.set('token', apiKey);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    await rateLimitWait();
    try {
      const res = await fetch(url.toString());

      if (res.status === 429) {
        // Rate limited — back off
        console.warn(`[Finnhub] Rate limited on ${endpoint}, attempt ${attempt}`);
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt * 2));
        continue;
      }

      if (!res.ok) {
        console.error(`[Finnhub] HTTP ${res.status} on ${endpoint}: ${res.statusText}`);
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
          continue;
        }
        return null;
      }

      const data = await res.json();
      return data as T;
    } catch (err) {
      console.error(`[Finnhub] Network error on ${endpoint}, attempt ${attempt}:`, err);
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
        continue;
      }
      return null;
    }
  }

  return null;
}

// --- Public API methods ---

export async function getQuote(symbol: string): Promise<FinnhubQuote | null> {
  return finnhubFetch<FinnhubQuote>('/quote', { symbol });
}

export async function getCandles(
  symbol: string,
  resolution: string,
  from: number,
  to: number
): Promise<FinnhubCandle | null> {
  const data = await finnhubFetch<FinnhubCandle>('/stock/candle', {
    symbol,
    resolution,
    from: from.toString(),
    to: to.toString(),
  });
  if (data && data.s === 'no_data') {
    console.warn(`[Finnhub] No candle data for ${symbol}`);
    return null;
  }
  return data;
}

export async function getCompanyProfile(symbol: string): Promise<FinnhubCompanyProfile | null> {
  return finnhubFetch<FinnhubCompanyProfile>('/stock/profile2', { symbol });
}

export async function getCompanyNews(
  symbol: string,
  from: string,
  to: string
): Promise<FinnhubNewsItem[] | null> {
  return finnhubFetch<FinnhubNewsItem[]>('/company-news', { symbol, from, to });
}

export async function searchSymbol(query: string): Promise<FinnhubSymbolLookupResult | null> {
  return finnhubFetch<FinnhubSymbolLookupResult>('/search', { q: query });
}
