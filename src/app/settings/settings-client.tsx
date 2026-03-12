'use client';

import { useEffect, useState, useCallback } from 'react';
import { TickerSearch } from '@/components/ticker-search';
import { RulesClient } from '@/app/rules/rules-client';

interface Settings {
  id: number;
  scoreThreshold: number;
  watchlistThreshold: number;
  alertCooldownMin: number;
  pollingIntervalSec: number;
  dataSource: string;
  screenerTopN: number;
  twelveDataExhausted?: boolean;
  twelveDataResumesAt?: string | null;
}

interface TickerData {
  id: number;
  symbol: string;
  name: string | null;
  active: boolean;
}

export function SettingsClient() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [tickers, setTickers] = useState<TickerData[]>([]);
  const [saving, setSaving] = useState(false);
  const [pollStatus, setPollStatus] = useState<string | null>(null);
  const [pollLoading, setPollLoading] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [syncLoading, setSyncLoading] = useState(false);

  const loadData = useCallback(async () => {
    const [settingsRes, tickersRes] = await Promise.all([
      fetch('/api/settings'),
      fetch('/api/tickers'),
    ]);
    if (settingsRes.ok) setSettings(await settingsRes.json());
    if (tickersRes.ok) setTickers(await tickersRes.json());
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Re-check quota status every 30s when using Twelve Data
  useEffect(() => {
    if (!settings || settings.dataSource !== 'twelvedata') return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch('/api/settings');
        if (res.ok) {
          const data = await res.json();
          setSettings((prev) => prev ? { ...prev, twelveDataExhausted: data.twelveDataExhausted, twelveDataResumesAt: data.twelveDataResumesAt } : prev);
        }
      } catch { /* ignore */ }
    }, 30_000);
    return () => clearInterval(timer);
  }, [settings?.dataSource]);

  async function saveSettings() {
    if (!settings) return;
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scoreThreshold: settings.scoreThreshold,
          watchlistThreshold: settings.watchlistThreshold,
          alertCooldownMin: settings.alertCooldownMin,
          pollingIntervalSec: settings.pollingIntervalSec,
          dataSource: settings.dataSource,
          screenerTopN: settings.screenerTopN,
        }),
      });
      if (res.ok) setSettings(await res.json());
    } catch (err) {
      console.error('Failed to save settings:', err);
    } finally {
      setSaving(false);
    }
  }

  async function addTicker(symbol: string, name: string) {
    try {
      const res = await fetch('/api/tickers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: symbol.trim(), name }),
      });
      if (res.ok) {
        loadData();
      }
    } catch (err) {
      console.error('Failed to add ticker:', err);
    }
  }

  async function removeTicker(symbol: string) {
    try {
      await fetch(`/api/tickers?symbol=${encodeURIComponent(symbol)}`, { method: 'DELETE' });
      loadData();
    } catch (err) {
      console.error('Failed to remove ticker:', err);
    }
  }

  async function triggerPoll() {
    setPollLoading(true);
    setPollStatus(null);
    try {
      const res = await fetch('/api/poll', {
        method: 'POST',
      });
      const data = await res.json();
      if (res.ok) {
        let status = `Processed ${data.processed}: ${data.succeeded} ok, ${data.failed} failed`;
        status += ` | Source: ${data.dataSource} | Candles: ${data.candlesAvailable}/${data.processed}`;
        if (data.candleError) {
          status += `\n⚠ ${data.candleError}`;
        }
        // Show per-symbol candle counts for diagnostics
        const withCandles = (data.results || []).filter((r: { candleCount?: number }) => (r.candleCount ?? 0) > 0);
        if (withCandles.length > 0) {
          status += `\n✓ Candle data: ${withCandles.map((r: { symbol: string; candleCount: number }) => `${r.symbol}(${r.candleCount})`).join(', ')}`;
        }
        setPollStatus(status);
      } else {
        setPollStatus(`Error: ${data.error}`);
      }
    } catch (err) {
      setPollStatus('Network error');
      console.error(err);
    } finally {
      setPollLoading(false);
    }
  }

  return (
    <div className="pt-4 space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
      {/* App Settings */}
      {settings && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-4">
          <h2 className="text-sm font-semibold text-gray-400">Alert & Polling Config</h2>

          <div className="flex items-center justify-between">
            <label className="text-sm text-gray-300">Data Source</label>
            <select
              value={settings.dataSource}
              onChange={(e) => setSettings({ ...settings, dataSource: e.target.value })}
              className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200"
            >
              <option value="finnhub">Finnhub (Quote Only)</option>
              <option value="twelvedata">Twelve Data (Intraday Candles)</option>
              <option value="polygon">Polygon (Daily Only)</option>
            </select>
          </div>
          {settings.dataSource === 'twelvedata' && (
            <p className="text-xs text-gray-500 -mt-2">
              Uses 1-min candles for 5m/15m/1h momentum, RVOL, and VWAP. Grow plan: 55 credits/min.
            </p>
          )}
          {settings.dataSource === 'twelvedata' && settings.twelveDataExhausted && (
            <div className="bg-yellow-900/40 border border-yellow-700 rounded p-2.5 -mt-1">
              <p className="text-xs text-yellow-300 font-semibold">⚠ Twelve Data rate-limited — auto-fallback to Finnhub active</p>
              <p className="text-xs text-yellow-400/80 mt-0.5">
                Polling is using Finnhub as a temporary fallback until the per-minute rate limit resets.
                {settings.twelveDataResumesAt && (
                  <> Estimated resume: {new Date(settings.twelveDataResumesAt).toLocaleTimeString()}.</>
                )}
              </p>
            </div>
          )}
          {settings.dataSource === 'polygon' && (
            <p className="text-xs text-yellow-500/70 -mt-2">
              Free tier does not support intraday candles. Falls back to quote-only scoring.
            </p>
          )}

          <SettingInput
            label="Alert Threshold"
            value={settings.scoreThreshold}
            onChange={(v) => setSettings({ ...settings, scoreThreshold: v })}
            min={0}
            max={100}
          />
          <SettingInput
            label="Watchlist Threshold"
            value={settings.watchlistThreshold}
            onChange={(v) => setSettings({ ...settings, watchlistThreshold: v })}
            min={0}
            max={100}
          />
          <SettingInput
            label="Alert Cooldown (min)"
            value={settings.alertCooldownMin}
            onChange={(v) => setSettings({ ...settings, alertCooldownMin: v })}
            min={1}
            max={1440}
          />
          <SettingInput
            label="Polling Interval (sec)"
            value={settings.pollingIntervalSec}
            onChange={(v) => setSettings({ ...settings, pollingIntervalSec: v })}
            min={10}
            max={3600}
          />
          <SettingInput
            label="Screener Top N"
            value={settings.screenerTopN}
            onChange={(v) => setSettings({ ...settings, screenerTopN: v })}
            min={1}
            max={200}
          />
          <p className="text-xs text-gray-500 -mt-2">
            Number of stocks to pull from the FMP screener. Syncs at 6:30 AM, 10 AM, 1 PM MT.
          </p>

          <button
            onClick={saveSettings}
            disabled={saving}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 text-sm py-2 rounded transition-colors"
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      )}

      {/* Watchlist */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <h2 className="text-sm font-semibold text-gray-400 mb-3">Watchlist</h2>

        <div className="mb-3">
          <TickerSearch
            onAdd={addTicker}
            existingSymbols={tickers.filter((t) => t.active).map((t) => t.symbol)}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          {tickers.map((t) => (
            <span
              key={t.id}
              className={`flex items-center gap-1 text-sm px-2.5 py-1.5 rounded ${
                t.active ? 'bg-gray-800 text-gray-200' : 'bg-gray-800/50 text-gray-500 line-through'
              }`}
            >
              {t.symbol}
              {t.name && <span className="text-gray-500 ml-0.5">({t.name.slice(0, 15)})</span>}
              {t.active && (
                <button
                  onClick={() => removeTicker(t.symbol)}
                  className="text-gray-500 hover:text-red-400 ml-1"
                >
                  ×
                </button>
              )}
            </span>
          ))}
          {tickers.length === 0 && (
            <span className="text-gray-500 text-sm">No tickers — search above to add stocks</span>
          )}
        </div>
      </div>

      {/* Screener Sync */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <h2 className="text-sm font-semibold text-gray-400 mb-3">Screener Sync</h2>
        <p className="text-sm text-gray-500 mb-3">
          Run the FMP screener and replace your watchlist with the top results.
        </p>
        <button
          onClick={async () => {
            setSyncLoading(true);
            setSyncStatus(null);
            try {
              const res = await fetch('/api/screener/sync', { method: 'POST' });
              const data = await res.json();
              if (res.ok) {
                setSyncStatus(`Synced ${data.total} tickers (${data.added} new). Symbols: ${data.symbols?.join(', ')}`);
                loadData();
              } else {
                setSyncStatus(`Error: ${data.error}`);
              }
            } catch {
              setSyncStatus('Network error');
            } finally {
              setSyncLoading(false);
            }
          }}
          disabled={syncLoading}
          className="w-full bg-emerald-700 hover:bg-emerald-600 disabled:bg-gray-700 text-sm py-2 rounded transition-colors"
        >
          {syncLoading ? 'Syncing...' : 'Sync Now'}
        </button>
        {syncStatus && (
          <div className="text-sm text-gray-400 mt-2 whitespace-pre-line">{syncStatus}</div>
        )}
      </div>

      {/* Manual Poll Trigger */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <h2 className="text-sm font-semibold text-gray-400 mb-3">Manual Poll</h2>
        <p className="text-sm text-gray-500 mb-3">
          Scan all watchlist tickers for fresh signals.
        </p>
        <button
          onClick={triggerPoll}
          disabled={pollLoading}
          className="w-full bg-purple-700 hover:bg-purple-600 disabled:bg-gray-700 text-sm py-2 rounded transition-colors"
        >
          {pollLoading ? 'Running...' : 'Run Poll Now'}
        </button>
        {pollStatus && (
          <div className="text-sm text-gray-400 mt-2 whitespace-pre-line">{pollStatus}</div>
        )}
      </div>
      </div>

      <RulesClient />
    </div>
  );
}

function SettingInput({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
}) {
  return (
    <div className="flex items-center justify-between">
      <label className="text-sm text-gray-300">{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => {
          const v = parseInt(e.target.value, 10);
          if (!isNaN(v) && v >= min && v <= max) onChange(v);
        }}
        min={min}
        max={max}
        className="w-24 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200 text-right"
      />
    </div>
  );
}
