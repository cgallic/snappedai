#!/usr/bin/env node
// butterfly-server.cjs — Global Butterfly Engine backend
// Consolidates market data, OSINT, news, watchlist, and AI synthesis
// into a single Express API with SQLite persistence and caching.

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const PORT = process.env.BUTTERFLY_PORT || 3884;
const DB_PATH = process.env.BUTTERFLY_DB || path.join(__dirname, 'butterfly.db');
const ENV_PATH = process.env.ENV_PATH || '/var/www/snap/.env';

// Load .env
let OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || '';
let GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || '';
try {
  const envFile = fs.readFileSync(ENV_PATH, 'utf8');
  if (!OPENROUTER_KEY) {
    const m = envFile.match(/OPENROUTER_API_KEY=(.+)/);
    if (m) OPENROUTER_KEY = m[1].trim();
  }
  if (!GOOGLE_API_KEY) {
    const m = envFile.match(/GOOGLE_API_KEY=(.+)/);
    if (m) GOOGLE_API_KEY = m[1].trim();
  }
} catch {}

// ---------------------------------------------------------------------------
// Database Setup
// ---------------------------------------------------------------------------
const db = new Database(DB_PATH, { verbose: null });
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS sources (
    source_id TEXT PRIMARY KEY,
    priority TEXT DEFAULT 'P2',
    region TEXT,
    country_or_zone TEXT,
    source_name TEXT NOT NULL,
    source_type TEXT,
    language TEXT DEFAULT 'en',
    coverage TEXT,
    ingestion_method TEXT,
    cadence_minutes INTEGER DEFAULT 60,
    reliability_score REAL DEFAULT 0.5,
    notes TEXT,
    verified INTEGER DEFAULT 0,
    last_checked TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    message TEXT NOT NULL,
    details TEXT,
    severity TEXT DEFAULT 'medium',
    source TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts(created_at DESC);

  CREATE TABLE IF NOT EXISTS price_cache (
    symbol TEXT PRIMARY KEY,
    name TEXT,
    category TEXT,
    price REAL,
    prev_close REAL,
    change_pct REAL,
    currency TEXT,
    exchange TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS synthesis_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report TEXT NOT NULL,
    data_snapshot TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS news_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    region TEXT NOT NULL,
    stories TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
  );
`);

// ---------------------------------------------------------------------------
// In-memory caches with TTL
// ---------------------------------------------------------------------------
class TTLCache {
  constructor(ttlMs) {
    this.ttl = ttlMs;
    this.data = null;
    this.fetchedAt = 0;
  }
  isStale() { return Date.now() - this.fetchedAt > this.ttl; }
  set(data) { this.data = data; this.fetchedAt = Date.now(); }
  get() { return this.data; }
}

const priceCache = new TTLCache(60_000);      // 60s
const flightCache = new TTLCache(60_000);     // 60s
const alertCache = new TTLCache(30_000);      // 30s
const watchlistCache = new TTLCache(60_000);  // 60s
const newsCache = new TTLCache(300_000);      // 5min
const synthesisCache = new TTLCache(900_000); // 15min

// ---------------------------------------------------------------------------
// Instrument definitions (from existing markets-tracker.js)
// ---------------------------------------------------------------------------
const INSTRUMENTS = {
  'CL=F':     { name: 'WTI Crude',        category: 'energy' },
  'BZ=F':     { name: 'Brent Crude',       category: 'energy' },
  'NG=F':     { name: 'Natural Gas',       category: 'energy' },
  'RB=F':     { name: 'RBOB Gasoline',     category: 'energy' },
  'GC=F':     { name: 'Gold',              category: 'metals' },
  'SI=F':     { name: 'Silver',            category: 'metals' },
  'DX-Y.NYB': { name: 'US Dollar Index',  category: 'fx' },
  'EURUSD=X': { name: 'EUR/USD',          category: 'fx' },
  'USDJPY=X': { name: 'USD/JPY',          category: 'fx' },
  'USDCNY=X': { name: 'USD/CNY',          category: 'fx' },
  '^TNX':     { name: '10Y Treasury',      category: 'bonds' },
  '^TYX':     { name: '30Y Treasury',      category: 'bonds' },
  '^FVX':     { name: '5Y Treasury',       category: 'bonds' },
  '^SPX':     { name: 'S&P 500',           category: 'equities' },
  '^IXIC':    { name: 'NASDAQ',            category: 'equities' },
  '^VIX':     { name: 'VIX',               category: 'equities' },
  'LMT':      { name: 'Lockheed Martin',   category: 'defense' },
  'RTX':      { name: 'RTX Corp',          category: 'defense' },
  'NOC':      { name: 'Northrop Grumman',  category: 'defense' },
  'FRO':      { name: 'Frontline',         category: 'tankers' },
  'STNG':     { name: 'Scorpio Tankers',   category: 'tankers' },
  'BTC-USD':  { name: 'Bitcoin',           category: 'crypto' },
  'ETH-USD':  { name: 'Ethereum',          category: 'crypto' },
};

// ---------------------------------------------------------------------------
// Data fetching helpers
// ---------------------------------------------------------------------------
async function fetchWithTimeout(url, opts = {}, timeoutMs = 10_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function getYahooQuote(symbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1m&range=1d`;
    const res = await fetchWithTimeout(url, {
      headers: { 'User-Agent': 'SnappedAI-Butterfly/1.0' }
    });
    const data = await res.json();
    const meta = data.chart?.result?.[0]?.meta;
    if (!meta) return null;
    const price = meta.regularMarketPrice;
    const prevClose = meta.previousClose;
    return {
      symbol,
      price,
      prevClose,
      change: ((price - prevClose) / prevClose * 100).toFixed(2),
      currency: meta.currency,
      exchange: meta.exchangeName,
    };
  } catch (e) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Price polling
// ---------------------------------------------------------------------------
async function pollAllPrices() {
  console.log('[PRICES] Polling all instruments...');
  const instruments = {};
  const categories = {};

  const upsert = db.prepare(`
    INSERT OR REPLACE INTO price_cache (symbol, name, category, price, prev_close, change_pct, currency, exchange, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);

  for (const [symbol, info] of Object.entries(INSTRUMENTS)) {
    const q = await getYahooQuote(symbol);
    if (q) {
      const entry = { ...info, ...q };
      instruments[symbol] = entry;
      if (!categories[info.category]) categories[info.category] = [];
      categories[info.category].push(entry);

      upsert.run(symbol, info.name, info.category, q.price, q.prevClose, parseFloat(q.change), q.currency || '', q.exchange || '');

      // Alert on big moves
      if (Math.abs(parseFloat(q.change)) > 3) {
        insertAlert('BIG_MOVE', `${info.name} ${q.change > 0 ? '↑' : '↓'} ${q.change}% today`, JSON.stringify({ symbol, price: q.price, change: q.change }), 'medium');
      }
    }
    await new Promise(r => setTimeout(r, 400));
  }

  let spreads = {};
  if (instruments['BZ=F'] && instruments['CL=F']) {
    spreads.brentWti = (instruments['BZ=F'].price - instruments['CL=F'].price).toFixed(2);
  }

  const result = { instruments, categories, spreads, lastUpdate: new Date().toISOString() };
  priceCache.set(result);
  console.log(`[PRICES] Updated ${Object.keys(instruments).length} instruments`);
  return result;
}

// ---------------------------------------------------------------------------
// Flight tracking (ADSB.lol)
// ---------------------------------------------------------------------------
const ZONES = {
  middleEast:    { lat: 28, lon: 45, dist: 800, name: 'Middle East/Gulf' },
  redSea:        { lat: 18, lon: 40, dist: 400, name: 'Red Sea' },
  mediterranean: { lat: 35, lon: 25, dist: 500, name: 'Eastern Med' },
};

const MIL_CALLSIGNS = /^(RCH|JAKE|EVAC|NAVY|USAF|RAF|IAF|DUKE|REACH|TEAL|CASA|NCHO|LAGR|TOPCT)/i;
const MIL_TYPES = /^(C17|C5|KC|E[23]|P8|B52|F15|F16|F35|F22|A10|MQ9|RQ4|RC135|E8|MC12|U2|GLEX|GLF|C130|C37|C40|B737|E6|KC135|KC10|C32)/i;

async function pollFlights() {
  const zones = {};
  for (const [key, zone] of Object.entries(ZONES)) {
    try {
      const url = `https://api.adsb.lol/v2/lat/${zone.lat}/lon/${zone.lon}/dist/${zone.dist}`;
      const res = await fetchWithTimeout(url, { headers: { 'User-Agent': 'SnappedAI-Butterfly/1.0' } });
      const data = await res.json();
      if (!data.ac) { zones[key] = { name: zone.name, total: 0, military: 0 }; continue; }
      const military = data.ac.filter(a => MIL_CALLSIGNS.test(a.flight || '') || MIL_TYPES.test(a.t || ''));
      zones[key] = { name: zone.name, total: data.ac.length, military: military.length, lastPoll: new Date().toISOString() };

      if (military.length > 8) {
        insertAlert('HIGH_MILITARY', `${military.length} military aircraft over ${zone.name}`, null, 'high');
      }
    } catch (e) {
      zones[key] = zones[key] || { name: zone.name, total: 0, military: 0, error: e.message };
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  const result = { zones, lastUpdate: new Date().toISOString() };
  flightCache.set(result);
  return result;
}

// ---------------------------------------------------------------------------
// RSS feed parsing
// ---------------------------------------------------------------------------
async function parseFeed(url) {
  try {
    const res = await fetchWithTimeout(url, { headers: { 'User-Agent': 'SnappedAI-Butterfly/1.0' } });
    const text = await res.text();
    const items = [];
    const regex = text.includes('<entry') ? /<entry[^>]*>([\s\S]*?)<\/entry>/gi : /<item[^>]*>([\s\S]*?)<\/item>/gi;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const item = match[1];
      const title = item.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i)?.[1]?.trim() || '';
      const link = item.match(/<link[^>]*>([^<]+)<\/link>/i)?.[1]?.trim() ||
                   item.match(/<link[^>]*href="([^"]+)"/i)?.[1] || '';
      const pubDate = item.match(/<pubDate[^>]*>([^<]+)<\/pubDate>/i)?.[1]?.trim() ||
                      item.match(/<published[^>]*>([^<]+)<\/published>/i)?.[1]?.trim() || '';
      items.push({ title, link, pubDate, text: title.toLowerCase() });
    }
    return items.slice(0, 10);
  } catch { return []; }
}

// ---------------------------------------------------------------------------
// Watchlist scanning
// ---------------------------------------------------------------------------
const WATCHLIST_SIGNALS = {
  iran_response: {
    name: 'Iran Response', source: 'Tehran statements', trigger: 'Retaliation announcement',
    feeds: ['https://www.irna.ir/rss', 'https://www.tasnimnews.com/en/rss/most-visited/service/76/politics'],
    keywords: ['retaliation', 'revenge', 'response', 'attack', 'strike', 'military action'],
  },
  hormuz_traffic: {
    name: 'Hormuz Traffic', source: 'Shipping data', trigger: 'Passage disruption',
    feeds: ['https://gcaptain.com/feed/', 'https://www.hellenicshippingnews.com/feed/'],
    keywords: ['hormuz', 'strait', 'tanker', 'blocked', 'disruption', 'closure', 'attack'],
  },
  nato_article5: {
    name: 'NATO Article 5', source: 'Brussels/Ankara', trigger: 'Turkey escalation',
    feeds: ['https://www.nato.int/cps/en/natohq/news.xml'],
    keywords: ['article 5', 'collective defense', 'turkey', 'ankara', 'missile', 'attack'],
  },
  oil_facilities: {
    name: 'Oil Facility Status', source: 'Gulf media', trigger: 'Further attacks',
    feeds: ['https://english.alarabiya.net/tools/rss'],
    keywords: ['oil facility', 'refinery', 'attack', 'fire', 'explosion', 'aramco', 'sabotage', 'drone'],
  },
  crude_price: {
    name: 'Crude Futures', source: 'Markets', trigger: 'Break above $95',
    priceTarget: 95,
  },
};

let watchlistStatus = JSON.parse(JSON.stringify(WATCHLIST_SIGNALS));

async function scanWatchlist() {
  for (const [key, signal] of Object.entries(watchlistStatus)) {
    if (signal.feeds) {
      for (const feedUrl of signal.feeds) {
        const items = await parseFeed(feedUrl);
        for (const item of items) {
          for (const kw of signal.keywords) {
            if (item.text.includes(kw.toLowerCase())) {
              const pubTime = new Date(item.pubDate).getTime();
              if (pubTime > Date.now() - 6 * 3600_000 || !item.pubDate) {
                watchlistStatus[key].status = 'TRIGGERED';
                watchlistStatus[key].lastHit = { keyword: kw, title: item.title.substring(0, 100), link: item.link, time: new Date().toISOString() };
                insertAlert('WATCHLIST_TRIGGER', `${signal.name}: "${kw}" detected - ${item.title.substring(0, 60)}`, JSON.stringify({ signal: key, keyword: kw }), 'high');
                break;
              }
            }
          }
        }
        await new Promise(r => setTimeout(r, 1500));
      }
    }
  }

  // Crude price check
  const prices = priceCache.get();
  if (prices?.instruments?.['CL=F']) {
    const price = prices.instruments['CL=F'].price;
    watchlistStatus.crude_price.lastPrice = price;
    if (price >= watchlistStatus.crude_price.priceTarget) {
      watchlistStatus.crude_price.status = 'TRIGGERED';
      watchlistStatus.crude_price.lastHit = { price, time: new Date().toISOString() };
    }
  }
  watchlistCache.set(watchlistStatus);
}

// ---------------------------------------------------------------------------
// News scanning
// ---------------------------------------------------------------------------
const NEWS_REGIONS = {
  asia: {
    name: 'Asia-Pacific',
    feeds: [
      { url: 'https://www3.nhk.or.jp/rss/news/cat0.xml', source: 'NHK Japan' },
      { url: 'https://www.scmp.com/rss/91/feed', source: 'SCMP China' },
      { url: 'https://en.yna.co.kr/RSS/news.xml', source: 'Yonhap Korea' },
    ],
    keywords: ['china', 'taiwan', 'japan', 'korea', 'india', 'military', 'trade', 'sanctions'],
  },
  europe: {
    name: 'Europe',
    feeds: [
      { url: 'https://feeds.bbci.co.uk/news/world/rss.xml', source: 'BBC World' },
      { url: 'https://rss.dw.com/xml/rss-en-all', source: 'DW Germany' },
    ],
    keywords: ['nato', 'eu', 'ukraine', 'russia', 'germany', 'france', 'uk', 'sanctions', 'energy'],
  },
  americas: {
    name: 'Americas',
    feeds: [
      { url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', source: 'NYT World' },
      { url: 'https://feeds.npr.org/1004/rss.xml', source: 'NPR World' },
    ],
    keywords: ['mexico', 'brazil', 'canada', 'venezuela', 'trade', 'immigration'],
  },
  africa: {
    name: 'Africa',
    feeds: [
      { url: 'https://allafrica.com/tools/headlines/rdf/latest/headlines.rdf', source: 'AllAfrica' },
    ],
    keywords: ['coup', 'conflict', 'oil', 'mining', 'china', 'russia'],
  },
  middleEast: {
    name: 'Middle East',
    feeds: [
      { url: 'https://english.alarabiya.net/tools/rss', source: 'Al Arabiya' },
      { url: 'https://www.jpost.com/rss/rssfeedsfrontpage.aspx', source: 'Jerusalem Post' },
    ],
    keywords: ['iran', 'israel', 'saudi', 'yemen', 'houthi', 'oil', 'attack', 'military'],
  },
  yahoo: {
    name: 'Yahoo Finance',
    feeds: [
      { url: 'https://finance.yahoo.com/news/rssindex', source: 'Yahoo Finance' },
    ],
    keywords: ['market', 'stock', 'oil', 'crypto', 'bitcoin', 'fed', 'inflation', 'trade', 'tariff', 'gold'],
  },
};

async function scanAllNews() {
  console.log('[NEWS] Scanning all regions...');
  const regions = {};

  for (const [key, region] of Object.entries(NEWS_REGIONS)) {
    const stories = [];
    for (const feed of region.feeds) {
      const items = await parseFeed(feed.url);
      for (const item of items) {
        const matched = region.keywords.filter(kw => item.text.includes(kw));
        if (matched.length > 0 || !region.keywords.length) {
          stories.push({ title: item.title.substring(0, 120), source: feed.source, link: item.link, keywords: matched, pubDate: item.pubDate });
        }
      }
      await new Promise(r => setTimeout(r, 1000));
    }
    regions[key] = { name: region.name, stories: stories.slice(0, 10), count: stories.length, lastScan: new Date().toISOString() };
  }

  const result = { regions, lastUpdate: new Date().toISOString() };
  newsCache.set(result);

  // Persist to DB
  const upsertNews = db.prepare('INSERT OR REPLACE INTO news_cache (id, region, stories, updated_at) VALUES ((SELECT id FROM news_cache WHERE region = ?), ?, ?, datetime(\'now\'))');
  for (const [key, val] of Object.entries(regions)) {
    upsertNews.run(key, key, JSON.stringify(val));
  }
  console.log(`[NEWS] Updated ${Object.keys(regions).length} regions`);
  return result;
}

// ---------------------------------------------------------------------------
// AI Synthesis
// ---------------------------------------------------------------------------
async function generateSynthesis() {
  if (!OPENROUTER_KEY) { console.log('[SYNTHESIS] No OpenRouter key, skipping'); return null; }

  const prices = priceCache.get() || {};
  const flights = flightCache.get() || {};
  const news = newsCache.get() || {};
  const alerts = getRecentAlerts(10);
  const watchlist = watchlistCache.get() || {};

  const m = prices.instruments || {};
  const f = flights.zones || {};

  // Weather data
  let weatherLines = '';
  try {
    const hubs = [
      { name: 'Henry Hub (NatGas)', lat: 30.13, lon: -92.36 },
      { name: 'Cushing (WTI)', lat: 35.99, lon: -96.77 },
    ];
    for (const hub of hubs) {
      const w = await fetchWithTimeout(`https://api.open-meteo.com/v1/forecast?latitude=${hub.lat}&longitude=${hub.lon}&daily=temperature_2m_max&timezone=auto&forecast_days=3`);
      const wd = await w.json();
      const temps = wd.daily?.temperature_2m_max || [];
      const avg = temps.length ? (temps.reduce((a, b) => a + b, 0) / temps.length).toFixed(1) : 'N/A';
      weatherLines += `- ${hub.name}: Avg high ${avg}C\n`;
    }
  } catch {}

  // Polymarket
  let polyLines = '';
  try {
    const pmRes = await fetchWithTimeout('https://gamma-api.polymarket.com/markets?limit=5&active=true&sort=volume&order=desc');
    const pmData = await pmRes.json();
    const pmMarkets = Array.isArray(pmData) ? pmData : (pmData.markets || []);
    polyLines = pmMarkets.filter(m => m && m.resolved === false && m.question).slice(0, 5).map(m => {
      let prob = 'N/A';
      try { const prices = JSON.parse(m.outcomePrices || '[0,0]'); prob = Math.round(prices[0] * 100) + '%'; } catch {}
      return `- ${m.question?.slice(0, 60)}: ${prob}`;
    }).join('\n');
  } catch {}

  const prompt = `You are a macro strategist generating a daily intelligence report. Identify the Single Dominant Narrative and trace downstream consequences.

CURRENT MARKET DATA:
- Bitcoin: $${m['BTC-USD']?.price?.toFixed(0) || '?'} (${m['BTC-USD']?.change || '?'}%)
- Ethereum: $${m['ETH-USD']?.price?.toFixed(0) || '?'} (${m['ETH-USD']?.change || '?'}%)
- WTI Crude: $${m['CL=F']?.price?.toFixed(2) || '?'} (${m['CL=F']?.change || '?'}%)
- Brent: $${m['BZ=F']?.price?.toFixed(2) || '?'} (${m['BZ=F']?.change || '?'}%)
- Spread: $${prices.spreads?.brentWti || '?'}
- NatGas: $${m['NG=F']?.price?.toFixed(2) || '?'} (${m['NG=F']?.change || '?'}%)
- Gold: $${m['GC=F']?.price?.toFixed(0) || '?'} (${m['GC=F']?.change || '?'}%)
- S&P 500: ${m['^SPX']?.price?.toFixed(0) || '?'} (${m['^SPX']?.change || '?'}%)
- VIX: ${m['^VIX']?.price?.toFixed(2) || '?'} (${m['^VIX']?.change || '?'}%)
- DXY: ${m['DX-Y.NYB']?.price?.toFixed(2) || '?'}
- 10Y: ${m['^TNX']?.price?.toFixed(2) || '?'}%

WEATHER (Energy Hubs):
${weatherLines || 'N/A'}

POLYMARKET:
${polyLines || 'N/A'}

WATCHLIST:
${Object.entries(watchlist).map(([k, v]) => `- ${v.name}: ${v.status || 'watching'}${v.lastHit ? ' — ' + (v.lastHit.title || '').substring(0, 50) : ''}`).join('\n')}

FLIGHTS:
- Middle East: ${f.middleEast?.total || 0} (${f.middleEast?.military || 0} mil)
- Red Sea: ${f.redSea?.total || 0} (${f.redSea?.military || 0} mil)
- E. Med: ${f.mediterranean?.total || 0} (${f.mediterranean?.military || 0} mil)

ALERTS:
${alerts.map(a => `- [${a.type}] ${a.message}`).join('\n') || 'None'}

TOP NEWS:
${Object.entries(news.regions || {}).map(([k, r]) => `${r.name}: ${r.stories?.[0]?.title?.substring(0, 60) || 'No news'}`).join('\n')}

Generate JSON:
{
  "timestamp": "ISO",
  "summary": "2-3 sentence executive summary",
  "criticalSignals": [{"signal":"...","severity":"high/medium/low"}],
  "downstreamEffects": [{"trigger":"...","chain":["..."],"timeframe":"...","confidence":"high/medium/low"}],
  "regime": {"current":"risk-on/risk-off/neutral","reasoning":"...","shift_probability":"low/medium/high"},
  "positioning": [{"trade":"...","reasoning":"...","entry":"...","risk":"...","conviction":"high/medium/low"}],
  "watchNext24h": [{"event":"...","trigger":"...","impact":"..."}]
}

Be specific. Use actual numbers. Think like a macro hedge fund analyst.`;

  try {
    const res = await fetchWithTimeout('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://snappedai.com',
        'X-Title': 'Butterfly Engine Synthesis',
      },
      body: JSON.stringify({
        model: 'deepseek/deepseek-chat',
        messages: [
          { role: 'system', content: 'You are a macro strategist. Output valid JSON only.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 2000,
      }),
    }, 30_000);

    const result = await res.json();
    const content = result.choices?.[0]?.message?.content;
    if (!content) return null;

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const report = JSON.parse(jsonMatch[0]);
    report.generatedAt = new Date().toISOString();
    report.dataSnapshot = {
      btc: m['BTC-USD']?.price,
      wti: m['CL=F']?.price,
      vix: m['^VIX']?.price,
      spx: m['^SPX']?.price,
    };

    synthesisCache.set(report);

    // Persist
    db.prepare('INSERT INTO synthesis_cache (report, data_snapshot, created_at) VALUES (?, ?, datetime(\'now\'))').run(
      JSON.stringify(report), JSON.stringify(report.dataSnapshot)
    );

    console.log('[SYNTHESIS] Report generated:', report.summary?.substring(0, 80));
    return report;
  } catch (e) {
    console.error('[SYNTHESIS ERROR]', e.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Alert helpers
// ---------------------------------------------------------------------------
function insertAlert(type, message, details, severity) {
  // Dedupe: same message in last hour
  const recent = db.prepare("SELECT id FROM alerts WHERE message = ? AND created_at > datetime('now', '-1 hour')").get(message);
  if (recent) return;
  db.prepare('INSERT INTO alerts (type, message, details, severity) VALUES (?, ?, ?, ?)').run(type, message, details || null, severity || 'medium');
}

function getRecentAlerts(limit = 20) {
  return db.prepare('SELECT * FROM alerts ORDER BY created_at DESC LIMIT ?').all(limit);
}

// ---------------------------------------------------------------------------
// Source registry import
// ---------------------------------------------------------------------------
function importSourceCSV(csvPath) {
  if (!fs.existsSync(csvPath)) return 0;
  const existing = db.prepare('SELECT COUNT(*) as c FROM sources').get().c;
  if (existing > 0) return existing;

  const text = fs.readFileSync(csvPath, 'utf8');
  const lines = text.trim().split(/\r?\n/);
  const header = parseCSVLine(lines.shift());

  const insert = db.prepare(`INSERT OR IGNORE INTO sources (source_id, priority, region, country_or_zone, source_name, source_type, language, coverage, ingestion_method, cadence_minutes, reliability_score, notes, verified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  const tx = db.transaction(() => {
    let count = 0;
    for (const line of lines) {
      const vals = parseCSVLine(line);
      const row = {};
      header.forEach((h, i) => row[h] = vals[i] || '');
      const isPlaceholder = (row.notes || '').toLowerCase().includes('auto-added placeholder');
      insert.run(
        row.source_id, row.priority || 'P2', row.region || '', row.country_or_zone || '',
        row.source_name || 'Unknown', row.source_type || '', row.language || 'en',
        row.coverage || '', row.ingestion_method || '', parseInt(row.cadence_minutes) || 60,
        parseFloat(row.reliability_score) || 0.5, row.notes || '', isPlaceholder ? 0 : 1
      );
      count++;
    }
    return count;
  });

  const count = tx();
  console.log(`[SOURCES] Imported ${count} sources from CSV`);
  return count;
}

function parseCSVLine(line) {
  const out = [];
  let cur = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      out.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

// ---------------------------------------------------------------------------
// Ask AI (Q&A)
// ---------------------------------------------------------------------------
const askRateLimits = new Map();
const ASK_RATE_LIMIT = 10;

function checkAskRateLimit(ip) {
  const now = Date.now();
  const rec = askRateLimits.get(ip) || { count: 0, resetAt: now + 3600_000 };
  if (now > rec.resetAt) { rec.count = 0; rec.resetAt = now + 3600_000; }
  if (rec.count >= ASK_RATE_LIMIT) return false;
  rec.count++;
  askRateLimits.set(ip, rec);
  return true;
}

async function askAI(question, ip) {
  if (!checkAskRateLimit(ip)) return { error: 'Rate limit exceeded. Try again in an hour.' };
  if (!OPENROUTER_KEY) return { error: 'AI not configured' };

  const m = priceCache.get()?.instruments || {};
  const s = synthesisCache.get() || {};

  const prompt = `You are a macro analyst assistant. Be conversational, specific, and actionable.

CURRENT MARKETS:
- BTC: $${m['BTC-USD']?.price?.toFixed(0) || '?'} (${m['BTC-USD']?.change || '?'}%)
- WTI: $${m['CL=F']?.price?.toFixed(2) || '?'} (${m['CL=F']?.change || '?'}%)
- Gold: $${m['GC=F']?.price?.toFixed(0) || '?'} (${m['GC=F']?.change || '?'}%)
- S&P 500: ${m['^SPX']?.price?.toFixed(0) || '?'} (${m['^SPX']?.change || '?'}%)
- VIX: ${m['^VIX']?.price?.toFixed(2) || '?'}

TODAY'S ANALYSIS:
- Summary: ${s.summary || 'Not available'}
- Regime: ${s.regime?.current || '?'}

User question: ${question}

Answer conversationally. Reference specific data. Keep under 200 words.`;

  try {
    const res = await fetchWithTimeout('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://snappedai.com',
      },
      body: JSON.stringify({
        model: 'deepseek/deepseek-chat',
        messages: [
          { role: 'system', content: 'You are a helpful macro analyst. Be specific, use actual numbers.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 500,
      }),
    }, 20_000);
    const result = await res.json();
    return { answer: result.choices?.[0]?.message?.content || 'Could not process that.' };
  } catch (e) {
    return { error: 'AI temporarily unavailable: ' + e.message };
  }
}

// ---------------------------------------------------------------------------
// Express App
// ---------------------------------------------------------------------------
const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());

// --- family-scanner module (apartment + flight pages) ---
try { require('./family-server.cjs')(app, db); } catch (e) { console.error('[FAMILY] mount failed:', e.message); }


// Health
app.get('/api/health', (req, res) => {
  const sourceCount = db.prepare('SELECT COUNT(*) as c FROM sources').get().c;
  const priceCount = db.prepare('SELECT COUNT(*) as c FROM price_cache').get().c;
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    sources: sourceCount,
    prices: priceCount,
    caches: {
      prices: !priceCache.isStale(),
      flights: !flightCache.isStale(),
      news: !newsCache.isStale(),
      synthesis: !synthesisCache.isStale(),
    },
  });
});

// Prices
app.get('/api/prices', async (req, res) => {
  let data = priceCache.get();
  if (!data || priceCache.isStale()) {
    // Return cached DB data while refresh happens in background
    const rows = db.prepare('SELECT * FROM price_cache').all();
    if (rows.length && data) {
      // Background refresh
      pollAllPrices().catch(() => {});
    }
    if (!data && rows.length) {
      const instruments = {};
      const categories = {};
      for (const r of rows) {
        instruments[r.symbol] = { symbol: r.symbol, name: r.name, category: r.category, price: r.price, prevClose: r.prev_close, change: r.change_pct?.toFixed(2) };
        if (!categories[r.category]) categories[r.category] = [];
        categories[r.category].push(instruments[r.symbol]);
      }
      data = { instruments, categories, spreads: {}, lastUpdate: rows[0]?.updated_at || 'unknown' };
      if (instruments['BZ=F'] && instruments['CL=F']) {
        data.spreads.brentWti = (instruments['BZ=F'].price - instruments['CL=F'].price).toFixed(2);
      }
    }
  }
  res.json(data || { instruments: {}, categories: {}, spreads: {}, lastUpdate: null });
});

// Flights
app.get('/api/flights', (req, res) => {
  res.json(flightCache.get() || { zones: {}, lastUpdate: null });
});

// Alerts
app.get('/api/alerts', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  res.json(getRecentAlerts(limit));
});

// Watchlist
app.get('/api/watchlist', (req, res) => {
  res.json(watchlistCache.get() || watchlistStatus);
});

// News
app.get('/api/news', (req, res) => {
  let data = newsCache.get();
  if (!data) {
    // Try DB fallback
    const rows = db.prepare('SELECT * FROM news_cache ORDER BY updated_at DESC').all();
    if (rows.length) {
      const regions = {};
      for (const r of rows) {
        try { regions[r.region] = JSON.parse(r.stories); } catch {}
      }
      data = { regions, lastUpdate: rows[0]?.updated_at };
    }
  }
  res.json(data || { regions: {}, lastUpdate: null });
});

// Synthesis
app.get('/api/synthesis', (req, res) => {
  let data = synthesisCache.get();
  if (!data) {
    const row = db.prepare('SELECT report FROM synthesis_cache ORDER BY created_at DESC LIMIT 1').get();
    if (row) {
      try { data = JSON.parse(row.report); } catch {}
    }
  }
  res.json(data || { error: 'No synthesis report yet' });
});

// Sources
app.get('/api/sources', (req, res) => {
  const { region, source_type, quality, q, limit: lim, offset: off } = req.query;
  let sql = 'SELECT * FROM sources WHERE 1=1';
  const params = [];

  if (region) { sql += ' AND region = ?'; params.push(region); }
  if (source_type) { sql += ' AND source_type = ?'; params.push(source_type); }
  if (quality === 'official') { sql += ' AND verified = 1'; }
  if (quality === 'placeholder') { sql += ' AND verified = 0'; }
  if (q) { sql += ' AND (source_name LIKE ? OR country_or_zone LIKE ? OR notes LIKE ?)'; params.push(`%${q}%`, `%${q}%`, `%${q}%`); }

  const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as c');
  const total = db.prepare(countSql).get(...params).c;

  sql += ' ORDER BY region, country_or_zone, source_name';
  const limit = Math.min(parseInt(lim) || 1000, 1000);
  const offset = parseInt(off) || 0;
  sql += ` LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const rows = db.prepare(sql).all(...params);

  // Stats
  const stats = db.prepare('SELECT COUNT(*) as total, SUM(verified) as verified FROM sources').get();

  res.json({
    sources: rows,
    total,
    stats: { total: stats.total, verified: stats.verified, placeholder: stats.total - stats.verified },
    regions: db.prepare('SELECT DISTINCT region FROM sources ORDER BY region').all().map(r => r.region),
    sourceTypes: db.prepare('SELECT DISTINCT source_type FROM sources ORDER BY source_type').all().map(r => r.source_type),
  });
});

// Ask AI
app.post('/api/ask', async (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const { question } = req.body;
  if (!question || question.length < 3) return res.status(400).json({ error: 'Question too short' });
  const result = await askAI(question, ip);
  res.json(result);
});

// ---------------------------------------------------------------------------
// Phase 2 API endpoints (events, ripples, assets, anomalies, predictions, dashboard)
// ---------------------------------------------------------------------------

// Events
app.get('/api/events', (req, res) => {
  const { category, region, severity_min, limit: lim, offset: off } = req.query;
  let sql = 'SELECT * FROM events WHERE 1=1';
  const params = [];
  if (category) { sql += ' AND category = ?'; params.push(category); }
  if (region) { sql += ' AND region = ?'; params.push(region); }
  if (severity_min) { sql += ' AND severity >= ?'; params.push(parseInt(severity_min)); }
  sql += ' ORDER BY created_at DESC';
  const limit = Math.min(parseInt(lim) || 50, 200);
  const offset = parseInt(off) || 0;
  sql += ' LIMIT ? OFFSET ?';
  params.push(limit, offset);

  try {
    const rows = db.prepare(sql).all(...params);
    const total = db.prepare(sql.replace('SELECT *', 'SELECT COUNT(*) as c').replace(/ LIMIT.*/, '')).get(...params.slice(0, -2))?.c || 0;
    res.json({ events: rows, total });
  } catch (e) {
    res.json({ events: [], total: 0 });
  }
});

// Event ripples
app.get('/api/events/:id/ripples', (req, res) => {
  try {
    const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    const ripples = db.prepare('SELECT * FROM ripple_effects WHERE event_id = ? ORDER BY ripple_order, confidence DESC').all(req.params.id);
    const predictions = db.prepare('SELECT * FROM predictions WHERE event_id = ? ORDER BY created_at DESC').all(req.params.id);
    res.json({ event, ripples, predictions });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Assets with regime
app.get('/api/assets', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM assets ORDER BY category, name').all();
    res.json({ assets: rows });
  } catch (e) {
    res.json({ assets: [] });
  }
});

// Anomalies
app.get('/api/anomalies', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  try {
    const rows = db.prepare('SELECT * FROM anomalies WHERE resolved = 0 ORDER BY created_at DESC LIMIT ?').all(limit);
    res.json(rows);
  } catch (e) {
    res.json([]);
  }
});

// Predictions accuracy
app.get('/api/predictions/accuracy', (req, res) => {
  try {
    const latest = db.prepare('SELECT * FROM accuracy_reports ORDER BY created_at DESC LIMIT 1').get();
    const total = db.prepare('SELECT COUNT(*) as c FROM predictions').get()?.c || 0;
    const pending = db.prepare("SELECT COUNT(*) as c FROM predictions WHERE status = 'pending'").get()?.c || 0;
    const correct = db.prepare("SELECT COUNT(*) as c FROM predictions WHERE status = 'correct'").get()?.c || 0;
    const incorrect = db.prepare("SELECT COUNT(*) as c FROM predictions WHERE status = 'incorrect'").get()?.c || 0;
    const partial = db.prepare("SELECT COUNT(*) as c FROM predictions WHERE status = 'partial'").get()?.c || 0;

    res.json({
      summary: { total, pending, correct, incorrect, partial, hit_rate: total - pending > 0 ? (correct / (total - pending) * 100).toFixed(1) : null },
      latest_report: latest ? JSON.parse(latest.by_category || '{}') : null,
      by_asset: latest ? JSON.parse(latest.by_asset_class || '{}') : null,
      by_horizon: latest ? JSON.parse(latest.by_time_horizon || '{}') : null,
    });
  } catch (e) {
    res.json({ summary: {}, latest_report: null });
  }
});

// Predictions list
app.get('/api/predictions', (req, res) => {
  const { status, asset, limit: lim } = req.query;
  let sql = 'SELECT p.*, e.title as event_title, e.category as event_category FROM predictions p LEFT JOIN events e ON p.event_id = e.id WHERE 1=1';
  const params = [];
  if (status) { sql += ' AND p.status = ?'; params.push(status); }
  if (asset) { sql += ' AND p.asset = ?'; params.push(asset); }
  sql += ' ORDER BY p.created_at DESC';
  const limit = Math.min(parseInt(lim) || 50, 200);
  sql += ' LIMIT ?';
  params.push(limit);
  try {
    res.json(db.prepare(sql).all(...params));
  } catch (e) {
    res.json([]);
  }
});

// ---------------------------------------------------------------------------
// Polymarket mispricing API endpoints
// ---------------------------------------------------------------------------

// Active markets
app.get('/api/polymarket/markets', (req, res) => {
  const { category, minVolume, limit: lim } = req.query;
  let sql = 'SELECT * FROM polymarket_markets WHERE active = 1';
  const params = [];
  if (category) { sql += ' AND category = ?'; params.push(category); }
  if (minVolume) { sql += ' AND volume >= ?'; params.push(parseFloat(minVolume)); }
  sql += ' ORDER BY volume DESC';
  const limit = Math.min(parseInt(lim) || 50, 200);
  sql += ' LIMIT ?';
  params.push(limit);
  try {
    const rows = db.prepare(sql).all(...params);
    const total = db.prepare('SELECT COUNT(*) as c FROM polymarket_markets WHERE active = 1').get()?.c || 0;
    res.json({ markets: rows, total });
  } catch (e) {
    res.json({ markets: [], total: 0 });
  }
});

// Mispricing signals
app.get('/api/polymarket/mispricings', (req, res) => {
  const { strength, includeDecayed, includeStale, maxAgeHours, limit: lim } = req.query;
  let sql = `SELECT m.*, pm.question as market_question, pm.prob_yes, pm.prob_no,
    pm.volume, pm.liquidity, pm.url as market_url, pm.category as market_category,
    e.title as event_title, e.category as event_category
    FROM polymarket_mispricings m
    JOIN polymarket_markets pm ON m.market_id = pm.market_id
    LEFT JOIN events e ON m.event_id = e.id
    WHERE pm.prob_yes > 0.05 AND pm.prob_yes < 0.95`;
  const params = [];
  if (strength) { sql += ' AND m.signal_strength = ?'; params.push(strength); }
  if (includeDecayed !== 'true') { sql += ' AND m.decayed = 0'; }
  // Default freshness guard: only show recent signals unless explicitly requested.
  if (includeStale !== 'true') {
    const age = Math.max(1, Math.min(parseInt(maxAgeHours) || 12, 168));
    sql += ` AND m.created_at >= datetime('now', '-${age} hours')`;
  }
  sql += ' ORDER BY m.delta DESC, m.created_at DESC';
  const limit = Math.min(parseInt(lim) || 50, 200);
  sql += ' LIMIT ?';
  params.push(limit);
  try {
    const rawRows = db.prepare(sql).all(...params);
    // Dedup: keep highest-delta signal per unique market
    const seen = new Map();
    for (const r of rawRows) {
      const existing = seen.get(r.market_id);
      if (!existing || Math.abs(r.delta) > Math.abs(existing.delta)) {
        seen.set(r.market_id, r);
      }
    }
    const rows = [...seen.values()].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    res.json({ mispricings: rows, total: rows.length });
  } catch (e) {
    res.json({ mispricings: [], total: 0 });
  }
});

// Mispricing detail
app.get('/api/polymarket/mispricings/:id', (req, res) => {
  try {
    const signal = db.prepare(`
      SELECT m.*, pm.question as market_question, pm.prob_yes, pm.prob_no,
        pm.volume, pm.liquidity, pm.url as market_url, pm.category as market_category,
        pm.outcome_yes, pm.outcome_no, pm.end_date, pm.volume_24h
      FROM polymarket_mispricings m
      JOIN polymarket_markets pm ON m.market_id = pm.market_id
      WHERE m.id = ?
    `).get(req.params.id);
    if (!signal) return res.status(404).json({ error: 'Signal not found' });

    const event = signal.event_id ? db.prepare('SELECT * FROM events WHERE id = ?').get(signal.event_id) : null;
    const ripple = signal.ripple_id ? db.prepare('SELECT * FROM ripple_effects WHERE id = ?').get(signal.ripple_id) : null;
    const rippleChain = signal.event_id ? db.prepare('SELECT * FROM ripple_effects WHERE event_id = ? ORDER BY ripple_order, confidence DESC').all(signal.event_id) : [];

    res.json({ signal, event, ripple, rippleChain });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Polymarket stats
app.get('/api/polymarket/stats', (req, res) => {
  try {
    const { includeStale, maxAgeHours } = req.query;
    // Only count signals for non-settled markets (prob between 5% and 95%)
    // and recent by default, to avoid stale dashboard numbers.
    const age = Math.max(1, Math.min(parseInt(maxAgeHours) || 12, 168));
    const freshness = includeStale === 'true' ? '1=1' : `m.created_at >= datetime('now', '-${age} hours')`;
    const validFilter = `m.decayed = 0 AND pm.prob_yes > 0.05 AND pm.prob_yes < 0.95 AND ${freshness}`;
    const total = db.prepare(`SELECT COUNT(DISTINCT m.market_id) as c FROM polymarket_mispricings m JOIN polymarket_markets pm ON m.market_id = pm.market_id WHERE ${validFilter}`).get()?.c || 0;
    const strong = db.prepare(`SELECT COUNT(DISTINCT m.market_id) as c FROM polymarket_mispricings m JOIN polymarket_markets pm ON m.market_id = pm.market_id WHERE ${validFilter} AND m.signal_strength = 'strong'`).get()?.c || 0;
    const moderate = db.prepare(`SELECT COUNT(DISTINCT m.market_id) as c FROM polymarket_mispricings m JOIN polymarket_markets pm ON m.market_id = pm.market_id WHERE ${validFilter} AND m.signal_strength = 'moderate'`).get()?.c || 0;
    const weak = db.prepare(`SELECT COUNT(DISTINCT m.market_id) as c FROM polymarket_mispricings m JOIN polymarket_markets pm ON m.market_id = pm.market_id WHERE ${validFilter} AND m.signal_strength = 'weak'`).get()?.c || 0;
    const corrected = db.prepare("SELECT COUNT(*) as c FROM polymarket_mispricings WHERE resolution = 'market_corrected'").get()?.c || 0;
    const wrong = db.prepare("SELECT COUNT(*) as c FROM polymarket_mispricings WHERE resolution = 'ripple_wrong'").get()?.c || 0;
    const resolved = corrected + wrong;
    const marketCount = db.prepare('SELECT COUNT(*) as c FROM polymarket_markets WHERE active = 1').get()?.c || 0;

    res.json({
      active_signals: total,
      by_strength: { strong, moderate, weak },
      resolution: {
        total_resolved: resolved,
        market_corrected: corrected,
        ripple_wrong: wrong,
        correction_rate: resolved > 0 ? Math.round((corrected / resolved) * 100) : null,
      },
      active_markets: marketCount,
    });
  } catch (e) {
    res.json({ active_signals: 0, by_strength: {}, resolution: {}, active_markets: 0 });
  }
});

// Dashboard aggregate (for initial page load)
app.get('/api/dashboard', (req, res) => {
  try {
    const prices = priceCache.get() || {};
    const flights = flightCache.get() || {};
    const synthesis = synthesisCache.get() || {};
    const watchlist = watchlistCache.get() || {};

    const recentEvents = db.prepare('SELECT * FROM events ORDER BY created_at DESC LIMIT 10').all();
    const recentAnomalies = db.prepare('SELECT * FROM anomalies WHERE resolved = 0 ORDER BY created_at DESC LIMIT 5').all();
    const recentAlerts = db.prepare('SELECT * FROM alerts ORDER BY created_at DESC LIMIT 10').all();
    const predSummary = {
      total: db.prepare('SELECT COUNT(*) as c FROM predictions').get()?.c || 0,
      pending: db.prepare("SELECT COUNT(*) as c FROM predictions WHERE status = 'pending'").get()?.c || 0,
      correct: db.prepare("SELECT COUNT(*) as c FROM predictions WHERE status = 'correct'").get()?.c || 0,
    };

    res.json({
      prices: prices.instruments || {},
      spreads: prices.spreads || {},
      flights: flights.zones || {},
      synthesis,
      watchlist,
      events: recentEvents,
      anomalies: recentAnomalies,
      alerts: recentAlerts,
      predictions: predSummary,
      lastUpdate: prices.lastUpdate || new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Server-Sent Events (SSE) endpoint
// ---------------------------------------------------------------------------

// Track last event ID for each client connection
const clientLastEventIds = new WeakMap();

app.get('/api/sse/events', (req, res) => {
  // Set proper SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Get client's last event ID (if resuming connection)
  const clientLastId = parseInt(req.query.lastId) || 0;
  let lastEventId = clientLastId;
  let lastAnomalyId = clientLastId;
  let lastPriceUpdate = Date.now();

  // Send initial connection confirmation
  res.write(`event: connected\ndata: ${JSON.stringify({ timestamp: new Date().toISOString(), message: 'SSE connection established' })}\n\n`);

  // Heartbeat interval (30 seconds) to keep connection alive
  const heartbeatInterval = setInterval(() => {
    res.write(`event: ping\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);
  }, 30_000);

  // Poll for new events every 10 seconds
  const eventInterval = setInterval(() => {
    try {
      const newEvents = db.prepare('SELECT * FROM events WHERE id > ? ORDER BY id ASC LIMIT 50').all(lastEventId);
      for (const event of newEvents) {
        res.write(`event: event\ndata: ${JSON.stringify(event)}\n\n`);
        lastEventId = event.id;
      }
    } catch (e) {
      console.error('[SSE] Error polling events:', e.message);
    }
  }, 10_000);

  // Poll for new anomalies every 15 seconds
  const anomalyInterval = setInterval(() => {
    try {
      const newAnomalies = db.prepare('SELECT * FROM anomalies WHERE id > ? ORDER BY id ASC LIMIT 50').all(lastAnomalyId);
      for (const anomaly of newAnomalies) {
        res.write(`event: anomaly\ndata: ${JSON.stringify(anomaly)}\n\n`);
        lastAnomalyId = anomaly.id;
      }
    } catch (e) {
      console.error('[SSE] Error polling anomalies:', e.message);
    }
  }, 15_000);

  // Send price updates every 60 seconds
  const priceInterval = setInterval(() => {
    try {
      const prices = priceCache.get();
      if (prices) {
        res.write(`event: price_update\ndata: ${JSON.stringify({ timestamp: new Date().toISOString(), instruments: prices.instruments || {}, spreads: prices.spreads || {} })}\n\n`);
      }
    } catch (e) {
      console.error('[SSE] Error sending price update:', e.message);
    }
  }, 60_000);

  // Clean up intervals on client disconnect
  req.on('close', () => {
    clearInterval(heartbeatInterval);
    clearInterval(eventInterval);
    clearInterval(anomalyInterval);
    clearInterval(priceInterval);
    console.log('[SSE] Client disconnected');
  });

  // Handle client errors
  req.on('error', (e) => {
    console.error('[SSE] Client error:', e.message);
    clearInterval(heartbeatInterval);
    clearInterval(eventInterval);
    clearInterval(anomalyInterval);
    clearInterval(priceInterval);
  });
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
async function startPollers() {
  // Import sources CSV on first run
  const csvPath = '/var/www/snap/data/global-source-registry-starter.csv';
  importSourceCSV(csvPath);

  // Initial data fetch
  console.log('[STARTUP] Fetching initial data...');
  await pollAllPrices().catch(e => console.error('[STARTUP] Price poll error:', e.message));
  await pollFlights().catch(e => console.error('[STARTUP] Flight poll error:', e.message));
  await scanWatchlist().catch(e => console.error('[STARTUP] Watchlist error:', e.message));
  await scanAllNews().catch(e => console.error('[STARTUP] News error:', e.message));

  // Generate initial synthesis after data is loaded
  setTimeout(() => generateSynthesis().catch(e => console.error('[STARTUP] Synthesis error:', e.message)), 5000);

  // Polling intervals
  setInterval(() => pollAllPrices().catch(() => {}), 5 * 60_000);      // 5 min
  setInterval(() => pollFlights().catch(() => {}), 2 * 60_000);        // 2 min
  setInterval(() => scanWatchlist().catch(() => {}), 10 * 60_000);     // 10 min
  setInterval(() => scanAllNews().catch(() => {}), 15 * 60_000);       // 15 min
  setInterval(() => generateSynthesis().catch(() => {}), 30 * 60_000); // 30 min
}

const server = app.listen(PORT, () => {
  console.log(`[BUTTERFLY] Server running on port ${PORT}`);
  console.log(`[BUTTERFLY] Database: ${DB_PATH}`);
  startPollers();
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[BUTTERFLY] Shutting down...');
  server.close();
  db.close();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[BUTTERFLY] Interrupted, closing...');
  server.close();
  db.close();
  process.exit(0);
});
