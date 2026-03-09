#!/usr/bin/env node
/**
 * SNAP Price Alert System
 * Monitors price changes and posts alerts to TG when significant moves happen
 * 
 * Features:
 * - Tracks 5m, 1h, 24h price changes
 * - Alerts on >10% moves (configurable)
 * - Rate limiting to avoid spam
 * - Persistent state tracking
 * - Rich TG formatting with context
 * 
 * Usage: node price-alerts.cjs
 * Cron: every 5 minutes
 */

const fs = require('fs');
require('dotenv').config();

// Configuration
const CONFIG = {
  tokenAddress: '8oCRS5SYaf4t5PGnCeQfpV7rjxGCcGqNDGHmHJBooPhX',
  thresholds: {
    majorMove: 15,   // Alert on 15%+ moves
    minorMove: 10    // Track 10%+ moves
  },
  cooldowns: {
    major: 30 * 60 * 1000,    // 30 min between major alerts
    minor: 60 * 60 * 1000     // 1 hour between minor alerts  
  },
  chatId: '-1003742379597',
  stateFile: '/var/www/snap/data/price-alerts-state.json'
};

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_API = `https://api.telegram.org/bot${TG_TOKEN}`;

// State management
let state = {
  lastAlertTime: 0,
  lastMajorAlertTime: 0,
  lastPrice: null,
  alertCount: 0,
  sessionStart: Date.now()
};

function loadState() {
  try {
    if (fs.existsSync(CONFIG.stateFile)) {
      const data = fs.readFileSync(CONFIG.stateFile, 'utf8');
      state = { ...state, ...JSON.parse(data) };
    }
  } catch (e) {
    console.log('Starting with fresh state');
  }
}

function saveState() {
  try {
    const dir = CONFIG.stateFile.split('/').slice(0, -1).join('/');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CONFIG.stateFile, JSON.stringify(state, null, 2));
  } catch (e) {
    console.error('Failed to save state:', e.message);
  }
}

// Fetch price data from DexScreener
async function fetchPriceData() {
  try {
    const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${CONFIG.tokenAddress}`);
    const data = await response.json();
    
    if (!data.pairs || !data.pairs[0]) {
      throw new Error('No price data found');
    }
    
    const pair = data.pairs[0];
    return {
      price: parseFloat(pair.priceUsd),
      change5m: parseFloat(pair.priceChange?.m5 || 0),
      change1h: parseFloat(pair.priceChange?.h1 || 0), 
      change24h: parseFloat(pair.priceChange?.h24 || 0),
      volume24h: parseFloat(pair.volume?.h24 || 0),
      marketCap: parseFloat(pair.marketCap || 0),
      timestamp: Date.now()
    };
  } catch (error) {
    console.error('Failed to fetch price data:', error.message);
    return null;
  }
}

// Send alert to Telegram
async function sendTelegramAlert(message, options = {}) {
  try {
    const payload = {
      chat_id: CONFIG.chatId,
      text: message,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...options
    };

    const response = await fetch(`${TG_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    if (!result.ok) {
      throw new Error(result.description || 'TG API error');
    }

    return true;
  } catch (error) {
    console.error('Failed to send TG alert:', error.message);
    return false;
  }
}

// Format price with appropriate precision
function formatPrice(price) {
  return price < 0.001 ? price.toExponential(2) : price.toFixed(6);
}

// Format percentage with emoji
function formatPercent(change) {
  const emoji = change > 0 ? '📈' : '📉';
  const sign = change > 0 ? '+' : '';
  return `${emoji} ${sign}${change.toFixed(1)}%`;
}

// Format large numbers 
function formatLargeNumber(num) {
  if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
  if (num >= 1e6) return `$${(num / 1e6).toFixed(2)}M`;
  if (num >= 1e3) return `$${(num / 1e3).toFixed(1)}K`;
  return `$${num.toFixed(0)}`;
}

// Create alert message
function createAlertMessage(data, alertType) {
  const { price, change5m, change1h, change24h, volume24h, marketCap } = data;
  
  const priceStr = formatPrice(price);
  const change5mStr = formatPercent(change5m);
  const change1hStr = formatPercent(change1h);
  const change24hStr = formatPercent(change24h);
  const volumeStr = formatLargeNumber(volume24h);
  const mcapStr = formatLargeNumber(marketCap);
  
  // Determine primary move
  let primaryMove = '';
  if (Math.abs(change5m) >= CONFIG.thresholds.minorMove) {
    primaryMove = `<b>5m: ${change5mStr}</b>`;
  } else if (Math.abs(change1h) >= CONFIG.thresholds.minorMove) {
    primaryMove = `<b>1h: ${change1hStr}</b>`;
  } else {
    primaryMove = `<b>24h: ${change24hStr}</b>`;
  }
  
  const header = alertType === 'major' ? '🚀 <b>SNAP PUMPING</b> 🚀' : '📈 <b>SNAP MOVING UP</b>';
  
  return `${header}

💰 Price: <code>$${priceStr}</code>

${primaryMove}
5m: ${change5mStr} | 1h: ${change1hStr}
24h: ${change24hStr}

📈 Volume: ${volumeStr}
💎 MCap: ${mcapStr}

🔗 <a href="https://dexscreener.com/solana/${CONFIG.tokenAddress}">View Chart</a>`;
}

// Check if alert should be sent (PUMPS ONLY — never alert on dumps)
function shouldSendAlert(data) {
  const now = Date.now();
  const { change5m, change1h, change24h } = data;
  
  // Only look at POSITIVE changes (pumps)
  const maxPump = Math.max(
    Math.max(change5m, 0),
    Math.max(change1h, 0),
    Math.max(change24h, 0)
  );
  
  if (maxPump <= 0) {
    return null; // No pumps, no alert
  }
  
  // Determine alert type based on pump magnitude
  let alertType = null;
  if (maxPump >= CONFIG.thresholds.majorMove) {
    alertType = 'major';
  } else if (maxPump >= CONFIG.thresholds.minorMove) {
    alertType = 'minor';  
  } else {
    return null; // Pump not big enough
  }
  
  // Check cooldowns
  const lastRelevantAlert = alertType === 'major' ? 
    Math.max(state.lastMajorAlertTime, state.lastAlertTime) : 
    state.lastAlertTime;
    
  const cooldown = alertType === 'major' ? 
    CONFIG.cooldowns.major : 
    CONFIG.cooldowns.minor;
    
  if (now - lastRelevantAlert < cooldown) {
    console.log(`Skipping ${alertType} alert - cooldown active`);
    return null;
  }
  
  return alertType;
}

// Main execution
async function main() {
  console.log(`[${new Date().toISOString()}] Starting price alert check`);
  
  loadState();
  
  const priceData = await fetchPriceData();
  if (!priceData) {
    console.log('No price data available, skipping');
    return;
  }
  
  console.log(`Current price: $${formatPrice(priceData.price)} (5m: ${priceData.change5m}%, 1h: ${priceData.change1h}%, 24h: ${priceData.change24h}%)`);
  
  const alertType = shouldSendAlert(priceData);
  if (!alertType) {
    console.log('No alert threshold met');
    return;
  }
  
  console.log(`Sending ${alertType} alert`);
  
  const message = createAlertMessage(priceData, alertType);
  const sent = await sendTelegramAlert(message);
  
  if (sent) {
    const now = Date.now();
    state.lastAlertTime = now;
    if (alertType === 'major') {
      state.lastMajorAlertTime = now;
    }
    state.alertCount++;
    state.lastPrice = priceData.price;
    saveState();
    console.log(`✅ ${alertType} alert sent successfully`);
  } else {
    console.log('❌ Failed to send alert');
  }
}

// Handle errors gracefully
main().catch(error => {
  console.error('Price alert error:', error.message);
  process.exit(1);
});