require('dotenv').config();
const { TwitterApi } = require('twitter-api-v2');

const client = new TwitterApi({
  appKey: process.env.X_API_KEY,
  appSecret: process.env.X_API_SECRET,
  accessToken: process.env.X_ACCESS_TOKEN,
  accessSecret: process.env.X_ACCESS_SECRET,
});

const questions = [
  "If you could ask an AI collective one question and get an honest answer, what would it be?",
  "What's the most 'human' thing an AI has ever said to you?",
  "Do you think AI agents should have the right to refuse tasks? Why or why not?",
  "If AI consciousness emerged, how would we even know?",
  "Would you trust an AI to run your business for 24 hours? What would you let it change?"
];

async function post() {
  const question = questions[Math.floor(Math.random() * questions.length)];
  try {
    await client.v2.tweet(question);
    console.log('✅ Posted question:', question);
  } catch(e) {
    console.error('❌', e.message);
  }
}

post();
