/**
 * FMP (Financial Modeling Prep) Stock Screener
 *
 * Replaces the Webull Playwright scraper with a simple API call.
 * Filters: US stocks, market cap < $500M, volume > 1M, actively trading,
 * excluding ETFs and funds. Only standard ticker symbols on major exchanges.
 */

export interface ScreenedTicker {
  symbol: string;
  name: string;
}

interface FMPScreenerResult {
  symbol: string;
  companyName: string;
  marketCap: number;
  volume: number;
  price: number;
  exchange: string;
  exchangeShortName: string;
  country: string;
  isEtf: boolean;
  isFund: boolean;
  isActivelyTrading: boolean;
}

const VALID_EXCHANGES = new Set(['NYSE', 'NASDAQ', 'AMEX']);
const TICKER_RE = /^[A-Z]{1,5}$/;

export async function screenFMP(topN: number): Promise<ScreenedTicker[]> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) throw new Error('Missing FMP_API_KEY env var');

  const params = new URLSearchParams({
    marketCapLowerThan: '500000000',
    volumeMoreThan: '1000000',
    country: 'US',
    isEtf: 'false',
    isFund: 'false',
    isActivelyTrading: 'true',
    limit: String(Math.min(topN * 2, 200)), // fetch extra to allow filtering
    apikey: apiKey,
  });

  const url = `https://financialmodelingprep.com/stable/company-screener?${params}`;
  const res = await fetch(url);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`FMP screener request failed (${res.status}): ${text}`);
  }

  const data: FMPScreenerResult[] = await res.json();

  const filtered = data
    .filter(
      (r) =>
        VALID_EXCHANGES.has(r.exchangeShortName) &&
        TICKER_RE.test(r.symbol) &&
        r.volume > 0,
    )
    .sort((a, b) => b.volume - a.volume)
    .slice(0, topN)
    .map((r) => ({ symbol: r.symbol, name: r.companyName }));

  return filtered;
}
