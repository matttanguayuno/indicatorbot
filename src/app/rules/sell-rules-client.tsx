'use client';

import { useEffect, useState, useCallback } from 'react';

interface SellRules {
  cooldownMin: number;
  lookbackMin: number;
  maxSnapshots: number;
  suppressor: {
    minRvol: number;
  };
  level3: {
    drop5min: number;
    drop3min: number;
    vwapBelow: number;
    rvolBelow: number;
    minConfirmations: number;
  };
  level2: {
    drop5min: number;
    drop3min: number;
    dropFromEntry: number;
    dropFromEntryConfirm3min: number;
    vwapBelow: number;
    minConfirmations: number;
  };
  level1: {
    drop3min: number;
    dropFromPeakPct: number;
    dropFromPeakAbs: number;
    minWeakness: number;
  };
}

interface Field {
  label: string;
  path: string[];
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

const SECTIONS: Section[] = [
  {
    title: 'General',
    icon: '⚙️',
    fields: [
      { label: 'Cooldown (min)', path: ['cooldownMin'], unit: 'min', step: 1, min: 1, max: 60, description: 'Minimum time between sell alerts for the same entry' },
      { label: 'Lookback Window (min)', path: ['lookbackMin'], unit: 'min', step: 1, min: 2, max: 30, description: 'How far back to query recent snapshots' },
      { label: 'Max Snapshots', path: ['maxSnapshots'], step: 1, min: 2, max: 30, description: 'Max number of recent snapshots to evaluate' },
    ],
  },
  {
    title: 'Trend Suppressor',
    icon: '🛡️',
    fields: [
      { label: 'Min RVOL for Strong Uptrend', path: ['suppressor', 'minRvol'], step: 0.1, min: 0.1, max: 5, description: 'RVOL threshold — above VWAP + nearHigh + breakout + this RVOL = STRONG_UP (all alerts suppressed)' },
    ],
  },
  {
    title: 'Level 3 — Structure Failed',
    icon: '🔴',
    fields: [
      { label: '5-min Score Drop', path: ['level3', 'drop5min'], unit: 'pts', step: 1, min: 5, max: 50, description: 'Score drop in 5 min to arm L3 alert' },
      { label: '3-min Score Drop', path: ['level3', 'drop3min'], unit: 'pts', step: 1, min: 5, max: 50, description: 'Score drop in 3 min to arm L3 alert' },
      { label: 'VWAP Below Threshold', path: ['level3', 'vwapBelow'], unit: '%', step: 0.25, max: 0, description: 'Deep below VWAP confirmation threshold (e.g. -0.75)' },
      { label: 'RVOL Below Threshold', path: ['level3', 'rvolBelow'], step: 0.1, min: 0, max: 3, description: 'Volume drying up confirmation threshold' },
      { label: 'Min Confirmations', path: ['level3', 'minConfirmations'], step: 1, min: 1, max: 8, description: 'Price confirmations required to fire L3 (BROKEN trend only)' },
    ],
  },
  {
    title: 'Level 2 — Trend Weakening',
    icon: '🟠',
    fields: [
      { label: '5-min Score Drop', path: ['level2', 'drop5min'], unit: 'pts', step: 1, min: 3, max: 50, description: 'Score drop in 5 min to arm L2 alert' },
      { label: '3-min Score Drop', path: ['level2', 'drop3min'], unit: 'pts', step: 1, min: 3, max: 50, description: 'Score drop in 3 min to arm L2 alert' },
      { label: 'Drop From Entry', path: ['level2', 'dropFromEntry'], unit: 'pts', step: 1, min: 3, max: 50, description: 'Score points below entry to arm L2' },
      { label: 'Entry Confirm (3-min)', path: ['level2', 'dropFromEntryConfirm3min'], unit: 'pts', step: 1, min: 1, max: 20, description: 'Additional 3-min drop needed to confirm entry-based sell' },
      { label: 'VWAP Below Threshold', path: ['level2', 'vwapBelow'], unit: '%', step: 0.1, max: 0, description: 'Below VWAP threshold for BROKEN trend detection (e.g. -0.3)' },
      { label: 'Min Confirmations', path: ['level2', 'minConfirmations'], step: 1, min: 1, max: 8, description: 'Price confirmations required to fire L2 (BROKEN trend only)' },
    ],
  },
  {
    title: 'Level 1 — Momentum Cooling',
    icon: '⚠️',
    fields: [
      { label: '3-min Score Drop', path: ['level1', 'drop3min'], unit: 'pts', step: 1, min: 1, max: 30, description: 'Score drop in 3 min to arm warning' },
      { label: 'Peak Drop %', path: ['level1', 'dropFromPeakPct'], unit: '%', step: 1, min: 1, max: 50, description: '% score drop from peak to arm warning' },
      { label: 'Peak Drop Minimum', path: ['level1', 'dropFromPeakAbs'], unit: 'pts', step: 1, min: 1, max: 30, description: 'Absolute pts drop from peak (combined with %)' },
      { label: 'Min Weakness Signals', path: ['level1', 'minWeakness'], step: 1, min: 0, max: 3, description: 'Weakness signals required (lost nearHigh, low RVOL, below VWAP)' },
    ],
  },
];

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

function diffFromDefaults(rules: SellRules, defaults: SellRules): Record<string, unknown> {
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

export function SellRulesClient() {
  const [rules, setRules] = useState<SellRules | null>(null);
  const [defaults, setDefaults] = useState<SellRules | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/sell-rules');
      if (res.ok) {
        const data = await res.json();
        setRules(data.rules);
        setDefaults(data.defaults);
      }
    } catch (err) {
      console.error('Failed to load sell rules:', err);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!rules || !defaults) return;
    setSaving(true);
    setStatus(null);
    try {
      const overrides = diffFromDefaults(rules, defaults);
      const res = await fetch('/api/sell-rules', {
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
    setRules(updated as SellRules);
  }

  function updateField(path: string[], value: number) {
    if (!rules) return;
    setRules(setNestedValue(rules, path, value) as SellRules);
  }

  function toggleSection(title: string) {
    setCollapsed(prev => ({ ...prev, [title]: !prev[title] }));
  }

  if (!rules || !defaults) {
    return <div className="pt-4 text-gray-400">Loading sell rules...</div>;
  }

  const hasChanges = JSON.stringify(rules) !== JSON.stringify(defaults);

  return (
    <div className="pt-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-2xl font-bold">Sell Rules</h2>
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

      <p className="text-sm text-gray-500">
        Configure when sell alerts fire for active buy entries. Score drops ARM alerts, price action CONFIRMS them. Trend state gates severity: STRONG_UP suppresses all, PULLBACK allows L1, BROKEN allows L2/L3.
      </p>

      {/* Sections */}
      <div className="columns-1 lg:columns-2 gap-6 space-y-6">
        {SECTIONS.map((section) => {
          const isCollapsed = collapsed[section.title];
          const sectionHasChanges = section.fields.some(
            f => getNestedValue(rules, f.path) !== getNestedValue(defaults, f.path),
          );

          return (
            <div key={section.title} className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden break-inside-avoid">
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
            {saving ? 'Saving...' : 'Save Sell Rules'}
          </button>
        </div>
      )}
    </div>
  );
}
