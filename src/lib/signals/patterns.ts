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
} from '../types';
import { calcBollingerBands, linearRegression } from './indicators';

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
export function detectVolumeBreakout(candles: NormalizedCandle[]): VolumeBreakout | null {
  const lookback = 22;
  if (candles.length < lookback + SKIP_OPEN) return null;

  // Scan from most recent backward (report only the latest pattern)
  for (let end = candles.length - 1; end >= SKIP_OPEN + lookback - 1; end--) {
    const windowStart = end - lookback + 1;
    const rangeCandles = candles.slice(windowStart, end - 1); // exclude last 2 for confirmation
    if (rangeCandles.length < 3) continue;

    const resistance = Math.max(...rangeCandles.map(c => c.high));
    const avg = avgVolume(rangeCandles);

    // Need 2 consecutive closes above resistance
    const c1 = candles[end - 1];
    const c2 = candles[end];
    if (c1.close <= resistance || c2.close <= resistance) continue;

    // Volume confirmation on breakout candle
    const volumeRatio = c1.volume / (avg || 1);
    if (volumeRatio < 1.5) continue;

    return {
      type: 'volume-breakout',
      startIndex: windowStart,
      endIndex: end,
      startTime: candles[windowStart].timestamp.toISOString(),
      endTime: candles[end].timestamp.toISOString(),
      conviction: Math.min(volumeRatio / 4, 1),
      label: 'Volume Breakout',
      resistancePrice: resistance,
      breakoutPrice: c1.close,
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
export function detectConsolidationBreakout(candles: NormalizedCandle[]): ConsolidationBreakout | null {
  const lookback = 35;
  if (candles.length < lookback + SKIP_OPEN) return null;

  const bb = calcBollingerBands(candles, 20);

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
    if (contraction < 0.4) continue;

    // Determine consolidation range from the narrow section
    const narrowStart = windowStart + peakIdx;
    const narrowCandles = candles.slice(narrowStart, end);
    if (narrowCandles.length < 3) continue;

    const rangeHigh = Math.max(...narrowCandles.map(c => c.high));
    const rangeLow = Math.min(...narrowCandles.map(c => c.low));

    const lastCandle = candles[end];
    // Break above range
    if (lastCandle.close <= rangeHigh) continue;

    // Volume surge
    const avg = avgVolume(narrowCandles);
    const volRatio = lastCandle.volume / (avg || 1);
    if (volRatio < 1.5) continue;

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
export function detectBullFlag(candles: NormalizedCandle[]): BullFlag | null {
  const lookback = 45;
  if (candles.length < lookback + SKIP_OPEN) return null;

  for (let end = candles.length - 1; end >= SKIP_OPEN + lookback - 1; end--) {
    const windowStart = end - lookback + 1;

    // Look for a strong pole: find the sharpest rally in the window
    for (let poleLen = 8; poleLen <= 15; poleLen++) {
      for (let poleStart = windowStart; poleStart <= end - poleLen - 5; poleStart++) {
        const poleEnd = poleStart + poleLen;
        const poleGain = (candles[poleEnd].close - candles[poleStart].low) / candles[poleStart].low;
        if (poleGain < 0.015) continue; // Need ≥1.5% gain

        // Flag: from poleEnd to end
        const flagCandles = candles.slice(poleEnd, end + 1);
        if (flagCandles.length < 4) continue;

        const poleHigh = Math.max(...candles.slice(poleStart, poleEnd + 1).map(c => c.high));
        const poleLow = candles[poleStart].low;
        const flagLow = Math.min(...flagCandles.map(c => c.low));

        // Retrace ≤50%
        const retrace = (poleHigh - flagLow) / (poleHigh - poleLow || 1);
        if (retrace > 0.5) continue;

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
export function detectAscendingTriangle(candles: NormalizedCandle[]): AscendingTriangle | null {
  const lookback = 60;
  if (candles.length < lookback + SKIP_OPEN) return null;

  for (let end = candles.length - 1; end >= SKIP_OPEN + lookback - 1; end--) {
    const windowStart = end - lookback + 1;
    const window = candles.slice(windowStart, end + 1);

    const swingHighs = findSwingHighs(window, 3);
    if (swingHighs.length < 3) continue;

    // Find flat resistance — cluster of swing highs within 0.3% tolerance
    const highPrices = swingHighs.map(i => window[i].high);
    const candidateResistance = highPrices.reduce((a, b) => a + b, 0) / highPrices.length;
    const tolerance = candidateResistance * 0.003;

    const touches = swingHighs.filter(i => Math.abs(window[i].high - candidateResistance) <= tolerance);
    if (touches.length < 3) continue;

    // Find rising swing lows
    const swingLows = findSwingLows(window, 2);
    if (swingLows.length < 2) continue;

    const lowPrices = swingLows.map(i => window[i].low);
    const reg = linearRegression(lowPrices);
    if (reg.slope <= 0 || reg.r2 < 0.5) continue;

    // Breakout: last candle closes above resistance
    if (candles[end].close <= candidateResistance + tolerance) continue;

    // Volume confirmation
    const avg = avgVolume(candles.slice(windowStart, end));
    const volRatio = candles[end].volume / (avg || 1);
    if (volRatio < 1.2) continue;

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
export function detectChannelBreakout(candles: NormalizedCandle[]): ChannelBreakout | null {
  const lookback = 53;
  if (candles.length < lookback + SKIP_OPEN) return null;

  for (let end = candles.length - 1; end >= SKIP_OPEN + lookback - 1; end--) {
    const windowStart = end - lookback + 1;
    const window = candles.slice(windowStart, end); // exclude last (breakout) candle

    const swingHighs = findSwingHighs(window, 3);
    const swingLows = findSwingLows(window, 3);
    if (swingHighs.length < 3 || swingLows.length < 3) continue;

    // Regress swing highs and lows
    const highReg = linearRegression(swingHighs.map(i => window[i].high));
    const lowReg = linearRegression(swingLows.map(i => window[i].low));

    if (highReg.r2 < 0.6 || lowReg.r2 < 0.6) continue;

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

    if (hSlope.r2 < 0.6 || lSlope.r2 < 0.6) continue;

    // Parallel check
    const avgSlope = (Math.abs(hSlope.slope) + Math.abs(lSlope.slope)) / 2;
    if (avgSlope > 0 && Math.abs(hSlope.slope - lSlope.slope) / avgSlope > 0.15) continue;

    // Upper channel value at last candle
    const lastIdx = window.length - 1;
    const upperAtEnd = hSlope.intercept + hSlope.slope * lastIdx;

    // Breakout
    if (candles[end].close <= upperAtEnd) continue;

    // Volume
    const avg = avgVolume(candles.slice(windowStart, end));
    const volRatio = candles[end].volume / (avg || 1);
    if (volRatio < 1.3) continue;

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
export function detectDoubleBottom(candles: NormalizedCandle[]): DoubleBottom | null {
  const lookback = 50;
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
        // Need some separation (at least 8 candles apart)
        if (i2 - i1 < 8) continue;

        const p1 = window[i1].low;
        const p2 = window[i2].low;
        // Similar price (within 0.5%)
        const avgPrice = (p1 + p2) / 2;
        if (Math.abs(p1 - p2) / avgPrice > 0.005) continue;

        // Find the neckline: highest high between the two bottoms
        const between = window.slice(i1, i2 + 1);
        const neckline = Math.max(...between.map(c => c.high));

        // Breakout: last candle closes above neckline
        if (candles[end].close <= neckline) continue;

        // Volume confirmation
        const avg = avgVolume(candles.slice(windowStart, end));
        const volRatio = candles[end].volume / (avg || 1);
        if (volRatio < 1.2) continue;

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
export function detectInsideBarBreakout(candles: NormalizedCandle[]): InsideBarBreakout | null {
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

    if (insideCount === 0) continue;

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
export function detectVWAPReclaim(candles: NormalizedCandle[]): VWAPReclaim | null {
  const lookback = 30;
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

    if (maxDip < 0.003 || dipIdx < 0) continue; // Need ≥0.3% dip below VWAP

    // Confirm the dip candle was actually below VWAP
    if (candles[dipIdx].close >= vwaps[dipIdx]) continue;

    // Volume confirmation on reclaim
    const avg = avgVolume(candles.slice(windowStart, end));
    const volRatio = candles[end].volume / (avg || 1);
    if (volRatio < 1.3) continue;

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
export function detectSymmetricalTriangle(candles: NormalizedCandle[]): SymmetricalTriangle | null {
  const lookback = 50;
  if (candles.length < lookback + SKIP_OPEN) return null;

  for (let end = candles.length - 1; end >= SKIP_OPEN + lookback - 1; end--) {
    const windowStart = end - lookback + 1;
    const window = candles.slice(windowStart, end); // exclude breakout candle

    const swingHighs = findSwingHighs(window, 3);
    const swingLows = findSwingLows(window, 2);
    if (swingHighs.length < 3 || swingLows.length < 3) continue;

    // Regress with actual x positions
    const highXY = swingHighs.map(idx => ({ x: idx, y: window[idx].high }));
    const lowXY = swingLows.map(idx => ({ x: idx, y: window[idx].low }));

    const hReg = regWithX(highXY);
    const lReg = regWithX(lowXY);

    if (hReg.r2 < 0.5 || lReg.r2 < 0.5) continue;

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
    if (volRatio < 1.2) continue;

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
// Master detector — runs all patterns and returns all found
// ---------------------------------------------------------------------------
export function detectAllPatterns(candles: NormalizedCandle[]): PatternResult[] {
  const results: PatternResult[] = [];
  const vb = detectVolumeBreakout(candles);
  if (vb) results.push(vb);
  const cb = detectConsolidationBreakout(candles);
  if (cb) results.push(cb);
  const bf = detectBullFlag(candles);
  if (bf) results.push(bf);
  const at = detectAscendingTriangle(candles);
  if (at) results.push(at);
  const ch = detectChannelBreakout(candles);
  if (ch) results.push(ch);
  const db = detectDoubleBottom(candles);
  if (db) results.push(db);
  const ib = detectInsideBarBreakout(candles);
  if (ib) results.push(ib);
  const vr = detectVWAPReclaim(candles);
  if (vr) results.push(vr);
  const st = detectSymmetricalTriangle(candles);
  if (st) results.push(st);
  return results;
}
