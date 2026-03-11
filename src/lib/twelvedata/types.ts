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
