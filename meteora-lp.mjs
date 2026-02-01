#!/usr/bin/env node
/**
 * Meteora DLMM LP Script for SNAP/USDC
 * Steps:
 * 1. Swap ~12.8 SOL → USDC via Jupiter
 * 2. Create SNAP/USDC pool on Meteora DLMM
 * 3. Add liquidity (balanced position)
 */

import { Connection, Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { readFileSync } from 'fs';
import BN from 'bn.js';

const RPC = 'https://api.mainnet-beta.solana.com';
const connection = new Connection(RPC, 'confirmed');

// Load wallet
const walletData = JSON.parse(readFileSync('/root/.config/solana/snap-wallet.json', 'utf-8'));
const wallet = Keypair.fromSecretKey(new Uint8Array(walletData));
console.log('Wallet:', wallet.publicKey.toBase58());

// Token mints
const SNAP_MINT = '8oCRS5SYaf4t5PGnCeQfpV7rjxGCcGqNDGHmHJBooPhX';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL_MINT = 'So11111111111111111111111111111111111111112';

// ---- STEP 1: Swap SOL → USDC via Jupiter ----
async function swapSolToUsdc(amountSol) {
  const lamports = Math.floor(amountSol * 1e9);
  console.log(`\n📊 Swapping ${amountSol} SOL → USDC...`);

  // Get quote
  const quoteUrl = `https://lite-api.jup.ag/swap/v1/quote?inputMint=${SOL_MINT}&outputMint=${USDC_MINT}&amount=${lamports}&slippageBps=100`;
  const quoteRes = await fetch(quoteUrl);
  const quote = await quoteRes.json();
  
  if (quote.error) {
    console.error('Quote error:', quote.error);
    return null;
  }
  
  const usdcOut = Number(quote.outAmount) / 1e6;
  console.log(`  Quote: ${amountSol} SOL → ${usdcOut.toFixed(2)} USDC`);

  // Get swap transaction
  const swapRes = await fetch('https://lite-api.jup.ag/swap/v1/swap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: wallet.publicKey.toBase58(),
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 'auto'
    })
  });
  const swapData = await swapRes.json();
  
  if (swapData.error) {
    console.error('Swap error:', swapData.error);
    return null;
  }

  // Sign and send
  const txBuf = Buffer.from(swapData.swapTransaction, 'base64');
  const tx = VersionedTransaction.deserialize(txBuf);
  tx.sign([wallet]);
  
  console.log('  Sending swap transaction...');
  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: true,
    maxRetries: 3
  });
  console.log(`  TX: https://solscan.io/tx/${sig}`);
  
  // Wait for confirmation
  const confirm = await connection.confirmTransaction(sig, 'confirmed');
  if (confirm.value.err) {
    console.error('  Swap failed:', confirm.value.err);
    return null;
  }
  
  console.log(`  ✅ Swapped ${amountSol} SOL → ~${usdcOut.toFixed(2)} USDC`);
  return usdcOut;
}

// ---- STEP 2: Create Meteora DLMM Pool ----
async function createMeteoraPool() {
  // Import DLMM SDK
  const { default: DLMM } = await import('@meteora-ag/dlmm');
  
  // Check if SNAP/USDC pool already exists
  const snapMint = new PublicKey(SNAP_MINT);
  const usdcMint = new PublicKey(USDC_MINT);
  
  console.log('\n🏊 Creating Meteora DLMM pool for SNAP/USDC...');
  
  // Try to find existing pool first
  try {
    const pairs = await DLMM.DLMM.getAllLbPairPositionsByUser(connection, wallet.publicKey);
    console.log('  Existing positions:', pairs.size);
  } catch(e) {
    console.log('  No existing positions');
  }

  // Create new pool
  // bin_step 100 = 1% price movement per bin (good for volatile tokens)
  const binStep = 100;
  
  // Current SNAP price in USDC
  const snapPrice = 0.0001185; // from DexScreener
  
  // Calculate active bin ID from price
  // Meteora: price = (1 + binStep/10000) ^ (binId - offset)
  // For SNAP/USDC with bin_step=100: each bin is 1% apart
  const pricePerLamport = snapPrice * (10 ** 6) / (10 ** 6); // SNAP 6 decimals, USDC 6 decimals
  
  try {
    // Use the DLMM createLbPair method
    const createPoolTx = await DLMM.DLMM.createPermissionlessLbPair(
      connection,
      new BN(binStep),
      snapMint,
      usdcMint,
      // Active bin ID will be calculated from price
      new BN(0), // active ID placeholder
      wallet.publicKey
    );
    
    console.log('  Pool creation tx built, sending...');
    // This is complex - might need to use Meteora's UI instead
    
  } catch(e) {
    console.log('  SDK create error:', e.message);
    console.log('\n⚠️  Creating DLMM pools programmatically is complex.');
    console.log('  Recommend using Meteora UI: https://app.meteora.ag/dlmm/create');
    console.log('  Or their standard AMM which is simpler.');
  }
}

// ---- MAIN ----
async function main() {
  console.log('=== Meteora LP Script ===');
  console.log(`Wallet: ${wallet.publicKey.toBase58()}`);
  
  // Check balances
  const solBal = await connection.getBalance(wallet.publicKey);
  console.log(`SOL balance: ${(solBal / 1e9).toFixed(4)} SOL`);
  
  // Check SNAP balance
  const snapAccounts = await connection.getTokenAccountsByOwner(wallet.publicKey, {
    mint: new PublicKey(SNAP_MINT)
  });
  
  if (snapAccounts.value.length > 0) {
    const snapInfo = await connection.getTokenAccountBalance(snapAccounts.value[0].pubkey);
    console.log(`SNAP balance: ${Number(snapInfo.value.uiAmount).toLocaleString()} SNAP`);
  }
  
  const mode = process.argv[2] || 'check';
  
  if (mode === 'swap') {
    // Swap 12.8 SOL keeping 1 for gas
    const swapAmount = Math.floor((solBal / 1e9 - 1) * 10) / 10; // Leave 1 SOL, round down
    console.log(`\nSwapping ${swapAmount} SOL → USDC (keeping 1 SOL for gas)`);
    await swapSolToUsdc(swapAmount);
  } else if (mode === 'pool') {
    await createMeteoraPool();
  } else {
    console.log('\nUsage:');
    console.log('  node meteora-lp.mjs check  - Check balances');
    console.log('  node meteora-lp.mjs swap   - Swap SOL → USDC');
    console.log('  node meteora-lp.mjs pool   - Create pool + add LP');
  }
}

main().catch(console.error);
