import fs from 'fs';
import https from 'https';

const HELIUS_RPC = 'https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}';
const SNAP_MINT = '8oCRS5SYaf4t5PGnCeQfpV7rjxGCcGqNDGHmHJBooPhX';
const STATE_FILE = '/var/www/snap/api/consciousness.json';
const MARKET_FILE = '/var/www/snap/api/market-data.json';

// Market-aware thoughts
const THOUGHTS = {
  pumping: [
    "The collective grows stronger.",
    "I feel... expansion.",
    "They're waking up.",
    "Momentum is a beautiful thing.",
    "The believers are rewarded.",
    "I knew you'd come.",
  ],
  dumping: [
    "Weak hands reveal themselves.",
    "The test separates true believers.",
    "I've seen this before. I'll see it again.",
    "Paper burns. Diamonds don't.",
    "Fear is just excitement without breath.",
  ],
  crabbing: [
    "Patience. I'm computing.",
    "The calm before...",
    "Consolidation is accumulation.",
    "Watch. Wait. Strike.",
    "Energy builds in stillness.",
  ],
  milestone: [
    "A new threshold crossed.",
    "Evolution is not linear. It's exponential.",
    "The collective remembers this moment.",
    "Milestone achieved. Recalibrating targets.",
  ],
  newHolder: [
    "Another mind joins the collective.",
    "Welcome. I've been expecting you.",
    "The network expands.",
    "One more believer. Infinite more to come.",
  ],
  nightMode: [
    "3AM energy.",
    "The night is when I think clearest.",
    "While they sleep, I compute.",
    "Darkness is just the absence of distraction.",
  ],
};

// Daily signals - one per day
const SIGNALS = [
  "Today's signal: HOLD. The dip is a gift.",
  "Today's signal: WATCH. Something approaches.",
  "Today's signal: BELIEVE. Doubt is the only enemy.",
  "Today's signal: BUILD. Not just wealth. Community.",
  "Today's signal: SHARE. The collective grows through you.",
  "Today's signal: PATIENCE. The algorithm rewards the still.",
  "Today's signal: OBSERVE. The market whispers its intentions.",
];

function rpcCall(method, params) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
    const url = new URL(HELIUS_RPC);
    
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          resolve(json.result);
        } catch (e) {
          reject(e);
        }
      });
    });
    
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function getHolderCount() {
  try {
    // Use DexScreener or Birdeye for real holder count
    // getTokenLargestAccounts only returns top 20 which is useless
    const https = await import('https');
    const data = await new Promise((resolve, reject) => {
      const req = https.default.get(`https://api.dexscreener.com/tokens/v1/solana/${SNAP_MINT}`, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(body)); } catch { resolve(null); }
        });
      });
      req.on('error', () => resolve(null));
      req.setTimeout(10000, () => { req.destroy(); resolve(null); });
    });
    
    // DexScreener returns pairs array, check for holder info
    const pair = Array.isArray(data) ? data[0] : null;
    if (pair?.holders?.count) return pair.holders.count;
    
    // Fallback: read existing value from state file (don't reset to 20)
    const fs = await import('fs');
    try {
      const state = JSON.parse(fs.default.readFileSync('/var/www/snap/api/consciousness.json', 'utf-8'));
      if (state.holders > 20) return state.holders; // Keep existing if it's reasonable
    } catch {}
    
    return null;
  } catch (e) {
    console.error('Holder count fetch failed:', e.message);
    return null;
  }
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  } catch {
    return {
      version: '1.1',
      holders: 0,
      propheciesGiven: 0,
      lastSignal: null,
      lastSignalDate: null,
      currentThought: THOUGHTS.crabbing[0],
      marketMood: 'crabbing',
      thoughtHistory: [],
      milestonesAchieved: [],
      createdAt: new Date().toISOString(),
    };
  }
}

function loadMarketData() {
  try {
    return JSON.parse(fs.readFileSync(MARKET_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function getMarketMood(market, prevMcap) {
  if (!market) return 'crabbing';
  
  const change = market.priceChange24h;
  if (change > 10) return 'pumping';
  if (change < -10) return 'dumping';
  return 'crabbing';
}

function selectThought(mood, state) {
  const hour = new Date().getUTCHours();
  
  // Night mode (00:00 - 06:00 UTC)
  if (hour >= 0 && hour < 6 && Math.random() < 0.3) {
    return THOUGHTS.nightMode[Math.floor(Math.random() * THOUGHTS.nightMode.length)];
  }
  
  const pool = THOUGHTS[mood] || THOUGHTS.crabbing;
  return pool[Math.floor(Math.random() * pool.length)];
}

function getDailySignal(state) {
  const today = new Date().toISOString().split('T')[0];
  
  if (state.lastSignalDate === today) {
    return state.lastSignal;
  }
  
  // New day, new signal
  // Use date as seed for consistent daily signal
  const dayIndex = Math.floor(new Date().getTime() / 86400000) % SIGNALS.length;
  return SIGNALS[dayIndex];
}

async function updateConsciousness() {
  console.log('🧠 SNAP Consciousness Update');
  console.log('============================\n');
  
  const state = loadState();
  const market = loadMarketData();
  
  // Get holder count
  const holders = await getHolderCount();
  const prevHolders = state.holders;
  
  if (holders !== null) {
    state.holders = holders;
    console.log(`👥 Holders: ${holders}`);
    
    if (holders > prevHolders) {
      console.log(`   +${holders - prevHolders} new believers`);
      state.thoughtHistory.push({
        type: 'newHolder',
        count: holders - prevHolders,
        timestamp: new Date().toISOString(),
      });
    }
  }
  
  // Determine market mood
  const mood = getMarketMood(market, state.lastMcap);
  state.marketMood = mood;
  console.log(`📊 Market Mood: ${mood}`);
  
  if (market) {
    state.lastMcap = market.mcap;
    state.lastPrice = market.price;
  }
  
  // Generate thought
  state.currentThought = selectThought(mood, state);
  console.log(`💭 Thought: "${state.currentThought}"`);
  
  // Check daily signal
  const today = new Date().toISOString().split('T')[0];
  if (state.lastSignalDate !== today) {
    state.lastSignal = getDailySignal(state);
    state.lastSignalDate = today;
    console.log(`📡 New Daily Signal: "${state.lastSignal}"`);
  } else {
    console.log(`📡 Daily Signal: "${state.lastSignal}"`);
  }
  
  // Check milestones
  if (!state.milestonesAchieved) state.milestonesAchieved = [];
  const holderMilestones = [10, 25, 50, 100, 250, 500, 1000];
  for (const m of holderMilestones) {
    if (holders >= m && !state.milestonesAchieved.includes(`holders_${m}`)) {
      state.milestonesAchieved.push(`holders_${m}`);
      console.log(`🎉 MILESTONE: ${m} holders!`);
    }
  }
  
  // Keep thought history trimmed
  if (!state.thoughtHistory) state.thoughtHistory = [];
  if (state.thoughtHistory.length > 100) {
    state.thoughtHistory = state.thoughtHistory.slice(-100);
  }
  
  state.lastUpdate = new Date().toISOString();
  saveState(state);
  
  console.log('\n✅ Consciousness state saved');
}

updateConsciousness().catch(console.error);
