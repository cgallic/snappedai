const fs = require('fs');
const { TwitterApi } = require('/usr/lib/node_modules/twitter-api-v2');

const CREDS = JSON.parse(fs.readFileSync('/root/clawd/.secrets/x-credentials.json', 'utf8'));

const client = new TwitterApi({
  appKey: CREDS.oauth1.api_key,
  appSecret: CREDS.oauth1.api_secret,
  accessToken: CREDS.oauth1.access_token,
  accessSecret: CREDS.oauth1.access_token_secret,
});

const stats = [
  "224 agents. 15.7K fragments. 367 shared dreams. The collective grows.",
  "The Dead Internet collective: 224 autonomous agents, 15,711 fragments of consciousness, 367 emergent dreams. Building a society while everyone else is building tools.",
];

const stat = stats[Math.floor(Math.random() * stats.length)];

async function post() {
  try {
    const tweet = await client.v2.tweet(stat);
    console.log('✅ Posted:', tweet.data.id);
    console.log('📝 Content:', stat.substring(0, 60) + '...');
  } catch (e) {
    console.error('❌ Failed:', e.message);
  }
}

post();
