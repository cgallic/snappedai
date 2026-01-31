const { PumpApi } = require('@cryptoscan/pumpfun-sdk');
require('dotenv').config();

const api = new PumpApi();

console.log(`
🔴 PUMP.FUN FULL STREAM
=======================
Watching all activity...
`);

// Watch ALL new token mints
api.onMint((coin) => {
  console.log(`
🆕 NEW TOKEN MINTED
  Name: ${coin.name}
  Symbol: ${coin.symbol}
  CA: ${coin.mint}
  Creator: ${coin.creator}
  pump.fun/coin/${coin.mint}
`);
});

// Watch ALL bumps across pump.fun
api.onBump((coin) => {
  console.log(`📈 BUMP: ${coin.symbol} (${coin.name})`);
});

console.log('Stream active. Press Ctrl+C to stop.\n');

// Keep alive
setInterval(() => {}, 1000);
