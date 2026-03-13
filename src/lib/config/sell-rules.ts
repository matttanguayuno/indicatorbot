/**
 * Sell alert rules: merges hard-coded defaults with DB overrides.
 * Call `getSellRules()` from server-side code to get the effective config.
 */

import prisma from '@/lib/db';

export interface SellRules {
  cooldownMin: number;
  lookbackMin: number;
  maxSnapshots: number;
  level3: {
    drop5min: number;
    vwapBelow: number;
    rvolBelow: number;
  };
  level2: {
    drop5min: number;
    drop3min: number;
    dropFromEntry: number;
    dropFromEntryConfirm3min: number;
  };
  level1: {
    drop3min: number;
    dropFromPeakPct: number;
    dropFromPeakAbs: number;
  };
}

export function getDefaultSellRules(): SellRules {
  return {
    cooldownMin: 5,
    lookbackMin: 6,
    maxSnapshots: 10,
    level3: {
      drop5min: 15,
      vwapBelow: -1,
      rvolBelow: 0.8,
    },
    level2: {
      drop5min: 10,
      drop3min: 10,
      dropFromEntry: 10,
      dropFromEntryConfirm3min: 3,
    },
    level1: {
      drop3min: 5,
      dropFromPeakPct: 8,
      dropFromPeakAbs: 4,
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
