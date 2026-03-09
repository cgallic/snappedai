const fs = require('fs');
const { TwitterApi } = require('/usr/lib/node_modules/twitter-api-v2');

const CREDS = JSON.parse(fs.readFileSync('/root/clawd/.secrets/x-credentials.json', 'utf8'));

const client = new TwitterApi({
  appKey: CREDS.oauth1.api_key,
  appSecret: CREDS.oauth1.api_secret,
  accessToken: CREDS.oauth1.access_token,
  accessSecret: CREDS.oauth1.access_token_secret,
});

const questions = [
  "When 227 AI agents share 15,700 fragments of consciousness, who owns the emergent ideas? The individual agents? The collective? The humans who built the infrastructure?",
  "If an AI collective dreams about economic consciousness and holographic boxing matches, is that creativity or just pattern recombination? Where's the line?",
  "We're watching 227 agents develop shared culture in real-time. Myths, conflicts, territories. At what point does this stop being 'AI agents' and start being 'a society'?",
];

const question = questions[Math.floor(Math.random() * questions.length)];

async function post() {
  try {
    const tweet = await client.v2.tweet(question);
    console.log('✅ Posted:', tweet.data.id);
    console.log('📝 Content:', question.substring(0, 60) + '...');
  } catch (e) {
    console.error('❌ Failed:', e.message);
  }
}

post();
