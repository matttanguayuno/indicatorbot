/**
 * Twelve Data API client — sole data source for quotes, candles, profiles, and search.
 * Grow plan: 55 API credits/min, no daily cap. Each symbol in a batch = 1 credit.
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

// Per-minute rate-limit backoff (Grow plan: 55 credits/min, no daily cap).
// On 429 we back off for 60s, NOT until midnight.
const RATE_LIMIT_BACKOFF_MS = 60_000;
let quotaExhaustedUntil = 0;

// ── Per-minute credit tracker ──
const CREDITS_PER_MINUTE = 55;
const MINUTE_MS = 60_000;
let creditWindowStart = 0;
let creditsUsedInWindow = 0;

/** Record that `n` credits were consumed and return true if we're still under the limit. */
function recordCredits(n: number): boolean {
  const now = Date.now();
  if (now - creditWindowStart >= MINUTE_MS) {
    creditWindowStart = now;
    creditsUsedInWindow = 0;
  }
  creditsUsedInWindow += n;
  return creditsUsedInWindow <= CREDITS_PER_MINUTE;
}

/** Check whether making `n` more credit calls would exceed the per-minute cap. */
export function wouldExceedRateLimit(n: number): boolean {
  const now = Date.now();
  if (now - creditWindowStart >= MINUTE_MS) return false;
  return creditsUsedInWindow + n > CREDITS_PER_MINUTE;
}

/** Check whether Twelve Data credits are currently rate-limited. */
export function isQuotaExhausted(): boolean {
  return Date.now() < quotaExhaustedUntil;
}

/** Return the unix-ms timestamp when quota backoff expires, or 0 if not in backoff. */
export function getQuotaResumeTime(): number {
  return quotaExhaustedUntil;
}

// ── API call log (persisted to database) ──
export interface ApiCallLogEntry {
  timestamp: string;
  endpoint: string;
  symbols: string | string[];
  credits: number;
  purpose: string;
  status: 'ok' | 'error' | 'rate-limited' | 'http-429' | 'api-error' | 'skipped';
  detail?: string;
}

// Cache the logging-enabled flag so we don't hit the DB on every call
let _loggingEnabled: boolean | null = null;
async function isLoggingEnabled(): Promise<boolean> {
  if (_loggingEnabled !== null) return _loggingEnabled;
  try {
    const { prisma } = await import('@/lib/db');
    const s = await prisma.appSettings.findFirst();
    _loggingEnabled = s?.apiLoggingEnabled ?? true;
  } catch { _loggingEnabled = true; }
  return _loggingEnabled;
}

/** Call this when the setting changes to update the cache immediately. */
export function setLoggingEnabledCache(enabled: boolean) {
  _loggingEnabled = enabled;
}

function logApiCall(entry: ApiCallLogEntry) {
  // Fire-and-forget DB write
  void (async () => {
    if (!(await isLoggingEnabled())) return;
    try {
      const { prisma } = await import('@/lib/db');
      const symbols = Array.isArray(entry.symbols) ? entry.symbols.join(',') : entry.symbols;
      await prisma.apiCallLog.create({
        data: {
          timestamp: new Date(entry.timestamp),
          endpoint: entry.endpoint,
          symbols,
          credits: entry.credits,
          purpose: entry.purpose,
          status: entry.status,
          detail: entry.detail ?? null,
        },
      });
    } catch (err) {
      console.error('[ApiLog] Failed to persist:', err);
    }
  })();
}

/** Get the API call log (newest first). */
export async function getApiCallLog(limit = 500): Promise<ApiCallLogEntry[]> {
  const { prisma } = await import('@/lib/db');
  const rows = await prisma.apiCallLog.findMany({
    orderBy: { timestamp: 'desc' },
    take: limit,
  });
  return rows.map((r) => ({
    timestamp: r.timestamp.toISOString(),
    endpoint: r.endpoint,
    symbols: r.symbols,
    credits: r.credits,
    purpose: r.purpose,
    status: r.status as ApiCallLogEntry['status'],
    detail: r.detail ?? undefined,
  }));
}

/** Delete all log entries from the database. */
export async function clearApiCallLog(): Promise<void> {
  const { prisma } = await import('@/lib/db');
  await prisma.apiCallLog.deleteMany();
}

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

  // Skip if we're in rate-limit backoff
  if (Date.now() < quotaExhaustedUntil) {
    const waitSec = Math.round((quotaExhaustedUntil - Date.now()) / 1000);
    console.log(`[TwelveData] Rate-limit backoff active, skipping candle fetch (${waitSec}s remaining)`);
    logApiCall({ timestamp: new Date().toISOString(), endpoint: '/time_series', symbols, credits: 0, purpose: `Candles ${interval} (${outputsize} bars)`, status: 'skipped', detail: `Rate-limited, ${waitSec}s remaining` });
    return new Map();
  }

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
        quotaExhaustedUntil = Date.now() + RATE_LIMIT_BACKOFF_MS;
        console.warn(`[TwelveData] Rate limited — backing off 60s until ${new Date(quotaExhaustedUntil).toISOString()}`);
        logApiCall({ timestamp: new Date().toISOString(), endpoint: '/time_series', symbols, credits: 0, purpose: `Candles ${interval} (${outputsize} bars)`, status: 'rate-limited', detail: 'HTTP 429' });
        return new Map();
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

      // API-level error (e.g. missing key or quota exhausted in response body)
      if (data.code && data.status === 'error') {
        console.error(`[TwelveData] API error: ${data.message}`);
        if (data.code === 429) {
          quotaExhaustedUntil = Date.now() + RATE_LIMIT_BACKOFF_MS;
          console.warn(`[TwelveData] Rate limited (response body) — backing off 60s until ${new Date(quotaExhaustedUntil).toISOString()}`);
        }
        return new Map();
      }

      // Record credits: 1 per symbol in the batch
      recordCredits(symbols.length);

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

      logApiCall({ timestamp: new Date().toISOString(), endpoint: '/time_series', symbols, credits: symbols.length, purpose: `Candles ${interval} (${outputsize} bars)`, status: 'ok', detail: `${result.size}/${symbols.length} symbols returned` });
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
async function twelveDataFetch<T>(endpoint: string, params: Record<string, string> = {}, purpose = ''): Promise<T | null> {
  const symbol = params.symbol || '';
  // Skip if we're in rate-limit backoff
  if (Date.now() < quotaExhaustedUntil) {
    const waitSec = Math.round((quotaExhaustedUntil - Date.now()) / 1000);
    console.log(`[TwelveData] Rate-limit backoff active, skipping ${endpoint} (${waitSec}s remaining)`);
    logApiCall({ timestamp: new Date().toISOString(), endpoint, symbols: symbol, credits: 0, purpose, status: 'rate-limited', detail: `Backoff ${waitSec}s remaining` });
    return null;
  }

  // Pre-check: would this call exceed our per-minute budget?
  if (wouldExceedRateLimit(1)) {
    console.log(`[TwelveData] Skipping ${endpoint} — would exceed ${CREDITS_PER_MINUTE} credits/min`);
    logApiCall({ timestamp: new Date().toISOString(), endpoint, symbols: symbol, credits: 0, purpose, status: 'rate-limited', detail: `Would exceed ${CREDITS_PER_MINUTE} credits/min` });
    return null;
  }

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
        quotaExhaustedUntil = Date.now() + RATE_LIMIT_BACKOFF_MS;
        console.warn(`[TwelveData] Rate limited on ${endpoint} — backing off 60s until ${new Date(quotaExhaustedUntil).toISOString()}`);
        logApiCall({ timestamp: new Date().toISOString(), endpoint, symbols: symbol, credits: 0, purpose, status: 'http-429', detail: 'Rate limited — backing off 60s' });
        return null;
      }
      if (!res.ok) {
        console.error(`[TwelveData] HTTP ${res.status} on ${endpoint}: ${res.statusText}`);
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
          continue;
        }
        logApiCall({ timestamp: new Date().toISOString(), endpoint, symbols: symbol, credits: 0, purpose, status: 'error', detail: `HTTP ${res.status} ${res.statusText}` });
        return null;
      }
      recordCredits(1);
      const data = await res.json();
      if (data.code && data.status === 'error') {
        console.error(`[TwelveData] API error on ${endpoint}: ${data.message}`);
        if (data.code === 429) {
          quotaExhaustedUntil = Date.now() + RATE_LIMIT_BACKOFF_MS;
          console.warn(`[TwelveData] Rate limited on ${endpoint} (response body) — backing off 60s until ${new Date(quotaExhaustedUntil).toISOString()}`);
        }
        logApiCall({ timestamp: new Date().toISOString(), endpoint, symbols: symbol, credits: 1, purpose, status: 'api-error', detail: data.message });
        return null;
      }
      logApiCall({ timestamp: new Date().toISOString(), endpoint, symbols: symbol, credits: 1, purpose, status: 'ok', detail: '' });
      return data as T;
    } catch (err) {
      console.error(`[TwelveData] Network error on ${endpoint}, attempt ${attempt}:`, err);
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
        continue;
      }
    }
  }
  logApiCall({ timestamp: new Date().toISOString(), endpoint, symbols: symbol, credits: 0, purpose, status: 'error', detail: 'All retries exhausted' });
  return null;
}

/**
 * Fetch real-time quote for a symbol. 1 credit per call.
 */
export async function getQuote(symbol: string): Promise<TwelveDataQuote | null> {
  return twelveDataFetch<TwelveDataQuote>('/quote', { symbol }, 'Quote');
}

/**
 * Fetch company profile. 1 credit per call.
 */
export async function getProfile(symbol: string): Promise<TwelveDataProfile | null> {
  return twelveDataFetch<TwelveDataProfile>('/profile', { symbol }, 'Company profile');
}

/**
 * Fetch stock statistics (shares outstanding, float, short interest). 1 credit per call.
 */
export async function getStatistics(symbol: string): Promise<TwelveDataStatistics | null> {
  return twelveDataFetch<TwelveDataStatistics>('/statistics', { symbol }, 'Statistics');
}

/**
 * Search for symbols. Free — 0 credits.
 */
export async function searchSymbols(query: string): Promise<TwelveDataSymbolSearchResult | null> {
  return twelveDataFetch<TwelveDataSymbolSearchResult>('/symbol_search', {
    symbol: query,
    show_plan: 'false',
  }, 'Symbol search (free)');
}
