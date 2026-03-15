'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { TickerSearch } from '@/components/ticker-search';
import { RulesClient } from '@/app/rules/rules-client';
import { SellRulesClient } from '@/app/rules/sell-rules-client';
import { PushToggle } from '@/components/push-toggle';
import type { PatternConfig } from '@/lib/config/patterns';
import { DEFAULT_PATTERN_CONFIG } from '@/lib/config/patterns';

interface Settings {
  id: number;
  scoreThreshold: number;
  watchlistThreshold: number;
  alertCooldownMin: number;
  pollingIntervalSec: number;
  dataSource: string;
  screenerSource: string;
  screenerTopN: number;
  screenerSyncTimes: string;
  newsSummaryTimes: string;
  sentimentMethod: string;
  patternConfig?: PatternConfig;
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
  const [refreshingNews, setRefreshingNews] = useState(false);
  const [newsRefreshResult, setNewsRefreshResult] = useState<string | null>(null);
  const [testPushLoading, setTestPushLoading] = useState(false);
  const [testPushResult, setTestPushResult] = useState<string | null>(null);
  const [pollStatus, setPollStatus] = useState<string | null>(null);
  const [pollLoading, setPollLoading] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [syncLoading, setSyncLoading] = useState(false);
  const [dismissedRemoved, setDismissedRemoved] = useState(false);
  const [saveConfirm, setSaveConfirm] = useState<string | null>(null);

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
          screenerSource: settings.screenerSource,
          screenerTopN: settings.screenerTopN,
          screenerSyncTimes: settings.screenerSyncTimes,
          newsSummaryTimes: settings.newsSummaryTimes,
          patternConfig: settings.patternConfig,
        }),
      });
      if (res.ok) setSettings(await res.json());
      setSaveConfirm('Settings saved');
      setTimeout(() => setSaveConfirm(null), 3000);
    } catch (err) {
      console.error('Failed to save settings:', err);
    } finally {
      setSaving(false);
    }
  }

  async function saveScreenerSource(source: string) {
    try {
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ screenerSource: source }),
      });
    } catch { /* ignore */ }
  }

  async function saveSentimentMethod(method: string) {
    try {
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sentimentMethod: method }),
      });
      setSaveConfirm(method === 'off' ? 'Sentiment scoring disabled' : `Sentiment switched to ${method} — rescoring news…`);
      setTimeout(() => setSaveConfirm(null), 4000);
    } catch { /* ignore */ }
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
          {settings.screenerSource !== 'webull' && (
            <>
              <SettingInput
                label="Screener Top N"
                value={settings.screenerTopN}
                onChange={(v) => setSettings({ ...settings, screenerTopN: v })}
                min={1}
                max={200}
              />
              <p className="text-xs text-gray-500 -mt-2">
                Number of top movers to pull from FMP.
              </p>

              <div className="flex items-center justify-between">
                <label className="text-sm text-gray-300">Sync Times (MT)</label>
                <input
                  type="text"
                  value={settings.screenerSyncTimes}
                  onChange={(e) => setSettings({ ...settings, screenerSyncTimes: e.target.value })}
                  placeholder="06:30,10:00,13:00"
                  className="w-40 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200 text-right"
                />
              </div>
              <p className="text-xs text-gray-500 -mt-2">
                Comma-separated HH:MM times in Mountain Time for auto-syncing top movers.
              </p>
            </>
          )}

          <div className="flex items-center justify-between">
            <label className="text-sm text-gray-300">News Summary (MT)</label>
            <input
              type="text"
              value={settings.newsSummaryTimes}
              onChange={(e) => setSettings({ ...settings, newsSummaryTimes: e.target.value })}
              placeholder="09:30,12:00"
              className="w-40 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200 text-right"
            />
          </div>
          <p className="text-xs text-gray-500 -mt-2">
            Comma-separated HH:MM times in Mountain Time for auto-generating AI news summaries.
          </p>

          <div className="flex items-center justify-between">
            <label className="text-sm text-gray-300">News Sentiment</label>
            <div className="flex rounded overflow-hidden border border-gray-700">
              {(['keyword', 'ai', 'off'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => { setSettings({ ...settings, sentimentMethod: m }); saveSentimentMethod(m); }}
                  className={`px-3 py-1 text-sm transition-colors ${
                    settings.sentimentMethod === m
                      ? 'bg-emerald-700 text-white'
                      : 'bg-gray-800 text-gray-400 hover:text-gray-200'
                  }`}
                >
                  {m === 'keyword' ? 'Keyword' : m === 'ai' ? 'AI' : 'Off'}
                </button>
              ))}
            </div>
          </div>
          <p className="text-xs text-gray-500 -mt-2">
            Keyword = free pattern matching only. AI = keyword instantly + GPT-4o-mini upgrade at news summary times. Off = no scoring.
          </p>

          <button
            onClick={saveSettings}
            disabled={saving}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 text-sm py-2 rounded transition-colors"
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
          {saveConfirm && (
            <p className="text-xs text-green-400 text-center">{saveConfirm}</p>
          )}

          <button
            onClick={async () => {
              setRefreshingNews(true);
              try {
                const res = await fetch('/api/news/summary', { method: 'POST' });
                if (res.ok) {
                  setNewsRefreshResult('News summary generated successfully.');
                } else {
                  const data = await res.json().catch(() => ({}));
                  setNewsRefreshResult(data.error || 'Failed to generate summary.');
                }
              } catch {
                setNewsRefreshResult('Network error — could not reach the server.');
              } finally {
                setRefreshingNews(false);
                setTimeout(() => setNewsRefreshResult(null), 5000);
              }
            }}
            disabled={refreshingNews}
            className="w-full bg-gray-800 hover:bg-gray-700 disabled:bg-gray-800 disabled:text-gray-500 border border-gray-700 text-sm py-2 rounded transition-colors"
          >
            {refreshingNews ? '⏳ Generating…' : '📰 Refresh News Summary Now'}
          </button>
          {newsRefreshResult && (
            <p className={`text-xs ${newsRefreshResult.includes('success') ? 'text-green-400' : 'text-red-400'}`}>
              {newsRefreshResult}
            </p>
          )}
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
          {tickers.filter((t) => t.active).map((t) => (
            <span
              key={t.id}
              className="flex items-center gap-1 text-sm px-2.5 py-1.5 rounded bg-gray-800 text-gray-200"
            >
              {t.symbol}
              {t.name && <span className="text-gray-500 ml-0.5">({t.name.slice(0, 15)})</span>}
              <button
                onClick={() => removeTicker(t.symbol)}
                className="text-gray-500 hover:text-red-400 ml-1"
              >
                ×
              </button>
            </span>
          ))}
          {tickers.filter((t) => t.active).length === 0 && (
            <span className="text-gray-500 text-sm">No tickers — search above to add stocks</span>
          )}
        </div>

        {!dismissedRemoved && tickers.filter((t) => !t.active).length > 0 && (
          <div className="mt-3 pt-3 border-t border-gray-800">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-500">Removed by sync — click to re-add</span>
              <button
                onClick={async () => {
                  const inactiveSymbols = tickers.filter((t) => !t.active).map((t) => t.symbol);
                  await Promise.all(inactiveSymbols.map((s) =>
                    fetch(`/api/tickers?symbol=${encodeURIComponent(s)}`, { method: 'DELETE' }).catch(() => {})
                  ));
                  loadData();
                }}
                className="text-xs text-gray-600 hover:text-gray-400"
              >
                Dismiss
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {tickers.filter((t) => !t.active).map((t) => (
                <button
                  key={t.id}
                  onClick={() => addTicker(t.symbol, t.name || '')}
                  className="text-sm px-2.5 py-1.5 rounded bg-gray-800/50 text-gray-500 line-through hover:bg-gray-800 hover:text-gray-300 hover:no-underline transition-colors"
                >
                  {t.symbol}
                  {t.name && <span className="text-gray-600 ml-0.5">({t.name.slice(0, 15)})</span>}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Screener Sync */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <h2 className="text-sm font-semibold text-gray-400 mb-3">Top Movers Sync</h2>

        {/* Source toggle */}
        {settings && (
          <div className="flex items-center gap-2 mb-3">
            <span className="text-sm text-gray-300">Source:</span>
            <div className="flex rounded overflow-hidden border border-gray-700">
              <button
                onClick={() => { setSettings({ ...settings, screenerSource: 'fmp' }); setSyncStatus(null); saveScreenerSource('fmp'); }}
                className={`px-3 py-1 text-sm transition-colors ${settings.screenerSource === 'fmp' ? 'bg-emerald-700 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}`}
              >
                FMP
              </button>
              <button
                onClick={() => { setSettings({ ...settings, screenerSource: 'webull' }); setSyncStatus(null); saveScreenerSource('webull'); }}
                className={`px-3 py-1 text-sm transition-colors ${settings.screenerSource === 'webull' ? 'bg-emerald-700 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}`}
              >
                Webull
              </button>
            </div>
          </div>
        )}

        {settings?.screenerSource === 'webull' ? (
          <WebullUpload onSynced={() => { loadData(); setDismissedRemoved(false); }} />
        ) : (
          <>
            <p className="text-sm text-gray-500 mb-3">
              Pull the top daily gainers from FMP and update your watchlist.
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
                    setDismissedRemoved(false);
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
          </>
        )}
        {syncStatus && (
          <div className="text-sm text-gray-400 mt-2 whitespace-pre-line">{syncStatus}</div>
        )}
      </div>

      {/* Push Notifications */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <h2 className="text-sm font-semibold text-gray-400 mb-3">Push Notifications</h2>
        <p className="text-sm text-gray-500 mb-3">
          Get notified on your phone when a signal alert fires.
        </p>
        <PushToggle />
        <button
          onClick={async () => {
            setTestPushLoading(true);
            setTestPushResult(null);
            try {
              const res = await fetch('/api/push/test', { method: 'POST' });
              if (res.ok) {
                setTestPushResult('Test notification sent!');
              } else {
                const data = await res.json().catch(() => ({}));
                setTestPushResult(data.error || 'Failed to send test notification.');
              }
            } catch {
              setTestPushResult('Network error — could not reach the server.');
            } finally {
              setTestPushLoading(false);
              setTimeout(() => setTestPushResult(null), 5000);
            }
          }}
          disabled={testPushLoading}
          className="w-full mt-3 bg-gray-800 hover:bg-gray-700 disabled:bg-gray-800 disabled:text-gray-500 border border-gray-700 text-sm py-2 rounded transition-colors"
        >
          {testPushLoading ? '⏳ Sending…' : '🔔 Send Test Notification'}
        </button>
        {testPushResult && (
          <p className={`text-xs mt-2 ${testPushResult.includes('sent') ? 'text-green-400' : 'text-red-400'}`}>
            {testPushResult}
          </p>
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

      {/* Pattern Detection Config */}
      {settings && <PatternSettingsSection settings={settings} setSettings={setSettings} />}

      <RulesClient />

      <SellRulesClient />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pattern Detection Settings
// ---------------------------------------------------------------------------

const PATTERN_LABELS: Record<keyof PatternConfig, string> = {
  volumeBreakout: 'Volume Breakout',
  consolidationBreakout: 'Consolidation Breakout',
  bullFlag: 'Bull Flag',
  ascendingTriangle: 'Ascending Triangle',
  channelBreakout: 'Channel Breakout',
  doubleBottom: 'Double Bottom',
  insideBarBreakout: 'Inside Bar Breakout',
  vwapReclaim: 'VWAP Reclaim',
  symmetricalTriangle: 'Symmetrical Triangle',
  bullishEngulfing: 'Bullish Engulfing',
  morningStar: 'Morning Star',
  hammer: 'Hammer / Inv. Hammer',
  emaCrossover: 'EMA Crossover',
  bollingerSqueeze: 'BB Squeeze Breakout',
  gapAndGo: 'Gap & Go',
  cupAndHandle: 'Cup & Handle',
  fallingWedge: 'Falling Wedge',
};

type PatternKey = keyof PatternConfig;

interface PatternFieldDef {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  suffix?: string;
}

const PATTERN_FIELDS: Record<PatternKey, PatternFieldDef[]> = {
  volumeBreakout: [
    { key: 'lookback', label: 'Lookback', min: 5, max: 100, step: 1, suffix: 'bars' },
    { key: 'volumeRatio', label: 'Volume Ratio', min: 1, max: 5, step: 0.1, suffix: '×' },
    { key: 'confirmationBars', label: 'Confirmation Bars', min: 1, max: 5, step: 1 },
  ],
  consolidationBreakout: [
    { key: 'lookback', label: 'Lookback', min: 10, max: 100, step: 1, suffix: 'bars' },
    { key: 'bbPeriod', label: 'BB Period', min: 5, max: 50, step: 1 },
    { key: 'contractionPct', label: 'Contraction', min: 10, max: 80, step: 5, suffix: '%' },
    { key: 'volumeRatio', label: 'Volume Ratio', min: 1, max: 5, step: 0.1, suffix: '×' },
  ],
  bullFlag: [
    { key: 'lookback', label: 'Lookback', min: 15, max: 120, step: 1, suffix: 'bars' },
    { key: 'poleMinGainPct', label: 'Pole Min Gain', min: 1, max: 30, step: 0.5, suffix: '%' },
    { key: 'poleLenMin', label: 'Pole Len Min', min: 3, max: 30, step: 1, suffix: 'bars' },
    { key: 'poleLenMax', label: 'Pole Len Max', min: 5, max: 50, step: 1, suffix: 'bars' },
    { key: 'maxRetracePct', label: 'Max Retrace', min: 10, max: 80, step: 5, suffix: '%' },
    { key: 'minFlagBars', label: 'Min Flag Bars', min: 1, max: 20, step: 1 },
    { key: 'maxFlagBars', label: 'Max Flag Bars', min: 3, max: 40, step: 1 },
    { key: 'volumeRatio', label: 'Volume Ratio', min: 1, max: 5, step: 0.1, suffix: '×' },
  ],
  ascendingTriangle: [
    { key: 'lookback', label: 'Lookback', min: 20, max: 150, step: 1, suffix: 'bars' },
    { key: 'resistanceTolerance', label: 'Resistance Tol.', min: 0.001, max: 0.01, step: 0.001 },
    { key: 'minTouches', label: 'Min Touches', min: 2, max: 10, step: 1 },
    { key: 'minR2', label: 'Min R²', min: 0.1, max: 1, step: 0.05 },
    { key: 'volumeRatio', label: 'Volume Ratio', min: 1, max: 5, step: 0.1, suffix: '×' },
  ],
  channelBreakout: [
    { key: 'lookback', label: 'Lookback', min: 20, max: 150, step: 1, suffix: 'bars' },
    { key: 'minR2', label: 'Min R²', min: 0.1, max: 1, step: 0.05 },
    { key: 'slopeParallelismPct', label: 'Parallelism', min: 5, max: 50, step: 5, suffix: '%' },
    { key: 'minSwingPoints', label: 'Min Swing Pts', min: 2, max: 10, step: 1 },
    { key: 'volumeRatio', label: 'Volume Ratio', min: 1, max: 5, step: 0.1, suffix: '×' },
  ],
  doubleBottom: [
    { key: 'lookback', label: 'Lookback', min: 15, max: 150, step: 1, suffix: 'bars' },
    { key: 'priceTolerance', label: 'Price Tol.', min: 0.001, max: 0.02, step: 0.001 },
    { key: 'minSeparation', label: 'Min Separation', min: 3, max: 30, step: 1, suffix: 'bars' },
    { key: 'volumeRatio', label: 'Volume Ratio', min: 1, max: 5, step: 0.1, suffix: '×' },
  ],
  insideBarBreakout: [
    { key: 'minInsideBars', label: 'Min Inside Bars', min: 1, max: 10, step: 1 },
  ],
  vwapReclaim: [
    { key: 'lookback', label: 'Lookback', min: 5, max: 100, step: 1, suffix: 'bars' },
    { key: 'minDipPct', label: 'Min Dip', min: 0.1, max: 3, step: 0.1, suffix: '%' },
    { key: 'volumeRatio', label: 'Volume Ratio', min: 1, max: 5, step: 0.1, suffix: '×' },
  ],
  symmetricalTriangle: [
    { key: 'lookback', label: 'Lookback', min: 20, max: 150, step: 1, suffix: 'bars' },
    { key: 'minR2', label: 'Min R²', min: 0.1, max: 1, step: 0.05 },
    { key: 'minSwingPoints', label: 'Min Swing Pts', min: 2, max: 10, step: 1 },
    { key: 'volumeRatio', label: 'Volume Ratio', min: 1, max: 5, step: 0.1, suffix: '×' },
  ],
  bullishEngulfing: [
    { key: 'volumeRatio', label: 'Volume Ratio', min: 1, max: 5, step: 0.1, suffix: '×' },
  ],
  morningStar: [
    { key: 'volumeRatio', label: 'Volume Ratio', min: 1, max: 5, step: 0.1, suffix: '×' },
  ],
  hammer: [
    { key: 'maxBodyPct', label: 'Max Body', min: 10, max: 50, step: 5, suffix: '%' },
    { key: 'minWickRatio', label: 'Min Wick Ratio', min: 1, max: 5, step: 0.5, suffix: '×' },
    { key: 'volumeRatio', label: 'Volume Ratio', min: 0.5, max: 5, step: 0.1, suffix: '×' },
  ],
  emaCrossover: [
    { key: 'shortPeriod', label: 'Short EMA', min: 3, max: 50, step: 1 },
    { key: 'longPeriod', label: 'Long EMA', min: 10, max: 200, step: 1 },
  ],
  bollingerSqueeze: [
    { key: 'lookback', label: 'Lookback', min: 15, max: 100, step: 1, suffix: 'bars' },
    { key: 'bbPeriod', label: 'BB Period', min: 5, max: 50, step: 1 },
    { key: 'squeezePercentile', label: 'Squeeze Pctile', min: 5, max: 50, step: 5, suffix: '%' },
    { key: 'volumeRatio', label: 'Volume Ratio', min: 1, max: 5, step: 0.1, suffix: '×' },
  ],
  gapAndGo: [
    { key: 'minGapPct', label: 'Min Gap', min: 0.5, max: 10, step: 0.5, suffix: '%' },
    { key: 'holdBars', label: 'Hold Bars', min: 1, max: 10, step: 1 },
    { key: 'volumeRatio', label: 'Volume Ratio', min: 1, max: 5, step: 0.1, suffix: '×' },
  ],
  cupAndHandle: [
    { key: 'lookback', label: 'Lookback', min: 30, max: 200, step: 5, suffix: 'bars' },
    { key: 'minCupBars', label: 'Min Cup Width', min: 10, max: 50, step: 1, suffix: 'bars' },
    { key: 'maxCupDepthPct', label: 'Max Cup Depth', min: 5, max: 50, step: 5, suffix: '%' },
    { key: 'maxHandleRetracePct', label: 'Max Handle Retrace', min: 10, max: 80, step: 5, suffix: '%' },
  ],
  fallingWedge: [
    { key: 'lookback', label: 'Lookback', min: 20, max: 150, step: 1, suffix: 'bars' },
    { key: 'minR2', label: 'Min R²', min: 0.1, max: 1, step: 0.05 },
    { key: 'minSwingPoints', label: 'Min Swing Pts', min: 2, max: 10, step: 1 },
    { key: 'volumeRatio', label: 'Volume Ratio', min: 1, max: 5, step: 0.1, suffix: '×' },
  ],
};

function PatternSettingsSection({ settings, setSettings }: { settings: Settings; setSettings: (s: Settings) => void }) {
  const [expanded, setExpanded] = useState<PatternKey | null>(null);
  const config = settings.patternConfig ?? DEFAULT_PATTERN_CONFIG;

  function updatePatternField(pattern: PatternKey, field: string, value: number | boolean) {
    const updated = {
      ...config,
      [pattern]: { ...config[pattern], [field]: value },
    };
    setSettings({ ...settings, patternConfig: updated });
  }

  function resetToDefaults() {
    setSettings({ ...settings, patternConfig: { ...DEFAULT_PATTERN_CONFIG } });
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-400">Pattern Detection</h2>
        <button
          onClick={resetToDefaults}
          className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          Reset to defaults
        </button>
      </div>
      <p className="text-xs text-gray-500">
        Enable/disable patterns and tune detection thresholds. Changes take effect on next Save Settings.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-1">
        {(Object.keys(PATTERN_LABELS) as PatternKey[]).map((key) => {
          const patternCfg = config[key] as unknown as Record<string, unknown>;
          const enabled = patternCfg.enabled as boolean;
          const isExpanded = expanded === key;
          const fields = PATTERN_FIELDS[key];

          return (
            <div key={key} className="border border-gray-800 rounded">
              <div className="flex items-center gap-2 px-3 py-2">
                <button
                  onClick={() => updatePatternField(key, 'enabled', !enabled)}
                  className={`w-8 h-4 rounded-full relative transition-colors flex-shrink-0 ${enabled ? 'bg-emerald-600' : 'bg-gray-700'}`}
                >
                  <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${enabled ? 'left-4' : 'left-0.5'}`} />
                </button>
                <button
                  onClick={() => setExpanded(isExpanded ? null : key)}
                  className={`flex-1 text-left text-sm transition-colors ${enabled ? 'text-gray-200' : 'text-gray-500'}`}
                >
                  {PATTERN_LABELS[key]}
                </button>
                <button
                  onClick={() => setExpanded(isExpanded ? null : key)}
                  className="text-gray-500 text-xs"
                >
                  {isExpanded ? '▲' : '▼'}
                </button>
              </div>

              {isExpanded && enabled && (
                <div className="px-3 pb-3 pt-1 space-y-2 border-t border-gray-800">
                  {fields.map((f) => (
                    <div key={f.key} className="flex items-center justify-between">
                      <label className="text-xs text-gray-400">{f.label}</label>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          value={patternCfg[f.key] as number}
                          onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            if (!isNaN(v) && v >= f.min && v <= f.max) {
                              updatePatternField(key, f.key, v);
                            }
                          }}
                          min={f.min}
                          max={f.max}
                          step={f.step}
                          className="w-20 bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-xs text-gray-200 text-right"
                        />
                        {f.suffix && <span className="text-xs text-gray-500 w-8">{f.suffix}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WebullUpload({ onSynced }: { onSynced: () => void }) {
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setUploading(true);
    setResult(null);
    setError(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const res = await fetch('/api/screener/parse-screenshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: dataUrl }),
      });
      const data = await res.json();
      if (res.ok) {
        setResult(`Synced ${data.total} tickers (${data.added} new): ${data.symbols?.join(', ')}`);
        onSynced();
      } else {
        setError(data.error || 'Failed to parse screenshot');
      }
    } catch {
      setError('Network error');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500">
        Upload a screenshot of the Webull top-movers table to sync your watchlist.
      </p>
      <label
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragging(true); }}
        onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setDragging(true); }}
        onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragging(false); }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file && file.type.startsWith('image/')) handleFile(file);
        }}
        className={`flex flex-col items-center justify-center w-full h-28 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${
          uploading ? 'border-gray-700 bg-gray-800/50'
            : dragging ? 'border-emerald-500 bg-emerald-900/20'
            : 'border-gray-700 hover:border-emerald-600 hover:bg-gray-800/30'
        }`}
      >
        <span className="text-sm text-gray-400">
          {uploading ? '⏳ Parsing screenshot…' : dragging ? '📥 Drop image here' : '📸 Click or drag a screenshot'}
        </span>
        <span className="text-xs text-gray-600 mt-1">PNG, JPG — Webull screener table</span>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          disabled={uploading}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
      </label>
      {result && <p className="text-sm text-green-400">{result}</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}
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
