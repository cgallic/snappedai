// Watchlist signal tracker
const fs = require('fs');
const path = require('path');

const WATCHLIST_FILE = path.join(__dirname, 'watchlist-status.json');
const ALERTS_FILE = path.join(__dirname, 'live-alerts.json');

// Watchlist signals
const WATCHLIST = {
  iran_response: {
    name: 'Iran Response',
    source: 'Tehran statements',
    trigger: 'Retaliation announcement',
    feeds: [
      'https://www.irna.ir/rss', // IRNA
      'https://www.tasnimnews.com/en/rss/most-visited/service/76/politics', // Tasnim
    ],
    keywords: ['retaliation', 'revenge', 'response', 'attack', 'strike', 'military action'],
    status: 'watching',
    lastHit: null
  },
  hormuz_traffic: {
    name: 'Hormuz Traffic',
    source: 'AIS/Ship data',
    trigger: 'Passage disruption',
    // AIS requires API key - using news fallback
    feeds: [
      'https://gcaptain.com/feed/',
      'https://www.hellenicshippingnews.com/feed/',
    ],
    keywords: ['hormuz', 'strait', 'tanker', 'blocked', 'disruption', 'closure', 'attack'],
    status: 'watching',
    lastHit: null
  },
  nato_article5: {
    name: 'NATO Article 5',
    source: 'Brussels/Ankara',
    trigger: 'Turkey escalation',
    feeds: [
      'https://www.nato.int/cps/en/natohq/news.xml',
      'https://www.dailysabah.com/rssFeed/politics',
    ],
    keywords: ['article 5', 'collective defense', 'turkey', 'ankara', 'erdogan', 'missile', 'attack'],
    status: 'watching',
    lastHit: null
  },
  oil_facilities: {
    name: 'Oil Facility Status',
    source: 'Gulf media',
    trigger: 'Further attacks',
    feeds: [
      'https://english.alarabiya.net/tools/rss',
      'https://www.thenationalnews.com/arc/outboundfeeds/rss/',
    ],
    keywords: ['oil facility', 'refinery', 'attack', 'fire', 'explosion', 'aramco', 'sabotage', 'drone'],
    status: 'watching',
    lastHit: null
  },
  crude_price: {
    name: 'Crude Futures',
    source: 'Markets',
    trigger: 'Break above $95',
    priceTarget: 95,
    status: 'watching',
    lastPrice: null,
    lastHit: null
  }
};

let watchlistStatus = {};
let alerts = [];

// Load existing
try { watchlistStatus = JSON.parse(fs.readFileSync(WATCHLIST_FILE, 'utf8')); } catch { watchlistStatus = WATCHLIST; }
try { alerts = JSON.parse(fs.readFileSync(ALERTS_FILE, 'utf8')); } catch { alerts = []; }

function addAlert(type, message, details) {
  const alert = {
    id: Date.now(),
    type,
    message,
    details,
    timestamp: new Date().toISOString(),
    ago: 'now'
  };
  
  // Dedupe
  const recent = alerts.find(a => a.message === message && Date.now() - new Date(a.timestamp).getTime() < 3600000);
  if (recent) return;
  
  alerts.unshift(alert);
  alerts = alerts.slice(0, 100);
  fs.writeFileSync(ALERTS_FILE, JSON.stringify(alerts, null, 2));
  console.log(`[WATCHLIST ALERT] ${type}: ${message}`);
}

// Parse RSS/Atom feed
async function parseFeed(url) {
  try {
    const res = await fetch(url, { 
      signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': 'SnappedAI-OSINT/1.0' }
    });
    const text = await res.text();
    
    // Simple regex parsing for RSS items
    const items = [];
    const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
    const entryRegex = /<entry[^>]*>([\s\S]*?)<\/entry>/gi;
    
    let match;
    const regex = text.includes('<entry') ? entryRegex : itemRegex;
    
    while ((match = regex.exec(text)) !== null) {
      const item = match[1];
      const title = item.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i)?.[1]?.trim() || '';
      const desc = item.match(/<description[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i)?.[1]?.trim() || '';
      const link = item.match(/<link[^>]*>([^<]+)<\/link>/i)?.[1]?.trim() || 
                   item.match(/<link[^>]*href="([^"]+)"/i)?.[1] || '';
      const pubDate = item.match(/<pubDate[^>]*>([^<]+)<\/pubDate>/i)?.[1]?.trim() ||
                      item.match(/<published[^>]*>([^<]+)<\/published>/i)?.[1]?.trim() || '';
      
      items.push({ title, desc, link, pubDate, text: `${title} ${desc}`.toLowerCase() });
    }
    
    return items.slice(0, 10); // Last 10 items
  } catch (e) {
    console.log(`[FEED ERROR] ${url}: ${e.message}`);
    return [];
  }
}

// Check feeds for keywords
async function checkSignal(key, signal) {
  if (!signal.feeds) return;
  
  for (const feedUrl of signal.feeds) {
    const items = await parseFeed(feedUrl);
    
    for (const item of items) {
      for (const keyword of signal.keywords) {
        if (item.text.includes(keyword.toLowerCase())) {
          // Check if this is recent (last 6 hours based on pubDate)
          const pubTime = new Date(item.pubDate).getTime();
          const sixHoursAgo = Date.now() - 6 * 60 * 60 * 1000;
          
          if (pubTime > sixHoursAgo || !item.pubDate) {
            watchlistStatus[key].status = 'TRIGGERED';
            watchlistStatus[key].lastHit = {
              keyword,
              title: item.title.substring(0, 100),
              link: item.link,
              time: new Date().toISOString()
            };
            
            addAlert('WATCHLIST_TRIGGER', `${signal.name}: "${keyword}" detected - ${item.title.substring(0, 60)}...`, {
              signal: key,
              keyword,
              source: feedUrl,
              link: item.link
            });
            
            return; // One trigger per signal per run
          }
        }
      }
    }
  }
}

// Check crude price
async function checkCrudePrice() {
  try {
    // Using Yahoo Finance
    const res = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/CL=F?interval=1m&range=1d', {
      signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': 'SnappedAI-OSINT/1.0' }
    });
    const data = await res.json();
    
    const price = data.chart?.result?.[0]?.meta?.regularMarketPrice;
    if (price) {
      watchlistStatus.crude_price.lastPrice = price;
      console.log(`[CRUDE] Current price: $${price.toFixed(2)}`);
      
      if (price >= watchlistStatus.crude_price.priceTarget) {
        watchlistStatus.crude_price.status = 'TRIGGERED';
        watchlistStatus.crude_price.lastHit = {
          price,
          time: new Date().toISOString()
        };
        
        addAlert('WATCHLIST_TRIGGER', `Crude broke $${watchlistStatus.crude_price.priceTarget} - now at $${price.toFixed(2)}`, {
          signal: 'crude_price',
          price,
          target: watchlistStatus.crude_price.priceTarget
        });
      }
    }
  } catch (e) {
    console.log(`[CRUDE ERROR] ${e.message}`);
  }
}

// Main scan
async function scanWatchlist() {
  console.log('[WATCHLIST] Starting scan...');
  
  for (const [key, signal] of Object.entries(watchlistStatus)) {
    if (signal.feeds) {
      await checkSignal(key, signal);
      await new Promise(r => setTimeout(r, 2000)); // Rate limit
    }
  }
  
  await checkCrudePrice();
  
  // Save status
  fs.writeFileSync(WATCHLIST_FILE, JSON.stringify(watchlistStatus, null, 2));
  console.log('[WATCHLIST] Scan complete');
}

// HTTP endpoint for watchlist status
const http = require('http');
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  
  if (req.url === '/watchlist') {
    res.end(JSON.stringify(watchlistStatus));
  } else if (req.url === '/health') {
    res.end(JSON.stringify({ status: 'ok' }));
  } else {
    res.end(JSON.stringify({ endpoint: '/watchlist' }));
  }
});

const PORT = 3880;
server.listen(PORT, () => {
  console.log(`[WATCHLIST] Running on port ${PORT}`);
  
  // Initial scan
  scanWatchlist();
  
  // Scan every 10 minutes
  setInterval(scanWatchlist, 10 * 60 * 1000);
});
