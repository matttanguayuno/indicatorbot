/**
 * Webull Screener Scraper
 *
 * Uses Playwright to log into Webull, load the saved "God" screener preset,
 * and scrape the top N ticker symbols from the results table.
 */

import { chromium, type Browser, type Page } from 'playwright';

export interface ScrapedTicker {
  symbol: string;
  name: string;
}

/**
 * Scrapes the Webull screener for the top `topN` symbols.
 * Launches a headless Chromium browser, logs in, loads the "God" preset,
 * scrolls through the table, and returns the results.
 */
export async function scrapeWebullScreener(topN: number): Promise<ScrapedTicker[]> {
  const email = process.env.WEBULL_EMAIL;
  const password = process.env.WEBULL_PASSWORD;
  const pin = process.env.WEBULL_PIN;

  if (!email || !password || !pin) {
    throw new Error('Missing WEBULL_EMAIL, WEBULL_PASSWORD, or WEBULL_PIN env vars');
  }

  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
    });

    const page = await context.newPage();

    // -- Step 1: Login --
    await login(page, email, password, pin);

    // -- Step 2: Navigate to screener --
    await page.goto('https://app.webull.com/screener', {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });
    await page.waitForTimeout(3000);

    // -- Step 3: Load the "God" preset --
    await loadPreset(page, 'God');

    // -- Step 4: Scrape the table --
    const tickers = await scrapeTable(page, topN);

    console.log(`[Screener] Scraped ${tickers.length} tickers`);
    return tickers;
  } finally {
    if (browser) await browser.close();
  }
}

async function login(page: Page, email: string, password: string, pin: string) {
  await page.goto('https://app.webull.com/account', {
    waitUntil: 'networkidle',
    timeout: 30_000,
  });
  await page.waitForTimeout(2000);

  // Click login/sign-in if there's a button
  const loginBtn = page.locator('text=/log in|sign in/i').first();
  if (await loginBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loginBtn.click();
    await page.waitForTimeout(2000);
  }

  // Fill email
  const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="mail" i]').first();
  await emailInput.waitFor({ timeout: 10_000 });
  await emailInput.fill(email);
  await page.waitForTimeout(500);

  // Click next/continue if present
  const nextBtn = page.locator('button:has-text("Next"), button:has-text("Continue")').first();
  if (await nextBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await nextBtn.click();
    await page.waitForTimeout(2000);
  }

  // Fill password
  const passwordInput = page.locator('input[type="password"]').first();
  await passwordInput.waitFor({ timeout: 10_000 });
  await passwordInput.fill(password);
  await page.waitForTimeout(500);

  // Submit login
  const submitBtn = page.locator('button[type="submit"], button:has-text("Log In"), button:has-text("Sign In")').first();
  await submitBtn.click();
  await page.waitForTimeout(5000);

  // Handle trading PIN if prompted
  const pinInput = page.locator('input[type="password"], input[placeholder*="pin" i], input[placeholder*="PIN"]').first();
  if (await pinInput.isVisible({ timeout: 5000 }).catch(() => false)) {
    await pinInput.fill(pin);
    await page.waitForTimeout(500);
    const pinSubmit = page.locator('button[type="submit"], button:has-text("Confirm"), button:has-text("Submit")').first();
    if (await pinSubmit.isVisible({ timeout: 2000 }).catch(() => false)) {
      await pinSubmit.click();
    }
    await page.waitForTimeout(3000);
  }

  console.log('[Screener] Login completed');
}

async function loadPreset(page: Page, presetName: string) {
  // Look for "My Screeners" tab or similar
  const myScreenersTab = page.locator('text=/my screener|saved|custom/i').first();
  if (await myScreenersTab.isVisible({ timeout: 5000 }).catch(() => false)) {
    await myScreenersTab.click();
    await page.waitForTimeout(2000);
  }

  // Click on the preset by name
  const preset = page.locator(`text="${presetName}"`).first();
  await preset.waitFor({ timeout: 10_000 });
  await preset.click();
  await page.waitForTimeout(3000);

  // Wait for table to populate
  await page.waitForSelector('table, [class*="table"], [class*="list"]', { timeout: 15_000 });
  await page.waitForTimeout(2000);

  console.log(`[Screener] Loaded preset "${presetName}"`);
}

async function scrapeTable(page: Page, topN: number): Promise<ScrapedTicker[]> {
  const tickers: ScrapedTicker[] = [];
  const seen = new Set<string>();

  // Try multiple scroll+scrape passes for virtualized tables
  for (let pass = 0; pass < Math.ceil(topN / 10) + 2; pass++) {
    // Extract rows from the table
    const rows = await page.evaluate(() => {
      const results: { symbol: string; name: string }[] = [];

      // Strategy 1: Look for table rows
      const tableRows = document.querySelectorAll('table tbody tr, [class*="table"] [class*="row"]');
      for (const row of tableRows) {
        const cells = row.querySelectorAll('td, [class*="cell"]');
        if (cells.length >= 2) {
          // The symbol is usually the first column, name in second or same cell
          const firstCell = cells[0]?.textContent?.trim() ?? '';
          const secondCell = cells[1]?.textContent?.trim() ?? '';

          // Match a ticker symbol pattern (1-5 uppercase letters)
          const symbolMatch = firstCell.match(/^([A-Z]{1,5})$/);
          if (symbolMatch) {
            results.push({ symbol: symbolMatch[1], name: secondCell });
            continue;
          }

          // Sometimes symbol and name are in the same cell
          const combined = firstCell.match(/^([A-Z]{1,5})\s+(.+)/);
          if (combined) {
            results.push({ symbol: combined[1], name: combined[2] });
            continue;
          }
        }

        // Strategy 2: Look for elements with ticker-like text
        const text = row.textContent ?? '';
        const tickerMatch = text.match(/\b([A-Z]{1,5})\b/);
        if (tickerMatch) {
          const nameMatch = text.replace(tickerMatch[0], '').trim().split('\n')[0]?.trim() ?? '';
          results.push({ symbol: tickerMatch[1], name: nameMatch.slice(0, 50) });
        }
      }

      return results;
    });

    for (const row of rows) {
      if (seen.has(row.symbol)) continue;
      if (!/^[A-Z]{1,5}$/.test(row.symbol)) continue;
      seen.add(row.symbol);
      tickers.push(row);
      if (tickers.length >= topN) break;
    }

    if (tickers.length >= topN) break;

    // Scroll down to load more rows (handles virtualized tables)
    await page.evaluate(() => {
      const scrollable =
        document.querySelector('[class*="table"]') ??
        document.querySelector('[class*="list"]') ??
        document.querySelector('table')?.parentElement;
      if (scrollable) {
        scrollable.scrollTop += 500;
      } else {
        window.scrollBy(0, 500);
      }
    });
    await page.waitForTimeout(1500);
  }

  return tickers.slice(0, topN);
}
