// family-server.cjs
// Private family-facing apartment + flight scanner pages.
// Mounted by butterfly-server.cjs via: require('./family-server')(app, db).
//
// Env vars (all required for ingest/read to work):
//   FAMILY_INGEST_TOKEN   shared secret scanners present in X-Ingest-Token
//   FAMILY_APT_SLUG       slug for apartment page (URL: /family/apt-<slug>)
//   FAMILY_FLT_SLUG       slug for flight page    (URL: /family/flights-<slug>)
//
// Endpoints:
//   POST /api/family/ingest/apt          scanners → upsert listings
//   POST /api/family/ingest/flights      scanners → append snapshot
//   POST /api/family/ingest/errorfares   scanners → upsert error fares
//   GET  /api/family/:slug/apt           page fetch (slug must match FAMILY_APT_SLUG)
//   GET  /api/family/:slug/flights       page fetch (slug must match FAMILY_FLT_SLUG)
//
// If a required env var is unset, the corresponding endpoint returns 503.
const crypto = require('crypto');

function safeEq(a, b) {
  const ab = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS family_apt_listings (
      posting_id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      title TEXT,
      url TEXT NOT NULL,
      price INTEGER,
      bedrooms INTEGER,
      bathrooms REAL,
      sqft INTEGER,
      city TEXT,
      latitude REAL,
      longitude REAL,
      posted_at TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_family_apt_seen ON family_apt_listings(last_seen_at DESC);
    CREATE INDEX IF NOT EXISTS idx_family_apt_price ON family_apt_listings(price);

    CREATE TABLE IF NOT EXISTS family_flight_snapshots (
      snapshot_id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      fetched_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS family_flight_deals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_id TEXT NOT NULL,
      source TEXT NOT NULL,
      kind TEXT NOT NULL,
      origin TEXT NOT NULL,
      destination TEXT NOT NULL,
      airline TEXT,
      price REAL NOT NULL,
      departure_at TEXT,
      return_at TEXT,
      transfers INTEGER DEFAULT 0,
      flight_number TEXT,
      dep_month TEXT,
      median REAL,
      samples INTEGER,
      ratio REAL,
      is_deal INTEGER DEFAULT 0,
      fetched_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_family_flight_snap ON family_flight_deals(snapshot_id);
    CREATE INDEX IF NOT EXISTS idx_family_flight_fetched ON family_flight_deals(fetched_at DESC);

    CREATE TABLE IF NOT EXISTS family_flight_errorfares (
      guid TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      title TEXT NOT NULL,
      link TEXT,
      first_seen_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_family_errorfares_seen ON family_flight_errorfares(first_seen_at DESC);
  `);
}

module.exports = function attachFamily(app, db) {
  initSchema(db);

  const TOKEN = process.env.FAMILY_INGEST_TOKEN || '';
  const APT_SLUG = process.env.FAMILY_APT_SLUG || '';
  const FLT_SLUG = process.env.FAMILY_FLT_SLUG || '';

  function requireToken(req, res) {
    if (!TOKEN) { res.status(503).json({ error: 'family ingest not configured' }); return false; }
    const supplied = req.get('X-Ingest-Token') || '';
    if (!safeEq(supplied, TOKEN)) { res.status(401).json({ error: 'bad token' }); return false; }
    return true;
  }

  // ---------------------------------------------------------------------------
  // INGEST: apartment listings (upsert by posting_id)
  // ---------------------------------------------------------------------------
  const upsertApt = db.prepare(`
    INSERT INTO family_apt_listings
      (posting_id, source, title, url, price, bedrooms, bathrooms, sqft, city,
       latitude, longitude, posted_at, first_seen_at, last_seen_at)
    VALUES
      (@posting_id, @source, @title, @url, @price, @bedrooms, @bathrooms, @sqft, @city,
       @latitude, @longitude, @posted_at, @now, @now)
    ON CONFLICT(posting_id) DO UPDATE SET
      title       = excluded.title,
      url         = excluded.url,
      price       = excluded.price,
      bedrooms    = excluded.bedrooms,
      bathrooms   = COALESCE(excluded.bathrooms, family_apt_listings.bathrooms),
      sqft        = COALESCE(excluded.sqft,      family_apt_listings.sqft),
      city        = excluded.city,
      latitude    = COALESCE(excluded.latitude,  family_apt_listings.latitude),
      longitude   = COALESCE(excluded.longitude, family_apt_listings.longitude),
      posted_at   = COALESCE(excluded.posted_at, family_apt_listings.posted_at),
      last_seen_at= excluded.last_seen_at
  `);

  app.post('/api/family/ingest/apt', (req, res) => {
    if (!requireToken(req, res)) return;
    const { source, listings } = req.body || {};
    if (!source || !Array.isArray(listings)) {
      return res.status(400).json({ error: 'expected { source, listings: [...] }' });
    }
    const now = new Date().toISOString();
    let n = 0;
    const txn = db.transaction((rows) => {
      for (const r of rows) {
        if (!r.posting_id || !r.url) continue;
        upsertApt.run({
          posting_id: String(r.posting_id),
          source,
          title:     r.title       ?? null,
          url:       r.url,
          price:     r.price       ?? null,
          bedrooms:  r.bedrooms    ?? null,
          bathrooms: r.bathrooms   ?? null,
          sqft:      r.sqft        ?? null,
          city:      r.city        ?? null,
          latitude:  r.latitude    ?? null,
          longitude: r.longitude   ?? null,
          posted_at: r.posted_at   ?? null,
          now,
        });
        n++;
      }
    });
    txn(listings);
    const total = db.prepare('SELECT COUNT(*) AS c FROM family_apt_listings').get().c;
    res.json({ upserted: n, total });
  });

  // ---------------------------------------------------------------------------
  // INGEST: flight snapshot (append, page uses latest snapshot per source)
  // ---------------------------------------------------------------------------
  const insertSnapshot = db.prepare(`
    INSERT OR IGNORE INTO family_flight_snapshots (snapshot_id, source, fetched_at)
    VALUES (?, ?, ?)
  `);
  const insertFlight = db.prepare(`
    INSERT INTO family_flight_deals
      (snapshot_id, source, kind, origin, destination, airline, price,
       departure_at, return_at, transfers, flight_number, dep_month,
       median, samples, ratio, is_deal, fetched_at)
    VALUES
      (@snapshot_id, @source, @kind, @origin, @destination, @airline, @price,
       @departure_at, @return_at, @transfers, @flight_number, @dep_month,
       @median, @samples, @ratio, @is_deal, @fetched_at)
  `);

  app.post('/api/family/ingest/flights', (req, res) => {
    if (!requireToken(req, res)) return;
    const { source, snapshot_id, deals } = req.body || {};
    if (!source || !snapshot_id || !Array.isArray(deals)) {
      return res.status(400).json({ error: 'expected { source, snapshot_id, deals: [...] }' });
    }
    const fetched_at = new Date().toISOString();
    let n = 0;
    const txn = db.transaction((rows) => {
      insertSnapshot.run(snapshot_id, source, fetched_at);
      for (const r of rows) {
        if (!r.origin || !r.destination || r.price == null) continue;
        insertFlight.run({
          snapshot_id,
          source,
          kind:          r.kind        || 'cheapest',
          origin:        r.origin,
          destination:   r.destination,
          airline:       r.airline      ?? null,
          price:         Number(r.price),
          departure_at:  r.departure_at ?? null,
          return_at:     r.return_at    ?? null,
          transfers:     r.transfers    ?? 0,
          flight_number: r.flight_number ?? null,
          dep_month:     r.dep_month    ?? null,
          median:        r.median       ?? null,
          samples:       r.samples      ?? null,
          ratio:         r.ratio        ?? null,
          is_deal:       r.is_deal ? 1 : 0,
          fetched_at,
        });
        n++;
      }
    });
    txn(deals);
    res.json({ stored: n, snapshot_id });
  });

  // ---------------------------------------------------------------------------
  // INGEST: error fares (upsert by guid)
  // ---------------------------------------------------------------------------
  const upsertErrorfare = db.prepare(`
    INSERT INTO family_flight_errorfares (guid, source, title, link, first_seen_at)
    VALUES (@guid, @source, @title, @link, @first_seen_at)
    ON CONFLICT(guid) DO NOTHING
  `);

  app.post('/api/family/ingest/errorfares', (req, res) => {
    if (!requireToken(req, res)) return;
    const { source, items } = req.body || {};
    if (!source || !Array.isArray(items)) {
      return res.status(400).json({ error: 'expected { source, items: [...] }' });
    }
    let n = 0;
    const txn = db.transaction((rows) => {
      for (const r of rows) {
        if (!r.guid || !r.title) continue;
        upsertErrorfare.run({
          guid: String(r.guid),
          source,
          title: r.title,
          link: r.link ?? null,
          first_seen_at: r.first_seen_at || new Date().toISOString(),
        });
        n++;
      }
    });
    txn(items);
    res.json({ submitted: n });
  });

  // ---------------------------------------------------------------------------
  // READ: apartment page data
  // ---------------------------------------------------------------------------
  app.get('/api/family/:slug/apt', (req, res) => {
    if (!APT_SLUG) return res.status(503).json({ error: 'apt slug not configured' });
    if (!safeEq(req.params.slug, APT_SLUG)) return res.status(404).json({ error: 'not found' });
    const rows = db.prepare(`
      SELECT posting_id, source, title, url, price, bedrooms, bathrooms, sqft, city,
             latitude, longitude, posted_at, first_seen_at, last_seen_at
      FROM family_apt_listings
      WHERE last_seen_at >= datetime('now', '-21 days')
      ORDER BY first_seen_at DESC
      LIMIT 1000
    `).all();
    const lastIngest = db.prepare('SELECT MAX(last_seen_at) AS t FROM family_apt_listings').get().t;
    const sources = db.prepare('SELECT DISTINCT source FROM family_apt_listings').all().map(r => r.source);
    res.json({ listings: rows, last_ingest: lastIngest, sources });
  });

  // ---------------------------------------------------------------------------
  // READ: flights page data
  // ---------------------------------------------------------------------------
  app.get('/api/family/:slug/flights', (req, res) => {
    if (!FLT_SLUG) return res.status(503).json({ error: 'flights slug not configured' });
    if (!safeEq(req.params.slug, FLT_SLUG)) return res.status(404).json({ error: 'not found' });
    // Latest snapshot per source
    const latestSnaps = db.prepare(`
      SELECT source, snapshot_id, fetched_at
      FROM family_flight_snapshots s1
      WHERE fetched_at = (SELECT MAX(fetched_at) FROM family_flight_snapshots s2 WHERE s2.source = s1.source)
    `).all();
    const deals = [];
    for (const snap of latestSnaps) {
      const rows = db.prepare(`
        SELECT source, kind, origin, destination, airline, price, departure_at, return_at,
               transfers, flight_number, dep_month, median, samples, ratio, is_deal, fetched_at
        FROM family_flight_deals
        WHERE snapshot_id = ?
        ORDER BY is_deal DESC, ratio ASC, price ASC
      `).all(snap.snapshot_id);
      for (const r of rows) deals.push(r);
    }
    const errorfares = db.prepare(`
      SELECT guid, source, title, link, first_seen_at
      FROM family_flight_errorfares
      WHERE first_seen_at >= datetime('now', '-21 days')
      ORDER BY first_seen_at DESC
      LIMIT 200
    `).all();
    res.json({
      deals,
      errorfares,
      snapshots: latestSnaps,
      last_ingest: latestSnaps.map(s => s.fetched_at).sort().pop() || null,
    });
  });

  console.log('[FAMILY] mounted /api/family/* (apt slug ' + (APT_SLUG ? 'set' : 'UNSET') +
              ', flights slug ' + (FLT_SLUG ? 'set' : 'UNSET') +
              ', token ' + (TOKEN ? 'set' : 'UNSET') + ')');
};
