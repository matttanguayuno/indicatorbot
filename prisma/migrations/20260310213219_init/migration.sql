-- CreateTable
CREATE TABLE "AppSettings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "scoreThreshold" REAL NOT NULL DEFAULT 65,
    "alertCooldownMin" INTEGER NOT NULL DEFAULT 30,
    "pollingIntervalSec" INTEGER NOT NULL DEFAULT 60,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Ticker" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "symbol" TEXT NOT NULL,
    "name" TEXT,
    "sector" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SignalSnapshot" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tickerId" INTEGER NOT NULL,
    "symbol" TEXT NOT NULL,
    "currentPrice" REAL NOT NULL,
    "pctChange5m" REAL,
    "pctChange15m" REAL,
    "pctChange1h" REAL,
    "pctChange1d" REAL,
    "currentVolume" REAL,
    "averageVolume" REAL,
    "rvol" REAL,
    "volumeSpikeRatio" REAL,
    "float" REAL,
    "vwap" REAL,
    "pctFromVwap" REAL,
    "isBreakout" BOOLEAN NOT NULL DEFAULT false,
    "nearHigh" BOOLEAN NOT NULL DEFAULT false,
    "high52w" REAL,
    "recentNewsCount" INTEGER NOT NULL DEFAULT 0,
    "newsScore" REAL,
    "shortInterest" REAL,
    "shortInterestSource" TEXT,
    "optionsFlowValue" REAL,
    "optionsFlowSource" TEXT,
    "signalScore" REAL NOT NULL,
    "explanation" TEXT NOT NULL,
    "dataSourceMeta" TEXT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SignalSnapshot_tickerId_fkey" FOREIGN KEY ("tickerId") REFERENCES "Ticker" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tickerId" INTEGER NOT NULL,
    "symbol" TEXT NOT NULL,
    "scoreAtAlert" REAL NOT NULL,
    "explanation" TEXT NOT NULL,
    "snapshotId" INTEGER,
    "acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Alert_tickerId_fkey" FOREIGN KEY ("tickerId") REFERENCES "Ticker" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Feedback" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "alertId" INTEGER NOT NULL,
    "rating" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Feedback_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NewsItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tickerId" INTEGER NOT NULL,
    "symbol" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "source" TEXT,
    "url" TEXT,
    "summary" TEXT,
    "publishedAt" DATETIME NOT NULL,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NewsItem_tickerId_fkey" FOREIGN KEY ("tickerId") REFERENCES "Ticker" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Ticker_symbol_key" ON "Ticker"("symbol");

-- CreateIndex
CREATE INDEX "SignalSnapshot_tickerId_timestamp_idx" ON "SignalSnapshot"("tickerId", "timestamp");

-- CreateIndex
CREATE INDEX "SignalSnapshot_symbol_timestamp_idx" ON "SignalSnapshot"("symbol", "timestamp");

-- CreateIndex
CREATE INDEX "SignalSnapshot_signalScore_idx" ON "SignalSnapshot"("signalScore");

-- CreateIndex
CREATE INDEX "Alert_symbol_createdAt_idx" ON "Alert"("symbol", "createdAt");

-- CreateIndex
CREATE INDEX "Alert_createdAt_idx" ON "Alert"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Feedback_alertId_key" ON "Feedback"("alertId");

-- CreateIndex
CREATE INDEX "NewsItem_symbol_publishedAt_idx" ON "NewsItem"("symbol", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "NewsItem_symbol_headline_publishedAt_key" ON "NewsItem"("symbol", "headline", "publishedAt");
