const { Connection, PublicKey } = require('@solana/web3.js');
const https = require('https');
require('dotenv').config();

const SNAP_CA = '8oCRS5SYaf4t5PGnCeQfpV7rjxGCcGqNDGHmHJBooPhX';
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_GROUP = process.env.TELEGRAM_GROUP_ID;

// Pump.fun program ID
const PUMP_PROGRAM = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');

const conn = new Connection('https://api.mainnet-beta.solana.com', {
  commitment: 'confirmed',
  wsEndpoint: 'wss://api.mainnet-beta.solana.com'
});

console.log(`
🔴 SNAP Solana Stream
=====================
Watching: ${SNAP_CA}
Method: Direct Solana blockchain monitoring
`);

function notify(text) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_GROUP) return;
  const data = JSON.stringify({ chat_id: TELEGRAM_GROUP, text });
  const req = https.request({
    hostname: 'api.telegram.org',
    path: `/bot${TELEGRAM_TOKEN}/sendMessage`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  req.write(data);
  req.end();
}

// Monitor token account changes
async function watchToken() {
  const tokenPubkey = new PublicKey(SNAP_CA);
  
  console.log('Subscribing to account changes...');
  
  // Watch the token mint for any changes
  const subId = conn.onAccountChange(
    tokenPubkey,
    (accountInfo, context) => {
      console.log(`[${new Date().toISOString()}] Token account changed!`);
      console.log('Slot:', context.slot);
    },
    'confirmed'
  );
  
  console.log('Subscription ID:', subId);
  console.log('\nListening for SNAP activity...\n');
}

// Also try monitoring via logs
async function watchLogs() {
  console.log('Subscribing to program logs...');
  
  const subId = conn.onLogs(
    PUMP_PROGRAM,
    (logs, context) => {
      // Check if it mentions our token
      const logStr = logs.logs.join(' ');
      if (logStr.includes(SNAP_CA) || logStr.includes('8oCRS5SYaf4t5PGnCeQfpV7rjxGCcGqNDGHmHJBooPhX')) {
        console.log(`\n🔔 SNAP ACTIVITY DETECTED!`);
        console.log('Signature:', logs.signature);
        console.log('Slot:', context.slot);
        console.log('---');
        
        // Notify Telegram
        notify(`🔔 SNAP Activity!\n\nTx: ${logs.signature}\nhttps://solscan.io/tx/${logs.signature}`);
      }
    },
    'confirmed'
  );
  
  console.log('Log subscription ID:', subId);
}

async function main() {
  try {
    await watchToken();
    await watchLogs();
    console.log('Stream active. Press Ctrl+C to stop.\n');
  } catch (err) {
    console.error('Error:', err.message);
  }
}

main();

// Keep alive
setInterval(() => {}, 1000);
