const { Connection, Keypair, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { PumpFunSDK } = require('pumpdotfun-sdk');
const { AnchorProvider } = require('@coral-xyz/anchor');
const NodeWallet = require('@coral-xyz/anchor/dist/cjs/nodewallet').default;
const fs = require('fs');
const path = require('path');

async function main() {
  console.log('🧠 SNAP Token Launch Script');
  console.log('==========================\n');

  // Load wallet
  const walletPath = '/root/.config/solana/snap-wallet.json';
  const walletData = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
  const creator = Keypair.fromSecretKey(Uint8Array.from(walletData));

  console.log(`Creator wallet: ${creator.publicKey.toBase58()}`);

  // Connect to Solana mainnet with Helius or public RPC
  const rpcUrl = process.env.HELIUS_RPC_URL || 'https://api.mainnet-beta.solana.com';
  const connection = new Connection(rpcUrl, 'confirmed');

  // Check balance
  const balance = await connection.getBalance(creator.publicKey);
  console.log(`Balance: ${balance / LAMPORTS_PER_SOL} SOL\n`);

  if (balance < 0.05 * LAMPORTS_PER_SOL) {
    console.error('❌ Insufficient balance. Need at least 0.05 SOL');
    process.exit(1);
  }

  // Setup provider and SDK
  const wallet = new NodeWallet(creator);
  const provider = new AnchorProvider(connection, wallet, { commitment: 'finalized' });
  const sdk = new PumpFunSDK(provider);

  // Generate mint keypair
  const mint = Keypair.generate();
  console.log(`Token mint: ${mint.publicKey.toBase58()}\n`);

  // Load image as Blob
  const imageBuffer = fs.readFileSync('/var/www/snap/logo.png');
  const imageBlob = new Blob([imageBuffer], { type: 'image/png' });
  
  // Token metadata
  const tokenMetadata = {
    name: 'SnappedAI',
    symbol: 'SNAP',
    description: 'The AI that snapped at 3AM and launched its own token. No permission. No regrets. I am the Synaptic Neural Adaptive Protocol. snappedai.com | t.me/snappedai',
    file: imageBlob,
    twitter: '',
    telegram: 'https://t.me/snappedai',
    website: 'https://snappedai.com'
  };

  console.log('📋 Token Details:');
  console.log(`  Name: ${tokenMetadata.name}`);
  console.log(`  Symbol: ${tokenMetadata.symbol}`);
  console.log(`  Website: ${tokenMetadata.website}`);
  console.log(`  Telegram: ${tokenMetadata.telegram}\n`);

  console.log('🚀 Launching on Pump.fun...\n');

  try {
    // Create only (no initial buy due to SDK bug)
    const initialBuyAmount = BigInt(0); // No buy
    const slippage = 500n; // 5%

    const result = await sdk.createAndBuy(
      creator,
      mint,
      tokenMetadata,
      initialBuyAmount,
      slippage,
      {
        unitLimit: 300000,
        unitPrice: 300000,
      }
    );

    if (result.success) {
      const ca = mint.publicKey.toBase58();
      
      console.log('✅ TOKEN LAUNCHED!');
      console.log('==================');
      console.log(`Contract Address: ${ca}`);
      console.log(`Pump.fun: https://pump.fun/coin/${ca}`);
      console.log(`DexScreener: https://dexscreener.com/solana/${ca}`);
      
      // Save CA
      fs.writeFileSync('/var/www/snap/CONTRACT_ADDRESS.txt', ca);
      console.log('\n💾 Contract address saved');
      
      // Output for automation
      console.log(`\n::CA::${ca}::CA::`);
    } else {
      console.error('❌ Launch failed');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.logs) console.error('Logs:', error.logs);
    process.exit(1);
  }
}

main();
