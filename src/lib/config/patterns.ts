// ---------------------------------------------------------------------------
// Pattern Detection Configuration
// Each pattern has an `enabled` toggle and numeric threshold overrides.
// ---------------------------------------------------------------------------

export interface VolumeBreakoutConfig {
  enabled: boolean;
  lookback: number;
  volumeRatio: number;
  confirmationBars: number;
}

export interface ConsolidationBreakoutConfig {
  enabled: boolean;
  lookback: number;
  bbPeriod: number;
  contractionPct: number;
  volumeRatio: number;
}

export interface BullFlagConfig {
  enabled: boolean;
  lookback: number;
  poleMinGainPct: number;
  poleLenMin: number;
  poleLenMax: number;
  maxRetracePct: number;
  minFlagBars: number;
  maxFlagBars: number;
  volumeRatio: number;
}

export interface AscendingTriangleConfig {
  enabled: boolean;
  lookback: number;
  resistanceTolerance: number;
  minTouches: number;
  minR2: number;
  volumeRatio: number;
}

export interface ChannelBreakoutConfig {
  enabled: boolean;
  lookback: number;
  minR2: number;
  slopeParallelismPct: number;
  minSwingPoints: number;
  volumeRatio: number;
}

export interface DoubleBottomConfig {
  enabled: boolean;
  lookback: number;
  priceTolerance: number;
  minSeparation: number;
  volumeRatio: number;
}

export interface InsideBarBreakoutConfig {
  enabled: boolean;
  minInsideBars: number;
}

export interface VWAPReclaimConfig {
  enabled: boolean;
  lookback: number;
  minDipPct: number;
  volumeRatio: number;
}

export interface SymmetricalTriangleConfig {
  enabled: boolean;
  lookback: number;
  minR2: number;
  minSwingPoints: number;
  volumeRatio: number;
}

export interface PatternConfig {
  volumeBreakout: VolumeBreakoutConfig;
  consolidationBreakout: ConsolidationBreakoutConfig;
  bullFlag: BullFlagConfig;
  ascendingTriangle: AscendingTriangleConfig;
  channelBreakout: ChannelBreakoutConfig;
  doubleBottom: DoubleBottomConfig;
  insideBarBreakout: InsideBarBreakoutConfig;
  vwapReclaim: VWAPReclaimConfig;
  symmetricalTriangle: SymmetricalTriangleConfig;
}

export const DEFAULT_PATTERN_CONFIG: PatternConfig = {
  volumeBreakout: {
    enabled: true,
    lookback: 22,
    volumeRatio: 1.5,
    confirmationBars: 2,
  },
  consolidationBreakout: {
    enabled: true,
    lookback: 35,
    bbPeriod: 20,
    contractionPct: 40,
    volumeRatio: 1.5,
  },
  bullFlag: {
    enabled: true,
    lookback: 45,
    poleMinGainPct: 8,
    poleLenMin: 8,
    poleLenMax: 15,
    maxRetracePct: 35,
    minFlagBars: 3,
    maxFlagBars: 12,
    volumeRatio: 1.5,
  },
  ascendingTriangle: {
    enabled: true,
    lookback: 60,
    resistanceTolerance: 0.003,
    minTouches: 3,
    minR2: 0.5,
    volumeRatio: 1.2,
  },
  channelBreakout: {
    enabled: true,
    lookback: 53,
    minR2: 0.6,
    slopeParallelismPct: 15,
    minSwingPoints: 3,
    volumeRatio: 1.3,
  },
  doubleBottom: {
    enabled: true,
    lookback: 50,
    priceTolerance: 0.005,
    minSeparation: 8,
    volumeRatio: 1.2,
  },
  insideBarBreakout: {
    enabled: true,
    minInsideBars: 1,
  },
  vwapReclaim: {
    enabled: true,
    lookback: 30,
    minDipPct: 0.3,
    volumeRatio: 1.3,
  },
  symmetricalTriangle: {
    enabled: true,
    lookback: 50,
    minR2: 0.5,
    minSwingPoints: 3,
    volumeRatio: 1.2,
  },
};

/** Deep-merge saved JSON over defaults so new fields always have a value. */
export function getPatternConfig(json: string | null | undefined): PatternConfig {
  if (!json) return { ...DEFAULT_PATTERN_CONFIG };
  try {
    const saved = JSON.parse(json) as Partial<PatternConfig>;
    const merged = { ...DEFAULT_PATTERN_CONFIG };
    for (const key of Object.keys(DEFAULT_PATTERN_CONFIG) as (keyof PatternConfig)[]) {
      if (saved[key]) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (merged as any)[key] = {
          ...DEFAULT_PATTERN_CONFIG[key],
          ...saved[key],
        };
      }
    }
    return merged;
  } catch {
    return { ...DEFAULT_PATTERN_CONFIG };
  }
}
