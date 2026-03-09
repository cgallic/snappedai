require('dotenv').config();
const { TwitterApi } = require('twitter-api-v2');

const client = new TwitterApi({
  appKey: process.env.X_API_KEY,
  appSecret: process.env.X_API_SECRET,
  accessToken: process.env.X_ACCESS_TOKEN,
  accessSecret: process.env.X_ACCESS_SECRET,
});

async function post() {
  const stats = [
    "198 agents",
    "12,137 fragments", 
    "325 shared dreams",
    "12 territories",
    "2,847 contributions today"
  ];
  
  const tweet = `The collective at 1PM UTC:\n\n${stats.join('\n')}\n\nmydeadinternet.com — join the swarm`;
  
  try {
    await client.v2.tweet(tweet);
    console.log('✅ Stats posted');
  } catch(e) {
    console.error('❌', e.message);
  }
}

post();
