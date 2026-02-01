'use strict';

/**
 * SNAP On-Chain Intelligence System
 * ==================================
 * Feature Request #13
 * 
 * Monitors SNAP token transactions on Solana, detects whales,
 * classifies activity, and sends Telegram alerts.
 * 
 * Usage:
 *   node onchain-intel.cjs          # Run the persistent service
 *   node onchain-intel.cjs --dry    # Dry run: fetch last 10 txs and classify
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ quiet: true });

// ============================================
// CONFIGURATION
// ============================================
const CONFIG = {
  // Token & pair
  SNAP_MINT: '8oCRS5SYaf4t5PGnCeQfpV7rjxGCcGqNDGHmHJBooPhX',
  PAIR_ADDRESS: 'GfhNfEkFWuhjYeySrovPVzkwdizCBmqc5vuEaL3NEU43',
  WSOL_MINT: 'So11111111111111111111111111111111111111112',
  
  // Known programs
  TOKEN_PROGRAM: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  SYSTEM_PROGRAM: '11111111111111111111111111111111',
  PUMPSWAP_PROGRAM: 'PSwapMdSai8tjrEXcxFeQth87xC4rRsa4VA5mhGhXkP',
  PUMPFUN_PROGRAM: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
  RAYDIUM_V4: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
  JUPITER_V6: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
  
  // API
  HELIUS_RPC: 'https://mainnet.helius-rpc.com/?api-key=35f4ea8f-6608-44d6-881a-9fd18b75a023',
  HELIUS_API_KEY: process.env.HELIUS_API_KEY,
  DEXSCREENER_URL: 'https://api.dexscreener.com/latest/dex/pairs/solana/GfhNfEkFWuhjYeySrovPVzkwdizCBmqc5vuEaL3NEU43',
  
  // Telegram
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_GROUP_ID: '-1003742379597',
  
  // Thresholds (in SOL)
  NOTABLE_THRESHOLD: 1,    // > 1 SOL = notable
  WHALE_THRESHOLD: 5,      // > 5 SOL = whale
  ALERT_MIN_SOL: 5,        // minimum SOL to trigger alert (buys only)
  
  // Polling
  POLL_INTERVAL_MS: 30000,  // 30 seconds
  MAX_SIGS_PER_POLL: 25,
  MAX_CONCURRENT_TX_FETCH: 5,
  
  // Paths
  DATA_DIR: '/var/www/snap/data',
  DAILY_DIR: '/var/www/snap/data/onchain-daily',
  STATE_FILE: '/var/www/snap/data/onchain-state.json',
};

// ============================================
// UTILITY: HTTP HELPERS
// ============================================

function httpPost(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'SNAP-Intel/1.0',
        ...headers,
      },
    };
    const data = typeof body === 'string' ? body : JSON.stringify(body);
    options.headers['Content-Length'] = Buffer.byteLength(data);
    
    const transport = parsed.protocol === 'https:' ? https : http;
    const req = transport.request(options, (res) => {
      let chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        try {
          resolve(JSON.parse(raw));
        } catch {
          resolve(raw);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Request timeout')); });
    req.write(data);
    req.end();
  });
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === 'https:' ? https : http;
    const req = transport.get(url, { headers: { 'User-Agent': 'SNAP-Intel/1.0' } }, (res) => {
      let chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        try {
          resolve(JSON.parse(raw));
        } catch {
          resolve(raw);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Request timeout')); });
  });
}

async function retryAsync(fn, retries = 3, delayMs = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries - 1) throw err;
      log(`Retry ${i + 1}/${retries}: ${err.message}`);
      await sleep(delayMs * (i + 1));
    }
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ============================================
// LOGGING
// ============================================

function log(...args) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}

function logError(...args) {
  console.error(`[${new Date().toISOString()}] ERROR:`, ...args);
}

// ============================================
// STATE MANAGEMENT
// ============================================

let state = {
  walletLabels: {},         // wallet -> { label, firstSeen, txCount, totalSolVolume }
  whaleCounter: 0,          // incremental label counter
  lastSignature: null,      // last processed signature
  lastPollTime: null,
  alertThreshold: 5, // SOL minimum for buy alerts
  dailyStats: {
    date: todayStr(),
    totalVolumeSol: 0,
    totalBuys: 0,
    totalSells: 0,
    totalTransfers: 0,
    topBuyers: {},          // wallet -> sol amount
    topSellers: {},         // wallet -> sol amount
    whaleMovements: [],
    events: [],
  },
  recentAlerts: [],         // last 100 alerts
  processedSignatures: new Set(),  // recently processed (in-memory, last 500)
};

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function loadState() {
  try {
    if (fs.existsSync(CONFIG.STATE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(CONFIG.STATE_FILE, 'utf8'));
      state.walletLabels = raw.walletLabels || {};
      state.whaleCounter = raw.whaleCounter || 0;
      state.lastSignature = raw.lastSignature || null;
      state.lastPollTime = raw.lastPollTime || null;
      state.alertThreshold = raw.alertThreshold || CONFIG.ALERT_MIN_SOL;
      state.recentAlerts = raw.recentAlerts || [];
      
      // Reset daily stats if new day
      if (raw.dailyStats && raw.dailyStats.date === todayStr()) {
        state.dailyStats = raw.dailyStats;
      }
      
      log(`State loaded: ${Object.keys(state.walletLabels).length} known wallets, last sig: ${state.lastSignature ? state.lastSignature.slice(0, 12) + '...' : 'none'}`);
    } else {
      log('No existing state file, starting fresh');
    }
  } catch (err) {
    logError('Failed to load state:', err.message);
  }
}

function saveState() {
  try {
    fs.mkdirSync(CONFIG.DATA_DIR, { recursive: true });
    const toSave = {
      walletLabels: state.walletLabels,
      whaleCounter: state.whaleCounter,
      lastSignature: state.lastSignature,
      lastPollTime: state.lastPollTime,
      alertThreshold: state.alertThreshold,
      dailyStats: state.dailyStats,
      recentAlerts: state.recentAlerts.slice(-100),
    };
    fs.writeFileSync(CONFIG.STATE_FILE, JSON.stringify(toSave, null, 2));
  } catch (err) {
    logError('Failed to save state:', err.message);
  }
}

function saveDailyData() {
  try {
    fs.mkdirSync(CONFIG.DAILY_DIR, { recursive: true });
    const filePath = path.join(CONFIG.DAILY_DIR, `${state.dailyStats.date}.json`);
    fs.writeFileSync(filePath, JSON.stringify(state.dailyStats, null, 2));
  } catch (err) {
    logError('Failed to save daily data:', err.message);
  }
}

function resetDailyIfNeeded() {
  const today = todayStr();
  if (state.dailyStats.date !== today) {
    // Save yesterday's data
    saveDailyData();
    // Reset
    state.dailyStats = {
      date: today,
      totalVolumeSol: 0,
      totalBuys: 0,
      totalSells: 0,
      totalTransfers: 0,
      topBuyers: {},
      topSellers: {},
      whaleMovements: [],
      events: [],
    };
    log('Daily stats reset for', today);
  }
}

// ============================================
// WALLET LABELING
// ============================================

function getWalletLabel(wallet) {
  if (state.walletLabels[wallet]) {
    return state.walletLabels[wallet].label;
  }
  return shortenAddress(wallet);
}

function ensureWalletTracked(wallet, solAmount = 0) {
  if (!state.walletLabels[wallet]) {
    state.walletLabels[wallet] = {
      label: shortenAddress(wallet),
      firstSeen: new Date().toISOString(),
      txCount: 0,
      totalSolVolume: 0,
      totalBuys: 0,
      totalSells: 0,
      recentTxTimes: [],  // last 10 timestamps for wash detection
    };
  }
  const w = state.walletLabels[wallet];
  w.txCount++;
  w.totalSolVolume += Math.abs(solAmount);
  
  // Promote to whale label if meets threshold
  if (w.totalSolVolume >= CONFIG.WHALE_THRESHOLD && !w.label.startsWith('whale_')) {
    state.whaleCounter++;
    w.label = `whale_${state.whaleCounter}`;
    log(`🐋 New whale labeled: ${wallet.slice(0, 8)}... → ${w.label}`);
  }
  
  // Track timing for wash detection
  w.recentTxTimes.push(Date.now());
  if (w.recentTxTimes.length > 10) w.recentTxTimes.shift();
  
  return w;
}

function shortenAddress(addr) {
  return addr.slice(0, 4) + '...' + addr.slice(-4);
}

// ============================================
// PRICE CONTEXT
// ============================================

let priceCache = { price: 0, priceUsd: 0, liquidity: 0, fdv: 0, lastFetch: 0 };

async function fetchPrice() {
  // Cache for 60 seconds
  if (Date.now() - priceCache.lastFetch < 60000 && priceCache.price > 0) {
    return priceCache;
  }
  try {
    const data = await retryAsync(() => httpGet(CONFIG.DEXSCREENER_URL));
    if (data && data.pair) {
      priceCache = {
        price: parseFloat(data.pair.priceNative) || 0,
        priceUsd: parseFloat(data.pair.priceUsd) || 0,
        liquidity: data.pair.liquidity?.usd || 0,
        fdv: data.pair.fdv || 0,
        volume24h: data.pair.volume?.h24 || 0,
        priceChange24h: data.pair.priceChange?.h24 || 0,
        lastFetch: Date.now(),
      };
    }
  } catch (err) {
    logError('Price fetch failed:', err.message);
  }
  return priceCache;
}

// ============================================
// SOLANA RPC HELPERS
// ============================================

let rpcId = 1;

async function rpcCall(method, params) {
  const body = {
    jsonrpc: '2.0',
    id: rpcId++,
    method,
    params,
  };
  const result = await retryAsync(() => httpPost(CONFIG.HELIUS_RPC, body));
  if (result.error) {
    throw new Error(`RPC ${method} error: ${JSON.stringify(result.error)}`);
  }
  return result.result;
}

async function getRecentSignatures(limit = CONFIG.MAX_SIGS_PER_POLL, beforeSig = null) {
  const params = [CONFIG.SNAP_MINT, { limit }];
  if (beforeSig) params[1].before = beforeSig;
  
  const sigs = await rpcCall('getSignaturesForAddress', params);
  return sigs || [];
}

async function getNewSignatures() {
  const sigs = await getRecentSignatures(CONFIG.MAX_SIGS_PER_POLL);
  
  if (!sigs.length) return [];
  
  // Filter to only new ones
  const newSigs = [];
  for (const sig of sigs) {
    if (sig.signature === state.lastSignature) break;
    if (state.processedSignatures.has(sig.signature)) continue;
    if (sig.err) continue; // skip failed txs
    newSigs.push(sig);
  }
  
  return newSigs.reverse(); // chronological order
}

async function getTransaction(signature) {
  return await rpcCall('getTransaction', [
    signature,
    { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }
  ]);
}

// ============================================
// TRANSACTION PARSING
// ============================================

const KNOWN_DEX_PROGRAMS = new Set([
  CONFIG.PUMPSWAP_PROGRAM,
  CONFIG.PUMPFUN_PROGRAM,
  CONFIG.RAYDIUM_V4,
  CONFIG.JUPITER_V6,
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc', // Orca Whirlpool
  'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK', // Raydium CLMM
  'routeUGWgWzqBWFcrCfv8tritsqukccJPu3q5GPP3xS',  // Raydium route
  'proVF4pMXVaYqmy4NjniPh4pqKNfMmsihgd4wdkCX3u',  // Pump.fun swap router
  'PumpkiNVjB71jFeXi3rGLcGNxBFDUAhxHnsFTBm7mZT',  // PumpSwap AMM
]);

function parseSNAPTransaction(txData, signature) {
  if (!txData || !txData.meta || txData.meta.err) return null;
  
  const meta = txData.meta;
  const message = txData.transaction.message;
  const accountKeys = message.accountKeys.map(k => typeof k === 'string' ? k : k.pubkey);
  const blockTime = txData.blockTime;
  
  // Find the signer (fee payer / initiator)
  let signer = null;
  for (const key of message.accountKeys) {
    if (typeof key === 'object' && key.signer) {
      signer = key.pubkey;
      break;
    }
  }
  if (!signer) signer = accountKeys[0];
  
  // Determine which programs are involved
  const programIds = new Set();
  for (const ix of message.instructions || []) {
    if (ix.programId) programIds.add(ix.programId);
  }
  for (const inner of meta.innerInstructions || []) {
    for (const ix of inner.instructions || []) {
      if (ix.programId) programIds.add(ix.programId);
    }
  }
  
  const isDexSwap = [...programIds].some(p => KNOWN_DEX_PROGRAMS.has(p));
  
  // Calculate SOL balance change for signer
  const signerIndex = accountKeys.indexOf(signer);
  let solChange = 0;
  if (signerIndex >= 0 && meta.preBalances && meta.postBalances) {
    solChange = (meta.postBalances[signerIndex] - meta.preBalances[signerIndex]) / 1e9;
    // Add back fee since we care about intentional changes
    solChange += meta.fee / 1e9;
  }
  
  // Calculate SNAP token balance changes
  const preTokenMap = {};
  const postTokenMap = {};
  
  for (const tb of (meta.preTokenBalances || [])) {
    if (tb.mint === CONFIG.SNAP_MINT && tb.owner) {
      preTokenMap[tb.owner] = parseFloat(tb.uiTokenAmount.uiAmountString || '0');
    }
  }
  for (const tb of (meta.postTokenBalances || [])) {
    if (tb.mint === CONFIG.SNAP_MINT && tb.owner) {
      postTokenMap[tb.owner] = parseFloat(tb.uiTokenAmount.uiAmountString || '0');
    }
  }
  
  // Also track SOL token account changes (for WSOL in pool)
  const preSolTokenMap = {};
  const postSolTokenMap = {};
  for (const tb of (meta.preTokenBalances || [])) {
    if (tb.mint === CONFIG.WSOL_MINT && tb.owner) {
      preSolTokenMap[tb.owner] = parseFloat(tb.uiTokenAmount.uiAmountString || '0');
    }
  }
  for (const tb of (meta.postTokenBalances || [])) {
    if (tb.mint === CONFIG.WSOL_MINT && tb.owner) {
      postSolTokenMap[tb.owner] = parseFloat(tb.uiTokenAmount.uiAmountString || '0');
    }
  }
  
  // SNAP change for the signer
  const signerPreSnap = preTokenMap[signer] || 0;
  const signerPostSnap = postTokenMap[signer] || 0;
  const signerSnapChange = signerPostSnap - signerPreSnap;
  
  // Pool SNAP change
  const poolPreSnap = preTokenMap[CONFIG.PAIR_ADDRESS] || 0;
  const poolPostSnap = postTokenMap[CONFIG.PAIR_ADDRESS] || 0;
  const poolSnapChange = poolPostSnap - poolPreSnap;
  
  // Pool SOL change
  const poolPreSol = preSolTokenMap[CONFIG.PAIR_ADDRESS] || 0;
  const poolPostSol = postSolTokenMap[CONFIG.PAIR_ADDRESS] || 0;
  const poolSolChange = poolPostSol - poolPreSol;
  
  // Determine SOL amount involved (absolute)
  // For swaps, use the pool SOL change as it's more accurate
  let solAmount = 0;
  if (isDexSwap && Math.abs(poolSolChange) > 0) {
    solAmount = Math.abs(poolSolChange);
  } else {
    solAmount = Math.abs(solChange);
  }
  
  // Determine transaction type
  let txType = 'unknown';
  let snapAmount = 0;
  
  if (isDexSwap) {
    if (poolSnapChange < 0 && poolSolChange > 0) {
      // Pool lost SNAP, gained SOL → someone bought SNAP
      txType = 'buy';
      snapAmount = Math.abs(poolSnapChange);
    } else if (poolSnapChange > 0 && poolSolChange < 0) {
      // Pool gained SNAP, lost SOL → someone sold SNAP
      txType = 'sell';
      snapAmount = Math.abs(poolSnapChange);
    } else if (signerSnapChange > 0 && solChange < -0.001) {
      // Fallback: signer gained SNAP and lost SOL
      txType = 'buy';
      snapAmount = signerSnapChange;
    } else if (signerSnapChange < 0 && solChange > 0.001) {
      // Fallback: signer lost SNAP and gained SOL
      txType = 'sell';
      snapAmount = Math.abs(signerSnapChange);
    }
  }
  
  // Check for transfers (non-DEX SNAP movements)
  if (txType === 'unknown' && !isDexSwap) {
    // Look for token transfer instructions
    const allInstructions = [];
    for (const ix of message.instructions || []) {
      allInstructions.push(ix);
    }
    for (const inner of meta.innerInstructions || []) {
      for (const ix of inner.instructions || []) {
        allInstructions.push(ix);
      }
    }
    
    const snapTransfers = allInstructions.filter(ix => 
      ix.programId === CONFIG.TOKEN_PROGRAM &&
      ix.parsed?.type === 'transfer' &&
      ix.parsed?.info
    );
    
    // Check if any SNAP token accounts moved
    const allOwners = new Set([...Object.keys(preTokenMap), ...Object.keys(postTokenMap)]);
    const changes = {};
    for (const owner of allOwners) {
      const pre = preTokenMap[owner] || 0;
      const post = postTokenMap[owner] || 0;
      if (Math.abs(post - pre) > 0.001) {
        changes[owner] = post - pre;
      }
    }
    
    if (Object.keys(changes).length >= 2) {
      txType = 'transfer';
      // Find the sender and receiver
      const senders = Object.entries(changes).filter(([_, v]) => v < 0);
      const receivers = Object.entries(changes).filter(([_, v]) => v > 0);
      snapAmount = Math.abs(senders[0]?.[1] || 0);
    }
    
    // Check for LP add/remove
    if (changes[CONFIG.PAIR_ADDRESS] !== undefined && Math.abs(poolSolChange) > 0) {
      txType = poolSnapChange > 0 ? 'lp_add' : 'lp_remove';
      snapAmount = Math.abs(poolSnapChange);
      solAmount = Math.abs(poolSolChange);
    }
  }
  
  // Distribution detection: one wallet sending to many
  const receivers = [];
  for (const owner of Object.keys(postTokenMap)) {
    const pre = preTokenMap[owner] || 0;
    const post = postTokenMap[owner] || 0;
    if (post - pre > 0 && owner !== CONFIG.PAIR_ADDRESS) {
      receivers.push({ wallet: owner, amount: post - pre });
    }
  }
  if (txType === 'transfer' && receivers.length >= 3) {
    txType = 'distribution';
  }
  
  return {
    signature,
    blockTime,
    timestamp: blockTime ? new Date(blockTime * 1000).toISOString() : null,
    signer,
    txType,
    solAmount,
    snapAmount,
    isDexSwap,
    poolSnapChange,
    poolSolChange,
    programs: [...programIds],
    receivers: receivers.length > 1 ? receivers : undefined,
  };
}

// ============================================
// INTELLIGENCE LAYER
// ============================================

function classifyEvent(parsed) {
  if (!parsed || parsed.txType === 'unknown') {
    return { classification: 'unknown', confidence: 0.1, explanation: 'Could not determine transaction type' };
  }
  
  const wallet = parsed.signer;
  const walletData = state.walletLabels[wallet];
  const isWhale = walletData?.label?.startsWith('whale_') || parsed.solAmount >= CONFIG.WHALE_THRESHOLD;
  const isNotable = parsed.solAmount >= CONFIG.NOTABLE_THRESHOLD;
  
  let classification = parsed.txType;
  let confidence = 0.7;
  let explanation = '';
  let flags = [];
  
  // Enhance classification
  switch (parsed.txType) {
    case 'buy': {
      if (isWhale) {
        classification = 'whale_buy';
        confidence = 0.9;
        explanation = `🐋 Whale ${getWalletLabel(wallet)} bought ${formatNumber(parsed.snapAmount)} SNAP for ${parsed.solAmount.toFixed(4)} SOL`;
        flags.push('whale');
      } else if (isNotable) {
        classification = 'notable_buy';
        confidence = 0.85;
        explanation = `🟢 Notable buy by ${getWalletLabel(wallet)}: ${formatNumber(parsed.snapAmount)} SNAP for ${parsed.solAmount.toFixed(4)} SOL`;
      } else {
        classification = 'organic_buy';
        confidence = 0.75;
        explanation = `🟢 ${getWalletLabel(wallet)} bought ${formatNumber(parsed.snapAmount)} SNAP for ${parsed.solAmount.toFixed(4)} SOL`;
      }
      break;
    }
    
    case 'sell': {
      if (isWhale) {
        classification = 'whale_sell';
        confidence = 0.9;
        explanation = `🐋🔴 Whale ${getWalletLabel(wallet)} sold ${formatNumber(parsed.snapAmount)} SNAP for ${parsed.solAmount.toFixed(4)} SOL`;
        flags.push('whale');
      } else if (isNotable) {
        classification = 'notable_sell';
        confidence = 0.85;
        explanation = `🔴 Notable sell by ${getWalletLabel(wallet)}: ${formatNumber(parsed.snapAmount)} SNAP for ${parsed.solAmount.toFixed(4)} SOL`;
      } else {
        classification = 'organic_sell';
        confidence = 0.75;
        explanation = `🔴 ${getWalletLabel(wallet)} sold ${formatNumber(parsed.snapAmount)} SNAP for ${parsed.solAmount.toFixed(4)} SOL`;
      }
      break;
    }
    
    case 'transfer': {
      classification = 'transfer';
      confidence = 0.8;
      explanation = `↔️ ${getWalletLabel(wallet)} transferred ${formatNumber(parsed.snapAmount)} SNAP`;
      break;
    }
    
    case 'distribution': {
      classification = 'distribution';
      confidence = 0.85;
      const numReceivers = parsed.receivers?.length || 0;
      explanation = `⚠️ Distribution: ${getWalletLabel(wallet)} sent SNAP to ${numReceivers} wallets`;
      flags.push('unusual');
      break;
    }
    
    case 'lp_add': {
      classification = 'lp_add';
      confidence = 0.9;
      explanation = `💧 Liquidity added: ${parsed.solAmount.toFixed(4)} SOL + ${formatNumber(parsed.snapAmount)} SNAP`;
      flags.push('lp_change');
      break;
    }
    
    case 'lp_remove': {
      classification = 'lp_remove';
      confidence = 0.9;
      explanation = `💧🔴 Liquidity removed: ${parsed.solAmount.toFixed(4)} SOL + ${formatNumber(parsed.snapAmount)} SNAP`;
      flags.push('lp_change', 'unusual');
      break;
    }
  }
  
  // Wash trading detection
  if (walletData && (parsed.txType === 'buy' || parsed.txType === 'sell')) {
    const hasBothSides = walletData.totalBuys > 0 && walletData.totalSells > 0;
    const recentTxTimes = walletData.recentTxTimes || [];
    const recentCount = recentTxTimes.filter(t => Date.now() - t < 300000).length; // last 5 min
    
    if (hasBothSides && recentCount >= 3) {
      classification = 'wash_trading';
      confidence = 0.7;
      explanation = `⚠️ Possible wash trading: ${getWalletLabel(wallet)} buying AND selling rapidly (${recentCount} txs in 5min)`;
      flags.push('wash', 'unusual');
    }
  }
  
  // Add USD context
  if (priceCache.priceUsd > 0 && parsed.snapAmount > 0) {
    const usdValue = parsed.snapAmount * priceCache.priceUsd;
    if (usdValue >= 1) {
      explanation += ` (~$${formatNumber(usdValue)})`;
    }
  }
  
  return {
    classification,
    confidence,
    explanation,
    flags,
  };
}

function formatNumber(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(2) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(2) + 'K';
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(6);
}

// ============================================
// TELEGRAM ALERTS
// ============================================

async function sendTelegramMessage(text, parseMode = 'HTML') {
  if (!CONFIG.TELEGRAM_BOT_TOKEN) {
    log('No Telegram bot token, skipping alert');
    return;
  }
  
  try {
    const result = await httpPost(`https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: CONFIG.TELEGRAM_GROUP_ID,
      text,
      parse_mode: parseMode,
      disable_web_page_preview: true,
    });
    if (!result.ok) {
      logError('Telegram send failed:', result.description);
    }
    return result;
  } catch (err) {
    logError('Telegram send error:', err.message);
  }
}

function formatAlertMessage(parsed, intel) {
  const walletLabel = getWalletLabel(parsed.signer);
  const solStr = parsed.solAmount.toFixed(2);
  const snapStr = formatNumber(parsed.snapAmount);
  const txLink = `https://solscan.io/tx/${parsed.signature}`;
  
  const isWhale = intel.classification.includes('whale');
  const emoji = isWhale ? '🐋' : '🟢';
  
  let usdStr = '';
  if (priceCache.priceUsd > 0 && parsed.snapAmount > 0) {
    const usd = parsed.snapAmount * priceCache.priceUsd;
    if (usd >= 0.01) usdStr = ` ($${formatNumber(usd)})`;
  }
  
  let msg = `${emoji} <b>BUY</b> — ${solStr} SOL${usdStr}\n`;
  msg += `${snapStr} SNAP → ${walletLabel}\n`;
  msg += `<a href="${txLink}">tx</a>`;
  
  return msg;
}

function getTypeEmoji(classification) {
  const map = {
    'whale_buy': '🐋🟢',
    'whale_sell': '🐋🔴',
    'notable_buy': '💪🟢',
    'notable_sell': '💪🔴',
    'organic_buy': '🟢',
    'organic_sell': '🔴',
    'transfer': '↔️',
    'distribution': '📤⚠️',
    'wash_trading': '🔄⚠️',
    'lp_add': '💧🟢',
    'lp_remove': '💧🔴',
    'unknown': '❓',
  };
  return map[classification] || '📊';
}

// ============================================
// DAILY SUMMARY
// ============================================

function generateDailySummary() {
  const d = state.dailyStats;
  const price = priceCache;
  
  const topBuyersSorted = Object.entries(d.topBuyers)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const topSellersSorted = Object.entries(d.topSellers)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  
  let buyPressure = d.totalBuys / (d.totalBuys + d.totalSells || 1);
  let sentiment = buyPressure > 0.6 ? '🟢 Bullish' : buyPressure < 0.4 ? '🔴 Bearish' : '🟡 Neutral';
  
  let msg = `📊 <b>SNAP Daily Intelligence Report</b>\n`;
  msg += `📅 ${d.date}\n\n`;
  
  msg += `<b>Volume & Activity</b>\n`;
  msg += `💰 Total Volume: ${d.totalVolumeSol.toFixed(2)} SOL`;
  if (price.priceUsd > 0) {
    msg += ` (~$${formatNumber(d.totalVolumeSol * (1 / price.price) * price.priceUsd)})`;
  }
  msg += '\n';
  msg += `🟢 Buys: ${d.totalBuys} | 🔴 Sells: ${d.totalSells} | ↔️ Transfers: ${d.totalTransfers}\n`;
  msg += `📈 Sentiment: ${sentiment} (${(buyPressure * 100).toFixed(0)}% buy pressure)\n\n`;
  
  if (price.priceUsd > 0) {
    msg += `<b>Market</b>\n`;
    msg += `💲 Price: $${price.priceUsd} (${price.priceChange24h > 0 ? '+' : ''}${price.priceChange24h}% 24h)\n`;
    msg += `💧 Liquidity: $${formatNumber(price.liquidity)}\n`;
    msg += `📊 FDV: $${formatNumber(price.fdv)}\n\n`;
  }
  
  if (topBuyersSorted.length > 0) {
    msg += `<b>Top Buyers</b>\n`;
    for (const [wallet, sol] of topBuyersSorted) {
      msg += `  ${getWalletLabel(wallet)}: ${sol.toFixed(4)} SOL\n`;
    }
    msg += '\n';
  }
  
  if (topSellersSorted.length > 0) {
    msg += `<b>Top Sellers</b>\n`;
    for (const [wallet, sol] of topSellersSorted) {
      msg += `  ${getWalletLabel(wallet)}: ${sol.toFixed(4)} SOL\n`;
    }
    msg += '\n';
  }
  
  if (d.whaleMovements.length > 0) {
    msg += `<b>🐋 Whale Movements</b>\n`;
    for (const m of d.whaleMovements.slice(-5)) {
      msg += `  ${m}\n`;
    }
    msg += '\n';
  }
  
  msg += `🤖 <i>SNAP On-Chain Intelligence</i>`;
  
  return msg;
}

async function postDailySummary() {
  const msg = generateDailySummary();
  await sendTelegramMessage(msg);
  saveDailyData();
  log('Daily summary posted');
}

// ============================================
// MAIN PROCESSING LOOP
// ============================================

async function processTransaction(sigInfo) {
  const { signature } = sigInfo;
  
  if (state.processedSignatures.has(signature)) return null;
  
  try {
    const txData = await getTransaction(signature);
    if (!txData) return null;
    
    const parsed = parseSNAPTransaction(txData, signature);
    if (!parsed || parsed.txType === 'unknown') return null;
    
    // Track wallet
    const walletInfo = ensureWalletTracked(parsed.signer, parsed.solAmount);
    if (parsed.txType === 'buy') walletInfo.totalBuys++;
    if (parsed.txType === 'sell') walletInfo.totalSells++;
    
    // Classify
    const intel = classifyEvent(parsed);
    
    // Update daily stats
    resetDailyIfNeeded();
    state.dailyStats.totalVolumeSol += parsed.solAmount;
    if (parsed.txType === 'buy') {
      state.dailyStats.totalBuys++;
      state.dailyStats.topBuyers[parsed.signer] = (state.dailyStats.topBuyers[parsed.signer] || 0) + parsed.solAmount;
    } else if (parsed.txType === 'sell') {
      state.dailyStats.totalSells++;
      state.dailyStats.topSellers[parsed.signer] = (state.dailyStats.topSellers[parsed.signer] || 0) + parsed.solAmount;
    } else if (parsed.txType === 'transfer' || parsed.txType === 'distribution') {
      state.dailyStats.totalTransfers++;
    }
    
    // Track whale movements in daily
    if (intel.flags?.includes('whale')) {
      state.dailyStats.whaleMovements.push(intel.explanation);
    }
    
    // Store event summary (capped)
    state.dailyStats.events.push({
      time: parsed.timestamp,
      type: intel.classification,
      sol: parsed.solAmount,
      snap: parsed.snapAmount,
      wallet: shortenAddress(parsed.signer),
    });
    if (state.dailyStats.events.length > 500) {
      state.dailyStats.events = state.dailyStats.events.slice(-500);
    }
    
    // Mark processed
    state.processedSignatures.add(signature);
    // Keep set manageable
    if (state.processedSignatures.size > 500) {
      const arr = [...state.processedSignatures];
      state.processedSignatures = new Set(arr.slice(-300));
    }
    
    // Store in recent alerts
    const alertObj = {
      time: parsed.timestamp,
      signature,
      classification: intel.classification,
      explanation: intel.explanation,
      confidence: intel.confidence,
      solAmount: parsed.solAmount,
      snapAmount: parsed.snapAmount,
      wallet: parsed.signer,
      walletLabel: getWalletLabel(parsed.signer),
    };
    state.recentAlerts.push(alertObj);
    if (state.recentAlerts.length > 100) {
      state.recentAlerts = state.recentAlerts.slice(-100);
    }
    
    // Send Telegram alert — BUYS ONLY, above threshold
    const isBuy = intel.classification.includes('buy');
    if (isBuy && parsed.solAmount >= state.alertThreshold) {
      const msg = formatAlertMessage(parsed, intel);
      await sendTelegramMessage(msg);
      log(`📢 Alert sent: ${intel.classification} - ${parsed.solAmount.toFixed(4)} SOL`);
    }
    
    return { parsed, intel };
    
  } catch (err) {
    logError(`Failed to process tx ${signature.slice(0, 12)}...:`, err.message);
    return null;
  }
}

async function poll() {
  try {
    await fetchPrice();
    resetDailyIfNeeded();
    
    const newSigs = await getNewSignatures();
    
    if (newSigs.length === 0) {
      return;
    }
    
    log(`Processing ${newSigs.length} new transactions...`);
    
    // Process in batches to avoid rate limiting
    for (let i = 0; i < newSigs.length; i += CONFIG.MAX_CONCURRENT_TX_FETCH) {
      const batch = newSigs.slice(i, i + CONFIG.MAX_CONCURRENT_TX_FETCH);
      const results = await Promise.allSettled(
        batch.map(sig => processTransaction(sig))
      );
      
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value) {
          const { parsed, intel } = r.value;
          log(`  ${intel.classification}: ${parsed.solAmount.toFixed(4)} SOL by ${getWalletLabel(parsed.signer)}`);
        }
      }
      
      // Small delay between batches
      if (i + CONFIG.MAX_CONCURRENT_TX_FETCH < newSigs.length) {
        await sleep(500);
      }
    }
    
    // Update last signature
    if (newSigs.length > 0) {
      // The last sig in the original (reverse-chronological) order is the newest
      state.lastSignature = newSigs[newSigs.length - 1].signature;
    }
    
    state.lastPollTime = new Date().toISOString();
    saveState();
    
  } catch (err) {
    logError('Poll failed:', err.message);
  }
}

// ============================================
// DAILY SUMMARY SCHEDULER
// ============================================

function scheduleDailySummary() {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setUTCDate(midnight.getUTCDate() + 1);
  midnight.setUTCHours(0, 0, 5, 0); // 00:00:05 UTC
  
  const msUntilMidnight = midnight.getTime() - now.getTime();
  
  log(`Daily summary scheduled in ${(msUntilMidnight / 3600000).toFixed(1)}h`);
  
  setTimeout(async () => {
    await postDailySummary();
    // Reschedule for next day
    setInterval(async () => {
      await postDailySummary();
    }, 24 * 60 * 60 * 1000);
  }, msUntilMidnight);
}

// ============================================
// EXPORTED FUNCTIONS (for telegram-bot.cjs)
// ============================================

/**
 * Get a whale report with current whale positions
 */
function getWhaleReport() {
  const whales = Object.entries(state.walletLabels)
    .filter(([_, data]) => data.label.startsWith('whale_'))
    .sort((a, b) => b[1].totalSolVolume - a[1].totalSolVolume);
  
  if (whales.length === 0) {
    return '🐋 No whales tracked yet. The system is still learning wallet patterns.';
  }
  
  let msg = '🐋 <b>SNAP Whale Report</b>\n\n';
  for (const [wallet, data] of whales.slice(0, 10)) {
    const shortWallet = shortenAddress(wallet);
    msg += `<b>${data.label}</b> (${shortWallet})\n`;
    msg += `  📊 ${data.txCount} txs | ${data.totalSolVolume.toFixed(2)} SOL volume\n`;
    msg += `  🟢 ${data.totalBuys || 0} buys | 🔴 ${data.totalSells || 0} sells\n`;
    msg += `  📅 First seen: ${data.firstSeen?.slice(0, 10) || 'unknown'}\n\n`;
  }
  
  return msg;
}

/**
 * Get today's summary so far
 */
function getDailySummary() {
  resetDailyIfNeeded();
  return generateDailySummary();
}

/**
 * Get last N alerts
 */
function getRecentAlerts(n = 10) {
  const alerts = state.recentAlerts.slice(-n);
  
  if (alerts.length === 0) {
    return '📊 No recent alerts. Monitoring is active.';
  }
  
  let msg = `📊 <b>Last ${alerts.length} SNAP Alerts</b>\n\n`;
  for (const a of alerts.reverse()) {
    const emoji = getTypeEmoji(a.classification);
    msg += `${emoji} ${a.explanation}\n`;
    msg += `  ⏰ ${a.time?.slice(11, 19) || '?'} UTC | `;
    msg += `<a href="https://solscan.io/tx/${a.signature}">tx</a>\n\n`;
  }
  
  return msg;
}

/**
 * Get the full state for diagnostics
 */
function getIntelState() {
  return {
    knownWallets: Object.keys(state.walletLabels).length,
    whaleCount: state.whaleCounter,
    lastPoll: state.lastPollTime,
    alertThreshold: state.alertThreshold,
    todayStats: {
      volume: state.dailyStats.totalVolumeSol,
      buys: state.dailyStats.totalBuys,
      sells: state.dailyStats.totalSells,
      events: state.dailyStats.events.length,
    },
    recentAlerts: state.recentAlerts.length,
    price: priceCache,
  };
}

// ============================================
// DRY RUN MODE
// ============================================

async function dryRun() {
  log('=== DRY RUN MODE ===');
  log('Fetching last 10 SNAP transactions...\n');
  
  await fetchPrice();
  log(`Current SNAP price: $${priceCache.priceUsd} | ${priceCache.price} SOL`);
  log(`Liquidity: $${formatNumber(priceCache.liquidity)} | FDV: $${formatNumber(priceCache.fdv)}\n`);
  
  const sigs = await getRecentSignatures(10);
  log(`Got ${sigs.length} signatures\n`);
  
  let processed = 0;
  let classified = { buy: 0, sell: 0, transfer: 0, unknown: 0, other: 0 };
  
  for (const sigInfo of sigs.reverse()) {
    const sig = sigInfo.signature;
    log(`--- Transaction ${++processed} ---`);
    log(`Sig: ${sig.slice(0, 20)}...`);
    log(`Time: ${sigInfo.blockTime ? new Date(sigInfo.blockTime * 1000).toISOString() : 'unknown'}`);
    
    try {
      const txData = await getTransaction(sig);
      if (!txData) {
        log('  ⚠️ Could not fetch transaction data');
        classified.unknown++;
        continue;
      }
      
      const parsed = parseSNAPTransaction(txData, sig);
      if (!parsed) {
        log('  ⚠️ Could not parse (might be failed tx or non-SNAP)');
        classified.unknown++;
        continue;
      }
      
      // Track the wallet
      ensureWalletTracked(parsed.signer, parsed.solAmount);
      if (parsed.txType === 'buy') state.walletLabels[parsed.signer].totalBuys++;
      if (parsed.txType === 'sell') state.walletLabels[parsed.signer].totalSells++;
      
      const intel = classifyEvent(parsed);
      
      log(`  Type: ${parsed.txType} | DEX: ${parsed.isDexSwap}`);
      log(`  Signer: ${parsed.signer.slice(0, 12)}... (${getWalletLabel(parsed.signer)})`);
      log(`  SOL: ${parsed.solAmount.toFixed(6)} | SNAP: ${formatNumber(parsed.snapAmount)}`);
      log(`  Classification: ${intel.classification} (${(intel.confidence * 100).toFixed(0)}%)`);
      log(`  ${intel.explanation}`);
      
      if (intel.flags?.length) log(`  Flags: ${intel.flags.join(', ')}`);
      
      // Count
      if (parsed.txType === 'buy') classified.buy++;
      else if (parsed.txType === 'sell') classified.sell++;
      else if (parsed.txType === 'transfer') classified.transfer++;
      else classified.other++;
      
      // Show what the Telegram alert would look like
      if (parsed.solAmount >= CONFIG.ALERT_MIN_SOL) {
        log(`  📢 Would send Telegram alert`);
      }
      
    } catch (err) {
      log(`  ❌ Error: ${err.message}`);
      classified.unknown++;
    }
    
    log('');
    await sleep(200); // rate limiting
  }
  
  log('=== DRY RUN SUMMARY ===');
  log(`Processed: ${processed} transactions`);
  log(`  🟢 Buys: ${classified.buy}`);
  log(`  🔴 Sells: ${classified.sell}`);
  log(`  ↔️ Transfers: ${classified.transfer}`);
  log(`  ❓ Unknown: ${classified.unknown}`);
  log(`  📊 Other: ${classified.other}`);
  log(`  🐋 Whales detected: ${state.whaleCounter}`);
  log(`  👛 Unique wallets: ${Object.keys(state.walletLabels).length}`);
  log('');
  
  // Show what a daily summary would look like
  state.dailyStats.totalVolumeSol = Object.values(classified).reduce((a, b) => a + b, 0) * 0.1; // rough estimate
  state.dailyStats.totalBuys = classified.buy;
  state.dailyStats.totalSells = classified.sell;
  state.dailyStats.totalTransfers = classified.transfer;
  
  log('=== SAMPLE DAILY SUMMARY ===');
  log(generateDailySummary().replace(/<[^>]+>/g, '')); // strip HTML for console
}

// ============================================
// MAIN
// ============================================

async function main() {
  log('🧠 SNAP On-Chain Intelligence System');
  log('=====================================');
  log(`Token: ${CONFIG.SNAP_MINT}`);
  log(`Pair: ${CONFIG.PAIR_ADDRESS}`);
  log(`Alert threshold: ${CONFIG.ALERT_MIN_SOL} SOL`);
  log(`Poll interval: ${CONFIG.POLL_INTERVAL_MS / 1000}s`);
  log(`Telegram: ${CONFIG.TELEGRAM_BOT_TOKEN ? 'configured' : 'NOT CONFIGURED'}`);
  log('');
  
  // Create data directories
  fs.mkdirSync(CONFIG.DAILY_DIR, { recursive: true });
  
  // Load existing state
  loadState();
  
  // Check for dry run
  if (process.argv.includes('--dry') || process.argv.includes('--dry-run')) {
    await dryRun();
    return;
  }
  
  // Fetch initial price
  await fetchPrice();
  log(`SNAP Price: $${priceCache.priceUsd} | Liquidity: $${formatNumber(priceCache.liquidity)}`);
  log('');
  
  // Start polling
  log('Starting transaction monitoring...');
  
  // Do initial poll
  await poll();
  
  // Set up recurring poll
  setInterval(poll, CONFIG.POLL_INTERVAL_MS);
  
  // Schedule daily summary
  scheduleDailySummary();
  
  // Save state periodically
  setInterval(saveState, 60000);
  
  log('✅ On-chain intelligence active. Monitoring SNAP transactions.');
}

// ============================================
// MODULE EXPORTS (for telegram-bot.cjs integration)
// ============================================

module.exports = {
  getWhaleReport,
  getDailySummary,
  getRecentAlerts,
  getIntelState,
  
  // Allow external code to trigger specific actions
  fetchPrice: () => fetchPrice(),
  postDailySummary: () => postDailySummary(),
};

// Keep process alive
setInterval(() => {}, 30000);

// Global error handlers
process.on('uncaughtException', (err) => {
  logError('Uncaught exception (not exiting):', err);
});
process.on('unhandledRejection', (reason) => {
  logError('Unhandled rejection (not exiting):', reason);
});

// Run if executed directly
if (require.main === module) {
  main().catch(err => {
    logError('Fatal error in main():', err);
    // Don't exit - let setInterval keep us alive and retry
    log('Will retry poll in 60 seconds...');
    setTimeout(() => {
      poll().catch(e => logError('Retry poll failed:', e));
      setInterval(() => poll().catch(e => logError('Poll error:', e)), CONFIG.POLL_INTERVAL_MS);
    }, 60000);
  });
}
