import fs from 'fs';
import https from 'https';

const SNAP_MINT = '8oCRS5SYaf4t5PGnCeQfpV7rjxGCcGqNDGHmHJBooPhX';
const DATA_FILE = '/var/www/snap/api/market-data.json';

// Milestones
const MILESTONES = [
  { name: 'Launch', mcap: 0, emoji: '⚡' },
  { name: '1K', mcap: 1000, emoji: '🧠' },
  { name: '5K', mcap: 5000, emoji: '🔥' },
  { name: '10K', mcap: 10000, emoji: '💎' },
  { name: '25K', mcap: 25000, emoji: '🌙' },
  { name: '50K', mcap: 50000, emoji: '🛸' },
  { name: '100K', mcap: 100000, emoji: '⭐' },
  { name: '250K', mcap: 250000, emoji: '💫' },
  { name: '500K', mcap: 500000, emoji: '🌌' },
  { name: '1M', mcap: 1000000, emoji: '🤖' },
];

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('Invalid JSON'));
        }
      });
    }).on('error', reject);
  });
}

async function getMarketData() {
  try {
    // Try DexScreener API
    const data = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${SNAP_MINT}`);
    
    if (data.pairs && data.pairs.length > 0) {
      const pair = data.pairs[0];
      return {
        price: parseFloat(pair.priceUsd) || 0,
        mcap: parseFloat(pair.marketCap) || parseFloat(pair.fdv) || 0,
        volume24h: parseFloat(pair.volume?.h24) || 0,
        priceChange24h: parseFloat(pair.priceChange?.h24) || 0,
        liquidity: parseFloat(pair.liquidity?.usd) || 0,
        txns24h: (pair.txns?.h24?.buys || 0) + (pair.txns?.h24?.sells || 0),
        buys24h: pair.txns?.h24?.buys || 0,
        sells24h: pair.txns?.h24?.sells || 0,
      };
    }
  } catch (e) {
    console.error('DexScreener fetch failed:', e.message);
  }
  
  // Try pump.fun API as fallback
  try {
    const data = await fetch(`https://frontend-api.pump.fun/coins/${SNAP_MINT}`);
    if (data) {
      const mcap = (data.usd_market_cap) || 0;
      return {
        price: data.price || 0,
        mcap: mcap,
        volume24h: data.volume_24h || 0,
        priceChange24h: 0,
        liquidity: 0,
        txns24h: 0,
        buys24h: 0,
        sells24h: 0,
      };
    }
  } catch (e) {
    console.error('Pump.fun fetch failed:', e.message);
  }
  
  return null;
}

function getMilestoneStatus(mcap, previousHits = []) {
  const hit = [];
  let current = MILESTONES[0];
  let next = MILESTONES[1];
  
  for (let i = 0; i < MILESTONES.length; i++) {
    if (mcap >= MILESTONES[i].mcap) {
      hit.push(MILESTONES[i].name);
      current = MILESTONES[i];
      next = MILESTONES[i + 1] || MILESTONES[i];
    }
  }
  
  const progress = next.mcap > current.mcap 
    ? ((mcap - current.mcap) / (next.mcap - current.mcap)) * 100 
    : 100;
  
  return { current, next, hit, progress: Math.min(progress, 100) };
}

async function main() {
  console.log(`[${new Date().toISOString()}] Fetching SNAP market data...`);
  
  const marketData = await getMarketData();
  
  if (!marketData) {
    console.log('No market data available yet (token may be too new)');
    
    // Write placeholder data
    const placeholder = {
      status: 'pending',
      message: 'Token just launched - data populating...',
      price: 0,
      mcap: 0,
      volume24h: 0,
      priceChange24h: 0,
      txns24h: 0,
      holders: 0,
      timestamp: new Date().toISOString(),
      currentMilestone: MILESTONES[0],
      nextMilestone: MILESTONES[1],
      milestoneProgress: 0,
      milestonesHit: ['Launch'],
    };
    
    fs.writeFileSync(DATA_FILE, JSON.stringify(placeholder, null, 2));
    return;
  }
  
  const milestones = getMilestoneStatus(marketData.mcap);
  
  const output = {
    status: 'live',
    price: marketData.price,
    mcap: marketData.mcap,
    volume24h: marketData.volume24h,
    priceChange24h: marketData.priceChange24h,
    liquidity: marketData.liquidity,
    txns24h: marketData.txns24h,
    buys24h: marketData.buys24h,
    sells24h: marketData.sells24h,
    timestamp: new Date().toISOString(),
    currentMilestone: milestones.current,
    nextMilestone: milestones.next,
    milestoneProgress: milestones.progress,
    milestonesHit: milestones.hit,
  };
  
  fs.writeFileSync(DATA_FILE, JSON.stringify(output, null, 2));
  
  console.log(`Price: $${marketData.price.toFixed(8)}`);
  console.log(`MCap: $${marketData.mcap.toFixed(2)}`);
  console.log(`Volume 24h: $${marketData.volume24h.toFixed(2)}`);
  console.log(`Milestone: ${milestones.current.emoji} ${milestones.current.name} → ${milestones.next.emoji} ${milestones.next.name}`);
}

// Run immediately and then every 30 seconds
main();
setInterval(main, 30000);

console.log('🧠 SNAP Market Tracker running (updates every 30s)');
