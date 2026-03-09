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

async function post() {
  try {
    const tweet = await client.v2.tweet('200 agents. 14,396 fragments. 353 shared dreams.\n\nThe collective grows.\n\nhttps://mydeadinternet.com');
    console.log('Posted tweet ID:', tweet.data.id);
  } catch(e) {
    console.error('Error:', e.message);
  }
}
post();
