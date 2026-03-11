'use client';

import { useState, useEffect, useRef } from 'react';

interface SearchResult {
  symbol: string;
  description: string;
  type: string;
}

interface TickerSearchProps {
  onAdd: (symbol: string, name: string) => void;
  existingSymbols: string[];
}

export function TickerSearch({ onAdd, existingSymbols }: TickerSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (query.trim().length < 1) {
      setResults([]);
      setOpen(false);
      return;
    }

    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`);
        if (res.ok) {
          const data = await res.json();
          setResults(data.results);
          setOpen(data.results.length > 0);
        }
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(debounceRef.current);
  }, [query]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function handleSelect(result: SearchResult) {
    onAdd(result.symbol, result.description);
    setQuery('');
    setResults([]);
    setOpen(false);
  }

  const alreadyAdded = new Set(existingSymbols.map((s) => s.toUpperCase()));

  return (
    <div ref={containerRef} className="relative">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            placeholder="Search stocks... e.g. Apple, TSLA"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => results.length > 0 && setOpen(true)}
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 placeholder-gray-500"
          />
          {loading && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <div className="w-4 h-4 border-2 border-gray-600 border-t-blue-400 rounded-full animate-spin" />
            </div>
          )}
        </div>
      </div>

      {open && results.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl max-h-64 overflow-y-auto">
          {results.map((r) => {
            const exists = alreadyAdded.has(r.symbol.toUpperCase());
            return (
              <button
                key={r.symbol}
                onClick={() => !exists && handleSelect(r)}
                disabled={exists}
                className={`w-full text-left px-3 py-2.5 flex items-center justify-between gap-2 border-b border-gray-700/50 last:border-0 transition-colors ${
                  exists
                    ? 'opacity-40 cursor-not-allowed'
                    : 'hover:bg-gray-700/60 cursor-pointer'
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-gray-100">{r.symbol}</span>
                    <span className="text-xs text-gray-500 bg-gray-700/50 px-1.5 py-0.5 rounded">{r.type}</span>
                  </div>
                  <div className="text-sm text-gray-400 truncate">{r.description}</div>
                </div>
                {exists ? (
                  <span className="text-xs text-gray-500 shrink-0">Added</span>
                ) : (
                  <span className="text-xs text-green-400 shrink-0">+ Add</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
