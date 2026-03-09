#!/usr/bin/env node
// butterfly-anomaly.cjs — Anomaly detection worker for Global Butterfly Engine
// Runs every 15 minutes via PM2.
// Detects price spikes, volume surges, event clustering, regime changes,
// and spread anomalies from existing DB tables.
// PM2: pm2 start butterfly-anomaly.cjs --name snap-anomaly

'use strict';

const Database = require('better-sqlite3');
const path = require('path');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const DB_PATH = process.env.BUTTERFLY_DB || path.join(__dirname, 'butterfly.db');
const INTERVAL_MS = 15 * 60_000; // 15 minutes
const Z_SCORE_THRESHOLD = 2;
const VOLUME_SURGE_MULTIPLIER = 3;
const EVENT_CLUSTER_THRESHOLD = 20;
const SPREAD_HIGH = 5;
const SPREAD_LOW = 1;
const DEDUP_HOURS = 6;
const HISTORY_WINDOW = 20;

// ---------------------------------------------------------------------------
// Database setup
// ---------------------------------------------------------------------------
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

// Ensure all dependent tables exist (may be created by other workers)
db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_hash TEXT UNIQUE,
    title TEXT NOT NULL,
    country TEXT,
    category TEXT,
    severity INTEGER DEFAULT 5,
    novelty REAL DEFAULT 0.5,
    confidence REAL DEFAULT 0.5,
    entities TEXT,
    source_count INTEGER DEFAULT 1,
    raw_item_ids TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS assets (
    symbol TEXT PRIMARY KEY,
    name TEXT,
    category TEXT,
    current_price REAL,
    regime TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    price REAL NOT NULL,
    volume REAL,
    recorded_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS anomalies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    asset TEXT,
    description TEXT NOT NULL,
    severity TEXT DEFAULT 'medium',
    details TEXT,
    resolved INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_anomalies_created ON anomalies(created_at DESC);
`);

console.log('[ANOMALY] Database tables initialized');

// ---------------------------------------------------------------------------
// Prepared statements
// ---------------------------------------------------------------------------
const stmts = {
  // Get last N price history entries for a symbol
  getRecentPrices: db.prepare(`
    SELECT price, volume, recorded_at FROM price_history
    WHERE symbol = ?
    ORDER BY recorded_at DESC
    LIMIT ?
  `),

  // Get current asset data
  getAllAssets: db.prepare(`
    SELECT symbol, name, category, current_price, regime, updated_at FROM assets
    WHERE current_price IS NOT NULL
  `),

  // Get events in last N hours by category
  getRecentEventsByCategory: db.prepare(`
    SELECT category, COUNT(*) as cnt FROM events
    WHERE created_at > datetime('now', ?)
    GROUP BY category
    HAVING cnt > ?
  `),

  // Get all events in last 2 hours for detail
  getRecentEventsDetail: db.prepare(`
    SELECT category, title FROM events
    WHERE created_at > datetime('now', '-2 hours')
    ORDER BY created_at DESC
  `),

  // Get asset regime from N hours ago (via price_history timestamp)
  getAssetRegimeHistory: db.prepare(`
    SELECT regime FROM assets WHERE symbol = ?
  `),

  // Check for existing anomaly with same description in last N hours (dedup)
  checkDedup: db.prepare(`
    SELECT id FROM anomalies
    WHERE description = ? AND created_at > datetime('now', ?)
    LIMIT 1
  `),

  // Insert anomaly
  insertAnomaly: db.prepare(`
    INSERT INTO anomalies (type, asset, description, severity, details)
    VALUES (@type, @asset, @description, @severity, @details)
  `),

  // Get Brent and WTI prices
  getBrentWtiPrices: db.prepare(`
    SELECT symbol, current_price FROM assets
    WHERE symbol IN ('BZ=F', 'CL=F') AND current_price IS NOT NULL
  `),
};

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

function log(msg) {
  console.log(`[ANOMALY] ${msg}`);
}

function isDuplicate(description) {
  const dedupWindow = `-${DEDUP_HOURS} hours`;
  return !!stmts.checkDedup.get(description, dedupWindow);
}

function recordAnomaly(type, asset, description, severity, details) {
  if (isDuplicate(description)) return false;

  stmts.insertAnomaly.run({
    type,
    asset: asset || null,
    description,
    severity: severity || 'medium',
    details: details ? JSON.stringify(details) : null,
  });
  log(description);
  return true;
}

function calcMeanStddev(values) {
  if (values.length === 0) return { mean: 0, stddev: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length;
  return { mean, stddev: Math.sqrt(variance) };
}

// ---------------------------------------------------------------------------
// Detection: Price spikes (z-score > 2)
// ---------------------------------------------------------------------------
function detectPriceSpikes() {
  const assets = stmts.getAllAssets.all();
  let count = 0;

  for (const asset of assets) {
    const rows = stmts.getRecentPrices.all(asset.symbol, HISTORY_WINDOW);
    if (rows.length < 5) continue; // Need minimum data points

    const prices = rows.map(r => r.price);
    const currentPrice = prices[0]; // Most recent
    const historicalPrices = prices.slice(1); // Exclude current for baseline

    const { mean, stddev } = calcMeanStddev(historicalPrices);
    if (stddev === 0) continue;

    const zScore = (currentPrice - mean) / stddev;

    if (Math.abs(zScore) > Z_SCORE_THRESHOLD) {
      const direction = zScore > 0 ? 'up' : 'down';
      const severity = Math.abs(zScore) > 3 ? 'high' : 'medium';
      const description = `Price spike: ${asset.name} (${asset.symbol}) z-score ${zScore.toFixed(2)} (${direction}) - $${currentPrice.toFixed(2)} vs mean $${mean.toFixed(2)}`;

      if (recordAnomaly('price_spike', asset.symbol, description, severity, {
        symbol: asset.symbol,
        name: asset.name,
        current_price: currentPrice,
        mean,
        stddev,
        z_score: zScore,
        direction,
        data_points: historicalPrices.length,
      })) {
        count++;
      }
    }
  }

  return count;
}

// ---------------------------------------------------------------------------
// Detection: Volume surges (3x 20-period average)
// ---------------------------------------------------------------------------
function detectVolumeSurges() {
  const assets = stmts.getAllAssets.all();
  let count = 0;

  for (const asset of assets) {
    const rows = stmts.getRecentPrices.all(asset.symbol, HISTORY_WINDOW + 1);
    if (rows.length < 5) continue;

    // Filter rows that have volume data
    const withVolume = rows.filter(r => r.volume != null && r.volume > 0);
    if (withVolume.length < 5) continue;

    const currentVolume = withVolume[0].volume;
    const historicalVolumes = withVolume.slice(1).map(r => r.volume);
    const avgVolume = historicalVolumes.reduce((a, b) => a + b, 0) / historicalVolumes.length;

    if (avgVolume === 0) continue;

    const ratio = currentVolume / avgVolume;

    if (ratio >= VOLUME_SURGE_MULTIPLIER) {
      const description = `Volume surge: ${asset.name} (${asset.symbol}) volume ${ratio.toFixed(1)}x average (${currentVolume.toLocaleString()} vs avg ${Math.round(avgVolume).toLocaleString()})`;

      if (recordAnomaly('volume_surge', asset.symbol, description, 'medium', {
        symbol: asset.symbol,
        name: asset.name,
        current_volume: currentVolume,
        avg_volume: avgVolume,
        ratio,
        data_points: historicalVolumes.length,
      })) {
        count++;
      }
    }
  }

  return count;
}

// ---------------------------------------------------------------------------
// Detection: Event clustering (>5 events same category in 2 hours)
// ---------------------------------------------------------------------------
function detectEventClustering() {
  let count = 0;

  try {
    const clusters = stmts.getRecentEventsByCategory.all('-2 hours', EVENT_CLUSTER_THRESHOLD);

    for (const cluster of clusters) {
      const description = `Event cluster: ${cluster.cnt} events in category "${cluster.category}" within last 2 hours`;

      // Get some event titles for detail
      const events = stmts.getRecentEventsDetail.all();
      const categoryEvents = events
        .filter(e => e.category === cluster.category)
        .slice(0, 5)
        .map(e => e.title);

      if (recordAnomaly('event_cluster', null, description, 'medium', {
        category: cluster.category,
        event_count: cluster.cnt,
        sample_titles: categoryEvents,
      })) {
        count++;
      }
    }
  } catch (err) {
    // events table might not exist yet
    if (!err.message.includes('no such table')) {
      log(`Event clustering error: ${err.message}`);
    }
  }

  return count;
}

// ---------------------------------------------------------------------------
// Detection: Regime change
// ---------------------------------------------------------------------------

// Track last known regime per asset to detect changes between runs
let lastKnownRegimes = {};

function detectRegimeChanges() {
  const assets = stmts.getAllAssets.all();
  let count = 0;

  for (const asset of assets) {
    const currentRegime = asset.regime;
    const previousRegime = lastKnownRegimes[asset.symbol];

    if (previousRegime && currentRegime && previousRegime !== currentRegime) {
      const description = `Regime change: ${asset.name} (${asset.symbol}) shifted from "${previousRegime}" to "${currentRegime}"`;

      if (recordAnomaly('regime_change', asset.symbol, description, 'high', {
        symbol: asset.symbol,
        name: asset.name,
        previous_regime: previousRegime,
        current_regime: currentRegime,
      })) {
        count++;
      }
    }

    lastKnownRegimes[asset.symbol] = currentRegime;
  }

  return count;
}

// ---------------------------------------------------------------------------
// Detection: Spread anomalies (Brent-WTI)
// ---------------------------------------------------------------------------
function detectSpreadAnomalies() {
  let count = 0;

  const rows = stmts.getBrentWtiPrices.all();
  const priceMap = {};
  for (const row of rows) {
    priceMap[row.symbol] = row.current_price;
  }

  const brent = priceMap['BZ=F'];
  const wti = priceMap['CL=F'];

  if (brent == null || wti == null) return 0;

  const spread = brent - wti;

  if (spread > SPREAD_HIGH) {
    const description = `Spread anomaly: Brent-WTI spread $${spread.toFixed(2)} exceeds $${SPREAD_HIGH} threshold (Brent: $${brent.toFixed(2)}, WTI: $${wti.toFixed(2)})`;

    if (recordAnomaly('spread_anomaly', 'BZ=F/CL=F', description, 'high', {
      brent,
      wti,
      spread,
      threshold: SPREAD_HIGH,
      direction: 'widening',
    })) {
      count++;
    }
  } else if (spread < SPREAD_LOW) {
    const description = `Spread anomaly: Brent-WTI spread $${spread.toFixed(2)} below $${SPREAD_LOW} threshold (Brent: $${brent.toFixed(2)}, WTI: $${wti.toFixed(2)})`;

    if (recordAnomaly('spread_anomaly', 'BZ=F/CL=F', description, 'medium', {
      brent,
      wti,
      spread,
      threshold: SPREAD_LOW,
      direction: 'narrowing',
    })) {
      count++;
    }
  }

  return count;
}

// ---------------------------------------------------------------------------
// Main detection run
// ---------------------------------------------------------------------------
function runDetection() {
  const start = Date.now();
  log('Starting anomaly detection scan...');

  let total = 0;
  total += detectPriceSpikes();
  total += detectVolumeSurges();
  total += detectEventClustering();
  total += detectRegimeChanges();
  total += detectSpreadAnomalies();

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  log(`Scan complete: ${total} anomalies detected (${elapsed}s)`);
}

// ---------------------------------------------------------------------------
// Initialize regime tracking from current state
// ---------------------------------------------------------------------------
function initRegimeTracking() {
  const assets = stmts.getAllAssets.all();
  for (const asset of assets) {
    lastKnownRegimes[asset.symbol] = asset.regime;
  }
  log(`Initialized regime tracking for ${Object.keys(lastKnownRegimes).length} assets`);
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
function start() {
  log('Starting butterfly-anomaly worker');
  log(`Database: ${DB_PATH}`);
  log(`Detection interval: ${INTERVAL_MS / 60_000} minutes`);
  log(`Z-score threshold: ${Z_SCORE_THRESHOLD}`);
  log(`Volume surge multiplier: ${VOLUME_SURGE_MULTIPLIER}x`);

  initRegimeTracking();

  // Run immediately on startup
  try {
    runDetection();
  } catch (err) {
    log(`Detection error: ${err.message}`);
  }

  // Schedule every 15 minutes
  setInterval(() => {
    try {
      runDetection();
    } catch (err) {
      log(`Detection error: ${err.message}`);
    }
  }, INTERVAL_MS);
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
function shutdown(signal) {
  log(`Received ${signal}, shutting down`);
  try { db.close(); } catch {}
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('uncaughtException', (err) => {
  log(`Uncaught exception: ${err.message}`);
  log(err.stack || '');
});

process.on('unhandledRejection', (err) => {
  log(`Unhandled rejection: ${err && err.message ? err.message : err}`);
});

start();
