import type {
  NormalizedCandle,
  PatternResult,
  VolumeBreakout,
  ConsolidationBreakout,
  BullFlag,
  AscendingTriangle,
  ChannelBreakout,
  DoubleBottom,
  InsideBarBreakout,
  VWAPReclaim,
  SymmetricalTriangle,
  BullishEngulfing,
  MorningStar,
  HammerPattern,
  EMACrossover,
  BollingerSqueeze,
  GapAndGo,
  CupAndHandle,
  FallingWedge,
} from '../types';
import { calcBollingerBands, linearRegression, calcEMA } from './indicators';
import type { PatternConfig } from '../config/patterns';
import { DEFAULT_PATTERN_CONFIG } from '../config/patterns';

// Skip the first N candles to avoid opening-auction noise
const SKIP_OPEN = 5;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function avgVolume(candles: NormalizedCandle[]): number {
  if (candles.length === 0) return 0;
  return candles.reduce((s, c) => s + c.volume, 0) / candles.length;
}

/** Find local swing-low indices (a candle whose low is lower than neighbours) */
function findSwingLows(candles: NormalizedCandle[], margin: number = 2): number[] {
  const lows: number[] = [];
  for (let i = margin; i < candles.length - margin; i++) {
    let isLow = true;
    for (let j = 1; j <= margin; j++) {
      if (candles[i].low >= candles[i - j].low || candles[i].low >= candles[i + j].low) {
        isLow = false;
        break;
      }
    }
    if (isLow) lows.push(i);
  }
  return lows;
}

/** Find local swing-high indices */
function findSwingHighs(candles: NormalizedCandle[], margin: number = 2): number[] {
  const highs: number[] = [];
  for (let i = margin; i < candles.length - margin; i++) {
    let isHigh = true;
    for (let j = 1; j <= margin; j++) {
      if (candles[i].high <= candles[i - j].high || candles[i].high <= candles[i + j].high) {
        isHigh = false;
        break;
      }
    }
    if (isHigh) highs.push(i);
  }
  return highs;
}

// ---------------------------------------------------------------------------
// 1. Volume-Confirmed Breakout
//    Price closes above resistance (highest high over 20 candles) with
//    volume ≥ 1.5× average, confirmed by 2 consecutive closes above.
//    Lookback: 22 candles.
// ---------------------------------------------------------------------------
export function detectVolumeBreakout(candles: NormalizedCandle[], cfg = DEFAULT_PATTERN_CONFIG.volumeBreakout): VolumeBreakout | null {
  const { lookback, volumeRatio: minVolRatio, confirmationBars } = cfg;
  if (candles.length < lookback + SKIP_OPEN) return null;

  // Scan from most recent backward (report only the latest pattern)
  for (let end = candles.length - 1; end >= SKIP_OPEN + lookback - 1; end--) {
    const windowStart = end - lookback + 1;
    const rangeCandles = candles.slice(windowStart, end - confirmationBars + 1);
    if (rangeCandles.length < 3) continue;

    const resistance = Math.max(...rangeCandles.map(c => c.high));
    const avg = avgVolume(rangeCandles);

    // Need consecutive closes above resistance
    let confirmed = true;
    for (let i = 0; i < confirmationBars; i++) {
      if (candles[end - i].close <= resistance) { confirmed = false; break; }
    }
    if (!confirmed) continue;

    // Volume confirmation on breakout candle
    const volumeRatio = candles[end - confirmationBars + 1].volume / (avg || 1);
    if (volumeRatio < minVolRatio) continue;

    return {
      type: 'volume-breakout',
      startIndex: windowStart,
      endIndex: end,
      startTime: candles[windowStart].timestamp.toISOString(),
      endTime: candles[end].timestamp.toISOString(),
      conviction: Math.min(volumeRatio / 4, 1),
      label: 'Volume Breakout',
      resistancePrice: resistance,
      breakoutPrice: candles[end - confirmationBars + 1].close,
      volumeRatio,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// 2. Consolidation Breakout
//    Bollinger bandwidth contracts ≥40% from its peak in window, then price
//    breaks the range with volume ≥ 1.5× average. Lookback: 35 candles.
// ---------------------------------------------------------------------------
export function detectConsolidationBreakout(candles: NormalizedCandle[], cfg = DEFAULT_PATTERN_CONFIG.consolidationBreakout): ConsolidationBreakout | null {
  const { lookback, bbPeriod, contractionPct, volumeRatio: minVolRatio } = cfg;
  if (candles.length < lookback + SKIP_OPEN) return null;

  const bb = calcBollingerBands(candles, bbPeriod);

  for (let end = candles.length - 1; end >= SKIP_OPEN + lookback - 1; end--) {
    const windowStart = end - lookback + 1;
    const windowBB = bb.slice(windowStart, end + 1);

    // Find peak bandwidth in window
    const peakWidth = Math.max(...windowBB.map(b => b.width));
    if (peakWidth === 0) continue;

    // Find the narrowest bandwidth after the peak
    const peakIdx = windowBB.findIndex(b => b.width === peakWidth);
    const afterPeak = windowBB.slice(peakIdx);
    const minWidth = Math.min(...afterPeak.map(b => b.width));
    const contraction = 1 - minWidth / peakWidth;
    if (contraction < contractionPct / 100) continue;

    // Determine consolidation range from the narrow section
    const narrowStart = windowStart + peakIdx;
    const narrowCandles = candles.slice(narrowStart, end);
    if (narrowCandles.length < 3) continue;

    const rangeHigh = Math.max(...narrowCandles.map(c => c.high));
    const rangeLow = Math.min(...narrowCandles.map(c => c.low));

    const lastCandle = candles[end];
    // Break above range
    if (lastCandle.close <= rangeHigh) continue;

    const avg = avgVolume(narrowCandles);
    const volRatio = lastCandle.volume / (avg || 1);
    if (volRatio < minVolRatio) continue;

    return {
      type: 'consolidation-breakout',
      startIndex: narrowStart,
      endIndex: end,
      startTime: candles[narrowStart].timestamp.toISOString(),
      endTime: candles[end].timestamp.toISOString(),
      conviction: Math.min(contraction * (volRatio / 4), 1),
      label: 'Consolidation Breakout',
      rangeHigh,
      rangeLow,
      bandwidthContraction: contraction,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// 3. Bull Flag
//    Sharp pole (≥1.5% gain over up to 15 candles), shallow flag pullback
//    (≤50% retrace, declining volume, flat-to-negative slope), then close
//    above flag high. Lookback: 45 candles.
// ---------------------------------------------------------------------------
export function detectBullFlag(candles: NormalizedCandle[], cfg = DEFAULT_PATTERN_CONFIG.bullFlag): BullFlag | null {
  const { lookback, poleMinGainPct, poleLenMin, poleLenMax, maxRetracePct, minFlagBars, maxFlagBars, volumeRatio: minVolRatio } = cfg;
  if (candles.length < lookback + SKIP_OPEN) return null;

  for (let end = candles.length - 1; end >= SKIP_OPEN + lookback - 1; end--) {
    const windowStart = end - lookback + 1;

    // Look for a strong pole: find the sharpest rally in the window
    for (let poleLen = poleLenMin; poleLen <= poleLenMax; poleLen++) {
      for (let poleStart = windowStart; poleStart <= end - poleLen - 5; poleStart++) {
        const poleEnd = poleStart + poleLen;
        const poleGain = (candles[poleEnd].close - candles[poleStart].low) / candles[poleStart].low;
        if (poleGain < poleMinGainPct / 100) continue;

        // Flag: from poleEnd to end
        const flagCandles = candles.slice(poleEnd, end + 1);
        if (flagCandles.length < minFlagBars + 1 || flagCandles.length > maxFlagBars + 1) continue;

        const poleHigh = Math.max(...candles.slice(poleStart, poleEnd + 1).map(c => c.high));
        const poleLow = candles[poleStart].low;
        const flagLow = Math.min(...flagCandles.map(c => c.low));

        // Retrace check
        const retrace = (poleHigh - flagLow) / (poleHigh - poleLow || 1);
        if (retrace > maxRetracePct / 100) continue;

        // Flag slope should be flat or slightly negative
        const flagCloses = flagCandles.map(c => c.close);
        const reg = linearRegression(flagCloses);
        // Normalize slope by price
        const normalizedSlope = reg.slope / (candles[poleEnd].close || 1);
        if (normalizedSlope > 0.001) continue; // Flag shouldn't be going up steeply

        // Volume should decline during flag
        const poleAvgVol = avgVolume(candles.slice(poleStart, poleEnd + 1));
        const flagAvgVol = avgVolume(flagCandles);
        if (flagAvgVol > poleAvgVol) continue;

        // Break above flag high
        const flagHigh = Math.max(...flagCandles.slice(0, -1).map(c => c.high));
        if (candles[end].close <= flagHigh) continue;

        return {
          type: 'bull-flag',
          startIndex: poleStart,
          endIndex: end,
          startTime: candles[poleStart].timestamp.toISOString(),
          endTime: candles[end].timestamp.toISOString(),
          conviction: Math.min(poleGain * 10 * (1 - retrace), 1),
          label: 'Bull Flag',
          poleStartIndex: poleStart,
          poleEndIndex: poleEnd,
          flagStartIndex: poleEnd,
          flagEndIndex: end,
          poleStartTime: candles[poleStart].timestamp.toISOString(),
          poleEndTime: candles[poleEnd].timestamp.toISOString(),
          flagStartTime: candles[poleEnd].timestamp.toISOString(),
          flagEndTime: candles[end].timestamp.toISOString(),
          flagSlope: reg.slope,
        };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// 4. Ascending Triangle
//    Flat resistance (≥3 touches within 0.3% tolerance), rising swing lows,
//    breakout close above resistance with volume ≥ 1.2×.
//    Lookback: 60 candles.
// ---------------------------------------------------------------------------
export function detectAscendingTriangle(candles: NormalizedCandle[], cfg = DEFAULT_PATTERN_CONFIG.ascendingTriangle): AscendingTriangle | null {
  const { lookback, resistanceTolerance, minTouches, minR2, volumeRatio: minVolRatio } = cfg;
  if (candles.length < lookback + SKIP_OPEN) return null;

  for (let end = candles.length - 1; end >= SKIP_OPEN + lookback - 1; end--) {
    const windowStart = end - lookback + 1;
    const window = candles.slice(windowStart, end + 1);

    const swingHighs = findSwingHighs(window, 3);
    if (swingHighs.length < 3) continue;

    // Find flat resistance — cluster of swing highs within tolerance
    const highPrices = swingHighs.map(i => window[i].high);
    const candidateResistance = highPrices.reduce((a, b) => a + b, 0) / highPrices.length;
    const tolerance = candidateResistance * resistanceTolerance;

    const touches = swingHighs.filter(i => Math.abs(window[i].high - candidateResistance) <= tolerance);
    if (touches.length < minTouches) continue;

    // Find rising swing lows
    const swingLows = findSwingLows(window, 2);
    if (swingLows.length < 2) continue;

    const lowPrices = swingLows.map(i => window[i].low);
    const reg = linearRegression(lowPrices);
    if (reg.slope <= 0 || reg.r2 < minR2) continue;

    // Breakout: last candle closes above resistance
    if (candles[end].close <= candidateResistance + tolerance) continue;

    // Volume confirmation
    const avg = avgVolume(candles.slice(windowStart, end));
    const volRatio = candles[end].volume / (avg || 1);
    if (volRatio < minVolRatio) continue;

    return {
      type: 'ascending-triangle',
      startIndex: windowStart,
      endIndex: end,
      startTime: candles[windowStart].timestamp.toISOString(),
      endTime: candles[end].timestamp.toISOString(),
      conviction: Math.min(reg.r2 * (volRatio / 3), 1),
      label: 'Ascending Triangle',
      resistancePrice: candidateResistance,
      swingLowIndices: swingLows.map(i => i + windowStart),
      swingLowTimes: swingLows.map(i => candles[i + windowStart].timestamp.toISOString()),
      trendlineSlope: reg.slope,
      trendlineIntercept: reg.intercept,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// 5. Channel Breakout
//    Parallel trendlines through swing highs and lows (slopes within 15%,
//    R² ≥ 0.6 each), breakout close above upper channel with volume ≥ 1.3×.
//    Lookback: 53 candles.
// ---------------------------------------------------------------------------
export function detectChannelBreakout(candles: NormalizedCandle[], cfg = DEFAULT_PATTERN_CONFIG.channelBreakout): ChannelBreakout | null {
  const { lookback, minR2, slopeParallelismPct, minSwingPoints, volumeRatio: minVolRatio } = cfg;
  if (candles.length < lookback + SKIP_OPEN) return null;

  for (let end = candles.length - 1; end >= SKIP_OPEN + lookback - 1; end--) {
    const windowStart = end - lookback + 1;
    const window = candles.slice(windowStart, end); // exclude last (breakout) candle

    const swingHighs = findSwingHighs(window, 3);
    const swingLows = findSwingLows(window, 3);
    if (swingHighs.length < minSwingPoints || swingLows.length < minSwingPoints) continue;

    // Regress swing highs and lows
    const highReg = linearRegression(swingHighs.map(i => window[i].high));
    const lowReg = linearRegression(swingLows.map(i => window[i].low));

    if (highReg.r2 < minR2 || lowReg.r2 < minR2) continue;

    // Slopes should be roughly parallel (within 15%)
    // Use position-aware regression: x = index in window
    const highPosReg = linearRegression(
      swingHighs.map(i => window[i].high),
    );
    const lowPosReg = linearRegression(
      swingLows.map(i => window[i].low),
    );
    // Re-compute with actual x positions for proper slope
    const highXY = swingHighs.map((idx, i) => ({ x: idx, y: window[idx].high }));
    const lowXY = swingLows.map((idx, i) => ({ x: idx, y: window[idx].low }));

    const hSlope = regWithX(highXY);
    const lSlope = regWithX(lowXY);

    if (hSlope.r2 < minR2 || lSlope.r2 < minR2) continue;

    // Parallel check
    const avgSlope = (Math.abs(hSlope.slope) + Math.abs(lSlope.slope)) / 2;
    if (avgSlope > 0 && Math.abs(hSlope.slope - lSlope.slope) / avgSlope > slopeParallelismPct / 100) continue;

    // Upper channel value at last candle
    const lastIdx = window.length - 1;
    const upperAtEnd = hSlope.intercept + hSlope.slope * lastIdx;

    // Breakout
    if (candles[end].close <= upperAtEnd) continue;

    // Volume
    const avg = avgVolume(candles.slice(windowStart, end));
    const volRatio = candles[end].volume / (avg || 1);
    if (volRatio < minVolRatio) continue;

    return {
      type: 'channel-breakout',
      startIndex: windowStart,
      endIndex: end,
      startTime: candles[windowStart].timestamp.toISOString(),
      endTime: candles[end].timestamp.toISOString(),
      conviction: Math.min(((hSlope.r2 + lSlope.r2) / 2) * (volRatio / 2.5), 1),
      label: 'Channel Breakout',
      upperSlope: hSlope.slope,
      upperIntercept: hSlope.intercept,
      lowerSlope: lSlope.slope,
      lowerIntercept: lSlope.intercept,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Regression helper with explicit x values
// ---------------------------------------------------------------------------
function regWithX(points: { x: number; y: number }[]): { slope: number; intercept: number; r2: number } {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: points[0]?.y ?? 0, r2: 0 };
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (const { x, y } of points) {
    sumX += x; sumY += y; sumXY += x * y; sumX2 += x * x; sumY2 += y * y;
  }
  const denom = n * sumX2 - sumX ** 2;
  if (denom === 0) return { slope: 0, intercept: sumY / n, r2: 0 };
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  const ssTot = sumY2 - (sumY ** 2) / n;
  const ssRes = points.reduce((s, { x, y }) => s + (y - (intercept + slope * x)) ** 2, 0);
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;
  return { slope, intercept, r2 };
}

// ---------------------------------------------------------------------------
// 6. Double Bottom
//    Two swing lows at similar price (≤0.5% tolerance), with a peak between
//    them. Breakout close above the neckline (peak). Lookback: 50 candles.
// ---------------------------------------------------------------------------
export function detectDoubleBottom(candles: NormalizedCandle[], cfg = DEFAULT_PATTERN_CONFIG.doubleBottom): DoubleBottom | null {
  const { lookback, priceTolerance, minSeparation, volumeRatio: minVolRatio } = cfg;
  if (candles.length < lookback + SKIP_OPEN) return null;

  for (let end = candles.length - 1; end >= SKIP_OPEN + lookback - 1; end--) {
    const windowStart = end - lookback + 1;
    const window = candles.slice(windowStart, end + 1);

    const swingLows = findSwingLows(window, 3);
    if (swingLows.length < 2) continue;

    // Try pairs of swing lows
    for (let a = 0; a < swingLows.length - 1; a++) {
      for (let b = a + 1; b < swingLows.length; b++) {
        const i1 = swingLows[a];
        const i2 = swingLows[b];
        if (i2 - i1 < minSeparation) continue;

        const p1 = window[i1].low;
        const p2 = window[i2].low;
        // Similar price
        const avgPrice = (p1 + p2) / 2;
        if (Math.abs(p1 - p2) / avgPrice > priceTolerance) continue;

        // Find the neckline: highest high between the two bottoms
        const between = window.slice(i1, i2 + 1);
        const neckline = Math.max(...between.map(c => c.high));

        // Breakout: last candle closes above neckline
        if (candles[end].close <= neckline) continue;

        const avg = avgVolume(candles.slice(windowStart, end));
        const volRatio = candles[end].volume / (avg || 1);
        if (volRatio < minVolRatio) continue;

        return {
          type: 'double-bottom',
          startIndex: windowStart + i1,
          endIndex: end,
          startTime: candles[windowStart + i1].timestamp.toISOString(),
          endTime: candles[end].timestamp.toISOString(),
          conviction: Math.min((1 - Math.abs(p1 - p2) / avgPrice / 0.005) * (volRatio / 3), 1),
          label: 'Double Bottom',
          firstBottomPrice: p1,
          secondBottomPrice: p2,
          firstBottomIndex: windowStart + i1,
          secondBottomIndex: windowStart + i2,
          necklinePrice: neckline,
        };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// 7. Inside Bar Breakout
//    One or more candles whose entire range fits within the prior "mother"
//    bar's range, followed by a close above the mother bar's high.
//    Lookback: 10 candles.
// ---------------------------------------------------------------------------
export function detectInsideBarBreakout(candles: NormalizedCandle[], cfg = DEFAULT_PATTERN_CONFIG.insideBarBreakout): InsideBarBreakout | null {
  const { minInsideBars } = cfg;
  if (candles.length < 4 + SKIP_OPEN) return null;

  // Scan from most recent backward
  for (let end = candles.length - 1; end >= SKIP_OPEN + 2; end--) {
    // Walk backward to find inside bars
    let motherIdx = end - 1;
    let insideCount = 0;

    // Count consecutive inside bars ending at end-1
    while (motherIdx >= SKIP_OPEN + 1) {
      const mother = candles[motherIdx - 1];
      const child = candles[motherIdx];
      if (child.high <= mother.high && child.low >= mother.low) {
        insideCount++;
        motherIdx--;
      } else {
        break;
      }
    }

    if (insideCount < minInsideBars) continue;

    const mother = candles[motherIdx];
    const breakout = candles[end];

    // Breakout above mother bar high
    if (breakout.close <= mother.high) continue;

    // Volume confirmation
    const avg = avgVolume(candles.slice(Math.max(SKIP_OPEN, motherIdx - 10), motherIdx));
    const volRatio = breakout.volume / (avg || 1);

    return {
      type: 'inside-bar-breakout',
      startIndex: motherIdx,
      endIndex: end,
      startTime: candles[motherIdx].timestamp.toISOString(),
      endTime: candles[end].timestamp.toISOString(),
      conviction: Math.min((insideCount / 4 + volRatio / 4) * 0.8, 1),
      label: 'Inside Bar Breakout',
      motherBarIndex: motherIdx,
      insideBarCount: insideCount,
      motherBarHigh: mother.high,
      motherBarLow: mother.low,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// 8. VWAP Reclaim
//    Price dips below VWAP by ≥0.3%, then closes back above VWAP with
//    volume ≥ 1.3× average. Lookback: 30 candles.
// ---------------------------------------------------------------------------
export function detectVWAPReclaim(candles: NormalizedCandle[], cfg = DEFAULT_PATTERN_CONFIG.vwapReclaim): VWAPReclaim | null {
  const { lookback, minDipPct, volumeRatio: minVolRatio } = cfg;
  if (candles.length < lookback + SKIP_OPEN) return null;

  // Compute running VWAP for the full series
  const vwaps: number[] = [];
  let cumTPV = 0;
  let cumVol = 0;
  for (const c of candles) {
    const tp = (c.high + c.low + c.close) / 3;
    cumTPV += tp * c.volume;
    cumVol += c.volume;
    vwaps.push(cumVol > 0 ? cumTPV / cumVol : c.close);
  }

  for (let end = candles.length - 1; end >= SKIP_OPEN + lookback - 1; end--) {
    const windowStart = end - lookback + 1;
    const vwapNow = vwaps[end];

    // Current candle must close above VWAP
    if (candles[end].close <= vwapNow) continue;

    // Find the deepest dip below VWAP in the lookback window
    let maxDip = 0;
    let dipIdx = -1;
    for (let i = windowStart; i < end; i++) {
      const dip = (vwaps[i] - candles[i].low) / vwaps[i];
      if (dip > maxDip) {
        maxDip = dip;
        dipIdx = i;
      }
    }

    if (maxDip < minDipPct / 100 || dipIdx < 0) continue;

    // Confirm the dip candle was actually below VWAP
    if (candles[dipIdx].close >= vwaps[dipIdx]) continue;

    const avg = avgVolume(candles.slice(windowStart, end));
    const volRatio = candles[end].volume / (avg || 1);
    if (volRatio < minVolRatio) continue;

    return {
      type: 'vwap-reclaim',
      startIndex: dipIdx,
      endIndex: end,
      startTime: candles[dipIdx].timestamp.toISOString(),
      endTime: candles[end].timestamp.toISOString(),
      conviction: Math.min(maxDip * 50 * (volRatio / 3), 1),
      label: 'VWAP Reclaim',
      vwapPrice: vwapNow,
      dipPercent: maxDip * 100,
      volumeRatio: volRatio,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// 9. Symmetrical Triangle
//    Converging trendlines — descending swing highs + ascending swing lows,
//    with breakout above upper trendline. Lookback: 50 candles.
// ---------------------------------------------------------------------------
export function detectSymmetricalTriangle(candles: NormalizedCandle[], cfg = DEFAULT_PATTERN_CONFIG.symmetricalTriangle): SymmetricalTriangle | null {
  const { lookback, minR2, minSwingPoints, volumeRatio: minVolRatio } = cfg;
  if (candles.length < lookback + SKIP_OPEN) return null;

  for (let end = candles.length - 1; end >= SKIP_OPEN + lookback - 1; end--) {
    const windowStart = end - lookback + 1;
    const window = candles.slice(windowStart, end); // exclude breakout candle

    const swingHighs = findSwingHighs(window, 3);
    const swingLows = findSwingLows(window, 2);
    if (swingHighs.length < minSwingPoints || swingLows.length < minSwingPoints) continue;

    // Regress with actual x positions
    const highXY = swingHighs.map(idx => ({ x: idx, y: window[idx].high }));
    const lowXY = swingLows.map(idx => ({ x: idx, y: window[idx].low }));

    const hReg = regWithX(highXY);
    const lReg = regWithX(lowXY);

    if (hReg.r2 < minR2 || lReg.r2 < minR2) continue;

    // Upper trendline must slope down, lower must slope up (converging)
    if (hReg.slope >= 0 || lReg.slope <= 0) continue;

    // Lines should converge within the window (intersection point ahead or near end)
    // intersection at x = (lReg.intercept - hReg.intercept) / (hReg.slope - lReg.slope)
    const convergenceX = (lReg.intercept - hReg.intercept) / (hReg.slope - lReg.slope);
    if (convergenceX < window.length * 0.5) continue; // converge too early = not a triangle

    // Upper trendline at last candle
    const upperAtEnd = hReg.intercept + hReg.slope * (window.length - 1);

    // Breakout above upper trendline
    if (candles[end].close <= upperAtEnd) continue;

    // Volume confirmation
    const avg = avgVolume(candles.slice(windowStart, end));
    const volRatio = candles[end].volume / (avg || 1);
    if (volRatio < minVolRatio) continue;

    return {
      type: 'symmetrical-triangle',
      startIndex: windowStart,
      endIndex: end,
      startTime: candles[windowStart].timestamp.toISOString(),
      endTime: candles[end].timestamp.toISOString(),
      conviction: Math.min(((hReg.r2 + lReg.r2) / 2) * (volRatio / 2.5), 1),
      label: 'Symmetrical Triangle',
      upperSlope: hReg.slope,
      upperIntercept: hReg.intercept,
      lowerSlope: lReg.slope,
      lowerIntercept: lReg.intercept,
      swingPointCount: swingHighs.length + swingLows.length,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// 10. Bullish Engulfing
// ---------------------------------------------------------------------------
export function detectBullishEngulfing(candles: NormalizedCandle[], cfg = DEFAULT_PATTERN_CONFIG.bullishEngulfing): BullishEngulfing | null {
  if (candles.length < SKIP_OPEN + 3) return null;
  const avg = avgVolume(candles.slice(SKIP_OPEN, -1));
  // Scan from the end backwards for the most recent engulfing
  for (let i = candles.length - 1; i >= SKIP_OPEN + 1; i--) {
    const prev = candles[i - 1];
    const cur = candles[i];
    // Prior candle must be bearish
    if (prev.close >= prev.open) continue;
    // Current candle must be bullish and engulf prior body
    if (cur.close <= cur.open) continue;
    if (cur.open >= prev.close) continue; // open must be at or below prior close
    if (cur.close <= prev.open) continue; // close must be above prior open
    const volRatio = avg > 0 ? cur.volume / avg : 1;
    if (volRatio < cfg.volumeRatio) continue;
    const bodySize = Math.abs(cur.close - cur.open);
    const priorBodySize = Math.abs(prev.open - prev.close);
    const conviction = Math.min((bodySize / (priorBodySize || 1)) * 0.4 + volRatio * 0.2, 1);
    return {
      type: 'bullish-engulfing',
      startIndex: i - 1,
      endIndex: i,
      startTime: prev.timestamp.toISOString(),
      endTime: cur.timestamp.toISOString(),
      conviction,
      label: 'Bullish Engulfing',
      priorClose: prev.close,
      priorOpen: prev.open,
      engulfOpen: cur.open,
      engulfClose: cur.close,
      volumeRatio: volRatio,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// 11. Morning Star (3-candle reversal)
// ---------------------------------------------------------------------------
export function detectMorningStar(candles: NormalizedCandle[], cfg = DEFAULT_PATTERN_CONFIG.morningStar): MorningStar | null {
  if (candles.length < SKIP_OPEN + 4) return null;
  const avg = avgVolume(candles.slice(SKIP_OPEN, -1));
  for (let i = candles.length - 1; i >= SKIP_OPEN + 2; i--) {
    const c1 = candles[i - 2]; // bearish candle
    const c2 = candles[i - 1]; // small body (doji/star)
    const c3 = candles[i];     // bullish candle
    // c1 must be bearish with decent body
    if (c1.close >= c1.open) continue;
    const c1Body = Math.abs(c1.open - c1.close);
    // c2 must have a small body (≤ 30% of c1 body)
    const c2Body = Math.abs(c2.open - c2.close);
    if (c2Body > c1Body * 0.3) continue;
    // c2 should gap down or be near c1's close
    if (c2.close > c1.close && c2.open > c1.close) continue;
    // c3 must be bullish and close above c1 midpoint
    if (c3.close <= c3.open) continue;
    const c1Mid = (c1.open + c1.close) / 2;
    if (c3.close < c1Mid) continue;
    const volRatio = avg > 0 ? c3.volume / avg : 1;
    if (volRatio < cfg.volumeRatio) continue;
    const conviction = Math.min(((c3.close - c3.open) / (c1Body || 1)) * 0.5 + volRatio * 0.2, 1);
    return {
      type: 'morning-star',
      startIndex: i - 2,
      endIndex: i,
      startTime: c1.timestamp.toISOString(),
      endTime: c3.timestamp.toISOString(),
      conviction,
      label: 'Morning Star',
      firstClose: c1.close,
      dojiClose: c2.close,
      thirdClose: c3.close,
      volumeRatio: volRatio,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// 12. Hammer / Inverted Hammer
// ---------------------------------------------------------------------------
export function detectHammer(candles: NormalizedCandle[], cfg = DEFAULT_PATTERN_CONFIG.hammer): HammerPattern | null {
  if (candles.length < SKIP_OPEN + 4) return null;
  const avg = avgVolume(candles.slice(SKIP_OPEN, -1));
  // Need a preceding downtrend (close declining over last 5+ candles)
  for (let i = candles.length - 1; i >= SKIP_OPEN + 5; i--) {
    const c = candles[i];
    const range = c.high - c.low;
    if (range <= 0) continue;
    const body = Math.abs(c.close - c.open);
    const bodyPct = (body / range) * 100;
    if (bodyPct > cfg.maxBodyPct) continue;
    // Check preceding downtrend (close 5 bars ago > current area)
    if (candles[i - 5].close <= c.low) continue;
    const bodyTop = Math.max(c.open, c.close);
    const bodyBot = Math.min(c.open, c.close);
    const lowerWick = bodyBot - c.low;
    const upperWick = c.high - bodyTop;
    const volRatio = avg > 0 ? c.volume / avg : 1;
    if (volRatio < cfg.volumeRatio) continue;
    // Hammer: long lower wick
    if (lowerWick >= body * cfg.minWickRatio && lowerWick > upperWick * 2) {
      return {
        type: 'hammer',
        startIndex: i,
        endIndex: i,
        startTime: c.timestamp.toISOString(),
        endTime: c.timestamp.toISOString(),
        conviction: Math.min((lowerWick / range) * 0.7 + volRatio * 0.15, 1),
        label: 'Hammer',
        hammerType: 'hammer',
        bodyPct,
        wickRatio: lowerWick / (body || 1),
        volumeRatio: volRatio,
      };
    }
    // Inverted hammer: long upper wick
    if (upperWick >= body * cfg.minWickRatio && upperWick > lowerWick * 2) {
      return {
        type: 'hammer',
        startIndex: i,
        endIndex: i,
        startTime: c.timestamp.toISOString(),
        endTime: c.timestamp.toISOString(),
        conviction: Math.min((upperWick / range) * 0.6 + volRatio * 0.15, 1),
        label: 'Inverted Hammer',
        hammerType: 'inverted-hammer',
        bodyPct,
        wickRatio: upperWick / (body || 1),
        volumeRatio: volRatio,
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// 13. EMA Crossover (golden cross: short EMA crosses above long EMA)
// ---------------------------------------------------------------------------
export function detectEMACrossover(candles: NormalizedCandle[], cfg = DEFAULT_PATTERN_CONFIG.emaCrossover): EMACrossover | null {
  if (candles.length < cfg.longPeriod + 5) return null;
  const shortEMAs = calcEMA(candles, cfg.shortPeriod);
  const longEMAs = calcEMA(candles, cfg.longPeriod);
  // Scan from end for most recent bullish crossover
  for (let i = candles.length - 1; i >= cfg.longPeriod + 1; i--) {
    const prevShort = shortEMAs[i - 1];
    const prevLong = longEMAs[i - 1];
    const curShort = shortEMAs[i];
    const curLong = longEMAs[i];
    // Cross: previously short < long, now short >= long
    if (prevShort >= prevLong) continue;
    if (curShort < curLong) continue;
    const conviction = Math.min(((curShort - curLong) / (candles[i].close || 1)) * 200 + 0.4, 1);
    return {
      type: 'ema-crossover',
      startIndex: Math.max(0, i - cfg.longPeriod),
      endIndex: i,
      startTime: candles[Math.max(0, i - cfg.longPeriod)].timestamp.toISOString(),
      endTime: candles[i].timestamp.toISOString(),
      conviction,
      label: `EMA ${cfg.shortPeriod}/${cfg.longPeriod} Cross`,
      shortPeriod: cfg.shortPeriod,
      longPeriod: cfg.longPeriod,
      shortEMA: curShort,
      longEMA: curLong,
      crossoverPrice: candles[i].close,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// 14. Bollinger Squeeze Breakout
// ---------------------------------------------------------------------------
export function detectBollingerSqueeze(candles: NormalizedCandle[], cfg = DEFAULT_PATTERN_CONFIG.bollingerSqueeze): BollingerSqueeze | null {
  if (candles.length < cfg.lookback + cfg.bbPeriod) return null;
  const bands = calcBollingerBands(candles, cfg.bbPeriod);
  if (bands.length === 0) return null;
  // Compute bandwidths over lookback window
  const windowStart = candles.length - cfg.lookback;
  const bandwidths: number[] = [];
  for (let i = windowStart; i < candles.length; i++) {
    const b = bands[i];
    if (!b || b.middle === 0) continue;
    bandwidths.push((b.upper - b.lower) / b.middle);
  }
  if (bandwidths.length < 10) return null;
  // Find the squeeze threshold (bottom percentile)
  const sorted = [...bandwidths].sort((a, b) => a - b);
  const squeezeThreshold = sorted[Math.floor(sorted.length * cfg.squeezePercentile / 100)];
  // Check if current close is above upper band (breakout)
  const lastBand = bands[candles.length - 1];
  const lastClose = candles[candles.length - 1].close;
  if (lastClose <= lastBand.upper) return null;
  // Check if recent bandwidth was in squeeze territory
  const recentBW = bandwidths[bandwidths.length - 2]; // bar before breakout
  if (recentBW > squeezeThreshold) return null;
  const avg = avgVolume(candles.slice(Math.max(SKIP_OPEN, candles.length - 20), -1));
  const volRatio = avg > 0 ? candles[candles.length - 1].volume / avg : 1;
  if (volRatio < cfg.volumeRatio) return null;
  // Find where squeeze started
  let squeezeStart = candles.length - 2;
  for (let i = bandwidths.length - 2; i >= 0; i--) {
    if (bandwidths[i] > squeezeThreshold) {
      squeezeStart = windowStart + i + 1;
      break;
    }
  }
  return {
    type: 'bollinger-squeeze',
    startIndex: squeezeStart,
    endIndex: candles.length - 1,
    startTime: candles[squeezeStart].timestamp.toISOString(),
    endTime: candles[candles.length - 1].timestamp.toISOString(),
    conviction: Math.min((1 - recentBW / (squeezeThreshold * 2)) * 0.6 + volRatio * 0.2, 1),
    label: 'BB Squeeze Breakout',
    bandwidthAtSqueeze: recentBW,
    breakoutPrice: lastClose,
    upperBand: lastBand.upper,
    volumeRatio: volRatio,
  };
}

// ---------------------------------------------------------------------------
// 15. Gap & Go
// ---------------------------------------------------------------------------
export function detectGapAndGo(candles: NormalizedCandle[], cfg = DEFAULT_PATTERN_CONFIG.gapAndGo): GapAndGo | null {
  if (candles.length < SKIP_OPEN + cfg.holdBars + 2) return null;
  const avg = avgVolume(candles.slice(SKIP_OPEN, -1));
  // Find gap-up at market open: compare prev day's last candle to today's open
  // We detect by finding a candle whose open is significantly above prior candle's close
  for (let i = candles.length - 1; i >= SKIP_OPEN + cfg.holdBars; i--) {
    const prev = candles[i - 1];
    const cur = candles[i];
    const gapPct = ((cur.open - prev.close) / prev.close) * 100;
    if (gapPct < cfg.minGapPct) continue;
    // Check that the gap holds for the next holdBars candles (doesn't fill)
    let gapHeld = true;
    const endIdx = Math.min(i + cfg.holdBars, candles.length - 1);
    for (let j = i; j <= endIdx; j++) {
      if (candles[j].low < prev.close) { gapHeld = false; break; }
    }
    if (!gapHeld) continue;
    // Volume on the gap candle
    const volRatio = avg > 0 ? cur.volume / avg : 1;
    if (volRatio < cfg.volumeRatio) continue;
    // Confirm price moves higher after gap
    if (candles[endIdx].close <= cur.open) continue;
    return {
      type: 'gap-and-go',
      startIndex: i - 1,
      endIndex: endIdx,
      startTime: prev.timestamp.toISOString(),
      endTime: candles[endIdx].timestamp.toISOString(),
      conviction: Math.min(gapPct / 10 + volRatio * 0.2, 1),
      label: 'Gap & Go',
      gapPct,
      previousClose: prev.close,
      openPrice: cur.open,
      volumeRatio: volRatio,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// 16. Cup & Handle
// ---------------------------------------------------------------------------
export function detectCupAndHandle(candles: NormalizedCandle[], cfg = DEFAULT_PATTERN_CONFIG.cupAndHandle): CupAndHandle | null {
  if (candles.length < cfg.minCupBars + 10) return null;
  const end = candles.length - 1;
  const windowStart = Math.max(SKIP_OPEN, end - cfg.lookback);
  // Find the highest price in the window as the "rim"
  let rimIdx = windowStart;
  for (let i = windowStart; i <= end; i++) {
    if (candles[i].high > candles[rimIdx].high) rimIdx = i;
  }
  // Rim should not be at the very end
  if (rimIdx > end - 5) return null;
  // Find lowest point between windowStart and rimIdx (or after rim) to form cup bottom
  // First, find left rim and right rim near same price
  // Left rim: high before the cup bottom
  // Find lowest low between windowStart and end
  let cupBottomIdx = windowStart;
  for (let i = windowStart; i <= end - 3; i++) {
    if (candles[i].low < candles[cupBottomIdx].low) cupBottomIdx = i;
  }
  // Cup bottom should be between some candles
  if (cupBottomIdx <= windowStart + 3 || cupBottomIdx >= end - 5) return null;
  // Left rim: highest high before cup bottom
  let leftRimIdx = windowStart;
  for (let i = windowStart; i < cupBottomIdx; i++) {
    if (candles[i].high > candles[leftRimIdx].high) leftRimIdx = i;
  }
  // Right rim: highest high after cup bottom
  let rightRimIdx = cupBottomIdx + 1;
  for (let i = cupBottomIdx + 1; i <= end; i++) {
    if (candles[i].high > candles[rightRimIdx].high) rightRimIdx = i;
  }
  const leftRim = candles[leftRimIdx].high;
  const rightRim = candles[rightRimIdx].high;
  const rimPrice = Math.min(leftRim, rightRim);
  const cupBottom = candles[cupBottomIdx].low;
  // Cup must be at least minCupBars wide
  if (rightRimIdx - leftRimIdx < cfg.minCupBars) return null;
  // Cup depth check
  const cupDepthPct = ((rimPrice - cupBottom) / rimPrice) * 100;
  if (cupDepthPct > cfg.maxCupDepthPct || cupDepthPct < 3) return null;
  // Rims should be roughly equal (within 3%)
  if (Math.abs(leftRim - rightRim) / rimPrice > 0.03) return null;
  // Handle: small pullback after right rim
  if (rightRimIdx >= end - 1) return null;
  let handleLowIdx = rightRimIdx + 1;
  for (let i = rightRimIdx + 1; i <= end; i++) {
    if (candles[i].low < candles[handleLowIdx].low) handleLowIdx = i;
  }
  const handleLow = candles[handleLowIdx].low;
  const handleRetrace = ((rightRim - handleLow) / (rightRim - cupBottom)) * 100;
  if (handleRetrace > cfg.maxHandleRetracePct) return null;
  // Breakout: last candle should close above rim price
  if (candles[end].close < rimPrice) return null;
  const conviction = Math.min((1 - cupDepthPct / 50) * 0.5 + (1 - handleRetrace / 100) * 0.3, 1);
  return {
    type: 'cup-and-handle',
    startIndex: leftRimIdx,
    endIndex: end,
    startTime: candles[leftRimIdx].timestamp.toISOString(),
    endTime: candles[end].timestamp.toISOString(),
    conviction,
    label: 'Cup & Handle',
    cupStartPrice: leftRim,
    cupBottomPrice: cupBottom,
    cupEndPrice: rightRim,
    handleLowPrice: handleLow,
    rimPrice,
    cupDepthPct,
  };
}

// ---------------------------------------------------------------------------
// 17. Falling Wedge (bullish reversal)
// ---------------------------------------------------------------------------
export function detectFallingWedge(candles: NormalizedCandle[], cfg = DEFAULT_PATTERN_CONFIG.fallingWedge): FallingWedge | null {
  if (candles.length < cfg.lookback) return null;
  const end = candles.length - 1;
  const windowStart = Math.max(SKIP_OPEN, end - cfg.lookback);
  const window = candles.slice(windowStart, end); // exclude last candle (breakout)
  const swingHighs = findSwingHighs(window);
  const swingLows = findSwingLows(window);
  if (swingHighs.length < cfg.minSwingPoints || swingLows.length < cfg.minSwingPoints) return null;
  const hVals = swingHighs.map(i => window[i].high);
  const hIdxs = swingHighs;
  const lVals = swingLows.map(i => window[i].low);
  const lIdxs = swingLows;
  const hReg = linearRegression(hVals);
  const lReg = linearRegression(lVals);
  if (hReg.r2 < cfg.minR2 || lReg.r2 < cfg.minR2) return null;
  // Both trendlines must slope downward
  if (hReg.slope >= 0 || lReg.slope >= 0) return null;
  // Upper trendline should slope more steeply than lower (converging)
  if (hReg.slope >= lReg.slope) return null;
  // Breakout: last candle closes above upper trendline
  const upperAtEnd = hReg.intercept + hReg.slope * (hIdxs.length); // extrapolate
  if (candles[end].close <= upperAtEnd) {
    // Try against the last swing high value
    const lastHighVal = hVals[hVals.length - 1];
    if (candles[end].close <= lastHighVal) return null;
  }
  const avg = avgVolume(candles.slice(Math.max(SKIP_OPEN, end - 20), end));
  const volRatio = avg > 0 ? candles[end].volume / avg : 1;
  if (volRatio < cfg.volumeRatio) return null;
  return {
    type: 'falling-wedge',
    startIndex: windowStart,
    endIndex: end,
    startTime: candles[windowStart].timestamp.toISOString(),
    endTime: candles[end].timestamp.toISOString(),
    conviction: Math.min(((hReg.r2 + lReg.r2) / 2) * (volRatio / 2.5), 1),
    label: 'Falling Wedge',
    upperSlope: hReg.slope,
    upperIntercept: hReg.intercept,
    lowerSlope: lReg.slope,
    lowerIntercept: lReg.intercept,
    breakoutPrice: candles[end].close,
    volumeRatio: volRatio,
  };
}

// ---------------------------------------------------------------------------
// Master detector — runs all patterns and returns all found
// ---------------------------------------------------------------------------
export function detectAllPatterns(candles: NormalizedCandle[], config: PatternConfig = DEFAULT_PATTERN_CONFIG): PatternResult[] {
  const results: PatternResult[] = [];
  if (config.volumeBreakout.enabled) {
    const vb = detectVolumeBreakout(candles, config.volumeBreakout);
    if (vb) results.push(vb);
  }
  if (config.consolidationBreakout.enabled) {
    const cb = detectConsolidationBreakout(candles, config.consolidationBreakout);
    if (cb) results.push(cb);
  }
  if (config.bullFlag.enabled) {
    const bf = detectBullFlag(candles, config.bullFlag);
    if (bf) results.push(bf);
  }
  if (config.ascendingTriangle.enabled) {
    const at = detectAscendingTriangle(candles, config.ascendingTriangle);
    if (at) results.push(at);
  }
  if (config.channelBreakout.enabled) {
    const ch = detectChannelBreakout(candles, config.channelBreakout);
    if (ch) results.push(ch);
  }
  if (config.doubleBottom.enabled) {
    const db = detectDoubleBottom(candles, config.doubleBottom);
    if (db) results.push(db);
  }
  if (config.insideBarBreakout.enabled) {
    const ib = detectInsideBarBreakout(candles, config.insideBarBreakout);
    if (ib) results.push(ib);
  }
  if (config.vwapReclaim.enabled) {
    const vr = detectVWAPReclaim(candles, config.vwapReclaim);
    if (vr) results.push(vr);
  }
  if (config.symmetricalTriangle.enabled) {
    const st = detectSymmetricalTriangle(candles, config.symmetricalTriangle);
    if (st) results.push(st);
  }
  if (config.bullishEngulfing.enabled) {
    const be = detectBullishEngulfing(candles, config.bullishEngulfing);
    if (be) results.push(be);
  }
  if (config.morningStar.enabled) {
    const ms = detectMorningStar(candles, config.morningStar);
    if (ms) results.push(ms);
  }
  if (config.hammer.enabled) {
    const hm = detectHammer(candles, config.hammer);
    if (hm) results.push(hm);
  }
  if (config.emaCrossover.enabled) {
    const ec = detectEMACrossover(candles, config.emaCrossover);
    if (ec) results.push(ec);
  }
  if (config.bollingerSqueeze.enabled) {
    const bs = detectBollingerSqueeze(candles, config.bollingerSqueeze);
    if (bs) results.push(bs);
  }
  if (config.gapAndGo.enabled) {
    const gg = detectGapAndGo(candles, config.gapAndGo);
    if (gg) results.push(gg);
  }
  if (config.cupAndHandle.enabled) {
    const ch2 = detectCupAndHandle(candles, config.cupAndHandle);
    if (ch2) results.push(ch2);
  }
  if (config.fallingWedge.enabled) {
    const fw = detectFallingWedge(candles, config.fallingWedge);
    if (fw) results.push(fw);
  }
  return results;
}
