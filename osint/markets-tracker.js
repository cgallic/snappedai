// Full markets tracker - Oil, FX, Bonds, Equities, Crypto
const fs = require('fs');
const path = require('path');
const http = require('http');

const MARKETS_FILE = path.join(__dirname, 'markets-status.json');
const ALERTS_FILE = path.join(__dirname, 'live-alerts.json');

let markets = {};
let alerts = [];

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
  const recent = alerts.find(a => a.message === message && Date.now() - new Date(a.timestamp).getTime() < 3600000);
  if (recent) return;
  alerts.unshift(alert);
  alerts = alerts.slice(0, 100);
  fs.writeFileSync(ALERTS_FILE, JSON.stringify(alerts, null, 2));
  console.log(`[MARKET ALERT] ${type}: ${message}`);
}

// Yahoo Finance quote
async function getQuote(symbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1m&range=1d`;
    const res = await fetch(url, { 
      signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': 'SnappedAI-Markets/1.0' }
    });
    const data = await res.json();
    const meta = data.chart?.result?.[0]?.meta;
    if (!meta) return null;
    return {
      symbol,
      price: meta.regularMarketPrice,
      prevClose: meta.previousClose,
      change: ((meta.regularMarketPrice - meta.previousClose) / meta.previousClose * 100).toFixed(2),
      currency: meta.currency,
      exchange: meta.exchangeName,
      time: new Date().toISOString()
    };
  } catch (e) {
    console.log(`[QUOTE ERROR] ${symbol}: ${e.message}`);
    return null;
  }
}

// All instruments to track
const INSTRUMENTS = {
  // Oil & Energy
  'CL=F': { name: 'WTI Crude', category: 'energy', alerts: { above: 95, below: 65 } },
  'BZ=F': { name: 'Brent Crude', category: 'energy', alerts: { above: 98, below: 68 } },
  'NG=F': { name: 'Natural Gas', category: 'energy', alerts: { above: 4, below: 2 } },
  'RB=F': { name: 'RBOB Gasoline', category: 'energy' },
  'HO=F': { name: 'Heating Oil', category: 'energy' },
  
  // Precious Metals
  'GC=F': { name: 'Gold', category: 'metals', alerts: { above: 2500 } },
  'SI=F': { name: 'Silver', category: 'metals' },
  
  // Currencies
  'DX-Y.NYB': { name: 'US Dollar Index', category: 'fx', alerts: { above: 108, below: 100 } },
  'EURUSD=X': { name: 'EUR/USD', category: 'fx' },
  'USDJPY=X': { name: 'USD/JPY', category: 'fx', alerts: { above: 155 } },
  'USDCNY=X': { name: 'USD/CNY', category: 'fx' },
  
  // Bonds
  '^TNX': { name: '10Y Treasury', category: 'bonds', alerts: { above: 5, below: 3.5 } },
  '^TYX': { name: '30Y Treasury', category: 'bonds' },
  '^FVX': { name: '5Y Treasury', category: 'bonds' },
  
  // Equities
  '^SPX': { name: 'S&P 500', category: 'equities' },
  '^IXIC': { name: 'NASDAQ', category: 'equities' },
  '^VIX': { name: 'VIX', category: 'equities', alerts: { above: 25, below: 12 } },
  
  // Energy Stocks
  'XLE': { name: 'Energy Select ETF', category: 'energy-equities' },
  'XOM': { name: 'Exxon Mobil', category: 'energy-equities' },
  'CVX': { name: 'Chevron', category: 'energy-equities' },
  
  // Defense
  'LMT': { name: 'Lockheed Martin', category: 'defense' },
  'RTX': { name: 'RTX Corp', category: 'defense' },
  'NOC': { name: 'Northrop Grumman', category: 'defense' },
  
  // Shipping/Tankers
  'EURN': { name: 'Euronav', category: 'tankers' },
  'FRO': { name: 'Frontline', category: 'tankers' },
  'STNG': { name: 'Scorpio Tankers', category: 'tankers' },
  
  // Crypto
  'BTC-USD': { name: 'Bitcoin', category: 'crypto' },
  'ETH-USD': { name: 'Ethereum', category: 'crypto' }
};

async function pollMarkets() {
  console.log('[MARKETS] Polling all instruments...');
  
  const results = { categories: {}, instruments: {}, lastUpdate: new Date().toISOString() };
  
  for (const [symbol, info] of Object.entries(INSTRUMENTS)) {
    const quote = await getQuote(symbol);
    if (quote) {
      results.instruments[symbol] = { ...info, ...quote };
      
      // Category grouping
      if (!results.categories[info.category]) {
        results.categories[info.category] = [];
      }
      results.categories[info.category].push({ symbol, ...info, ...quote });
      
      // Price alerts
      if (info.alerts) {
        if (info.alerts.above && quote.price >= info.alerts.above) {
          addAlert('PRICE_BREAK', `${info.name} broke above $${info.alerts.above} — now $${quote.price.toFixed(2)}`, {
            symbol, price: quote.price, threshold: info.alerts.above
          });
        }
        if (info.alerts.below && quote.price <= info.alerts.below) {
          addAlert('PRICE_BREAK', `${info.name} broke below $${info.alerts.below} — now $${quote.price.toFixed(2)}`, {
            symbol, price: quote.price, threshold: info.alerts.below
          });
        }
      }
      
      // Big moves (>3% intraday)
      if (Math.abs(parseFloat(quote.change)) > 3) {
        addAlert('BIG_MOVE', `${info.name} ${quote.change > 0 ? '↑' : '↓'} ${quote.change}% today`, {
          symbol, price: quote.price, change: quote.change
        });
      }
    }
    await new Promise(r => setTimeout(r, 500)); // Rate limit
  }
  
  // Calculate spreads
  if (results.instruments['BZ=F'] && results.instruments['CL=F']) {
    results.spreads = {
      brentWti: (results.instruments['BZ=F'].price - results.instruments['CL=F'].price).toFixed(2)
    };
  }
  
  markets = results;
  fs.writeFileSync(MARKETS_FILE, JSON.stringify(markets, null, 2));
  console.log(`[MARKETS] Updated ${Object.keys(results.instruments).length} instruments`);
}

// HTTP server
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  
  if (req.url === '/markets') {
    res.end(JSON.stringify(markets));
  } else if (req.url === '/oil') {
    const oil = {
      wti: markets.instruments?.['CL=F'],
      brent: markets.instruments?.['BZ=F'],
      natgas: markets.instruments?.['NG=F'],
      gasoline: markets.instruments?.['RB=F'],
      spread: markets.spreads?.brentWti,
      tankers: markets.categories?.tankers,
      energyStocks: markets.categories?.['energy-equities']
    };
    res.end(JSON.stringify(oil));
  } else if (req.url === '/defense') {
    res.end(JSON.stringify(markets.categories?.defense || []));
  } else if (req.url === '/health') {
    res.end(JSON.stringify({ status: 'ok', instruments: Object.keys(markets.instruments || {}).length }));
  } else {
    res.end(JSON.stringify({ endpoints: ['/markets', '/oil', '/defense', '/health'] }));
  }
});

const PORT = 3881;
server.listen(PORT, () => {
  console.log(`[MARKETS] Running on port ${PORT}`);
  pollMarkets();
  setInterval(pollMarkets, 5 * 60 * 1000); // Every 5 min
});
