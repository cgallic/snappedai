#!/usr/bin/env node
/**
 * Alternative Data Feeds for Snapped Report
 * Non-news sources that show what's happening before it's reported
 */

const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = '/var/www/snap/data';
const ENV_PATH = '/var/www/snap/.env';

function loadEnvFromFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

// Ensure API keys are available even when run from cron/systemd without inherited env
loadEnvFromFile(ENV_PATH);

// Ensure output dir exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

/**
 * OpenSky Network - Flight data
 * Look for flights avoiding certain airspaces
 */
async function fetchOpenSky() {
  console.log('[OpenSky] Fetching flight data...');
  
  // Bounding boxes for conflict zones
  const zones = {
    iran: { lamin: 25, lamax: 40, lomin: 44, lomax: 64 },
    hormuz: { lamin: 24, lamax: 28, lomin: 54, lomax: 58 },
    redSea: { lamin: 12, lamax: 22, lomin: 36, lomax: 44 }
  };
  
  const results = {};
  
  for (const [zone, bbox] of Object.entries(zones)) {
    try {
      const url = `https://opensky-network.org/api/states/all?lamin=${bbox.lamin}&lomin=${bbox.lomin}&lamax=${bbox.lamax}&lomax=${bbox.lomax}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'SnappedReport/1.0' }
      });
      
      if (res.ok) {
        const data = await res.json();
        const flights = data.states || [];
        results[zone] = {
          count: flights.length,
          timestamp: data.time,
          sample: flights.slice(0, 5).map(f => ({
            callsign: f[1]?.trim(),
            origin: f[2],
            altitude: f[7],
            velocity: f[9]
          }))
        };
        console.log(`  [${zone}] ${flights.length} flights in airspace`);
      }
    } catch (e) {
      console.log(`  [${zone}] Error: ${e.message}`);
      results[zone] = { error: e.message };
    }
    
    // Rate limit
    await new Promise(r => setTimeout(r, 1000));
  }
  
  return results;
}

/**
 * Polymarket - Prediction market odds
 */
async function fetchPolymarket() {
  console.log('[Polymarket] Fetching prediction markets...');
  
  // Key markets to watch
  const watchlist = [
    'iran', 'israel', 'russia', 'china', 'trump', 
    'fed', 'recession', 'oil', 'bitcoin'
  ];
  
  try {
    const res = await fetch('https://gamma-api.polymarket.com/markets?limit=100&active=true', {
      headers: { 'User-Agent': 'SnappedReport/1.0' }
    });
    
    if (res.ok) {
      const markets = await res.json();
      
      // Filter for relevant markets
      const relevant = markets.filter(m => {
        const q = (m.question || '').toLowerCase();
        return watchlist.some(w => q.includes(w));
      }).map(m => ({
        question: m.question,
        outcome: m.outcomePrices?.[0] || m.outcome,
        volume: m.volume,
        liquidity: m.liquidity,
        endDate: m.endDate
      }));
      
      console.log(`  Found ${relevant.length} relevant markets`);
      return relevant;
    }
  } catch (e) {
    console.log(`  Error: ${e.message}`);
    return { error: e.message };
  }
  
  return [];
}

/**
 * Wikipedia Pageviews - Interest spikes
 */
async function fetchWikipediaSpikes() {
  console.log('[Wikipedia] Checking pageview spikes...');
  
  const watchPages = [
    'Strait_of_Hormuz',
    'Iran–Israel_proxy_conflict',
    'Iran–United_States_relations',
    'NATO',
    'Article_5_of_the_North_Atlantic_Treaty',
    '2026_United_States_elections',
    'Crude_oil',
    'Gold_as_an_investment',
    'Bank_run'
  ];
  
  const results = [];
  const today = new Date();
  const yesterday = new Date(today - 86400000);
  const dateStr = yesterday.toISOString().split('T')[0].replace(/-/g, '/');
  
  for (const page of watchPages) {
    try {
      const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/all-agents/${page}/daily/${dateStr.replace(/\//g, '')}/${dateStr.replace(/\//g, '')}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'SnappedReport/1.0' }
      });
      
      if (res.ok) {
        const data = await res.json();
        const views = data.items?.[0]?.views || 0;
        results.push({ page: page.replace(/_/g, ' '), views });
      }
    } catch (e) {
      // Skip errors silently
    }
    
    await new Promise(r => setTimeout(r, 100));
  }
  
  // Sort by views
  results.sort((a, b) => b.views - a.views);
  console.log(`  Top page: ${results[0]?.page} (${results[0]?.views} views)`);
  
  return results;
}

/**
 * Google Trends (via unofficial endpoint)
 */
async function fetchGoogleTrends() {
  console.log('[Google Trends] Checking search interest...');
  
  // This would require pytrends or unofficial API
  // For now, return placeholder
  return {
    note: 'Google Trends requires pytrends - TODO',
    watchTerms: ['Iran war', 'oil prices', 'gold price', 'military draft']
  };
}

/**
 * AIS Shipping data via AISStream (WebSocket)
 */
async function fetchShippingData() {
  console.log('[Shipping] Checking vessel movements...');

  const apiKey = process.env.AISSTREAM_API_KEY || process.env.AIS_API_KEY;
  if (!apiKey) {
    return {
      status: 'not_configured',
      note: 'AISSTREAM_API_KEY/AIS_API_KEY missing',
      signals: [
        'Dark tankers (AIS off) indicate sanctions evasion',
        'Rerouting around Hormuz indicates risk pricing',
        'Suez congestion impacts supply chains',
        'LNG carrier movements signal energy flows'
      ]
    };
  }

  // AISStream bounding boxes are [[ [lat1, lon1], [lat2, lon2] ], ...]
  const boundingBoxes = [
    [[24, 54], [28, 58]],   // Hormuz
    [[12, 42], [15, 45]],   // Bab el-Mandeb
    [[28, 30], [32, 34]],   // Suez approach
    [[22, 118], [26, 122]]  // Taiwan Strait
  ];

  const buckets = {
    hormuz: 0,
    babElMandeb: 0,
    suezApproach: 0,
    taiwanStrait: 0
  };

  const samples = [];

  const classify = (lat, lon) => {
    if (lat >= 24 && lat <= 28 && lon >= 54 && lon <= 58) return 'hormuz';
    if (lat >= 12 && lat <= 15 && lon >= 42 && lon <= 45) return 'babElMandeb';
    if (lat >= 28 && lat <= 32 && lon >= 30 && lon <= 34) return 'suezApproach';
    if (lat >= 22 && lat <= 26 && lon >= 118 && lon <= 122) return 'taiwanStrait';
    return null;
  };

  try {
    const ws = new WebSocket('wss://stream.aisstream.io/v0/stream');

    const result = await new Promise((resolve) => {
      let total = 0;
      let done = false;

      const finish = (payload) => {
        if (done) return;
        done = true;
        try { ws.close(); } catch {}
        resolve(payload);
      };

      const timer = setTimeout(() => {
        finish({
          status: 'ok',
          provider: 'aisstream',
          fetchedAt: new Date().toISOString(),
          vesselMessages: total,
          chokepoints: buckets,
          samples: samples.slice(0, 15),
          note: 'Timed 12s stream sample'
        });
      }, 12000);

      ws.addEventListener('open', () => {
        ws.send(JSON.stringify({
          APIKey: apiKey,
          BoundingBoxes: boundingBoxes,
          FilterMessageTypes: ['PositionReport']
        }));
      });

      ws.addEventListener('message', (evt) => {
        try {
          const msg = JSON.parse(evt.data.toString());
          const report = msg?.Message?.PositionReport;
          if (!report) return;

          const lat = Number(report.Latitude);
          const lon = Number(report.Longitude);
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

          total += 1;
          const zone = classify(lat, lon);
          if (zone) buckets[zone] += 1;

          if (samples.length < 25) {
            samples.push({
              mmsi: report.UserID || null,
              lat,
              lon,
              sog: Number(report.Sog || 0),
              cog: Number(report.Cog || 0),
              heading: Number(report.TrueHeading || 0),
              zone,
              timestamp: msg?.MetaData?.time_utc || null
            });
          }

          if (total >= 120) {
            clearTimeout(timer);
            finish({
              status: 'ok',
              provider: 'aisstream',
              fetchedAt: new Date().toISOString(),
              vesselMessages: total,
              chokepoints: buckets,
              samples: samples.slice(0, 15)
            });
          }
        } catch {
          // ignore malformed frames
        }
      });

      ws.addEventListener('error', (err) => {
        clearTimeout(timer);
        finish({
          status: 'error',
          provider: 'aisstream',
          note: err?.message || 'WebSocket error'
        });
      });

      ws.addEventListener('close', () => {
        // if close happens before timer, return what we have
        if (!done) {
          clearTimeout(timer);
          finish({
            status: 'ok',
            provider: 'aisstream',
            fetchedAt: new Date().toISOString(),
            vesselMessages: total,
            chokepoints: buckets,
            samples: samples.slice(0, 15),
            note: 'Stream closed'
          });
        }
      });
    });

    return {
      ...result,
      signals: [
        'Watch for sudden drops in chokepoint vessel counts',
        'Sharp reroutes near Hormuz/Bab el-Mandeb = elevated risk pricing',
        'Congestion spikes at Suez can front-run supply chain stress'
      ]
    };
  } catch (e) {
    return {
      status: 'error',
      provider: 'aisstream',
      note: e.message
    };
  }
}

/**
 * Main aggregator
 */
async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('📡 Alternative Data Feed Aggregator');
  console.log('═══════════════════════════════════════════════════════');
  
  const data = {
    timestamp: new Date().toISOString(),
    aviation: await fetchOpenSky(),
    predictionMarkets: await fetchPolymarket(),
    wikipediaInterest: await fetchWikipediaSpikes(),
    googleTrends: await fetchGoogleTrends(),
    shipping: await fetchShippingData()
  };
  
  // Save output
  const outputPath = path.join(OUTPUT_DIR, 'alt-data.json');
  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
  
  console.log('═══════════════════════════════════════════════════════');
  console.log(`✅ Saved to ${outputPath}`);
  console.log('═══════════════════════════════════════════════════════');
  
  return data;
}

main().catch(console.error);
