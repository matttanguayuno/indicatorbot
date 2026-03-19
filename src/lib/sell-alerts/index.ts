/**
 * Sell Alert Engine — evaluates active buy entries against latest snapshots.
 *
 * Core principle: Score drops ARM the alert, price action CONFIRMS it.
 *
 * Trend states gate which levels can fire:
 *   STRONG_UP → suppresses all sell alerts
 *   PULLBACK  → only Level 1 can fire (with weakness confirmation)
 *   BROKEN    → Level 1, 2, and 3 can fire
 *
 * Three severity levels:
 *   1 = Momentum Cooling  (⚠️)
 *   2 = Trend Weakening   (🟠)
 *   3 = Structure Failed   (🔴)
 */

import prisma from '@/lib/db';
import { sendPushToAll } from '@/lib/push';
import { getSellRules, type SellRules } from '@/lib/config';

interface RecentSnapshot {
  signalScore: number;
  currentPrice: number;
  pctFromVwap: number | null;
  volumeSpikeRatio: number | null;
  rvol: number | null;
  isBreakout: boolean;
  nearHigh: boolean;
  timestamp: Date;
}

type TrendState = 'STRONG_UP' | 'PULLBACK' | 'BROKEN';

interface SellAlertResult {
  symbol: string;
  level: number;
  reason: string;
}

/**
 * Determine trend state from recent snapshots.
 */
function getTrendState(latest: RecentSnapshot, snapshots: RecentSnapshot[], rules: SellRules): TrendState {
  const aboveVwap = latest.pctFromVwap !== null && latest.pctFromVwap > 0;
  const hasRvol = latest.rvol !== null && latest.rvol >= rules.suppressor.minRvol;

  // STRONG_UP: above VWAP + nearHigh + breakout + healthy volume
  if (aboveVwap && latest.nearHigh && latest.isBreakout && hasRvol) {
    return 'STRONG_UP';
  }

  // BROKEN: below VWAP meaningfully + lost breakout + nearHigh false for 2+ consecutive snaps
  const belowVwap = latest.pctFromVwap !== null && latest.pctFromVwap < rules.level2.vwapBelow;
  const nearHighFalseCount = snapshots.slice(0, 3).filter(s => !s.nearHigh).length;

  if (belowVwap && !latest.isBreakout && nearHighFalseCount >= 2) {
    return 'BROKEN';
  }

  return 'PULLBACK';
}

/**
 * Count price-action confirmations that the trade is deteriorating.
 */
function countConfirmations(
  latest: RecentSnapshot,
  snapshots: RecentSnapshot[],
  entryScore: number,
  rules: SellRules,
): { count: number; details: string[] } {
  const details: string[] = [];

  // 1. Below VWAP
  if (latest.pctFromVwap !== null && latest.pctFromVwap < 0) {
    details.push('below VWAP');
  }

  // 2. Breakout lost
  if (!latest.isBreakout) {
    details.push('breakout lost');
  }

  // 3. Near high false for 2+ consecutive snapshots
  const nearHighFalseCount = snapshots.slice(0, 3).filter(s => !s.nearHigh).length;
  if (nearHighFalseCount >= 2) {
    details.push('lost near-high');
  }

  // 4. Lower low printed (price declining across recent snapshots)
  if (snapshots.length >= 3) {
    const prices = snapshots.slice(0, 3).map(s => s.currentPrice);
    if (prices[0] < prices[1] && prices[1] < prices[2]) {
      details.push('lower lows');
    }
  }

  // 5. Sell volume spike
  if (latest.volumeSpikeRatio !== null && latest.volumeSpikeRatio > 2.0) {
    details.push('volume spike');
  }

  // 6. Score well below entry
  if (latest.signalScore < entryScore - 15) {
    details.push('score collapsed vs entry');
  }

  // 7. RVOL drying up
  if (latest.rvol !== null && latest.rvol < rules.level3.rvolBelow) {
    details.push('volume drying up');
  }

  // 8. Deep below VWAP
  if (latest.pctFromVwap !== null && latest.pctFromVwap < rules.level3.vwapBelow) {
    details.push('deep below VWAP');
  }

  return { count: details.length, details };
}

/**
 * Evaluate a single buy entry against recent snapshots.
 * Returns the alert level (0 = no alert) and reason.
 */
function evaluateSellAlert(
  entry: {
    scoreAtEntry: number;
    peakScoreSinceEntry: number;
    lastSellAlertLevel: number;
    boughtAt: Date;
  },
  snapshots: RecentSnapshot[],
  rules: SellRules,
): { level: number; reason: string } {
  if (snapshots.length < 2) return { level: 0, reason: '' };

  const latest = snapshots[0];
  const currentScore = latest.signalScore;
  const peakScore = Math.max(entry.peakScoreSinceEntry, entry.scoreAtEntry);

  // ── Determine trend state ──
  const trend = getTrendState(latest, snapshots, rules);

  // STRONG_UP suppresses all sell alerts
  if (trend === 'STRONG_UP') return { level: 0, reason: '' };

  // ── Calculate score drops (ARM the alert) ──
  const now = snapshots[0].timestamp.getTime();
  const scores3min = snapshots.filter(s => now - s.timestamp.getTime() <= 3 * 60 * 1000);
  const scores5min = snapshots.filter(s => now - s.timestamp.getTime() <= 5 * 60 * 1000);

  const maxScore3min = scores3min.length > 0 ? Math.max(...scores3min.map(s => s.signalScore)) : currentScore;
  const maxScore5min = scores5min.length > 0 ? Math.max(...scores5min.map(s => s.signalScore)) : currentScore;

  const drop3min = maxScore3min - currentScore;
  const drop5min = maxScore5min - currentScore;
  const dropFromPeak = peakScore - currentScore;
  const dropFromPeakPct = peakScore > 0 ? (dropFromPeak / peakScore) * 100 : 0;
  const dropFromEntry = entry.scoreAtEntry - currentScore;

  // ── Count price confirmations (CONFIRM the alert) ──
  const { count: confirmCount, details } = countConfirmations(latest, snapshots, entry.scoreAtEntry, rules);
  const confStr = details.length > 0 ? ` (${details.join(', ')})` : '';

  // ── Level 3: Structure Failed (BROKEN trend only) ──
  if (trend === 'BROKEN') {
    const scoreArmed = drop5min >= rules.level3.drop5min || drop3min >= rules.level3.drop3min;
    if (scoreArmed && confirmCount >= rules.level3.minConfirmations) {
      const window = drop3min >= rules.level3.drop3min ? '3min' : '5min';
      const dropVal = drop3min >= rules.level3.drop3min ? drop3min : drop5min;
      return {
        level: 3,
        reason: `Score dropped ${dropVal.toFixed(0)} pts in ${window}, ${confirmCount} confirmations${confStr}`,
      };
    }
  }

  // ── Level 2: Trend Weakening (BROKEN trend only) ──
  if (trend === 'BROKEN') {
    const scoreArmed =
      drop5min >= rules.level2.drop5min ||
      drop3min >= rules.level2.drop3min ||
      (dropFromEntry >= rules.level2.dropFromEntry && drop3min >= rules.level2.dropFromEntryConfirm3min);

    if (scoreArmed && confirmCount >= rules.level2.minConfirmations) {
      const reason = dropFromEntry >= rules.level2.dropFromEntry
        ? `Score fell ${dropFromEntry.toFixed(0)} pts below entry (${entry.scoreAtEntry.toFixed(0)} → ${currentScore.toFixed(0)}), ${confirmCount} confirmations${confStr}`
        : `Score dropped ${(drop3min >= rules.level2.drop3min ? drop3min : drop5min).toFixed(0)} pts, ${confirmCount} confirmations${confStr}`;
      return { level: 2, reason };
    }
  }

  // ── Level 1: Momentum Cooling (PULLBACK or BROKEN) ──
  const l1ScoreArmed =
    drop3min >= rules.level1.drop3min ||
    (dropFromPeakPct >= rules.level1.dropFromPeakPct && dropFromPeak >= rules.level1.dropFromPeakAbs);

  if (l1ScoreArmed) {
    // Need at least minWeakness confirmations
    const weaknessCount = [
      !latest.nearHigh,
      latest.rvol !== null && latest.rvol < rules.suppressor.minRvol,
      latest.pctFromVwap !== null && latest.pctFromVwap < 0,
    ].filter(Boolean).length;

    if (weaknessCount >= rules.level1.minWeakness) {
      const triggerReason = drop3min >= rules.level1.drop3min
        ? `Score dipped ${drop3min.toFixed(0)} pts in 3min (${maxScore3min.toFixed(0)} → ${currentScore.toFixed(0)})`
        : `Score down ${dropFromPeakPct.toFixed(0)}% from peak (${peakScore.toFixed(0)} → ${currentScore.toFixed(0)})`;
      return {
        level: 1,
        reason: triggerReason,
      };
    }
  }

  return { level: 0, reason: '' };
}

const LEVEL_LABELS: Record<number, { emoji: string; label: string }> = {
  1: { emoji: '⚠️', label: 'Momentum Cooling' },
  2: { emoji: '🟠', label: 'Trend Weakening' },
  3: { emoji: '🔴', label: 'Structure Failed' },
};

/**
 * Check all active buy entries and send sell alerts as needed.
 * Called after each polling cycle.
 */
export async function checkSellAlerts(): Promise<SellAlertResult[]> {
  const activeEntries = await prisma.buyEntry.findMany({
    where: { active: true },
  });

  if (activeEntries.length === 0) return [];

  const rules = await getSellRules();
  const results: SellAlertResult[] = [];

  for (const entry of activeEntries) {
    // Get recent snapshots for this symbol
    const recentSnapshots: RecentSnapshot[] = await prisma.signalSnapshot.findMany({
      where: {
        symbol: entry.symbol,
        timestamp: { gte: new Date(Date.now() - rules.lookbackMin * 60 * 1000) },
      },
      orderBy: { timestamp: 'desc' },
      take: rules.maxSnapshots,
      select: {
        signalScore: true,
        currentPrice: true,
        pctFromVwap: true,
        volumeSpikeRatio: true,
        rvol: true,
        isBreakout: true,
        nearHigh: true,
        timestamp: true,
      },
    });

    if (recentSnapshots.length === 0) continue;

    const latestSnap = recentSnapshots[0];

    // Update peak score
    const newPeak = Math.max(entry.peakScoreSinceEntry, latestSnap.signalScore);
    if (newPeak > entry.peakScoreSinceEntry) {
      await prisma.buyEntry.update({
        where: { id: entry.id },
        data: { peakScoreSinceEntry: newPeak },
      });
    }

    // Evaluate sell alert level
    const { level, reason } = evaluateSellAlert(
      { ...entry, peakScoreSinceEntry: newPeak },
      recentSnapshots,
      rules,
    );

    if (level === 0) continue;

    // Only alert if level is strictly higher than the last alert sent.
    // Same-level or lower-level alerts are never repeated.
    if (level <= entry.lastSellAlertLevel) continue;

    // Send push notification
    const { emoji, label } = LEVEL_LABELS[level] ?? { emoji: '⚠️', label: 'Sell Alert' };
    const pricePct = ((latestSnap.currentPrice - entry.entryPrice) / entry.entryPrice * 100).toFixed(1);
    const priceDir = latestSnap.currentPrice >= entry.entryPrice ? '+' : '';

    await sendPushToAll({
      title: `${emoji} ${entry.symbol} — ${label}`,
      body: `${reason}\nP&L: ${priceDir}${pricePct}% ($${entry.entryPrice.toFixed(2)} → $${latestSnap.currentPrice.toFixed(2)})`,
      symbol: entry.symbol,
      score: latestSnap.signalScore,
    }).catch((err) => console.error('[Sell Alert] Push error:', err));

    // Create Alert record for the sell alert
    const sellExplanation = `${label}: ${reason}\nP&L: ${priceDir}${pricePct}% ($${entry.entryPrice.toFixed(2)} → $${latestSnap.currentPrice.toFixed(2)})`;
    await prisma.alert.create({
      data: {
        tickerId: entry.tickerId,
        symbol: entry.symbol,
        alertType: 'sell',
        sellAlertLevel: level,
        scoreAtAlert: latestSnap.signalScore,
        explanation: sellExplanation,
      },
    });

    // Update entry with alert state
    await prisma.buyEntry.update({
      where: { id: entry.id },
      data: {
        lastSellAlertLevel: level,
        lastSellAlertAt: new Date(),
      },
    });

    console.log(`[Sell Alert] ${label} for ${entry.symbol}: ${reason}`);
    results.push({ symbol: entry.symbol, level, reason });
  }

  return results;
}
