#!/usr/bin/env node
// butterfly-feeds.cjs — Feed ingestion worker for Global Butterfly Engine
// Always-on PM2 service, 60-second tick.
// Ingests RSS + API feeds, deduplicates into canonical events, tracks feed health.

const Database = require('better-sqlite3');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const DB_PATH = process.env.BUTTERFLY_DB || path.join(__dirname, 'butterfly.db');
const ENV_PATH = process.env.ENV_PATH || '/var/www/snap/.env';
const TICK_INTERVAL = 60_000; // 60 seconds
const FETCH_TIMEOUT = 10_000; // 10 seconds
const RAW_ITEMS_TTL_DAYS = 7;
const FEED_RUNS_TTL_DAYS = 3;
const TITLE_OVERLAP_THRESHOLD = 0.6;

// Load .env
let OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || '';
try {
  const envFile = fs.readFileSync(ENV_PATH, 'utf8');
  if (!OPENROUTER_KEY) {
    const m = envFile.match(/OPENROUTER_API_KEY=(.+)/);
    if (m) OPENROUTER_KEY = m[1].trim();
  }
} catch {}

// ---------------------------------------------------------------------------
// Feed definitions
// ---------------------------------------------------------------------------
const FEEDS = [
  // Wire services
  { id: 'bbc-world', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', type: 'rss', category: 'geopolitics', cadence: 300 },
  { id: 'dw-world', url: 'https://rss.dw.com/xml/rss-en-all', type: 'rss', category: 'geopolitics', cadence: 600 },

  // Finance
  { id: 'yahoo-finance', url: 'https://finance.yahoo.com/news/rssindex', type: 'rss', category: 'markets', cadence: 300 },

  // Middle East
  { id: 'alarabiya', url: 'https://english.alarabiya.net/tools/rss', type: 'rss', category: 'middle_east', cadence: 300 },
  { id: 'jpost', url: 'https://www.jpost.com/rss/rssfeedsfrontpage.aspx', type: 'rss', category: 'middle_east', cadence: 300 },

  // Asia
  { id: 'nhk-japan', url: 'https://www3.nhk.or.jp/rss/news/cat0.xml', type: 'rss', category: 'asia', cadence: 600 },
  { id: 'scmp-china', url: 'https://www.scmp.com/rss/91/feed', type: 'rss', category: 'asia', cadence: 600 },
  { id: 'yonhap-korea', url: 'https://en.yna.co.kr/RSS/news.xml', type: 'rss', category: 'asia', cadence: 600 },

  // Shipping
  { id: 'gcaptain', url: 'https://gcaptain.com/feed/', type: 'rss', category: 'shipping', cadence: 900 },
  { id: 'hellenic-shipping', url: 'https://www.hellenicshippingnews.com/feed/', type: 'rss', category: 'shipping', cadence: 900 },

  // Defense
  { id: 'nato-news', url: 'https://www.nato.int/cps/en/natohq/news.xml', type: 'rss', category: 'defense', cadence: 900 },

  // Crypto
  { id: 'coingecko-news', url: 'https://www.coingecko.com/en/news.rss', type: 'rss', category: 'crypto', cadence: 600 },

  // Polymarket
  { id: 'polymarket', url: 'https://gamma-api.polymarket.com/markets?limit=20&active=true&sort=volume&order=desc', type: 'api_json', category: 'prediction_markets', cadence: 900 },

  // GDELT
  { id: 'gdelt-events', url: 'http://api.gdeltproject.org/api/v2/doc/doc?query=&mode=ArtList&maxrecords=20&format=json&sort=DateDesc', type: 'api_json', category: 'global_events', cadence: 600 },
];

// ---------------------------------------------------------------------------
// Country + asset dictionaries for entity extraction
// ---------------------------------------------------------------------------
const COUNTRIES = [
  'United States', 'US', 'USA', 'China', 'Russia', 'Ukraine', 'Iran', 'Israel',
  'Palestine', 'Gaza', 'Taiwan', 'North Korea', 'South Korea', 'Japan', 'India',
  'Pakistan', 'Saudi Arabia', 'Turkey', 'Syria', 'Iraq', 'Afghanistan', 'Yemen',
  'Lebanon', 'Egypt', 'Libya', 'Sudan', 'Ethiopia', 'Nigeria', 'South Africa',
  'Brazil', 'Mexico', 'Colombia', 'Venezuela', 'Argentina', 'Canada', 'UK',
  'United Kingdom', 'France', 'Germany', 'Italy', 'Spain', 'Poland', 'Romania',
  'Netherlands', 'Belgium', 'Sweden', 'Norway', 'Finland', 'Denmark', 'Greece',
  'Australia', 'New Zealand', 'Indonesia', 'Philippines', 'Vietnam', 'Thailand',
  'Myanmar', 'Malaysia', 'Singapore', 'Bangladesh', 'Sri Lanka', 'Nepal',
  'Kazakhstan', 'Uzbekistan', 'Georgia', 'Armenia', 'Azerbaijan', 'Belarus',
  'Moldova', 'Serbia', 'Kosovo', 'Bosnia', 'Croatia', 'Hungary', 'Czech',
  'Slovakia', 'Austria', 'Switzerland', 'Portugal', 'Ireland', 'Scotland',
  'NATO', 'EU', 'European Union', 'OPEC', 'BRICS', 'ASEAN', 'G7', 'G20',
];

const ASSETS = [
  'BTC', 'Bitcoin', 'ETH', 'Ethereum', 'XRP', 'Solana', 'SOL', 'Dogecoin', 'DOGE',
  'oil', 'crude', 'Brent', 'WTI', 'natural gas', 'gold', 'silver', 'copper',
  'wheat', 'corn', 'uranium', 'lithium', 'rare earth',
  'S&P 500', 'Nasdaq', 'Dow Jones', 'Nikkei', 'FTSE', 'DAX', 'Hang Seng',
  'Treasury', 'bond', 'yield', 'dollar', 'euro', 'yen', 'yuan', 'ruble',
];

// Build regex patterns (case-insensitive, word boundary)
const COUNTRY_PATTERNS = COUNTRIES.map(c => ({
  name: c,
  regex: new RegExp(`\\b${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'),
}));

const ASSET_PATTERNS = ASSETS.map(a => ({
  name: a,
  regex: new RegExp(`\\b${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'),
}));

// ---------------------------------------------------------------------------
// Database setup
// ---------------------------------------------------------------------------
const db = new Database(DB_PATH, { verbose: null });
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS raw_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    feed_id TEXT NOT NULL,
    title TEXT NOT NULL,
    url TEXT,
    summary TEXT,
    published_at TEXT,
    ingested_at TEXT DEFAULT (datetime('now')),
    event_id INTEGER REFERENCES events(id),
    processed INTEGER DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_raw_items_feed ON raw_items(feed_id, ingested_at DESC);
  CREATE INDEX IF NOT EXISTS idx_raw_items_processed ON raw_items(processed);

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_hash TEXT UNIQUE,
    title TEXT NOT NULL,
    summary TEXT,
    country TEXT,
    region TEXT,
    category TEXT,
    severity INTEGER DEFAULT 5,
    novelty REAL DEFAULT 0.5,
    confidence REAL DEFAULT 0.5,
    entities TEXT,
    source_count INTEGER DEFAULT 1,
    first_seen TEXT DEFAULT (datetime('now')),
    last_updated TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_events_category ON events(category);
  CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at DESC);

  CREATE TABLE IF NOT EXISTS feed_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    feed_id TEXT NOT NULL,
    status TEXT DEFAULT 'ok',
    items_fetched INTEGER DEFAULT 0,
    items_new INTEGER DEFAULT 0,
    error TEXT,
    run_at TEXT DEFAULT (datetime('now'))
  );
`);

// ---------------------------------------------------------------------------
// Prepared statements
// ---------------------------------------------------------------------------
const stmts = {
  insertRawItem: db.prepare(`
    INSERT OR IGNORE INTO raw_items (feed_id, title, url, summary, published_at)
    VALUES (@feed_id, @title, @url, @summary, @published_at)
  `),

  rawItemExists: db.prepare(`
    SELECT 1 FROM raw_items WHERE feed_id = @feed_id AND title = @title LIMIT 1
  `),

  getUnprocessedItems: db.prepare(`
    SELECT * FROM raw_items WHERE processed = 0 ORDER BY ingested_at ASC LIMIT 100
  `),

  markProcessed: db.prepare(`
    UPDATE raw_items SET processed = 1, event_id = @event_id WHERE id = @id
  `),

  getEventByHash: db.prepare(`
    SELECT * FROM events WHERE event_hash = @hash LIMIT 1
  `),

  getRecentEvents: db.prepare(`
    SELECT * FROM events WHERE created_at > datetime('now', '-24 hours') ORDER BY created_at DESC
  `),

  insertEvent: db.prepare(`
    INSERT INTO events (event_hash, title, summary, country, region, category, severity, novelty, confidence, entities)
    VALUES (@event_hash, @title, @summary, @country, @region, @category, @severity, @novelty, @confidence, @entities)
  `),

  bumpEvent: db.prepare(`
    UPDATE events SET source_count = source_count + 1, last_updated = datetime('now') WHERE id = @id
  `),

  insertFeedRun: db.prepare(`
    INSERT INTO feed_runs (feed_id, status, items_fetched, items_new, error)
    VALUES (@feed_id, @status, @items_fetched, @items_new, @error)
  `),

  getLastRun: db.prepare(`
    SELECT run_at FROM feed_runs WHERE feed_id = @feed_id ORDER BY run_at DESC LIMIT 1
  `),

  pruneRawItems: db.prepare(`
    DELETE FROM raw_items WHERE ingested_at < datetime('now', '-' || @days || ' days')
  `),

  pruneFeedRuns: db.prepare(`
    DELETE FROM feed_runs WHERE run_at < datetime('now', '-' || @days || ' days')
  `),
};

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

function log(msg) {
  console.log(`[FEEDS] ${new Date().toISOString().slice(0, 19)} ${msg}`);
}

function eventHash(title) {
  const normalized = title.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim().slice(0, 100);
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

function titleWords(title) {
  return new Set(
    title.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2)
  );
}

function wordOverlap(setA, setB) {
  if (setA.size === 0 || setB.size === 0) return 0;
  let overlap = 0;
  for (const w of setA) {
    if (setB.has(w)) overlap++;
  }
  const union = new Set([...setA, ...setB]).size;
  return union > 0 ? overlap / union : 0;
}

function extractEntities(text) {
  if (!text) return [];
  const entities = new Set();
  for (const { name, regex } of COUNTRY_PATTERNS) {
    if (regex.test(text)) entities.add(name);
  }
  for (const { name, regex } of ASSET_PATTERNS) {
    if (regex.test(text)) entities.add(name);
  }
  return [...entities];
}

function extractCountry(entities) {
  // Return the first country-like entity found
  for (const e of entities) {
    if (COUNTRIES.includes(e)) return e;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Market relevance filter — reject noise before it becomes an event
// ---------------------------------------------------------------------------
const MARKET_KEYWORDS = /\b(oil|crude|brent|wti|opec|sanctions|tariff|trade war|embargo|blockade|strait|hormuz|suez|pipeline|lng|natural gas|energy|nuclear|missile|attack|strike|military|navy|war|conflict|ceasefire|escalat|invasion|drone|bomb|weapon|defense|nato|troops|deploy|artillery|tanks|front.?line|offensive|retreat|casualt|killed|dead|hostage|terror|coup|regime|dictator|martial law|protest|uprising|revolution|unrest|riot|election|vote|parliament|sanction|freeze|seize|confiscat|bitcoin|crypto|ethereum|stablecoin|defi|etf|fed|interest rate|inflation|cpi|gdp|recession|unemployment|jobs|payroll|treasury|bond|yield|default|bank|bailout|stimulus|taper|quantitative|central bank|imf|world bank|forex|dollar|euro|yen|yuan|ruble|currency|devaluat|stock|equit|nasdaq|s&p|dow|market crash|bear|bull|rally|sell.off|volatil|vix|hedge|commodit|gold|silver|platinum|copper|wheat|corn|soy|lithium|uranium|rare earth|supply chain|shortage|shipping|freight|container|tanker|lng|port|canal|piracy|houthi|refugee|migrat|famine|drought|flood|earthquake|hurricane|typhoon|pandemic|outbreak|virus|climate|carbon|emission|solar|wind|renewab|chip|semiconductor|ai |artificial intelligence|tech|antitrust|regulat|ban|restrict|censor|spy|intelligen|hack|cyber|data breach|espionage)\b/i;

const NOISE_KEYWORDS = /\b(football|soccer|tennis|cricket|rugby|basketball|nba|nfl|premier league|champions league|world cup qualifier|olympic|medal|athlete|coach|referee|celebrity|actor|actress|singer|album|movie|film|concert|tour|fashion|recipe|cooking|gardening|horoscope|zodiac|pet|dog|cat|wedding|divorce|birthday|anniversary|obituary|funeral|church|mosque|temple|prayer|holiday|festival|carnival|parade|museum|gallery|exhibition|novel|book review|podcast|streaming|netflix|spotify|tiktok|instagram|influencer|selfie|viral video|meme|quiz|puzzle|crossword|comic|cartoon|anime|manga|game|esport|twitch|youtube|vlog|tutorial|diy|craft|hobby|workout|fitness|yoga|meditation|diet|weight loss|beauty|skincare|haircut|tattoo|jewelry|handbag|shoes|sneaker|luxury brand|art deco|photography|poetry|literary|ballet|opera|theater|broadway|grammy|oscar|emmy|golden globe)\b/i;

// Geopolitical signal words — weaker than MARKET_KEYWORDS but indicate market-relevant geopolitics
const GEO_SIGNAL = /\b(trade|economic|growth|treaty|alliance|deploy|tensions?|escalat|crisis|deal|agreement|summit|negotiat|diplomacy|foreign|minister|defense|intelligence|spy|espionage|border|occupation|rebel|separatist|annex|sovereignty|sanctions|coup|junta|authoritarian|dissident|opposition|detain|arrest|indict|investigat|charged|probe|corruption|fraud|launder|deport|immigra|refugee|asylum|manufactur|industrial|supply chain|export|import|debt|budget|reform|subsidie|bailout|default|currency)\b/i;

function isMarketRelevant(title, summary) {
  const text = [title, summary || ''].join(' ');
  // Auto-pass if matches market keywords
  if (MARKET_KEYWORDS.test(text)) return true;
  // Auto-reject if matches noise keywords and doesn't match market keywords
  if (NOISE_KEYWORDS.test(text)) return false;
  // Has asset mention — always relevant
  const hasAsset = ASSET_PATTERNS.some(p => p.regex.test(text));
  if (hasAsset) return true;
  // Country alone isn't enough — needs a geopolitical/economic signal word too
  const hasCountry = COUNTRY_PATTERNS.some(p => p.regex.test(text));
  if (hasCountry && GEO_SIGNAL.test(text)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Smart categorization — override feed category based on content
// ---------------------------------------------------------------------------
function smartCategory(title, summary, feedCategory) {
  const text = [title, summary || ''].join(' ').toLowerCase();
  if (/\b(bitcoin|crypto|ethereum|stablecoin|defi|etf.*crypto|crypto.*etf|blockchain|token|binance|coinbase)\b/i.test(text)) return 'crypto';
  if (/\b(oil|crude|brent|wti|opec|lng|natural gas|gasoline|energy|pipeline|refiner|fuel|barrel)\b/i.test(text)) return 'energy';
  if (/\b(missile|attack|strikes?\b|military|navy|war\b|bomb|weapon|defense|nato|troops|drone|artillery|invasion|offensive|conflict|combat|airstrike|stockpile|arsenal|arms\b|gunfire|shelling|ceasefire|siege|casualties|killed|wounded)\b/i.test(text)) return 'conflict';
  if (/\b(sanctions?|tariff|trade war|embargo|restrict|ban\b|seize|confiscat|blockade|duties|retaliatory)\b/i.test(text)) return 'sanctions';
  if (/\b(fed |federal reserve|interest rate|inflation|cpi|gdp|recession|unemployment|payroll|central bank|treasury|bond|yield|growth target|economic growth|economy|fiscal|monetary|stimulus|debt ceiling|deficit)\b/i.test(text)) return 'macro';
  if (/\b(stock|equit|nasdaq|s&p|dow|market crash|bear|bull|rally|sell.off|earning|ipo|valuation|index|investor|wall street)\b/i.test(text)) return 'markets';
  if (/\b(strait|hormuz|suez|shipping|freight|tanker|container|port|canal|houthi|piracy|maritime|cargo|vessel)\b/i.test(text)) return 'shipping';
  if (/\b(election|vote|parliament|coup|regime|protest|uprising|revolution|unrest|martial law|government|political|prime minister|president|legislation|constitutional)\b/i.test(text)) return 'political';
  if (/\b(earthquake|hurricane|typhoon|flood|drought|famine|pandemic|outbreak|wildfire|disaster|landslide|tsunami|cyclone)\b/i.test(text)) return 'disaster';
  if (/\b(nuclear|uranium|enrichment|centrifuge|warhead|icbm|atomic)\b/i.test(text)) return 'nuclear';
  if (/\b(chip|semiconductor|ai |artificial intelligence|tech|antitrust|cyber|hack|data breach|quantum)\b/i.test(text)) return 'tech';
  if (/\b(drug|trafficking|cartel|smuggl|narco)\b/i.test(text)) return 'security';
  if (/\b(mine|mining|gold|copper|lithium|rare earth|iron ore|mineral|cobalt)\b/i.test(text)) return 'commodities';
  return feedCategory;
}

const CATEGORY_TO_REGION = {
  geopolitics: 'global',
  markets: 'global',
  middle_east: 'middle_east',
  asia: 'asia_pacific',
  shipping: 'global',
  defense: 'global',
  crypto: 'global',
  prediction_markets: 'global',
  global_events: 'global',
  conflict: 'global',
  sanctions: 'global',
  macro: 'global',
  energy: 'global',
  political: 'global',
  disaster: 'global',
  nuclear: 'global',
  tech: 'global',
  security: 'global',
  commodities: 'global',
};

// ---------------------------------------------------------------------------
// RSS parser (simple regex, no external dependency)
// ---------------------------------------------------------------------------
function parseRSS(xml) {
  const items = [];

  // Try <item> (RSS 2.0) then <entry> (Atom)
  const itemMatches = xml.match(/<item[\s>][\s\S]*?<\/item>/gi)
    || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi)
    || [];

  for (const block of itemMatches) {
    const title = extractTag(block, 'title');
    if (!title) continue;

    const link = extractLink(block);
    const description = extractTag(block, 'description') || extractTag(block, 'summary') || '';
    const pubDate = extractTag(block, 'pubDate') || extractTag(block, 'published') || extractTag(block, 'updated') || '';

    items.push({
      title: decodeEntities(title).trim(),
      url: link,
      summary: decodeEntities(stripTags(description)).trim().slice(0, 500),
      published_at: pubDate ? normalizeDate(pubDate) : null,
    });
  }

  return items;
}

function extractTag(block, tag) {
  // Handle CDATA
  const cdataRe = new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, 'i');
  const cdataMatch = block.match(cdataRe);
  if (cdataMatch) return cdataMatch[1];

  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const m = block.match(re);
  return m ? m[1] : null;
}

function extractLink(block) {
  // RSS: <link>url</link>
  const linkTag = extractTag(block, 'link');
  if (linkTag && linkTag.trim().startsWith('http')) return linkTag.trim();

  // Atom: <link href="url" />
  const atomLink = block.match(/<link[^>]+href=["']([^"']+)["'][^>]*\/?>/i);
  if (atomLink) return atomLink[1];

  // guid as fallback
  const guid = extractTag(block, 'guid');
  if (guid && guid.startsWith('http')) return guid;

  return null;
}

function decodeEntities(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}

function stripTags(str) {
  if (!str) return '';
  return str.replace(/<[^>]+>/g, '');
}

function normalizeDate(dateStr) {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 19).replace('T', ' ');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// JSON API parsers (Polymarket, GDELT)
// ---------------------------------------------------------------------------
function parsePolymarket(data) {
  if (!Array.isArray(data)) return [];
  return data.map(m => ({
    title: m.question || m.title || 'Unknown market',
    url: m.slug ? `https://polymarket.com/event/${m.slug}` : null,
    summary: `Volume: $${Number(m.volume || 0).toLocaleString()} | Liquidity: $${Number(m.liquidity || 0).toLocaleString()}`,
    published_at: normalizeDate(m.startDate || m.createdAt) || null,
  })).filter(i => i.title);
}

function parseGDELT(data) {
  const articles = data?.articles || [];
  if (!Array.isArray(articles)) return [];
  return articles.map(a => ({
    title: a.title || 'Untitled',
    url: a.url || null,
    summary: (a.seendate ? `[${a.seendate}] ` : '') + (a.domain || ''),
    published_at: normalizeDate(a.seendate) || null,
  })).filter(i => i.title && i.title !== 'Untitled');
}

// ---------------------------------------------------------------------------
// Feed fetcher
// ---------------------------------------------------------------------------
async function fetchFeed(feed) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  try {
    const res = await fetch(feed.url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'ButterflyEngine/1.0 (news aggregator)',
        'Accept': feed.type === 'rss'
          ? 'application/rss+xml, application/xml, text/xml, */*'
          : 'application/json, */*',
      },
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }

    if (feed.type === 'rss') {
      const xml = await res.text();
      return parseRSS(xml);
    }

    // api_json
    const json = await res.json();

    if (feed.id === 'polymarket') return parsePolymarket(json);
    if (feed.id === 'gdelt-events') return parseGDELT(json);

    // Generic JSON array fallback
    if (Array.isArray(json)) {
      return json.slice(0, 20).map(item => ({
        title: item.title || item.name || item.headline || JSON.stringify(item).slice(0, 100),
        url: item.url || item.link || null,
        summary: item.summary || item.description || null,
        published_at: normalizeDate(item.publishedAt || item.date || item.created_at) || null,
      }));
    }

    return [];
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Cadence check — skip feed if fetched too recently
// ---------------------------------------------------------------------------
function shouldFetch(feed) {
  const row = stmts.getLastRun.get({ feed_id: feed.id });
  if (!row) return true;

  const lastRun = new Date(row.run_at + 'Z').getTime();
  const now = Date.now();
  return (now - lastRun) >= (feed.cadence * 1000);
}

// ---------------------------------------------------------------------------
// Ingest a single feed
// ---------------------------------------------------------------------------
async function ingestFeed(feed) {
  if (!shouldFetch(feed)) return null;

  let items = [];
  let newCount = 0;

  try {
    items = await fetchFeed(feed);

    for (const item of items) {
      // Skip if already ingested (dedup by feed_id + title)
      const exists = stmts.rawItemExists.get({ feed_id: feed.id, title: item.title });
      if (exists) continue;

      stmts.insertRawItem.run({
        feed_id: feed.id,
        title: item.title,
        url: item.url || null,
        summary: item.summary || null,
        published_at: item.published_at || null,
      });
      newCount++;
    }

    stmts.insertFeedRun.run({
      feed_id: feed.id,
      status: 'ok',
      items_fetched: items.length,
      items_new: newCount,
      error: null,
    });

    if (newCount > 0) {
      log(`${feed.id}: ${newCount} new / ${items.length} fetched`);
    }

    return { fetched: items.length, new: newCount };
  } catch (err) {
    stmts.insertFeedRun.run({
      feed_id: feed.id,
      status: 'error',
      items_fetched: 0,
      items_new: 0,
      error: err.message.slice(0, 500),
    });

    log(`${feed.id}: ERROR - ${err.message}`);
    return { fetched: 0, new: 0, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Event canonicalization — process unprocessed raw_items into events
// ---------------------------------------------------------------------------
function canonicalizeEvents() {
  const unprocessed = stmts.getUnprocessedItems.all();
  if (unprocessed.length === 0) return 0;

  const recentEvents = stmts.getRecentEvents.all();
  let newEvents = 0;

  const processItem = db.transaction((item) => {
    const hash = eventHash(item.title);
    const itemWords = titleWords(item.title);
    const combined = [item.title, item.summary || ''].join(' ');
    const entities = extractEntities(combined);

    // Check 1: exact hash match
    let existing = stmts.getEventByHash.get({ hash });

    // Check 2: fuzzy title overlap with recent events
    if (!existing) {
      for (const evt of recentEvents) {
        const evtWords = titleWords(evt.title);
        if (wordOverlap(itemWords, evtWords) >= TITLE_OVERLAP_THRESHOLD) {
          existing = evt;
          break;
        }
      }
    }

    // Filter out non-market-relevant items before creating events
    if (!isMarketRelevant(item.title, item.summary)) {
      stmts.markProcessed.run({ id: item.id, event_id: null });
      return;
    }

    if (existing) {
      // Merge into existing event
      stmts.bumpEvent.run({ id: existing.id });
      stmts.markProcessed.run({ id: item.id, event_id: existing.id });
    } else {
      // Create new event
      const country = extractCountry(entities);
      const feedDef = FEEDS.find(f => f.id === item.feed_id);
      const rawCategory = feedDef ? feedDef.category : 'uncategorized';
      const category = smartCategory(item.title, item.summary, rawCategory);
      const region = CATEGORY_TO_REGION[category] || 'global';

      const result = stmts.insertEvent.run({
        event_hash: hash,
        title: item.title,
        summary: item.summary || null,
        country: country,
        region: region,
        category: category,
        severity: 5,
        novelty: 0.5,
        confidence: 0.5,
        entities: JSON.stringify(entities),
      });

      const eventId = Number(result.lastInsertRowid);
      stmts.markProcessed.run({ id: item.id, event_id: eventId });

      // Add to recent events cache for this batch
      recentEvents.push({
        id: eventId,
        event_hash: hash,
        title: item.title,
        created_at: new Date().toISOString(),
      });

      newEvents++;
    }
  });

  for (const item of unprocessed) {
    try {
      processItem(item);
    } catch (err) {
      log(`Canonicalize error (raw_item ${item.id}): ${err.message}`);
      // Mark processed anyway to avoid infinite retry
      try {
        stmts.markProcessed.run({ id: item.id, event_id: null });
      } catch {}
    }
  }

  if (newEvents > 0) {
    log(`Canonicalized ${unprocessed.length} items -> ${newEvents} new events`);
  }

  return newEvents;
}

// ---------------------------------------------------------------------------
// Pruning — keep DB small
// ---------------------------------------------------------------------------
function prune() {
  try {
    const rawDeleted = stmts.pruneRawItems.run({ days: String(RAW_ITEMS_TTL_DAYS) });
    const runDeleted = stmts.pruneFeedRuns.run({ days: String(FEED_RUNS_TTL_DAYS) });

    if (rawDeleted.changes > 0 || runDeleted.changes > 0) {
      log(`Pruned ${rawDeleted.changes} raw_items, ${runDeleted.changes} feed_runs`);
    }
  } catch (err) {
    log(`Prune error: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Main tick
// ---------------------------------------------------------------------------
async function tick() {
  const start = Date.now();
  let totalNew = 0;
  let totalFetched = 0;
  let feedsProcessed = 0;

  // Ingest all feeds (sequentially to be polite to sources)
  for (const feed of FEEDS) {
    try {
      const result = await ingestFeed(feed);
      if (result) {
        totalFetched += result.fetched;
        totalNew += result.new;
        feedsProcessed++;
      }
    } catch (err) {
      log(`Unexpected error on ${feed.id}: ${err.message}`);
    }
  }

  // Canonicalize raw items into events
  const newEvents = canonicalizeEvents();

  // Prune old data
  prune();

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  if (feedsProcessed > 0 || newEvents > 0) {
    log(`Tick complete: ${feedsProcessed} feeds, ${totalNew} new items, ${newEvents} new events (${elapsed}s)`);
  }
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
function start() {
  log('Starting butterfly-feeds worker');
  log(`Database: ${DB_PATH}`);
  log(`Feeds configured: ${FEEDS.length}`);
  log(`Tick interval: ${TICK_INTERVAL / 1000}s`);

  // Initial tick
  tick().catch(err => log(`Tick error: ${err.message}`));

  // Schedule recurring ticks
  setInterval(() => {
    tick().catch(err => log(`Tick error: ${err.message}`));
  }, TICK_INTERVAL);
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
function shutdown(signal) {
  log(`Received ${signal}, shutting down`);
  try {
    db.close();
  } catch {}
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Handle uncaught errors to prevent PM2 restarts
process.on('uncaughtException', (err) => {
  log(`Uncaught exception: ${err.message}`);
  log(err.stack || '');
});

process.on('unhandledRejection', (err) => {
  log(`Unhandled rejection: ${err && err.message ? err.message : err}`);
});

start();
