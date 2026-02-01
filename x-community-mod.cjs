#!/usr/bin/env node
/**
 * SNAP X Community Moderator — API-based
 * Scans community posts, detects spam, blocks/reports bad actors
 * 
 * Usage:
 *   node x-community-mod.cjs scan      — Scan and report findings
 *   node x-community-mod.cjs moderate  — Scan + block spam accounts
 *   node x-community-mod.cjs cron      — Silent scan, only output if spam found
 */

require('dotenv').config();
const { TwitterApi } = require('/usr/lib/node_modules/twitter-api-v2');
const fs = require('fs');

const CREDS = JSON.parse(fs.readFileSync('/root/clawd/.secrets/x-credentials.json', 'utf8'));
const COMMUNITY_ID = '2017343083680043029';
const OUR_ID = '2017568276633559040';
const DATA_DIR = '/var/www/snap/data';
const LOG_FILE = `${DATA_DIR}/x-mod-log.json`;
const STATE_FILE = `${DATA_DIR}/x-mod-state.json`;

// Spam patterns
const SPAM_PATTERNS = [
  /send\s+\d+\s*(sol|eth|btc|usdt)/i,
  /airdrop.*claim.*now/i,
  /free\s+(crypto|tokens?|nft|mint)/i,
  /guaranteed\s+\d+x/i,
  /dm\s+me\s+(for|to)\s+(invest|trade|profit)/i,
  /join.*telegram.*pump/i,
  /click\s+(here|this)\s+link.*wallet/i,
  /connect\s+wallet.*claim/i,
  /verify\s+your\s+wallet/i,
  /make\s+\$\d{4,}.*per\s+(day|week|month)/i,
  /i\s+made\s+\$\d{4,}.*you\s+can\s+too/i,
  /passive\s+income.*guaranteed/i,
  /official\s+(support|admin|team)/i,
  /customer\s+service.*dm/i,
  /onlyfans.*link/i,
  /check\s+(my|the)\s+(bio|profile|pin).*link/i,
  /100x\s+gem/i,
  /presale.*hurry/i,
  /work\s+from\s+home.*\$\d{3,}/i,
];

const RED_FLAGS = [
  /t\.me\//i,
  /bit\.ly|tinyurl|shorturl/i,
  /whatsapp.*group/i,
  /\+\d{10,}/,
];

function getClient() {
  return new TwitterApi({
    appKey: CREDS.oauth1.api_key,
    appSecret: CREDS.oauth1.api_secret,
    accessToken: CREDS.oauth1.access_token,
    accessSecret: CREDS.oauth1.access_token_secret,
  });
}

function detectSpam(text) {
  const reasons = [];
  for (const p of SPAM_PATTERNS) {
    if (p.test(text)) reasons.push(p.source.substring(0, 40));
  }
  let flags = 0;
  for (const f of RED_FLAGS) if (f.test(text)) flags++;
  if (flags >= 2) reasons.push(`red_flags:${flags}`);
  return { isSpam: reasons.length > 0, confidence: Math.min(reasons.length / 3, 1), reasons };
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return { lastScanId: null, blockedUsers: [], scansRun: 0 }; }
}

function saveState(state) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function log(entry) {
  let logs = [];
  try { logs = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8')); } catch {}
  logs.push({ ts: new Date().toISOString(), ...entry });
  if (logs.length > 500) logs = logs.slice(-500);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2));
}

async function scanCommunity(client, state) {
  const results = { posts: [], spam: [], errors: [] };

  // 1. Search for tweets mentioning/linking the community
  try {
    const params = {
      max_results: 20,
      'tweet.fields': 'author_id,created_at,text,conversation_id',
      'user.fields': 'username,name,created_at,public_metrics',
      expansions: 'author_id',
    };
    if (state.lastScanId) params.since_id = state.lastScanId;

    const search = await client.v2.search(
      `url:"communities/${COMMUNITY_ID}" OR "SNAPPED AI" community`,
      params
    );

    const users = {};
    if (search.includes?.users) {
      for (const u of search.includes.users) users[u.id] = u;
    }

    for (const tweet of search.data?.data || []) {
      if (tweet.author_id === OUR_ID) continue; // skip our own
      const user = users[tweet.author_id] || {};
      const post = {
        id: tweet.id,
        text: tweet.text,
        authorId: tweet.author_id,
        username: user.username || 'unknown',
        createdAt: tweet.created_at,
        userCreatedAt: user.created_at,
        followers: user.public_metrics?.followers_count || 0,
      };
      results.posts.push(post);

      const spam = detectSpam(tweet.text);
      if (spam.isSpam) {
        // New accounts with < 10 followers are higher risk
        if (post.followers < 10) spam.confidence = Math.min(spam.confidence + 0.2, 1);
        results.spam.push({ ...post, ...spam });
      }
    }

    // Update last seen ID
    if (search.data?.meta?.newest_id) {
      state.lastScanId = search.data.meta.newest_id;
    }
  } catch (e) {
    results.errors.push(`search: ${e.message}`);
  }

  // 2. Check mentions/replies to our account
  try {
    const mentions = await client.v2.userMentionTimeline(OUR_ID, {
      max_results: 10,
      'tweet.fields': 'author_id,created_at,text',
      'user.fields': 'username',
      expansions: 'author_id',
    });

    const users = {};
    if (mentions.includes?.users) {
      for (const u of mentions.includes.users) users[u.id] = u;
    }

    for (const tweet of mentions.data?.data || []) {
      if (tweet.author_id === OUR_ID) continue;
      const spam = detectSpam(tweet.text);
      if (spam.isSpam) {
        const user = users[tweet.author_id] || {};
        results.spam.push({
          id: tweet.id,
          text: tweet.text,
          authorId: tweet.author_id,
          username: user.username || 'unknown',
          source: 'mention',
          ...spam,
        });
      }
    }
  } catch (e) {
    results.errors.push(`mentions: ${e.message}`);
  }

  return results;
}

async function takeAction(client, spamPost, state, dryRun = false) {
  const actions = [];

  // Skip if already blocked
  if (state.blockedUsers.includes(spamPost.authorId)) {
    return ['already_blocked'];
  }

  if (dryRun) return ['would_block', 'would_mute'];

  // Block the spammer
  try {
    await client.v2.block(OUR_ID, spamPost.authorId);
    actions.push('blocked');
    state.blockedUsers.push(spamPost.authorId);
  } catch (e) {
    actions.push(`block_error: ${e.message}`);
  }

  // Mute too
  try {
    await client.v2.mute(OUR_ID, spamPost.authorId);
    actions.push('muted');
  } catch (e) {
    actions.push(`mute_error: ${e.message}`);
  }

  return actions;
}

async function run(mode = 'scan') {
  const client = getClient();
  const state = loadState();
  state.scansRun = (state.scansRun || 0) + 1;

  const isSilent = mode === 'cron';
  const doAction = mode === 'moderate';

  if (!isSilent) console.log(`[x-mod] Scanning community (run #${state.scansRun})...`);

  const results = await scanCommunity(client, state);

  if (!isSilent) {
    console.log(`[x-mod] Found ${results.posts.length} posts, ${results.spam.length} spam`);
    if (results.errors.length) console.log(`[x-mod] Errors: ${results.errors.join(', ')}`);
  }

  // Process spam
  const actionsTaken = [];
  for (const post of results.spam) {
    if (!isSilent) {
      console.log(`🚨 @${post.username} [${post.confidence.toFixed(1)}]: "${post.text.substring(0, 80)}"`);
      console.log(`   Reasons: ${post.reasons.join(', ')}`);
    }

    if (doAction && post.confidence >= 0.3) {
      const actions = await takeAction(client, post, state);
      actionsTaken.push({ user: post.username, actions });
      if (!isSilent) console.log(`   Actions: ${actions.join(', ')}`);
    }
  }

  // Save state
  saveState(state);

  // Log
  log({
    mode,
    posts: results.posts.length,
    spam: results.spam.length,
    actions: actionsTaken.length,
    errors: results.errors,
  });

  // For cron mode, only output if spam found
  if (isSilent && results.spam.length > 0) {
    const summary = results.spam.map(s => `@${s.username}: "${s.text.substring(0, 60)}"`).join('\n');
    console.log(`🚨 ${results.spam.length} spam posts detected in SNAP X community:\n${summary}`);
  }

  if (!isSilent && results.spam.length === 0) {
    console.log('✅ Community is clean!');
  }

  return {
    posts: results.posts.length,
    spam: results.spam.length,
    actioned: actionsTaken.length,
    errors: results.errors,
    spamDetails: results.spam,
  };
}

if (require.main === module) {
  const mode = process.argv[2] || 'scan';
  run(mode).then(r => {
    if (mode !== 'cron') console.log('\n[x-mod] Done:', JSON.stringify({ posts: r.posts, spam: r.spam, actioned: r.actioned }));
  }).catch(e => { console.error('[x-mod] Fatal:', e.message); process.exit(1); });
}

module.exports = { run, detectSpam, getClient };
