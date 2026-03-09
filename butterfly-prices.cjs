/**
 * butterfly-prices.cjs
 *
 * Price polling worker for the Global Butterfly Engine.
 * Runs as an always-on PM2 service. Polls Yahoo Finance at per-asset
 * intervals, records price history, detects regime changes, and
 * calculates rolling volatility.
 *
 * PM2: pm2 start butterfly-prices.cjs --name snap-prices
 */

'use strict';

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = '/var/www/snap/butterfly.db';
const PRUNE_DAYS = 90;
const LOOP_INTERVAL_MS = 30_000;
const API_DELAY_MS = 500;

// ---------------------------------------------------------------------------
// Instruments
// ---------------------------------------------------------------------------

const INSTRUMENTS = {
  // Crypto - every 2 min (volatile)
  'BTC-USD': { name: 'Bitcoin', category: 'crypto', interval: 120 },
  'ETH-USD': { name: 'Ethereum', category: 'crypto', interval: 120 },

  // Energy - every 5 min
  'CL=F':  { name: 'WTI Crude',     category: 'energy', interval: 300 },
  'BZ=F':  { name: 'Brent Crude',   category: 'energy', interval: 300 },
  'NG=F':  { name: 'Natural Gas',   category: 'energy', interval: 300 },
  'RB=F':  { name: 'RBOB Gasoline', category: 'energy', interval: 300 },

  // Metals - every 5 min
  'GC=F': { name: 'Gold',   category: 'metals', interval: 300 },
  'SI=F': { name: 'Silver', category: 'metals', interval: 300 },

  // FX - every 5 min
  'DX-Y.NYB':  { name: 'US Dollar Index', category: 'fx', interval: 300 },
  'EURUSD=X':  { name: 'EUR/USD',         category: 'fx', interval: 300 },
  'USDJPY=X':  { name: 'USD/JPY',         category: 'fx', interval: 300 },
  'USDCNY=X':  { name: 'USD/CNY',         category: 'fx', interval: 300 },

  // Bonds - every 10 min
  '^TNX': { name: '10Y Treasury', category: 'bonds', interval: 600 },
  '^TYX': { name: '30Y Treasury', category: 'bonds', interval: 600 },
  '^FVX': { name: '5Y Treasury',  category: 'bonds', interval: 600 },

  // Equities - every 5 min
  '^SPX':  { name: 'S&P 500', category: 'equities', interval: 300 },
  '^IXIC': { name: 'NASDAQ',  category: 'equities', interval: 300 },
  '^VIX':  { name: 'VIX',     category: 'equities', interval: 300 },

  // Defense - every 10 min
  'LMT': { name: 'Lockheed Martin',  category: 'defense', interval: 600 },
  'RTX': { name: 'RTX Corp',         category: 'defense', interval: 600 },
  'NOC': { name: 'Northrop Grumman', category: 'defense', interval: 600 },

  // Tankers - every 10 min
  'FRO':  { name: 'Frontline',       category: 'tankers', interval: 600 },
  'STNG': { name: 'Scorpio Tankers', category: 'tankers', interval: 600 },
};

// ---------------------------------------------------------------------------
// Database setup
// ---------------------------------------------------------------------------

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS assets (
    symbol TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT,
    current_price REAL,
    prev_close REAL,
    change_pct REAL,
    regime TEXT DEFAULT 'neutral',
    volatility_20d REAL,
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    price REAL NOT NULL,
    volume REAL,
    recorded_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_ph_symbol_time
    ON price_history(symbol, recorded_at DESC);
`);

console.log('[PRICES] Database tables initialized');

// ---------------------------------------------------------------------------
// Prepared statements
// ---------------------------------------------------------------------------

const upsertAsset = db.prepare(`
  INSERT INTO assets (symbol, name, category, current_price, prev_close, change_pct, regime, volatility_20d, updated_at)
  VALUES (@symbol, @name, @category, @price, @prevClose, @changePct, @regime, @vol20d, datetime('now'))
  ON CONFLICT(symbol) DO UPDATE SET
    current_price = @price,
    prev_close    = @prevClose,
    change_pct    = @changePct,
    regime        = @regime,
    volatility_20d = @vol20d,
    updated_at    = datetime('now')
`);

const insertHistory = db.prepare(`
  INSERT INTO price_history (symbol, price, volume)
  VALUES (@symbol, @price, @volume)
`);

const getRecentPrices = db.prepare(`
  SELECT price, recorded_at FROM price_history
  WHERE symbol = ?
  ORDER BY recorded_at DESC
  LIMIT 500
`);

const pruneOld = db.prepare(`
  DELETE FROM price_history
  WHERE recorded_at < datetime('now', ?)
`);

// ---------------------------------------------------------------------------
// Yahoo Finance quote
// ---------------------------------------------------------------------------

async function getQuote(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d`;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': 'SnappedAI-Butterfly/1.0' },
    });
    if (!res.ok) {
      console.log(`[PRICES] HTTP ${res.status} for ${symbol}`);
      return null;
    }
    const data = await res.json();
    const meta = data.chart?.result?.[0]?.meta;
    if (!meta || meta.regularMarketPrice == null) return null;
    return {
      price: meta.regularMarketPrice,
      prevClose: meta.previousClose,
      change: Number(((meta.regularMarketPrice - meta.previousClose) / meta.previousClose * 100).toFixed(2)),
      volume: meta.regularMarketVolume || 0,
    };
  } catch (err) {
    console.log(`[PRICES] Error fetching ${symbol}: ${err.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Regime detection
// ---------------------------------------------------------------------------

function detectRegime(latestQuotes) {
  const vix = latestQuotes['^VIX'];
  const spx = latestQuotes['^SPX'];
  if (!vix || !spx) return 'neutral';

  const vixPrice = vix.price;
  const spxChange = spx.change;

  if (vixPrice > 25 && spxChange < -1) return 'risk-off';
  if (vixPrice < 15 && spxChange > 0.5) return 'risk-on';
  return 'neutral';
}

// ---------------------------------------------------------------------------
// Rolling 20-day volatility
// ---------------------------------------------------------------------------

function calcVolatility20d(symbol) {
  const rows = getRecentPrices.all(symbol);
  if (rows.length < 21) return null;

  // Group by date to get daily prices (use first price per day)
  const dailyMap = new Map();
  for (const row of rows) {
    const day = row.recorded_at.slice(0, 10);
    if (!dailyMap.has(day)) {
      dailyMap.set(day, row.price);
    }
  }

  const dailyPrices = [...dailyMap.values()].reverse(); // oldest first
  if (dailyPrices.length < 21) return null;

  // Take last 21 daily prices -> 20 daily returns
  const recent = dailyPrices.slice(-21);
  const returns = [];
  for (let i = 1; i < recent.length; i++) {
    if (recent[i - 1] !== 0) {
      returns.push((recent[i] - recent[i - 1]) / recent[i - 1]);
    }
  }
  if (returns.length < 10) return null;

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, r) => a + (r - mean) ** 2, 0) / (returns.length - 1);
  const vol = Math.sqrt(variance) * Math.sqrt(252) * 100; // annualized %
  return Number(vol.toFixed(2));
}

// ---------------------------------------------------------------------------
// Polling state
// ---------------------------------------------------------------------------

const lastPollTime = {};           // symbol -> epoch ms
const latestQuotes = {};           // symbol -> { price, prevClose, change, volume }
let lastPruneDate = null;

// ---------------------------------------------------------------------------
// Main poll cycle
// ---------------------------------------------------------------------------

async function pollDueInstruments() {
  const now = Date.now();
  const due = Object.entries(INSTRUMENTS).filter(([symbol, cfg]) => {
    const last = lastPollTime[symbol] || 0;
    return (now - last) >= cfg.interval * 1000;
  });

  if (due.length === 0) return;

  const fetched = [];

  for (const [symbol, cfg] of due) {
    const quote = await getQuote(symbol);
    if (quote) {
      latestQuotes[symbol] = quote;
      fetched.push({ symbol, cfg, quote });
    }
    lastPollTime[symbol] = Date.now();

    // Rate limit between API calls
    if (due.indexOf(due.find(d => d[0] === symbol)) < due.length - 1) {
      await sleep(API_DELAY_MS);
    }
  }

  if (fetched.length === 0) return;

  // Determine current regime
  const regime = detectRegime(latestQuotes);

  // Bulk write in a transaction
  const writeBatch = db.transaction((items) => {
    for (const { symbol, cfg, quote } of items) {
      insertHistory.run({
        symbol,
        price: quote.price,
        volume: quote.volume,
      });

      const vol20d = calcVolatility20d(symbol);

      upsertAsset.run({
        symbol,
        name: cfg.name,
        category: cfg.category,
        price: quote.price,
        prevClose: quote.prevClose,
        changePct: quote.change,
        regime,
        vol20d,
      });
    }
  });

  writeBatch(fetched);

  const symbols = fetched.map(f => f.symbol).join(', ');
  console.log(`[PRICES] Updated ${fetched.length} instruments (regime: ${regime}): ${symbols}`);
}

// ---------------------------------------------------------------------------
// Daily prune
// ---------------------------------------------------------------------------

function pruneHistory() {
  const today = new Date().toISOString().slice(0, 10);
  if (lastPruneDate === today) return;
  lastPruneDate = today;

  const result = pruneOld.run(`-${PRUNE_DAYS} days`);
  if (result.changes > 0) {
    console.log(`[PRICES] Pruned ${result.changes} price_history rows older than ${PRUNE_DAYS} days`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

async function mainLoop() {
  console.log(`[PRICES] Starting price worker -- ${Object.keys(INSTRUMENTS).length} instruments`);

  // Seed assets table on first run
  const assetCount = db.prepare('SELECT COUNT(*) AS c FROM assets').get().c;
  if (assetCount === 0) {
    const seedTx = db.transaction(() => {
      for (const [symbol, cfg] of Object.entries(INSTRUMENTS)) {
        upsertAsset.run({
          symbol,
          name: cfg.name,
          category: cfg.category,
          price: null,
          prevClose: null,
          changePct: null,
          regime: 'neutral',
          vol20d: null,
        });
      }
    });
    seedTx();
    console.log('[PRICES] Seeded assets table');
  }

  while (true) {
    try {
      await pollDueInstruments();
      pruneHistory();
    } catch (err) {
      console.error('[PRICES] Loop error:', err.message);
    }
    await sleep(LOOP_INTERVAL_MS);
  }
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

function shutdown(signal) {
  console.log(`[PRICES] Received ${signal}, shutting down`);
  try { db.close(); } catch (_) {}
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

mainLoop();
