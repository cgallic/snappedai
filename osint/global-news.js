// Global news tracker - All regions RSS feeds
const fs = require('fs');
const path = require('path');
const http = require('http');

const NEWS_FILE = path.join(__dirname, 'global-news.json');
const ALERTS_FILE = path.join(__dirname, 'live-alerts.json');

let news = { regions: {}, lastUpdate: null };
let alerts = [];

try { alerts = JSON.parse(fs.readFileSync(ALERTS_FILE, 'utf8')); } catch { alerts = []; }

function addAlert(type, message, details) {
  const alert = { id: Date.now(), type, message, details, timestamp: new Date().toISOString(), ago: 'now' };
  const recent = alerts.find(a => a.message === message && Date.now() - new Date(a.timestamp).getTime() < 3600000);
  if (recent) return;
  alerts.unshift(alert);
  alerts = alerts.slice(0, 100);
  fs.writeFileSync(ALERTS_FILE, JSON.stringify(alerts, null, 2));
  console.log(`[NEWS ALERT] ${type}: ${message}`);
}

// Trending & General News
const TRENDING = {
  yahoo: {
    name: 'Yahoo Finance',
    feeds: [
      { url: 'https://finance.yahoo.com/news/rssindex', source: 'Yahoo Finance' },
      { url: 'https://finance.yahoo.com/rss/topstories', source: 'Yahoo Top Stories' },
      { url: 'https://finance.yahoo.com/rss/marketstories', source: 'Yahoo Markets' },
    ],
    keywords: ['market', 'stock', 'oil', 'crypto', 'bitcoin', 'fed', 'inflation', 'earnings', 'trade', 'tariff', 'crude', 'gold', 'rates', 'tech']
  },
  marketwatch: {
    name: 'MarketWatch',
    feeds: [
      { url: 'https://www.marketwatch.com/rss/topstories', source: 'MarketWatch Top' },
      { url: 'https://www.marketwatch.com/rss/marketpulse', source: 'MarketWatch Pulse' },
    ],
    keywords: ['market', 'stock', 'oil', 'crypto', 'bitcoin', 'fed', 'inflation', 'earnings', 'trade', 'tariff', 'crude', 'gold', 'rates', 'tech', 'investor']
  }
};

// Regional RSS feeds
const REGIONS = {
  asia: {
    name: 'Asia-Pacific',
    feeds: [
      { url: 'https://www3.nhk.or.jp/rss/news/cat0.xml', source: 'NHK Japan' },
      { url: 'https://www.scmp.com/rss/91/feed', source: 'SCMP China' },
      { url: 'https://en.yna.co.kr/RSS/news.xml', source: 'Yonhap Korea' },
      { url: 'https://timesofindia.indiatimes.com/rssfeeds/296589292.cms', source: 'Times of India' },
    ],
    keywords: ['china', 'taiwan', 'japan', 'korea', 'india', 'military', 'trade', 'sanctions']
  },
  europe: {
    name: 'Europe',
    feeds: [
      { url: 'https://www.reuters.com/arc/outboundfeeds/v3/all/rss/', source: 'Reuters' },
      { url: 'https://feeds.bbci.co.uk/news/world/rss.xml', source: 'BBC World' },
      { url: 'https://rss.dw.com/xml/rss-en-all', source: 'DW Germany' },
    ],
    keywords: ['nato', 'eu', 'ukraine', 'russia', 'germany', 'france', 'uk', 'sanctions', 'energy']
  },
  americas: {
    name: 'Americas',
    feeds: [
      { url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', source: 'NYT World' },
      { url: 'https://feeds.npr.org/1004/rss.xml', source: 'NPR World' },
    ],
    keywords: ['mexico', 'brazil', 'canada', 'venezuela', 'trade', 'immigration', 'drugs']
  },
  africa: {
    name: 'Africa',
    feeds: [
      { url: 'https://allafrica.com/tools/headlines/rdf/latest/headlines.rdf', source: 'AllAfrica' },
    ],
    keywords: ['coup', 'conflict', 'oil', 'mining', 'china', 'russia', 'wagner']
  },
  middleEast: {
    name: 'Middle East',
    feeds: [
      { url: 'https://english.alarabiya.net/tools/rss', source: 'Al Arabiya' },
      { url: 'https://www.jpost.com/rss/rssfeedsfrontpage.aspx', source: 'Jerusalem Post' },
    ],
    keywords: ['iran', 'israel', 'saudi', 'yemen', 'houthi', 'oil', 'attack', 'military']
  }
};

// Parse RSS
async function parseFeed(url) {
  try {
    const res = await fetch(url, { 
      signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': 'SnappedAI-News/1.0' }
    });
    const text = await res.text();
    const items = [];
    const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
    let match;
    while ((match = itemRegex.exec(text)) !== null) {
      const item = match[1];
      const title = item.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i)?.[1]?.trim() || '';
      const link = item.match(/<link[^>]*>([^<]+)<\/link>/i)?.[1]?.trim() || '';
      const pubDate = item.match(/<pubDate[^>]*>([^<]+)<\/pubDate>/i)?.[1]?.trim() || '';
      items.push({ title, link, pubDate, text: title.toLowerCase() });
    }
    return items.slice(0, 5);
  } catch (e) {
    return [];
  }
}

async function scanRegion(key, region) {
  const stories = [];
  
  for (const feed of region.feeds) {
    const items = await parseFeed(feed.url);
    for (const item of items) {
      // Check for keyword matches (if keywords defined, else accept all)
      if (!region.keywords || region.keywords.length === 0) {
        // Accept all (for trending sources like Google)
        stories.push({
          title: item.title.substring(0, 100),
          source: feed.source,
          link: item.link,
          keywords: ['trending'],
          pubDate: item.pubDate
        });
      } else {
        const matched = region.keywords.filter(kw => item.text.includes(kw));
        if (matched.length > 0) {
          stories.push({
            title: item.title.substring(0, 100),
            source: feed.source,
            link: item.link,
            keywords: matched,
            pubDate: item.pubDate
          });
        }
      }
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  
  return stories.slice(0, 10); // Top 10 per region
}

async function scanAllRegions() {
  console.log('[NEWS] Scanning all regions...');
  
  // Scan regional feeds
  for (const [key, region] of Object.entries(REGIONS)) {
    const stories = await scanRegion(key, region);
    news.regions[key] = {
      name: region.name,
      stories,
      count: stories.length,
      lastScan: new Date().toISOString()
    };
    
    // Alert on high-priority keywords
    for (const story of stories) {
      if (story.keywords.some(k => ['attack', 'military', 'coup', 'sanctions'].includes(k))) {
        addAlert('BREAKING', `${region.name}: ${story.title.substring(0, 60)}...`, {
          region: key,
          source: story.source,
          link: story.link
        });
      }
    }
  }
  
  // Scan trending feeds
  console.log('[NEWS] Scanning trending sources...');
  for (const [key, source] of Object.entries(TRENDING)) {
    const stories = await scanRegion(key, source);
    news.regions[key] = {
      name: source.name,
      stories,
      count: stories.length,
      lastScan: new Date().toISOString()
    };
  }
  
  news.lastUpdate = new Date().toISOString();
  fs.writeFileSync(NEWS_FILE, JSON.stringify(news, null, 2));
  console.log(`[NEWS] Updated ${Object.keys(news.regions).length} sources`);
}

// HTTP server
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  
  if (req.url === '/news') {
    res.end(JSON.stringify(news));
  } else if (req.url.startsWith('/region/')) {
    const region = req.url.split('/')[2];
    res.end(JSON.stringify(news.regions?.[region] || {}));
  } else {
    res.end(JSON.stringify({ endpoints: ['/news', '/region/{asia|europe|americas|africa|middleEast}'] }));
  }
});

const PORT = 3882;
server.listen(PORT, () => {
  console.log(`[NEWS] Running on port ${PORT}`);
  scanAllRegions();
  setInterval(scanAllRegions, 15 * 60 * 1000); // Every 15 min
});
