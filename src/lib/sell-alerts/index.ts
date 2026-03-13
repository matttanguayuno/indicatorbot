/**
 * Sell Alert Engine — evaluates active buy entries against latest snapshots.
 * Three severity levels:
 *   1 = Soft warning (momentum cooling)
 *   2 = Hard sell / trim (conditions weakening)
 *   3 = Exit fast / kill switch (rapid deterioration + confirming signals)
 */

import prisma from '@/lib/db';
import { sendPushToAll } from '@/lib/push';
import { getSellRules, type SellRules } from '@/lib/config';

interface SnapshotData {
  signalScore: number;
  currentPrice: number;
  pctFromVwap: number | null;
  volumeSpikeRatio: number | null;
  rvol: number | null;
  isBreakout: boolean;
  nearHigh: boolean;
}

interface SellAlertResult {
  symbol: string;
  level: number;
  reason: string;
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
  recentScores: { score: number; timestamp: Date }[],
  latest: SnapshotData,
  rules: SellRules,
): { level: number; reason: string } {
  if (recentScores.length < 2) return { level: 0, reason: '' };

  const currentScore = latest.signalScore;
  const peakScore = Math.max(entry.peakScoreSinceEntry, entry.scoreAtEntry);

  // Calculate score drop over recent snapshots (3-5 min windows)
  // Snapshots are ordered newest-first
  const now = recentScores[0].timestamp.getTime();
  const scores3min = recentScores.filter(s => now - s.timestamp.getTime() <= 3 * 60 * 1000);
  const scores5min = recentScores.filter(s => now - s.timestamp.getTime() <= 5 * 60 * 1000);

  const maxScore3min = scores3min.length > 0 ? Math.max(...scores3min.map(s => s.score)) : currentScore;
  const maxScore5min = scores5min.length > 0 ? Math.max(...scores5min.map(s => s.score)) : currentScore;

  const drop3min = maxScore3min - currentScore;
  const drop5min = maxScore5min - currentScore;
  const dropFromPeak = peakScore - currentScore;
  const dropFromPeakPct = peakScore > 0 ? (dropFromPeak / peakScore) * 100 : 0;
  const dropFromEntry = entry.scoreAtEntry - currentScore;

  // ── Level 3: Exit Fast / Kill Switch ──
  // Score drops significantly in under 5 minutes
  // + confirming signals: losing VWAP, volume drying up, failed breakout
  if (drop5min >= rules.level3.drop5min) {
    const confirmations: string[] = [];
    if (latest.pctFromVwap !== null && latest.pctFromVwap < rules.level3.vwapBelow) {
      confirmations.push('below VWAP');
    }
    if (latest.rvol !== null && latest.rvol < rules.level3.rvolBelow) {
      confirmations.push('volume drying up');
    }
    if (!latest.isBreakout && !latest.nearHigh) {
      confirmations.push('lost breakout');
    }

    const conf = confirmations.length > 0 ? ` (${confirmations.join(', ')})` : '';
    return {
      level: 3,
      reason: `Score crashed ${drop5min.toFixed(0)} pts in 5min${conf}`,
    };
  }

  // ── Level 2: Hard Sell / Trim ──
  // Score drops significantly in 3-5 minutes
  // OR score falls below entry and keeps falling
  if (drop5min >= rules.level2.drop5min || drop3min >= rules.level2.drop3min) {
    const window = drop3min >= rules.level2.drop3min ? '3min' : '5min';
    const dropVal = drop3min >= rules.level2.drop3min ? drop3min : drop5min;
    return {
      level: 2,
      reason: `Score dropped ${dropVal.toFixed(0)} pts in ${window} (entry: ${entry.scoreAtEntry.toFixed(0)}, now: ${currentScore.toFixed(0)})`,
    };
  }

  if (dropFromEntry >= rules.level2.dropFromEntry && drop3min >= rules.level2.dropFromEntryConfirm3min) {
    return {
      level: 2,
      reason: `Score fell ${dropFromEntry.toFixed(0)} pts below entry (${entry.scoreAtEntry.toFixed(0)} → ${currentScore.toFixed(0)}) and still falling`,
    };
  }

  // ── Level 1: Soft Warning ──
  // Score drops in 3 minutes
  // OR score loses % from peak after entry
  if (drop3min >= rules.level1.drop3min) {
    return {
      level: 1,
      reason: `Score dipped ${drop3min.toFixed(0)} pts in 3min (${maxScore3min.toFixed(0)} → ${currentScore.toFixed(0)})`,
    };
  }

  if (dropFromPeakPct >= rules.level1.dropFromPeakPct && dropFromPeak >= rules.level1.dropFromPeakAbs) {
    return {
      level: 1,
      reason: `Score down ${dropFromPeakPct.toFixed(0)}% from peak (${peakScore.toFixed(0)} → ${currentScore.toFixed(0)})`,
    };
  }

  return { level: 0, reason: '' };
}

const LEVEL_LABELS: Record<number, { emoji: string; label: string }> = {
  1: { emoji: '⚠️', label: 'Soft Warning' },
  2: { emoji: '🔴', label: 'Hard Sell' },
  3: { emoji: '🚨', label: 'EXIT NOW' },
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
    const recentSnapshots = await prisma.signalSnapshot.findMany({
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
    const recentScores = recentSnapshots.map(s => ({
      score: s.signalScore,
      timestamp: s.timestamp,
    }));

    const { level, reason } = evaluateSellAlert(
      { ...entry, peakScoreSinceEntry: newPeak },
      recentScores,
      latestSnap,
      rules,
    );

    if (level === 0) continue;

    // Only alert if level is higher than last alert, or cooldown has expired
    const cooldownExpired = !entry.lastSellAlertAt ||
      Date.now() - entry.lastSellAlertAt.getTime() > rules.cooldownMin * 60 * 1000;

    if (level <= entry.lastSellAlertLevel && !cooldownExpired) continue;

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
