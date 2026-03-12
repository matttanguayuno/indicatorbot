/**
 * Next.js Instrumentation Hook
 * Runs once when the server starts. Sets up automatic server-side polling
 * so score evolution data is collected continuously without the app being open.
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

  // Check every 60s, and poll when market is open
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
}
