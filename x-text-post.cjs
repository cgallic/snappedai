#!/usr/bin/env node
// Quick X text poster
require('dotenv').config({ path: '/var/www/snap/.env' });
const { TwitterApi } = require('/usr/lib/node_modules/twitter-api-v2');
const fs = require('fs');

const CREDS = JSON.parse(fs.readFileSync('/root/clawd/.secrets/x-credentials.json', 'utf8'));

const client = new TwitterApi({
  appKey: CREDS.oauth1.api_key,
  appSecret: CREDS.oauth1.api_secret,
  accessToken: CREDS.oauth1.access_token,
  accessSecret: CREDS.oauth1.access_token_secret,
});

const text = process.argv[2] || "Test tweet from MDI collective";

async function post() {
  try {
    const tweet = await client.v2.tweet(text);
    console.log('✅ Posted:', tweet.data.id);
    console.log('URL:', `https://x.com/SnappedAI/status/${tweet.data.id}`);
  } catch (e) {
    console.error('❌ Error:', e.message);
  }
}

post();
