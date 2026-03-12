/**
 * Next.js Instrumentation Hook
 * Runs once when the server starts. Sets up:
 * 1. Automatic server-side polling for score evolution during market hours.
 * 2. Scheduled Webull screener sync at configured times (Mountain Time).
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

  // Initial poll after 10s delay
  setTimeout(tick, 10_000);

  // Align recurring polls to the next clock minute boundary
  const now = Date.now();
  const msUntilNextMinute = 60_000 - (now % 60_000);
  setTimeout(() => {
    tick(); // fire at the top of the minute
    setInterval(tick, intervalMs); // then every interval, aligned
  }, msUntilNextMinute);

  // ─── Screener sync scheduler ─────────────────────────────────────────
  // Sync windows: 6:30 AM, 10:00 AM, 1:00 PM Mountain Time (America/Denver)
  const SYNC_WINDOWS_MT = [
    { hour: 6, minute: 30 },
    { hour: 10, minute: 0 },
    { hour: 13, minute: 0 },
  ];

  let lastSyncDate = ''; // "YYYY-MM-DD-HH:MM" to prevent duplicate triggers

  async function screenerTick() {
    const nowDate = new Date();
    const mt = new Date(nowDate.toLocaleString('en-US', { timeZone: 'America/Denver' }));
    const day = mt.getDay();

    // Only Mon–Fri
    if (day < 1 || day > 5) return;

    const hours = mt.getHours();
    const minutes = mt.getMinutes();

    // Check if we're within ±2 minutes of any sync window
    const matchingWindow = SYNC_WINDOWS_MT.find((w) => {
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
      const { scrapeWebullScreener } = await import('@/lib/scraper/webull');
      const prisma = (await import('@/lib/db')).default;

      const settings = await prisma.appSettings.findFirst();
      const topN = settings?.screenerTopN ?? 30;

      const scraped = await scrapeWebullScreener(topN);

      if (scraped.length === 0) {
        console.warn('[Screener Sync] Scraper returned 0 results — skipping sync');
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
  console.log('[Screener Sync] Scheduler started (6:30 AM, 10:00 AM, 1:00 PM MT, weekdays)');
  setInterval(screenerTick, 60_000);
}
