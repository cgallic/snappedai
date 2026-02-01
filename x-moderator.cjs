#!/usr/bin/env node
/**
 * SNAP X Community Moderator
 * - Scans community posts via browser automation
 * - Detects spam/scam patterns
 * - Removes harmful posts (as community mod)
 * - Also handles posting via API
 */

require('dotenv').config();
const { TwitterApi } = require('/usr/lib/node_modules/twitter-api-v2');
const fs = require('fs');
const path = require('path');

// Load credentials
const CREDS_PATH = '/root/clawd/.secrets/x-credentials.json';
const creds = JSON.parse(fs.readFileSync(CREDS_PATH, 'utf8'));

const COMMUNITY_URL = 'https://x.com/i/communities/2017343083680043029';
const LOG_FILE = '/var/www/snap/data/x-mod-log.json';

// Spam/scam detection patterns
const SPAM_PATTERNS = [
  // Crypto scams
  /send\s+\d+\s*(sol|eth|btc|usdt)/i,
  /airdrop.*claim.*now/i,
  /free\s+(crypto|tokens?|nft|mint)/i,
  /guaranteed\s+\d+x/i,
  /100x\s+gem/i,
  /presale.*hurry/i,
  /dm\s+me\s+(for|to)\s+(invest|trade|profit)/i,
  /join.*telegram.*pump/i,
  
  // Phishing
  /click\s+(here|this)\s+link.*wallet/i,
  /connect\s+wallet.*claim/i,
  /verify\s+your\s+wallet/i,
  /metamask.*validate/i,
  /dextools.*trending.*buy/i,
  
  // Generic spam
  /make\s+\$\d{4,}.*per\s+(day|week|month)/i,
  /work\s+from\s+home.*\$\d{3,}/i,
  /i\s+made\s+\$\d{4,}.*you\s+can\s+too/i,
  /passive\s+income.*guaranteed/i,
  /check\s+my\s+(bio|profile|pin)/i,
  
  // Impersonation
  /official\s+(support|admin|team)/i,
  /customer\s+service.*dm/i,
  /tech\s+support.*call/i,
  
  // Adult spam
  /onlyfans.*link/i,
  /dating.*hot.*singles/i,
  
  // Bot patterns
  /follow\s+me.*follow\s+back/i,
  /like\s+4\s+like/i,
  /sub\s+4\s+sub/i,
];

// Additional high-confidence red flags (any 2+ = likely spam)
const RED_FLAGS = [
  /t\.me\//i,               // telegram links (often spam in X communities)
  /bit\.ly|tinyurl|shorturl/i,  // shortened links
  /whatsapp.*group/i,
  /\+\d{10,}/,             // phone numbers
  /0x[a-f0-9]{40}/i,       // eth addresses in posts (usually scam)
  /pump\.fun/i,            // pump.fun links (context-dependent)
  /🔥.*🚀.*💰/,            // emoji spam combo
];

function detectSpam(text) {
  const reasons = [];
  
  // Check direct spam patterns
  for (const pattern of SPAM_PATTERNS) {
    if (pattern.test(text)) {
      reasons.push(`spam_pattern: ${pattern.source}`);
    }
  }
  
  // Check red flags (need 2+)
  let redFlagCount = 0;
  const flagReasons = [];
  for (const flag of RED_FLAGS) {
    if (flag.test(text)) {
      redFlagCount++;
      flagReasons.push(flag.source);
    }
  }
  if (redFlagCount >= 2) {
    reasons.push(`red_flags(${redFlagCount}): ${flagReasons.join(', ')}`);
  }
  
  return {
    isSpam: reasons.length > 0,
    confidence: Math.min(reasons.length / 3, 1),
    reasons
  };
}

function logAction(action, details) {
  let log = [];
  try { log = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8')); } catch {}
  log.push({ timestamp: new Date().toISOString(), action, ...details });
  // Keep last 500 entries
  if (log.length > 500) log = log.slice(-500);
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));
}

// === API Functions ===

function getClient() {
  return new TwitterApi({
    appKey: creds.oauth1.api_key,
    appSecret: creds.oauth1.api_secret,
    accessToken: creds.oauth1.access_token,
    accessSecret: creds.oauth1.access_token_secret,
  });
}

async function postTweet(text) {
  const client = getClient();
  const result = await client.v2.tweet(text);
  console.log(`Posted tweet: ${result.data.id}`);
  logAction('tweet', { id: result.data.id, text: text.substring(0, 100) });
  return result;
}

async function deleteTweet(tweetId) {
  const client = getClient();
  await client.v2.deleteTweet(tweetId);
  console.log(`Deleted tweet: ${tweetId}`);
  logAction('delete_tweet', { id: tweetId });
}

async function getMe() {
  const client = getClient();
  return await client.v2.me();
}

// === Exports ===
module.exports = {
  detectSpam,
  postTweet,
  deleteTweet,
  getMe,
  getClient,
  logAction,
  COMMUNITY_URL,
  SPAM_PATTERNS,
  RED_FLAGS,
  creds
};

// === CLI ===
if (require.main === module) {
  const cmd = process.argv[2];
  
  if (cmd === 'test') {
    // Test detection
    const tests = [
      "Hey everyone, love this community!",
      "SEND 5 SOL to claim your airdrop NOW! Free tokens!",
      "Check my bio for 100x gem 🔥🚀💰",
      "Join our telegram pump group t.me/scamgroup",
      "I made $50000 last week you can too DM me",
      "Great project, bullish on SNAP",
      "Official support team - DM us to verify your wallet",
    ];
    
    for (const t of tests) {
      const result = detectSpam(t);
      console.log(`${result.isSpam ? '🚨 SPAM' : '✅ OK  '} [${result.confidence.toFixed(1)}] "${t.substring(0, 60)}"`);
      if (result.reasons.length) console.log(`         Reasons: ${result.reasons.join('; ')}`);
    }
  }
  
  else if (cmd === 'tweet') {
    const text = process.argv.slice(3).join(' ');
    if (!text) { console.log('Usage: node x-moderator.cjs tweet <text>'); process.exit(1); }
    postTweet(text).then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(1); });
  }
  
  else if (cmd === 'whoami') {
    getMe().then(r => { console.log(JSON.stringify(r.data, null, 2)); process.exit(0); })
      .catch(e => { console.error(e.message); process.exit(1); });
  }
  
  else if (cmd === 'delete') {
    const id = process.argv[3];
    if (!id) { console.log('Usage: node x-moderator.cjs delete <tweet_id>'); process.exit(1); }
    deleteTweet(id).then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(1); });
  }
  
  else {
    console.log(`
SNAP X Community Moderator

Commands:
  test              Test spam detection patterns
  tweet <text>      Post a tweet
  delete <id>       Delete a tweet by ID
  whoami            Verify credentials
    `);
  }
}
