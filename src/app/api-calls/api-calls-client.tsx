'use client';

import { useEffect, useState, useCallback } from 'react';

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

  const fetchLog = useCallback(async () => {
    try {
      const res = await fetch('/api/api-calls');
      if (res.ok) {
        const data: LogEntry[] = await res.json();
        setEntries(data);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

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
    <div className="space-y-4 pb-24">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">API Call Log</h1>
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
        <p className="text-zinc-500 text-sm">No API calls logged yet. Logs are in-memory and reset on deploy.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-zinc-400 border-b border-zinc-800">
                <th className="py-2 pr-3">Time (MT)</th>
                <th className="py-2 pr-3">Endpoint</th>
                <th className="py-2 pr-3">Symbols</th>
                <th className="py-2 pr-3">Credits</th>
                <th className="py-2 pr-3">Purpose</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2">Detail</th>
              </tr>
            </thead>
            <tbody>
              {[...entries].reverse().map((e, i) => (
                <tr key={i} className="border-b border-zinc-800/50 hover:bg-zinc-900/50">
                  <td className="py-1.5 pr-3 font-mono text-xs whitespace-nowrap">{formatTime(e.timestamp)}</td>
                  <td className="py-1.5 pr-3 font-mono text-xs">{e.endpoint}</td>
                  <td className="py-1.5 pr-3 text-xs max-w-[200px] truncate">{e.symbols}</td>
                  <td className="py-1.5 pr-3 text-xs">{e.credits}</td>
                  <td className="py-1.5 pr-3 text-xs text-zinc-400">{e.purpose}</td>
                  <td className={`py-1.5 pr-3 text-xs font-medium ${STATUS_COLORS[e.status] || 'text-zinc-400'}`}>{e.status}</td>
                  <td className="py-1.5 text-xs text-zinc-500 max-w-[200px] truncate">{e.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
