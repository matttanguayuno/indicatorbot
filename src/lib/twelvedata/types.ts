/** Typed response shapes from the Twelve Data API */

export interface TwelveDataMeta {
  symbol: string;
  interval: string;
  currency: string;
  exchange_timezone: string;
  exchange: string;
  mic_code: string;
  type: string;
}

export interface TwelveDataValue {
  datetime: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  previous_close?: string;
}

/** Single-symbol time_series response */
export interface TwelveDataTimeSeries {
  meta: TwelveDataMeta;
  values: TwelveDataValue[];
  status: string;
}

/** Batch response: keyed by symbol name */
export type TwelveDataBatchResponse = Record<string, TwelveDataTimeSeries>;

/** /quote endpoint response */
export interface TwelveDataQuote {
  symbol: string;
  name: string;
  exchange: string;
  datetime: string;
  timestamp: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  previous_close: string;
  change: string;
  percent_change: string;
  is_market_open: boolean;
  fifty_two_week?: { low: string; high: string };
}

/** /profile endpoint response */
export interface TwelveDataProfile {
  symbol: string;
  name: string;
  exchange: string;
  sector: string;
  industry: string;
  employees: number;
  website: string;
  description: string;
  type: string;
  CEO: string;
  address: string;
  city: string;
  zip: string;
  state: string;
  country: string;
  phone: string;
}

/** /statistics endpoint response */
export interface TwelveDataStatistics {
  statistics: {
    valuations_metrics: {
      market_capitalization: number;
      enterprise_value: number;
      trailing_pe: number;
      forward_pe: number;
      peg_ratio: number;
      price_to_sales_ttm: number;
      price_to_book_mrq: number;
      enterprise_to_revenue: number;
      enterprise_to_ebitda: number;
    };
    financials: Record<string, unknown>;
    stock_statistics: {
      shares_outstanding: number;
      float_shares: number;
      avg_10_volume: number;
      avg_30_volume: number;
      shares_short: number;
      short_ratio: number;
      short_percent_of_shares_outstanding: number;
      percent_held_by_insiders: number;
      percent_held_by_institutions: number;
    };
    stock_price_summary: Record<string, unknown>;
    dividends_and_splits: Record<string, unknown>;
  };
}

/** /symbol_search endpoint response */
export interface TwelveDataSymbolSearchResult {
  data: Array<{
    symbol: string;
    instrument_name: string;
    exchange: string;
    mic_code: string;
    exchange_timezone: string;
    instrument_type: string;
    country: string;
    currency: string;
  }>;
  status: string;
}
