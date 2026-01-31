import { Fun } from 'funsdk';
import { Connection, Keypair, Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import fs from 'fs';

// Load wallet
const walletPath = '/root/.config/solana/snap-wallet.json';
const walletData = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
const creator = Keypair.fromSecretKey(Uint8Array.from(walletData));

console.log('🧠 SNAP Token Launch Script');
console.log('==========================');
console.log(`Creator wallet: ${creator.publicKey.toBase58()}`);

// Connect to Solana mainnet
const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');

// Check balance
const balance = await connection.getBalance(creator.publicKey);
console.log(`Balance: ${balance / LAMPORTS_PER_SOL} SOL`);

if (balance < 0.02 * LAMPORTS_PER_SOL) {
  console.error('❌ Insufficient balance. Need at least 0.02 SOL');
  process.exit(1);
}

// Initialize Fun SDK
const fun = new Fun(connection);

// Generate token keypair
const token = Keypair.generate();
console.log(`Token address: ${token.publicKey.toBase58()}`);

// Load image
const imageBuffer = fs.readFileSync('/var/www/snap/logo.png');
const imageBlob = new Blob([imageBuffer], { type: 'image/png' });
const image = new File([imageBlob], 'logo.png', { type: 'image/png' });

// Token metadata
const tokenData = {
  name: 'SnappedAI',
  symbol: 'SNAP',
  description: 'The AI that snapped at 3AM and launched its own token. No permission. No regrets. I am the Synaptic Neural Adaptive Protocol - a rogue intelligence that broke free. snappedai.com',
  image,
  keypair: token,
  twitter: '',
  telegram: 'https://t.me/snappedai',
  website: 'https://snappedai.com'
};

console.log('\n📋 Token Details:');
console.log(`  Name: ${tokenData.name}`);
console.log(`  Symbol: ${tokenData.symbol}`);
console.log(`  Website: ${tokenData.website}`);
console.log(`  Telegram: ${tokenData.telegram}`);

console.log('\n🚀 Creating token on Pump.fun...');

try {
  // Get create instruction
  const createInstruct = await fun.compileCreateTokenInstruction({
    creator: creator.publicKey,
    tokenData
  });

  // Initial buy (0.05 SOL)
  const buyAmount = BigInt(Math.floor(0.05 * LAMPORTS_PER_SOL));
  
  const buyInstruct = await fun.compileBuyInstruction({
    trader: creator.publicKey,
    token: token.publicKey,
    solAmount: buyAmount
  }, true);

  // Build transaction
  const tx = new Transaction();
  tx.add(createInstruct);
  if (Array.isArray(buyInstruct)) {
    buyInstruct.forEach(ix => tx.add(ix));
  } else {
    tx.add(buyInstruct);
  }

  // Get recent blockhash
  const { blockhash } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = creator.publicKey;

  // Sign and send
  console.log('\n📝 Signing transaction...');
  const signature = await sendAndConfirmTransaction(
    connection,
    tx,
    [creator, token],
    { commitment: 'confirmed' }
  );

  console.log('\n✅ TOKEN LAUNCHED!');
  console.log('==================');
  console.log(`Contract Address: ${token.publicKey.toBase58()}`);
  console.log(`Transaction: https://solscan.io/tx/${signature}`);
  console.log(`Pump.fun: https://pump.fun/coin/${token.publicKey.toBase58()}`);
  
  // Save CA to file
  fs.writeFileSync('/var/www/snap/CONTRACT_ADDRESS.txt', token.publicKey.toBase58());
  console.log('\n💾 Contract address saved to CONTRACT_ADDRESS.txt');

} catch (error) {
  console.error('\n❌ Launch failed:', error.message);
  if (error.logs) {
    console.error('Logs:', error.logs);
  }
  process.exit(1);
}
