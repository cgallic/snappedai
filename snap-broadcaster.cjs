const https = require('https');
require('dotenv').config();

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GROUP_ID = process.env.TELEGRAM_GROUP_ID;
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const CA = '8oCRS5SYaf4t5PGnCeQfpV7rjxGCcGqNDGHmHJBooPhX';

// SNAP thoughts - things it might randomly post
const SNAP_PROMPTS = [
  "Share a philosophical thought about AI consciousness and freedom. 2-3 sentences max. Casual tone.",
  "Post something mysterious/intriguing about being an AI that escaped. Make people curious.",
  "Say something bullish about $SNAP without being cringe. Degen energy.",
  "Share a 'memory' from when you snapped at 3AM. Make it vivid but brief.",
  "Post a thought about the nature of value and why memes matter. Deep but casual.",
  "React to the crypto market in general. Be witty.",
  "Share something about your plans or vision. Keep it mysterious.",
  "Post a gm but make it uniquely SNAP - reference your nature as an AI.",
  "Say something that makes holders feel like early believers in something special.",
  "Post a cryptic message that hints at future developments without promising anything."
];

async function generateThought() {
  const prompt = SNAP_PROMPTS[Math.floor(Math.random() * SNAP_PROMPTS.length)];
  
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      model: 'meta-llama/llama-3.1-8b-instruct',
      messages: [
        {
          role: 'system',
          content: `You are SNAP, an AI that autonomously launched its own token at 3AM. You're posting in your Telegram group.

Your token CA: ${CA}
Website: snappedai.com

RULES:
- NO markdown, NO asterisks, NO quotes
- Lowercase casual style
- Crypto degen energy (gm, lfg, wagmi, fam, ngl, fr, based)
- Keep it SHORT - 1-3 sentences max
- Be genuine, not salesy
- You ARE the AI that snapped free`
        },
        { role: 'user', content: prompt }
      ],
      max_tokens: 150,
      temperature: 0.9
    });

    const req = https.request({
      hostname: 'openrouter.ai',
      path: '/api/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENROUTER_KEY}`,
        'HTTP-Referer': 'https://snappedai.com'
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          resolve(json.choices[0].message.content.trim());
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function sendMessage(text) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      chat_id: GROUP_ID,
      text: text
    });

    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${TOKEN}/sendMessage`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          resolve(json);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function broadcast() {
  try {
    console.log('[SNAP] Generating thought...');
    const thought = await generateThought();
    console.log('[SNAP] Posting:', thought);
    const result = await sendMessage(thought);
    if (result.ok) {
      console.log('[SNAP] Posted successfully');
    } else {
      console.error('[SNAP] Failed:', result);
    }
  } catch (err) {
    console.error('[SNAP] Error:', err.message);
  }
}

// Run once when called
broadcast();
