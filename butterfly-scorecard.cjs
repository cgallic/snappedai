#!/usr/bin/env node
/**
 * butterfly-scorecard.cjs — Prediction scoring worker for Global Butterfly Engine
 * Runs daily at midnight UTC via PM2, with additional 6-hour resolution checks.
 * Resolves pending predictions, takes daily snapshots, generates accuracy reports.
 *
 * PM2: pm2 start butterfly-scorecard.cjs --name snap-scorecard
 */

'use strict';

const Database = require('better-sqlite3');
const path = require('path');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const DB_PATH = process.env.BUTTERFLY_DB || path.join(__dirname, 'butterfly.db');
const RESOLUTION_INTERVAL_MS = 6 * 3600_000; // 6 hours
const DAY_MS = 24 * 3600_000;

const TIME_HORIZON_HOURS = {
  '6h': 6,
  '24h': 24,
  '48h': 48,
  '7d': 168,
  '14d': 336,
  '30d': 720,
};

// ---------------------------------------------------------------------------
// Database setup
// ---------------------------------------------------------------------------
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

// Ensure all dependent tables exist (may be created by other workers, but we need them for prepare)
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

  CREATE TABLE IF NOT EXISTS predictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER REFERENCES events(id),
    ripple_id INTEGER REFERENCES ripple_effects(id),
    asset TEXT NOT NULL,
    direction TEXT NOT NULL,
    magnitude TEXT,
    time_horizon TEXT,
    confidence REAL DEFAULT 0.5,
    baseline_price REAL,
    target_low REAL,
    target_high REAL,
    status TEXT DEFAULT 'pending',
    actual_result TEXT,
    actual_move_pct REAL,
    realized_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS prediction_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prediction_id INTEGER NOT NULL,
    current_price REAL,
    move_pct REAL,
    status TEXT,
    snapshot_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS accuracy_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    period TEXT NOT NULL,
    period_start TEXT,
    period_end TEXT,
    total_predictions INTEGER DEFAULT 0,
    correct INTEGER DEFAULT 0,
    incorrect INTEGER DEFAULT 0,
    partial INTEGER DEFAULT 0,
    expired INTEGER DEFAULT 0,
    hit_rate REAL DEFAULT 0,
    brier_score REAL DEFAULT 0,
    by_category TEXT,
    by_asset_class TEXT,
    by_time_horizon TEXT,
    by_ripple_order TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

log('Database tables initialized');

// ---------------------------------------------------------------------------
// Prepared statements
// ---------------------------------------------------------------------------
const stmts = {
  getPendingPredictions: db.prepare(`
    SELECT p.*, e.category as event_category
    FROM predictions p
    LEFT JOIN events e ON p.event_id = e.id
    WHERE p.status = 'pending'
  `),

  getActivePredictions: db.prepare(`
    SELECT p.* FROM predictions p
    WHERE p.status IN ('pending', 'monitoring')
  `),

  getAssetPrice: db.prepare(`
    SELECT current_price, category FROM assets WHERE symbol = ?
  `),

  updatePrediction: db.prepare(`
    UPDATE predictions SET
      status = @status,
      actual_result = @actual_result,
      actual_move_pct = @actual_move_pct,
      realized_at = datetime('now')
    WHERE id = @id
  `),

  insertSnapshot: db.prepare(`
    INSERT INTO prediction_snapshots (prediction_id, current_price, move_pct, status)
    VALUES (@prediction_id, @current_price, @move_pct, @status)
  `),

  getResolvedPredictions: db.prepare(`
    SELECT p.*, e.category as event_category, a.category as asset_class
    FROM predictions p
    LEFT JOIN events e ON p.event_id = e.id
    LEFT JOIN assets a ON p.asset = a.symbol
    WHERE p.status IN ('correct', 'incorrect', 'partial', 'expired')
  `),

  getResolvedInRange: db.prepare(`
    SELECT p.*, e.category as event_category, a.category as asset_class
    FROM predictions p
    LEFT JOIN events e ON p.event_id = e.id
    LEFT JOIN assets a ON p.asset = a.symbol
    WHERE p.status IN ('correct', 'incorrect', 'partial', 'expired')
      AND p.realized_at >= @start AND p.realized_at < @end
  `),

  insertReport: db.prepare(`
    INSERT INTO accuracy_reports (
      period, period_start, period_end,
      total_predictions, correct, incorrect, partial, expired,
      hit_rate, brier_score,
      by_category, by_asset_class, by_time_horizon, by_ripple_order
    ) VALUES (
      @period, @period_start, @period_end,
      @total_predictions, @correct, @incorrect, @partial, @expired,
      @hit_rate, @brier_score,
      @by_category, @by_asset_class, @by_time_horizon, @by_ripple_order
    )
  `),
};

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

function log(msg) {
  console.log(`[SCORECARD] ${msg}`);
}

function parseMagnitude(magnitude) {
  if (!magnitude) return [0, 100];

  // Handle formats like "3-8%", "3%-8%", "5%", "3-8", etc.
  const cleaned = magnitude.replace(/%/g, '').trim();
  const rangeMatch = cleaned.match(/(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)/);
  if (rangeMatch) {
    return [parseFloat(rangeMatch[1]), parseFloat(rangeMatch[2])];
  }

  // Single value like "5%"
  const singleMatch = cleaned.match(/(\d+(?:\.\d+)?)/);
  if (singleMatch) {
    const val = parseFloat(singleMatch[1]);
    return [val * 0.5, val * 2]; // Allow range around single value
  }

  return [0, 100];
}

function getDeadlineHours(timeHorizon) {
  if (!timeHorizon) return 24; // Default 24h

  // Check exact match first
  if (TIME_HORIZON_HOURS[timeHorizon]) return TIME_HORIZON_HOURS[timeHorizon];

  // Try to parse numeric hour value
  const hourMatch = timeHorizon.match(/(\d+)\s*h/i);
  if (hourMatch) return parseInt(hourMatch[1]);

  const dayMatch = timeHorizon.match(/(\d+)\s*d/i);
  if (dayMatch) return parseInt(dayMatch[1]) * 24;

  return 24;
}

function msUntilMidnightUTC() {
  const now = new Date();
  const midnight = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0, 0, 0, 0
  ));
  return midnight.getTime() - now.getTime();
}

// ---------------------------------------------------------------------------
// Resolution: Resolve pending predictions past their deadline
// ---------------------------------------------------------------------------
function resolvePredictions() {
  let predictions;
  try {
    predictions = stmts.getPendingPredictions.all();
  } catch (err) {
    if (err.message.includes('no such table')) {
      log('Predictions table not found yet, skipping resolution');
      return { resolved: 0, correct: 0, incorrect: 0, partial: 0, expired: 0 };
    }
    throw err;
  }

  if (predictions.length === 0) {
    log('No pending predictions to resolve');
    return { resolved: 0, correct: 0, incorrect: 0, partial: 0, expired: 0 };
  }

  const now = Date.now();
  const results = { resolved: 0, correct: 0, incorrect: 0, partial: 0, expired: 0 };

  for (const pred of predictions) {
    const deadlineHours = getDeadlineHours(pred.time_horizon);
    const createdAt = new Date(pred.created_at + (pred.created_at.includes('Z') ? '' : 'Z')).getTime();
    const deadline = createdAt + (deadlineHours * 3600_000);

    // Only resolve if past deadline
    if (now < deadline) continue;

    // Get current price for the asset
    const asset = stmts.getAssetPrice.get(pred.asset);
    if (!asset || asset.current_price == null) {
      // No price data, mark as expired
      stmts.updatePrediction.run({
        id: pred.id,
        status: 'expired',
        actual_result: 'No price data available',
        actual_move_pct: null,
      });
      results.expired++;
      results.resolved++;
      continue;
    }

    const currentPrice = asset.current_price;
    const baselinePrice = pred.baseline_price;

    if (!baselinePrice || baselinePrice === 0) {
      stmts.updatePrediction.run({
        id: pred.id,
        status: 'expired',
        actual_result: 'No baseline price recorded',
        actual_move_pct: null,
      });
      results.expired++;
      results.resolved++;
      continue;
    }

    const actualMove = ((currentPrice - baselinePrice) / baselinePrice) * 100;
    let status;
    let resultText;

    const direction = pred.direction;
    const magnitude = pred.magnitude;

    if (direction === 'volatile') {
      // Correct if absolute move > 2%
      if (Math.abs(actualMove) > 2) {
        status = 'correct';
        resultText = `Volatility confirmed: ${actualMove.toFixed(2)}% move`;
      } else {
        status = 'incorrect';
        resultText = `Insufficient volatility: only ${actualMove.toFixed(2)}% move`;
      }
    } else {
      const predictedUp = direction === 'up';
      const actualUp = actualMove > 0;

      if (predictedUp === actualUp) {
        // Direction matched, check magnitude
        const [low, high] = parseMagnitude(magnitude);

        if (Math.abs(actualMove) >= low && Math.abs(actualMove) <= high * 1.5) {
          status = 'correct';
          resultText = `Direction and magnitude matched: ${actualMove.toFixed(2)}% (predicted ${direction} ${magnitude || ''})`;
        } else if (Math.abs(actualMove) >= low * 0.5) {
          status = 'partial';
          resultText = `Direction correct, magnitude partial: ${actualMove.toFixed(2)}% (predicted ${direction} ${magnitude || ''})`;
        } else {
          // Direction right but magnitude way off - treat as expired/insufficient
          if (Math.abs(actualMove) < 0.5) {
            status = 'expired';
            resultText = `Insufficient price movement: ${actualMove.toFixed(2)}%`;
          } else {
            status = 'incorrect';
            resultText = `Direction correct but magnitude off: ${actualMove.toFixed(2)}% (predicted ${direction} ${magnitude || ''})`;
          }
        }
      } else {
        status = 'incorrect';
        resultText = `Direction wrong: actual ${actualMove.toFixed(2)}% (predicted ${direction})`;
      }
    }

    stmts.updatePrediction.run({
      id: pred.id,
      status,
      actual_result: resultText,
      actual_move_pct: Number(actualMove.toFixed(4)),
    });

    results[status]++;
    results.resolved++;

    log(`Resolved prediction #${pred.id} (${pred.asset}): ${status} - ${resultText}`);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Daily snapshots: Record current state of all active predictions
// ---------------------------------------------------------------------------
function takeDailySnapshots() {
  let predictions;
  try {
    predictions = stmts.getActivePredictions.all();
  } catch (err) {
    if (err.message.includes('no such table')) return 0;
    throw err;
  }

  if (predictions.length === 0) return 0;

  let count = 0;

  const insertBatch = db.transaction((preds) => {
    for (const pred of preds) {
      const asset = stmts.getAssetPrice.get(pred.asset);
      if (!asset || asset.current_price == null) continue;

      const currentPrice = asset.current_price;
      let movePct = null;

      if (pred.baseline_price && pred.baseline_price > 0) {
        movePct = Number((((currentPrice - pred.baseline_price) / pred.baseline_price) * 100).toFixed(4));
      }

      stmts.insertSnapshot.run({
        prediction_id: pred.id,
        current_price: currentPrice,
        move_pct: movePct,
        status: pred.status,
      });
      count++;
    }
  });

  insertBatch(predictions);
  log(`Took ${count} prediction snapshots`);
  return count;
}

// ---------------------------------------------------------------------------
// Accuracy report generation
// ---------------------------------------------------------------------------
function generateAccuracyReport() {
  let allResolved;
  try {
    allResolved = stmts.getResolvedPredictions.all();
  } catch (err) {
    if (err.message.includes('no such table')) return null;
    throw err;
  }

  if (allResolved.length === 0) {
    log('No resolved predictions for report');
    return null;
  }

  const total = allResolved.length;
  const correct = allResolved.filter(p => p.status === 'correct').length;
  const incorrect = allResolved.filter(p => p.status === 'incorrect').length;
  const partial = allResolved.filter(p => p.status === 'partial').length;
  const expired = allResolved.filter(p => p.status === 'expired').length;

  const hitRate = total > 0 ? Number(((correct + partial * 0.5) / total).toFixed(4)) : 0;

  // Brier score: mean of (confidence - outcome)^2
  // outcome = 1 for correct, 0.5 for partial, 0 for incorrect/expired
  let brierSum = 0;
  let brierCount = 0;
  for (const pred of allResolved) {
    const confidence = pred.confidence || 0.5;
    let outcome;
    if (pred.status === 'correct') outcome = 1;
    else if (pred.status === 'partial') outcome = 0.5;
    else outcome = 0;

    brierSum += (confidence - outcome) ** 2;
    brierCount++;
  }
  const brierScore = brierCount > 0 ? Number((brierSum / brierCount).toFixed(4)) : 0;

  // Breakdown by category
  const byCategory = breakdownByField(allResolved, 'event_category');
  const byAssetClass = breakdownByField(allResolved, 'asset_class');
  const byTimeHorizon = breakdownByField(allResolved, 'time_horizon');
  const byRippleOrder = breakdownByField(allResolved, 'ripple_order');

  const now = new Date();
  const periodStr = `daily_${now.toISOString().slice(0, 10)}`;

  const report = {
    period: periodStr,
    period_start: new Date(now.getTime() - DAY_MS).toISOString().slice(0, 19).replace('T', ' '),
    period_end: now.toISOString().slice(0, 19).replace('T', ' '),
    total_predictions: total,
    correct,
    incorrect,
    partial,
    expired,
    hit_rate: hitRate,
    brier_score: brierScore,
    by_category: JSON.stringify(byCategory),
    by_asset_class: JSON.stringify(byAssetClass),
    by_time_horizon: JSON.stringify(byTimeHorizon),
    by_ripple_order: JSON.stringify(byRippleOrder),
  };

  stmts.insertReport.run(report);

  return report;
}

function breakdownByField(predictions, field) {
  const groups = {};

  for (const pred of predictions) {
    const key = pred[field] || 'unknown';
    if (!groups[key]) {
      groups[key] = { total: 0, correct: 0, incorrect: 0, partial: 0, expired: 0 };
    }
    groups[key].total++;
    groups[key][pred.status]++;
  }

  // Calculate hit rate for each group
  for (const key of Object.keys(groups)) {
    const g = groups[key];
    g.hit_rate = g.total > 0 ? Number(((g.correct + g.partial * 0.5) / g.total).toFixed(4)) : 0;
  }

  return groups;
}

// ---------------------------------------------------------------------------
// Full scoring run
// ---------------------------------------------------------------------------
function runScoring() {
  const start = Date.now();
  log('Starting prediction scoring run...');

  // 1. Resolve pending predictions
  const resolution = resolvePredictions();
  log(`Resolution: ${resolution.resolved} resolved (${resolution.correct} correct, ${resolution.partial} partial, ${resolution.incorrect} incorrect, ${resolution.expired} expired)`);

  // 2. Take daily snapshots
  const snapshots = takeDailySnapshots();

  // 3. Generate accuracy report
  const report = generateAccuracyReport();

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  if (report) {
    log(`Report: total=${report.total_predictions}, hit_rate=${(report.hit_rate * 100).toFixed(1)}%, brier=${report.brier_score}`);
  }

  log(`Scoring run complete (${elapsed}s)`);
}

// ---------------------------------------------------------------------------
// Startup and scheduling
// ---------------------------------------------------------------------------
function start() {
  log('Starting butterfly-scorecard worker');
  log(`Database: ${DB_PATH}`);

  // Run immediately on startup
  try {
    runScoring();
  } catch (err) {
    log(`Scoring error: ${err.message}`);
  }

  // Schedule resolution every 6 hours (for short-horizon predictions)
  setInterval(() => {
    try {
      log('Running 6-hour resolution check...');
      resolvePredictions();
    } catch (err) {
      log(`Resolution error: ${err.message}`);
    }
  }, RESOLUTION_INTERVAL_MS);

  // Schedule full scoring at midnight UTC
  const msToMidnight = msUntilMidnightUTC();
  log(`Next midnight UTC scoring in ${(msToMidnight / 3600_000).toFixed(1)} hours`);

  setTimeout(() => {
    try {
      runScoring();
    } catch (err) {
      log(`Midnight scoring error: ${err.message}`);
    }

    // Then every 24 hours
    setInterval(() => {
      try {
        runScoring();
      } catch (err) {
        log(`Daily scoring error: ${err.message}`);
      }
    }, DAY_MS);
  }, msToMidnight);
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
