/**
 * Sell alert rules: merges hard-coded defaults with DB overrides.
 * Call `getSellRules()` from server-side code to get the effective config.
 */

import prisma from '@/lib/db';

export interface SellRules {
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

export function getDefaultSellRules(): SellRules {
  return {
    cooldownMin: 5,
    lookbackMin: 6,
    maxSnapshots: 10,
    suppressor: {
      minRvol: 1.0,
    },
    level3: {
      drop5min: 15,
      drop3min: 12,
      vwapBelow: -0.75,
      rvolBelow: 0.8,
      minConfirmations: 3,
    },
    level2: {
      drop5min: 12,
      drop3min: 10,
      dropFromEntry: 10,
      dropFromEntryConfirm3min: 3,
      vwapBelow: -0.3,
      minConfirmations: 2,
    },
    level1: {
      drop3min: 6,
      dropFromPeakPct: 10,
      dropFromPeakAbs: 5,
      minWeakness: 1,
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deepMerge(target: any, source: any): any {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const sv = source[key];
    const tv = target[key];
    if (sv != null && typeof sv === 'object' && !Array.isArray(sv) && tv != null && typeof tv === 'object' && !Array.isArray(tv)) {
      result[key] = deepMerge(tv, sv);
    } else if (sv !== undefined) {
      result[key] = sv;
    }
  }
  return result;
}

/** Read sell rules from DB (with overrides merged on top of defaults). */
export async function getSellRules(): Promise<SellRules> {
  const defaults = getDefaultSellRules();
  try {
    const settings = await prisma.appSettings.findFirst();
    if (settings?.sellRulesJson) {
      const overrides = JSON.parse(settings.sellRulesJson) as Record<string, unknown>;
      return deepMerge(defaults, overrides) as SellRules;
    }
  } catch {
    // fall through to defaults
  }
  return defaults;
}
