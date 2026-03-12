'use client';

import { useEffect, useState, useCallback } from 'react';

interface ScoringRules {
  weights: {
    momentum: { weight: number; timeframes: Record<string, number> };
    rvol: { weight: number; highThreshold: number; moderateThreshold: number };
    volumeSpike: { weight: number; spikeThreshold: number };
    float: { weight: number; lowFloatThreshold: number; microFloatThreshold: number };
    vwap: { weight: number };
    intradayRange: { weight: number; tiers: { full: number; mid: number; low: number } };
    breakout: { weight: number; nearHighPct: number; gapUpPct: number };
    newsCatalyst: { weight: number; recentWindowMinutes: number; maxArticles: number };
    shortInterest: { weight: number; highThreshold: number; moderateThreshold: number };
    optionsFlow: { weight: number; bullishThreshold: number };
  };
  penalties: { missingDataPerField: number; maxMissingPenalty: number };
  momentum: { maxPctForFullScore: number };
  vwapTiers: { full: number; half: number };
  polling: { batchSize: number };
}

/* ── field descriptor ───────────────────────────────── */
interface Field {
  label: string;
  path: string[];          // key path inside ScoringRules
  unit?: string;
  step?: number;
  min?: number;
  max?: number;
  description?: string;
}

interface Section {
  title: string;
  icon: string;
  fields: Field[];
}

/* ── sections ───────────────────────────────────────── */
const SECTIONS: Section[] = [
  {
    title: 'Momentum',
    icon: '📈',
    fields: [
      { label: 'Weight (pts)', path: ['weights', 'momentum', 'weight'], unit: 'pts', step: 1, min: 0, max: 100 },
      { label: '1-min Timeframe', path: ['weights', 'momentum', 'timeframes', '1min'], step: 0.05, min: 0, max: 1 },
      { label: '5-min Timeframe', path: ['weights', 'momentum', 'timeframes', '5min'], step: 0.05, min: 0, max: 1 },
      { label: '15-min Timeframe', path: ['weights', 'momentum', 'timeframes', '15min'], step: 0.05, min: 0, max: 1 },
      { label: 'Max % for Full Score', path: ['momentum', 'maxPctForFullScore'], unit: '%', step: 0.5, min: 0.5, description: 'Price move % that yields full points' },
    ],
  },
  {
    title: 'Relative Volume (RVOL)',
    icon: '🔊',
    fields: [
      { label: 'Weight (pts)', path: ['weights', 'rvol', 'weight'], unit: 'pts', step: 1, min: 0, max: 100 },
      { label: 'High Threshold', path: ['weights', 'rvol', 'highThreshold'], step: 0.5, min: 1, description: 'RVOL ≥ this = full points' },
      { label: 'Moderate Threshold', path: ['weights', 'rvol', 'moderateThreshold'], step: 0.5, min: 1, description: 'RVOL ≥ this = partial points' },
    ],
  },
  {
    title: 'Volume Spike',
    icon: '⚡',
    fields: [
      { label: 'Weight (pts)', path: ['weights', 'volumeSpike', 'weight'], unit: 'pts', step: 1, min: 0, max: 100 },
      { label: 'Spike Threshold', path: ['weights', 'volumeSpike', 'spikeThreshold'], step: 0.5, min: 1, description: 'Volume/avg ratio for a spike' },
    ],
  },
  {
    title: 'Float Analysis',
    icon: '🏷️',
    fields: [
      { label: 'Weight (pts)', path: ['weights', 'float', 'weight'], unit: 'pts', step: 1, min: 0, max: 100 },
      { label: 'Low Float Threshold', path: ['weights', 'float', 'lowFloatThreshold'], unit: 'M', step: 5, min: 1, description: 'Shares (millions) for low float' },
      { label: 'Micro Float Threshold', path: ['weights', 'float', 'microFloatThreshold'], unit: 'M', step: 1, min: 0.5, description: 'Shares (millions) for micro float bonus' },
    ],
  },
  {
    title: 'VWAP',
    icon: '📏',
    fields: [
      { label: 'Weight (pts)', path: ['weights', 'vwap', 'weight'], unit: 'pts', step: 1, min: 0, max: 100 },
      { label: 'Full Points Above %', path: ['vwapTiers', 'full'], unit: '%', step: 0.5, min: 0, description: '% above VWAP for full points' },
      { label: 'Half Points Above %', path: ['vwapTiers', 'half'], unit: '%', step: 0.5, description: '% above VWAP for half points' },
    ],
  },
  {
    title: 'Intraday Range',
    icon: '📐',
    fields: [
      { label: 'Weight (pts)', path: ['weights', 'intradayRange', 'weight'], unit: 'pts', step: 1, min: 0, max: 100 },
      { label: 'Full Tier', path: ['weights', 'intradayRange', 'tiers', 'full'], step: 0.05, min: 0, max: 1, description: 'Range % for full points (e.g. 0.85 = 85th pct)' },
      { label: 'Mid Tier', path: ['weights', 'intradayRange', 'tiers', 'mid'], step: 0.05, min: 0, max: 1, description: 'Range % for partial points' },
      { label: 'Low Tier', path: ['weights', 'intradayRange', 'tiers', 'low'], step: 0.05, min: 0, max: 1, description: 'Range % for minimum points' },
    ],
  },
  {
    title: 'Breakout',
    icon: '🚀',
    fields: [
      { label: 'Weight (pts)', path: ['weights', 'breakout', 'weight'], unit: 'pts', step: 1, min: 0, max: 100 },
      { label: 'Near-High %', path: ['weights', 'breakout', 'nearHighPct'], unit: '%', step: 0.5, min: 0, description: '% within daily high to trigger' },
      { label: 'Gap-Up %', path: ['weights', 'breakout', 'gapUpPct'], unit: '%', step: 0.5, min: 0, description: '% above prev close for gap-up' },
    ],
  },
  {
    title: 'News Catalyst',
    icon: '📰',
    fields: [
      { label: 'Weight (pts)', path: ['weights', 'newsCatalyst', 'weight'], unit: 'pts', step: 1, min: 0, max: 100 },
      { label: 'Recent Window (min)', path: ['weights', 'newsCatalyst', 'recentWindowMinutes'], unit: 'min', step: 30, min: 30, description: 'How far back to look for news' },
      { label: 'Max Articles', path: ['weights', 'newsCatalyst', 'maxArticles'], step: 1, min: 1, description: 'Cap for article count scoring' },
    ],
  },
  {
    title: 'Short Interest',
    icon: '🩳',
    fields: [
      { label: 'Weight (pts)', path: ['weights', 'shortInterest', 'weight'], unit: 'pts', step: 1, min: 0, max: 100 },
      { label: 'High Threshold', path: ['weights', 'shortInterest', 'highThreshold'], unit: '%', step: 5, min: 1, description: 'SI % for full points' },
      { label: 'Moderate Threshold', path: ['weights', 'shortInterest', 'moderateThreshold'], unit: '%', step: 5, min: 1, description: 'SI % for partial points' },
    ],
  },
  {
    title: 'Options Flow',
    icon: '🎯',
    fields: [
      { label: 'Weight (pts)', path: ['weights', 'optionsFlow', 'weight'], unit: 'pts', step: 1, min: 0, max: 100 },
      { label: 'Bullish Threshold', path: ['weights', 'optionsFlow', 'bullishThreshold'], unit: '%', step: 5, min: 1, description: 'Bullish % for full points' },
    ],
  },
  {
    title: 'Penalties',
    icon: '⛔',
    fields: [
      { label: 'Per-Field Penalty', path: ['penalties', 'missingDataPerField'], unit: 'pts', step: 1, min: 0, description: 'Points deducted per missing data field' },
      { label: 'Max Penalty', path: ['penalties', 'maxMissingPenalty'], unit: 'pts', step: 5, min: 0, description: 'Upper cap on missing-data penalty' },
    ],
  },
  {
    title: 'Polling',
    icon: '🔄',
    fields: [
      { label: 'Batch Size', path: ['polling', 'batchSize'], step: 1, min: 1, max: 50, description: 'Tickers processed per polling batch' },
    ],
  },
];

/* ── helpers ────────────────────────────────────────── */
function getNestedValue(obj: unknown, path: string[]): number {
  let cur: unknown = obj;
  for (const k of path) {
    if (cur == null || typeof cur !== 'object') return 0;
    cur = (cur as Record<string, unknown>)[k];
  }
  return typeof cur === 'number' ? cur : 0;
}

function setNestedValue(obj: unknown, path: string[], value: number): unknown {
  if (path.length === 0) return value;
  const clone = Array.isArray(obj) ? [...obj] : { ...(obj as Record<string, unknown>) };
  (clone as Record<string, unknown>)[path[0]] = setNestedValue(
    (clone as Record<string, unknown>)[path[0]] ?? {},
    path.slice(1),
    value,
  );
  return clone;
}

function diffFromDefaults(rules: ScoringRules, defaults: ScoringRules): Record<string, unknown> {
  const diff: Record<string, unknown> = {};
  for (const section of SECTIONS) {
    for (const field of section.fields) {
      const cur = getNestedValue(rules, field.path);
      const def = getNestedValue(defaults, field.path);
      if (cur !== def) {
        let target: Record<string, unknown> = diff;
        for (let i = 0; i < field.path.length - 1; i++) {
          if (!(field.path[i] in target)) target[field.path[i]] = {};
          target = target[field.path[i]] as Record<string, unknown>;
        }
        target[field.path[field.path.length - 1]] = cur;
      }
    }
  }
  return diff;
}

/* ── component ──────────────────────────────────────── */
export function RulesClient() {
  const [rules, setRules] = useState<ScoringRules | null>(null);
  const [defaults, setDefaults] = useState<ScoringRules | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/rules');
      if (res.ok) {
        const data = await res.json();
        setRules(data.rules);
        setDefaults(data.defaults);
      }
    } catch (err) {
      console.error('Failed to load rules:', err);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!rules || !defaults) return;
    setSaving(true);
    setStatus(null);
    try {
      const overrides = diffFromDefaults(rules, defaults);
      const res = await fetch('/api/rules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rules: overrides }),
      });
      if (res.ok) {
        const data = await res.json();
        setRules(data.rules);
        setDefaults(data.defaults);
        setStatus('Saved');
        setTimeout(() => setStatus(null), 2000);
      } else {
        setStatus('Error saving');
      }
    } catch {
      setStatus('Network error');
    } finally {
      setSaving(false);
    }
  }

  function resetAll() {
    if (defaults) setRules(JSON.parse(JSON.stringify(defaults)));
  }

  function resetSection(section: Section) {
    if (!rules || !defaults) return;
    let updated: unknown = rules;
    for (const field of section.fields) {
      const def = getNestedValue(defaults, field.path);
      updated = setNestedValue(updated, field.path, def);
    }
    setRules(updated as ScoringRules);
  }

  function updateField(path: string[], value: number) {
    if (!rules) return;
    setRules(setNestedValue(rules, path, value) as ScoringRules);
  }

  function toggleSection(title: string) {
    setCollapsed(prev => ({ ...prev, [title]: !prev[title] }));
  }

  if (!rules || !defaults) {
    return <div className="pt-4 text-gray-400">Loading rules...</div>;
  }

  const totalWeight = Object.values(rules.weights).reduce((s, w) => s + w.weight, 0);
  const hasChanges = JSON.stringify(rules) !== JSON.stringify(defaults);

  return (
    <div className="pt-4 space-y-4 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-2xl font-bold">Scoring Rules</h2>
        <div className="flex items-center gap-2">
          {hasChanges && (
            <button
              onClick={resetAll}
              className="px-3 py-1.5 text-sm bg-gray-800 border border-gray-700 rounded-lg text-gray-300 hover:bg-gray-700 transition-colors"
            >
              Reset All
            </button>
          )}
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-1.5 text-sm bg-blue-600 rounded-lg text-white font-medium hover:bg-blue-500 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          {status && (
            <span className={`text-sm ${status === 'Saved' ? 'text-green-400' : 'text-red-400'}`}>
              {status}
            </span>
          )}
        </div>
      </div>

      {/* Weight summary */}
      <div className={`text-sm px-3 py-2 rounded-lg border ${
        totalWeight === 100
          ? 'bg-green-950/30 border-green-800/50 text-green-400'
          : 'bg-yellow-950/30 border-yellow-800/50 text-yellow-400'
      }`}>
        Total category weight: <span className="font-bold">{totalWeight}</span> / 100 pts
        {totalWeight !== 100 && ' — adjust weights so they sum to 100'}
      </div>

      {/* Sections — masonry layout */}
      <div className="columns-1 lg:columns-2 xl:columns-3 gap-6 space-y-6">
      {SECTIONS.map((section) => {
        const isCollapsed = collapsed[section.title];
        const sectionHasChanges = section.fields.some(
          f => getNestedValue(rules, f.path) !== getNestedValue(defaults, f.path),
        );

        return (
          <div key={section.title} className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden break-inside-avoid">
            {/* Section header */}
            <button
              onClick={() => toggleSection(section.title)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-800/50 transition-colors text-left"
            >
              <div className="flex items-center gap-2">
                <span className="text-lg">{section.icon}</span>
                <span className="text-base font-bold text-gray-100">{section.title}</span>
                {sectionHasChanges && (
                  <span className="w-2 h-2 rounded-full bg-blue-400" title="Modified" />
                )}
              </div>
              <span className="text-gray-500 text-sm">{isCollapsed ? '▸' : '▾'}</span>
            </button>

            {/* Section body */}
            {!isCollapsed && (
              <div className="px-4 pb-4 space-y-3 border-t border-gray-800">
                {section.fields.map((field) => {
                  const cur = getNestedValue(rules, field.path);
                  const def = getNestedValue(defaults, field.path);
                  const modified = cur !== def;

                  return (
                    <div key={field.path.join('.')} className="flex flex-col gap-1 mt-3">
                      <div className="flex items-center justify-between">
                        <label className="text-sm text-gray-400 flex items-center gap-1.5">
                          {field.label}
                          {field.unit && <span className="text-gray-600">({field.unit})</span>}
                          {modified && (
                            <span className="text-xs text-blue-400 font-medium">modified</span>
                          )}
                        </label>
                        <span className="text-xs text-gray-600">
                          default: {def}
                        </span>
                      </div>
                      {field.description && (
                        <p className="text-xs text-gray-600 -mt-0.5">{field.description}</p>
                      )}
                      <input
                        type="number"
                        value={cur}
                        step={field.step ?? 1}
                        min={field.min}
                        max={field.max}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          if (!isNaN(v)) updateField(field.path, v);
                        }}
                        className={`w-full px-3 py-1.5 text-sm rounded-md border bg-gray-950 outline-none transition-colors ${
                          modified
                            ? 'border-blue-600 text-blue-300'
                            : 'border-gray-700 text-gray-200'
                        } focus:border-blue-500`}
                      />
                    </div>
                  );
                })}

                {sectionHasChanges && (
                  <button
                    onClick={() => resetSection(section)}
                    className="text-xs text-gray-500 hover:text-gray-300 mt-1 transition-colors"
                  >
                    Reset section to defaults
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
      </div>

      {/* Sticky save bar on mobile */}
      {hasChanges && (
        <div className="fixed bottom-16 left-0 right-0 lg:hidden px-4 pb-2">
          <button
            onClick={save}
            disabled={saving}
            className="w-full py-2.5 bg-blue-600 rounded-lg text-white text-sm font-medium hover:bg-blue-500 disabled:opacity-50 transition-colors shadow-lg"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      )}
    </div>
  );
}
