/**
 * FMP (Financial Modeling Prep) Top Movers
 *
 * Fetches the biggest daily gainers via /stable/gainers and returns
 * the top N symbols, filtered to standard US tickers on major exchanges.
 */

export interface ScreenedTicker {
  symbol: string;
  name: string;
}

interface FMPGainerResult {
  symbol: string;
  name: string;
  change: number;
  price: number;
  changesPercentage: number;
}

const TICKER_RE = /^[A-Z]{1,5}$/;

export async function screenFMP(topN: number): Promise<ScreenedTicker[]> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) throw new Error('Missing FMP_API_KEY env var');

  const url = `https://financialmodelingprep.com/stable/biggest-gainers?apikey=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`FMP gainers request failed (${res.status}): ${text}`);
  }

  const data: FMPGainerResult[] = await res.json();

  const filtered = data
    .filter((r) => TICKER_RE.test(r.symbol))
    .slice(0, topN)
    .map((r) => ({ symbol: r.symbol, name: r.name }));

  return filtered;
}
