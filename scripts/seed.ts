/**
 * Seed script: populates the database with default tickers and app settings.
 * Run with: npx tsx scripts/seed.ts
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

const adapter = new PrismaBetterSqlite3({ url: 'file:prisma/dev.db' });
const prisma = new PrismaClient({ adapter });

const DEFAULT_TICKERS = [
  'AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMD',
  'META', 'AMZN', 'GOOGL', 'SPY', 'QQQ',
];

async function main() {
  console.log('Seeding database...');

  // Create default app settings
  await prisma.appSettings.upsert({
    where: { id: 1 },
    update: {},
    create: {
      scoreThreshold: 65,
      alertCooldownMin: 30,
      pollingIntervalSec: 60,
    },
  });
  console.log('✓ App settings created');

  // Create default tickers
  for (const symbol of DEFAULT_TICKERS) {
    await prisma.ticker.upsert({
      where: { symbol },
      update: {},
      create: { symbol, active: true },
    });
  }
  console.log(`✓ ${DEFAULT_TICKERS.length} tickers created`);

  console.log('Seed complete!');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
