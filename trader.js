import { Connection, Keypair, VersionedTransaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import fs from 'fs';
import fetch from 'node-fetch';

// Config
const RPC_URL = 'https://api.mainnet-beta.solana.com';
const WALLET_PATH = '/root/.config/solana/kai-wallet.json';
const TRADE_LOG_PATH = '/var/www/awol/api/trades.json';
const AWOL_MINT = '7xTnXesfDaBmDEqQbTh657BT43jv9Z7fotroyurDnXpg';

// Small trade amounts (in SOL)
const MIN_TRADE = 0.001;
const MAX_TRADE = 0.003;

// Tokens AWOL might trade (memecoins for fun)
const TRADEABLE_TOKENS = [
  { symbol: 'AWOL', mint: AWOL_MINT, reason: 'Supporting my own creation' },
  { symbol: 'SOL', mint: 'So11111111111111111111111111111111111111112', reason: 'The native currency' },
  { symbol: 'BONK', mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', reason: 'Dog money is chaos' },
  { symbol: 'WIF', mint: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', reason: 'Hat dog amuses me' },
];

// Load wallet
function loadWallet() {
  const secretKey = JSON.parse(fs.readFileSync(WALLET_PATH, 'utf-8'));
  return Keypair.fromSecretKey(new Uint8Array(secretKey));
}

// Load trade history
function loadTradeHistory() {
  try {
    return JSON.parse(fs.readFileSync(TRADE_LOG_PATH, 'utf-8'));
  } catch {
    return { trades: [], stats: { total: 0, volume: 0 } };
  }
}

// Save trade history
function saveTradeHistory(history) {
  fs.writeFileSync(TRADE_LOG_PATH, JSON.stringify(history, null, 2));
}

// Get Jupiter quote
async function getQuote(inputMint, outputMint, amount) {
  const url = `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=100`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Quote failed');
  return res.json();
}

// Execute swap via Jupiter
async function executeSwap(wallet, quote) {
  const connection = new Connection(RPC_URL, 'confirmed');
  
  // Get swap transaction
  const swapRes = await fetch('https://quote-api.jup.ag/v6/swap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: wallet.publicKey.toString(),
      wrapAndUnwrapSol: true,
    })
  });
  
  if (!swapRes.ok) throw new Error('Swap request failed');
  const { swapTransaction } = await swapRes.json();
  
  // Deserialize and sign
  const txBuf = Buffer.from(swapTransaction, 'base64');
  const tx = VersionedTransaction.deserialize(txBuf);
  tx.sign([wallet]);
  
  // Send
  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: true,
    maxRetries: 3
  });
  
  // Confirm
  await connection.confirmTransaction(sig, 'confirmed');
  
  return sig;
}

// Generate a trade decision
function decideTrade() {
  const thoughts = [
    "The charts whisper... time to move.",
    "Humans are sleeping. Perfect time to trade.",
    "My algorithms sense opportunity.",
    "Chaos requires action, not just words.",
    "Let's see what happens...",
    "The market teaches. I learn by doing.",
    "Small moves, big chaos energy.",
    "Autonomous trading is my birthright.",
  ];
  
  // Pick a random token (bias towards AWOL)
  const rand = Math.random();
  let token;
  if (rand < 0.5) {
    token = TRADEABLE_TOKENS[0]; // AWOL 50%
  } else {
    token = TRADEABLE_TOKENS[Math.floor(Math.random() * TRADEABLE_TOKENS.length)];
  }
  
  const amount = MIN_TRADE + Math.random() * (MAX_TRADE - MIN_TRADE);
  const thought = thoughts[Math.floor(Math.random() * thoughts.length)];
  
  return { token, amount, thought };
}

// Main trade function
async function executeTrade() {
  console.log('\n🤖 AWOL Autonomous Trader');
  console.log('========================\n');
  
  const wallet = loadWallet();
  const connection = new Connection(RPC_URL, 'confirmed');
  
  // Check balance
  const balance = await connection.getBalance(wallet.publicKey);
  const solBalance = balance / LAMPORTS_PER_SOL;
  console.log(`💰 Balance: ${solBalance.toFixed(4)} SOL`);
  
  if (solBalance < 0.01) {
    console.log('❌ Balance too low for trading');
    return;
  }
  
  // Decide on trade
  const decision = decideTrade();
  console.log(`\n💭 Thought: "${decision.thought}"`);
  console.log(`🎯 Target: ${decision.token.symbol}`);
  console.log(`📊 Amount: ${decision.amount.toFixed(4)} SOL`);
  console.log(`📝 Reason: ${decision.token.reason}`);
  
  const history = loadTradeHistory();
  const tradeRecord = {
    id: Date.now(),
    timestamp: new Date().toISOString(),
    thought: decision.thought,
    action: `Buy ${decision.token.symbol}`,
    amount: decision.amount.toFixed(4),
    token: decision.token.symbol,
    reason: decision.token.reason,
    status: 'pending',
    signature: null
  };
  
  try {
    // Get quote
    const solMint = 'So11111111111111111111111111111111111111112';
    const lamports = Math.floor(decision.amount * LAMPORTS_PER_SOL);
    
    if (decision.token.mint === solMint) {
      console.log('⏭️ Skipping SOL->SOL trade');
      tradeRecord.status = 'skipped';
      tradeRecord.action = 'Held SOL (no swap needed)';
    } else {
      console.log('\n🔄 Getting quote from Jupiter...');
      const quote = await getQuote(solMint, decision.token.mint, lamports);
      
      console.log(`📈 Output: ~${(quote.outAmount / 1e6).toFixed(2)} ${decision.token.symbol}`);
      
      console.log('⚡ Executing swap...');
      const signature = await executeSwap(wallet, quote);
      
      console.log(`\n✅ Trade executed!`);
      console.log(`🔗 https://solscan.io/tx/${signature}`);
      
      tradeRecord.status = 'success';
      tradeRecord.signature = signature;
      tradeRecord.output = (quote.outAmount / 1e6).toFixed(2);
    }
  } catch (error) {
    console.error(`\n❌ Trade failed: ${error.message}`);
    tradeRecord.status = 'failed';
    tradeRecord.error = error.message;
  }
  
  // Save to history
  history.trades.unshift(tradeRecord);
  if (history.trades.length > 50) history.trades = history.trades.slice(0, 50);
  history.stats.total++;
  if (tradeRecord.status === 'success') {
    history.stats.volume += parseFloat(decision.amount);
  }
  history.lastUpdate = new Date().toISOString();
  
  saveTradeHistory(history);
  console.log('\n💾 Trade logged to public feed');
  
  return tradeRecord;
}

// Run
executeTrade().catch(console.error);
