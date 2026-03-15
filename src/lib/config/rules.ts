/**
 * Dynamic scoring rules: merges hard-coded defaults with DB overrides.
 * Call `getScoringRules()` from server-side code to get the effective config.
 */

import prisma from '@/lib/db';
import { SCORING_WEIGHTS, SCORING_PENALTIES, ALERT_CONFIG, POLLING_CONFIG } from './scoring';

export interface ScoringRules {
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
    patterns: { weight: number; cap: number; baseBoosts: Record<string, number> };
  };
  penalties: { missingDataPerField: number; maxMissingPenalty: number };
  momentum: { maxPctForFullScore: number };
  vwapTiers: { full: number; half: number };
  polling: { batchSize: number };
}

/** Build default rules from the hard-coded constants */
export function getDefaultRules(): ScoringRules {
  return {
    weights: {
      momentum: {
        weight: SCORING_WEIGHTS.momentum.weight,
        timeframes: { ...SCORING_WEIGHTS.momentum.timeframes },
      },
      rvol: { ...SCORING_WEIGHTS.rvol },
      volumeSpike: { ...SCORING_WEIGHTS.volumeSpike },
      float: { ...SCORING_WEIGHTS.float },
      vwap: { weight: SCORING_WEIGHTS.vwap.weight },
      intradayRange: {
        weight: SCORING_WEIGHTS.intradayRange.weight,
        tiers: { full: 0.85, mid: 0.65, low: 0.50 },
      },
      breakout: { ...SCORING_WEIGHTS.breakout },
      newsCatalyst: { ...SCORING_WEIGHTS.newsCatalyst },
      shortInterest: { ...SCORING_WEIGHTS.shortInterest },
      optionsFlow: { ...SCORING_WEIGHTS.optionsFlow },
      patterns: { weight: SCORING_WEIGHTS.patterns.weight, cap: SCORING_WEIGHTS.patterns.cap, baseBoosts: { ...SCORING_WEIGHTS.patterns.baseBoosts } },
    },
    penalties: { ...SCORING_PENALTIES },
    momentum: { maxPctForFullScore: 5 },
    vwapTiers: { full: 2, half: 0 },
    polling: { batchSize: POLLING_CONFIG.batchSize },
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

/** Read rules from DB (with overrides merged on top of defaults). */
export async function getScoringRules(): Promise<ScoringRules> {
  const defaults = getDefaultRules();
  try {
    const settings = await prisma.appSettings.findFirst();
    if (settings?.rulesJson) {
      const overrides = JSON.parse(settings.rulesJson) as Record<string, unknown>;
      return deepMerge(defaults, overrides) as ScoringRules;
    }
  } catch {
    // fall through to defaults
  }
  return defaults;
}
