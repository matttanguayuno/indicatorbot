/**
 * Next.js Instrumentation Hook
 * Runs once when the server starts. Sets up:
 * 1. Automatic server-side polling for score evolution during market hours.
 * 2. Scheduled FMP screener sync at configured times (Mountain Time).
 */

export async function register() {
  // Only run in the Node.js runtime (not Edge)
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // Dynamically import to avoid bundling server code in edge
  const { runPollingCycle } = await import('@/lib/jobs');

  // Dynamically load settings for polling interval
  async function getPollingInterval(): Promise<number> {
    try {
      const prisma = (await import('@/lib/db')).default;
      const settings = await prisma.appSettings.findFirst();
      return (settings?.pollingIntervalSec ?? 60) * 1000;
    } catch {
      return 60_000; // default 60s
    }
  }

  function isMarketOpen(): boolean {
    const now = new Date();
    const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const day = et.getDay();
    const hours = et.getHours();
    const minutes = et.getMinutes();
    const time = hours * 60 + minutes;
    // Mon–Fri, 9:30 AM – 4:00 PM ET
    return day >= 1 && day <= 5 && time >= 570 && time < 960;
  }

  // ─── Polling scheduler ───────────────────────────────────────────────
  let polling = false;

  async function tick() {
    if (!isMarketOpen()) return;
    if (polling) return;

    polling = true;
    try {
      const result = await runPollingCycle();
      console.log(
        `[Server Poll] ${result.succeeded}/${result.processed} succeeded` +
        (result.failed > 0 ? `, ${result.failed} failed` : ''),
      );
    } catch (err) {
      console.error('[Server Poll] Error:', err instanceof Error ? err.message : err);
    } finally {
      polling = false;
    }
  }

  // Start the scheduler aligned to clock minutes so API credit usage
  // is predictable and doesn't straddle Twelve Data's per-minute windows.
  const intervalMs = await getPollingInterval();
  console.log(`[Server Poll] Scheduler started (interval: ${intervalMs / 1000}s, market hours only)`);

  // Align polls to the next clock minute boundary so Twelve Data
  // credit usage doesn't straddle their per-minute windows.
  const now = Date.now();
  const msUntilNextMinute = 60_000 - (now % 60_000);
  setTimeout(() => {
    tick(); // fire at the top of the minute
    setInterval(tick, intervalMs); // then every interval, aligned
  }, msUntilNextMinute);

  // ─── Screener sync scheduler ─────────────────────────────────────────
  // Sync windows loaded from DB (Mountain Time, America/Denver)
  const DEFAULT_SYNC_TIMES = '06:30,10:00,13:00';

  function parseSyncTimes(raw: string): { hour: number; minute: number }[] {
    return raw.split(',').map(s => s.trim()).filter(Boolean).map(s => {
      const [h, m] = s.split(':').map(Number);
      return { hour: h, minute: m };
    }).filter(w => !isNaN(w.hour) && !isNaN(w.minute));
  }

  let lastSyncDate = ''; // "YYYY-MM-DD-HH:MM" to prevent duplicate triggers

  async function screenerTick() {
    const nowDate = new Date();
    const mt = new Date(nowDate.toLocaleString('en-US', { timeZone: 'America/Denver' }));
    const day = mt.getDay();

    // Only Mon–Fri
    if (day < 1 || day > 5) return;

    const hours = mt.getHours();
    const minutes = mt.getMinutes();

    // Load sync windows from DB each tick so changes take effect without restart
    let syncWindows: { hour: number; minute: number }[];
    try {
      const prisma = (await import('@/lib/db')).default;
      const settings = await prisma.appSettings.findFirst() as Record<string, unknown> | null;
      const rawTimes = (typeof settings?.screenerSyncTimes === 'string' ? settings.screenerSyncTimes : null) ?? DEFAULT_SYNC_TIMES;
      syncWindows = parseSyncTimes(rawTimes);
    } catch {
      syncWindows = parseSyncTimes(DEFAULT_SYNC_TIMES);
    }

    // Check if we're within ±2 minutes of any sync window
    const matchingWindow = syncWindows.find((w) => {
      const windowMin = w.hour * 60 + w.minute;
      const currentMin = hours * 60 + minutes;
      return Math.abs(currentMin - windowMin) <= 2;
    });

    if (!matchingWindow) return;

    // De-duplicate: only run once per window
    const windowKey = `${mt.getFullYear()}-${mt.getMonth()}-${mt.getDate()}-${matchingWindow.hour}:${matchingWindow.minute}`;
    if (lastSyncDate === windowKey) return;
    lastSyncDate = windowKey;

    console.log(`[Screener Sync] Triggered at ${hours}:${String(minutes).padStart(2, '0')} MT`);

    try {
      const { screenFMP } = await import('@/lib/screener/fmp');
      const prisma = (await import('@/lib/db')).default;

      const settings = await prisma.appSettings.findFirst();
      const topN = settings?.screenerTopN ?? 30;

      const scraped = await screenFMP(topN);

      if (scraped.length === 0) {
        console.warn('[Screener Sync] FMP returned 0 results — skipping sync');
        return;
      }

      // Deactivate all tickers
      await prisma.ticker.updateMany({ data: { active: false } });

      // Upsert scraped tickers as active
      let added = 0;
      let reactivated = 0;
      for (const t of scraped) {
        const existing = await prisma.ticker.findUnique({ where: { symbol: t.symbol } });
        if (existing) {
          await prisma.ticker.update({
            where: { symbol: t.symbol },
            data: { active: true, name: t.name || existing.name },
          });
          reactivated++;
        } else {
          await prisma.ticker.create({
            data: { symbol: t.symbol, name: t.name || null, active: true },
          });
          added++;
        }
      }

      console.log(`[Screener Sync] Done — ${added} added, ${reactivated} reactivated, total ${scraped.length}`);
    } catch (err) {
      console.error('[Screener Sync] Error:', err instanceof Error ? err.message : err);
    }
  }

  // Check every 60s if it's time for a screener sync
  console.log('[Screener Sync] Scheduler started (times from DB, weekdays)');
  setInterval(screenerTick, 60_000);

  // ─── News summary scheduler ────────────────────────────────────────
  // Auto-generate AI news summaries at configured times (Mountain Time)
  const DEFAULT_NEWS_TIMES = '07:30,10:00';
  let lastNewsSummaryKey = '';

  async function newsSummaryTick() {
    const nowDate = new Date();
    const mt = new Date(nowDate.toLocaleString('en-US', { timeZone: 'America/Denver' }));
    const day = mt.getDay();

    // Only Mon–Fri
    if (day < 1 || day > 5) return;

    const hours = mt.getHours();
    const minutes = mt.getMinutes();

    // Load news summary times from DB
    let summaryWindows: { hour: number; minute: number }[];
    try {
      const prisma = (await import('@/lib/db')).default;
      const settings = await prisma.appSettings.findFirst() as Record<string, unknown> | null;
      const rawTimes = (typeof settings?.newsSummaryTimes === 'string' ? settings.newsSummaryTimes : null) ?? DEFAULT_NEWS_TIMES;
      summaryWindows = parseSyncTimes(rawTimes);
    } catch {
      summaryWindows = parseSyncTimes(DEFAULT_NEWS_TIMES);
    }

    const matchingWindow = summaryWindows.find((w) => {
      const windowMin = w.hour * 60 + w.minute;
      const currentMin = hours * 60 + minutes;
      return Math.abs(currentMin - windowMin) <= 2;
    });

    if (!matchingWindow) return;

    const windowKey = `news-${mt.getFullYear()}-${mt.getMonth()}-${mt.getDate()}-${matchingWindow.hour}:${matchingWindow.minute}`;
    if (lastNewsSummaryKey === windowKey) return;
    lastNewsSummaryKey = windowKey;

    console.log(`[News Summary] Auto-generating at ${hours}:${String(minutes).padStart(2, '0')} MT`);

    try {
      // First, refresh news from Finnhub for all tickers
      const { refreshNews } = await import('@/lib/jobs');
      const newsResult = await refreshNews();
      console.log(`[News] Fetched ${newsResult.fetched} articles for ${newsResult.symbols} tickers`);

      // Then generate the AI summary from the freshly-fetched articles
      const { generateNewsSummary } = await import('@/lib/news/summary');
      const data = await generateNewsSummary();
      console.log(`[News Summary] Done — ${data.symbols?.length ?? 0} symbols covered`);
    } catch (err) {
      console.error('[News Summary] Error:', err instanceof Error ? err.message : err);
    }
  }

  console.log('[News Summary] Scheduler started (times from DB, weekdays, MT)');
  setInterval(newsSummaryTick, 60_000);
}
