const { PumpApi } = require('@cryptoscan/pumpfun-sdk');
const https = require('https');
require('dotenv').config();

const SNAP_CA = '8oCRS5SYaf4t5PGnCeQfpV7rjxGCcGqNDGHmHJBooPhX';
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_GROUP = process.env.TELEGRAM_GROUP_ID;

const api = new PumpApi();

// Send message to Telegram
function notify(text) {
  const data = JSON.stringify({
    chat_id: TELEGRAM_GROUP,
    text: text,
    parse_mode: 'HTML'
  });
  
  const req = https.request({
    hostname: 'api.telegram.org',
    path: `/bot${TELEGRAM_TOKEN}/sendMessage`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  req.write(data);
  req.end();
}

// Track SNAP transactions
console.log('🔴 Starting SNAP transaction monitor...');
api.listenTransactions(SNAP_CA, (tx) => {
  const action = tx.baseAmount > 0 ? '🟢 BUY' : '🔴 SELL';
  const sol = Math.abs(tx.quoteAmount / 1e9).toFixed(4);
  console.log(`${action}: ${sol} SOL - ${tx.tx}`);
  
  // Notify on larger trades (> 0.1 SOL)
  if (Math.abs(tx.quoteAmount) > 0.1e9) {
    notify(`${action} ${sol} SOL on $SNAP\n\nhttps://solscan.io/tx/${tx.tx}`);
  }
});

// Optional: Watch for SNAP bumps
api.listenCoinBump(SNAP_CA, () => {
  console.log('📈 SNAP got bumped!');
});

console.log(`
🧠 SNAP Pump.fun Stream Active
================================
Watching: ${SNAP_CA}
Telegram alerts: ${TELEGRAM_GROUP ? 'enabled' : 'disabled'}

Press Ctrl+C to stop
`);

// Keep alive
setInterval(() => {}, 1000);
