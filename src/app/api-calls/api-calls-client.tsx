'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';

interface LogEntry {
  timestamp: string;
  endpoint: string;
  symbols: string;
  credits: number;
  purpose: string;
  status: string;
  detail: string;
}

const STATUS_COLORS: Record<string, string> = {
  ok: 'text-green-400',
  'rate-limited': 'text-yellow-400',
  'http-429': 'text-red-400',
  'api-error': 'text-red-400',
  error: 'text-red-400',
};

export function ApiCallsClient() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [loggingEnabled, setLoggingEnabled] = useState(true);

  const fetchLog = useCallback(async () => {
    try {
      const res = await fetch('/api/api-calls');
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries ?? []);
        setLoggingEnabled(data.enabled ?? true);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  const toggleLogging = async () => {
    const next = !loggingEnabled;
    setLoggingEnabled(next);
    await fetch('/api/api-calls', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: next }),
    });
  };

  const clearLog = async () => {
    if (!confirm('Clear all API call logs?')) return;
    await fetch('/api/api-calls', { method: 'DELETE' });
    setEntries([]);
  };

  useEffect(() => {
    fetchLog();
  }, [fetchLog]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(fetchLog, 15_000);
    return () => clearInterval(id);
  }, [autoRefresh, fetchLog]);

  const totalCredits = entries.reduce((sum, e) => sum + e.credits, 0);
  const lastMinuteCredits = entries
    .filter((e) => new Date(e.timestamp).getTime() > Date.now() - 60_000)
    .reduce((sum, e) => sum + e.credits, 0);

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-US', {
      timeZone: 'America/Denver',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });

  return (
    <div className="space-y-4 pb-24 overflow-x-hidden">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">API Call Log</h1>
        <div className="flex items-center gap-4">
          <button
            onClick={clearLog}
            className="px-3 py-1 text-sm rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
          >
            Clear
          </button>
          <button
            onClick={toggleLogging}
            className={`px-3 py-1 text-sm rounded font-medium ${
              loggingEnabled
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-400'
            }`}
          >
            {loggingEnabled ? 'Logging On' : 'Logging Off'}
          </button>
          <label className="flex items-center gap-2 text-sm text-zinc-400">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded"
            />
            Auto-refresh
          </label>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="bg-zinc-900 rounded-lg p-3 text-center">
          <div className="text-2xl font-bold">{entries.length}</div>
          <div className="text-xs text-zinc-400">Total Calls</div>
        </div>
        <div className="bg-zinc-900 rounded-lg p-3 text-center">
          <div className="text-2xl font-bold">{totalCredits}</div>
          <div className="text-xs text-zinc-400">Total Credits</div>
        </div>
        <div className="bg-zinc-900 rounded-lg p-3 text-center">
          <div className={`text-2xl font-bold ${lastMinuteCredits > 40 ? 'text-red-400' : lastMinuteCredits > 25 ? 'text-yellow-400' : 'text-green-400'}`}>
            {lastMinuteCredits}
          </div>
          <div className="text-xs text-zinc-400">Last 60s</div>
        </div>
      </div>

      {loading ? (
        <p className="text-zinc-500 text-sm">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-zinc-500 text-sm">No API calls logged yet.</p>
      ) : (
        <>
        <CreditChart entries={entries} />
        <div className="overflow-x-auto -mx-4 px-4">
          <table className="w-full text-sm table-fixed">
            <thead>
              <tr className="text-left text-zinc-400 border-b border-zinc-800">
                <th className="py-2 pr-2 w-[100px]">Time (MT)</th>
                <th className="py-2 pr-2 w-[100px]">Endpoint</th>
                <th className="py-2 pr-2">Symbols</th>
                <th className="py-2 pr-2 w-[50px]">Credits</th>
                <th className="py-2 pr-2 w-[120px]">Purpose</th>
                <th className="py-2 pr-2 w-[60px]">Status</th>
                <th className="py-2 w-[140px]">Detail</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const reversed = [...entries].reverse();
                // Count calls per minute (HH:MM key)
                const minuteCounts = new Map<string, number>();
                for (const e of reversed) {
                  const key = formatTime(e.timestamp).slice(0, 5); // "HH:MM"
                  minuteCounts.set(key, (minuteCounts.get(key) || 0) + 1);
                }
                return reversed.map((e, i) => {
                  const minuteKey = formatTime(e.timestamp).slice(0, 5);
                  const count = minuteCounts.get(minuteKey) || 0;
                  const isBusy = count >= 2;
                  return (
                    <tr key={i} className={`border-b border-zinc-800/50 ${isBusy ? 'bg-amber-900/25' : 'hover:bg-zinc-900/50'}`}>
                      <td className="py-1.5 pr-2 font-mono text-xs whitespace-nowrap">
                        {formatTime(e.timestamp)}
                        {isBusy && <span className="ml-1 text-amber-400 font-semibold" title={`${count} calls this minute`}>×{count}</span>}
                      </td>
                      <td className="py-1.5 pr-2 font-mono text-xs truncate">{e.endpoint}</td>
                      <td className="py-1.5 pr-2 text-xs truncate" title={e.symbols}>{e.symbols}</td>
                      <td className="py-1.5 pr-2 text-xs">{e.credits}</td>
                      <td className="py-1.5 pr-2 text-xs text-zinc-400 truncate">{e.purpose}</td>
                      <td className={`py-1.5 pr-2 text-xs font-medium ${STATUS_COLORS[e.status] || 'text-zinc-400'}`}>{e.status}</td>
                      <td className="py-1.5 text-xs text-zinc-500 truncate" title={e.detail}>{e.detail}</td>
                    </tr>
                  );
                });
              })()}
            </tbody>
          </table>
        </div>
        </>
      )}
    </div>
  );
}

function CreditChart({ entries }: { entries: LogEntry[] }) {
  const data = useMemo(() => {
    // Bucket credits by minute (HH:MM in MT)
    const buckets = new Map<string, number>();
    for (const e of entries) {
      const d = new Date(e.timestamp);
      const key = d.toLocaleTimeString('en-US', {
        timeZone: 'America/Denver',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      buckets.set(key, (buckets.get(key) || 0) + e.credits);
    }
    // Sort chronologically
    return [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([minute, credits]) => ({ minute, credits }));
  }, [entries]);

  if (data.length < 2) return null;

  const maxCredits = Math.max(...data.map((d) => d.credits), 1);
  const LIMIT = 55;
  const chartH = 140;
  const barW = Math.max(6, Math.min(24, Math.floor(600 / data.length) - 2));
  const gap = 2;
  const chartW = data.length * (barW + gap);
  const labelEvery = Math.max(1, Math.ceil(data.length / 12));

  return (
    <div className="bg-zinc-900 rounded-lg p-4">
      <h2 className="text-sm font-semibold text-zinc-400 mb-3">Credits Per Minute</h2>
      <div className="overflow-x-auto -mx-4 px-4">
        <svg width={chartW + 40} height={chartH + 28} style={{ minWidth: chartW + 40 }}>
          {/* 55-credit limit line */}
          {maxCredits >= LIMIT * 0.5 && (() => {
            const y = chartH - (LIMIT / Math.max(maxCredits, LIMIT)) * chartH;
            return (
              <>
                <line x1={0} y1={y} x2={chartW + 40} y2={y} stroke="#ef4444" strokeWidth={1} strokeDasharray="4,3" opacity={0.5} />
                <text x={chartW + 38} y={y - 3} fill="#ef4444" fontSize={9} textAnchor="end" opacity={0.7}>55</text>
              </>
            );
          })()}
          {/* Bars */}
          {data.map((d, i) => {
            const h = (d.credits / Math.max(maxCredits, LIMIT)) * chartH;
            const x = i * (barW + gap);
            const y = chartH - h;
            const color = d.credits >= LIMIT ? '#ef4444' : d.credits >= 40 ? '#f59e0b' : '#22c55e';
            return (
              <g key={i}>
                <title>{d.minute}: {d.credits} credits</title>
                <rect x={x} y={y} width={barW} height={h} rx={1} fill={color} opacity={0.85} />
                {i % labelEvery === 0 && (
                  <text x={x + barW / 2} y={chartH + 14} fill="#71717a" fontSize={9} textAnchor="middle">
                    {d.minute}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
