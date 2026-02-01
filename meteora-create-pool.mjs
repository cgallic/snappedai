#!/usr/bin/env node
/**
 * Create SNAP/USDC DLMM Pool on Meteora and add liquidity
 */

import { Connection, Keypair, PublicKey, sendAndConfirmTransaction } from '@solana/web3.js';
import { readFileSync } from 'fs';
import BN from 'bn.js';

const RPC = 'https://api.mainnet-beta.solana.com';
const connection = new Connection(RPC, 'confirmed');

// Load wallet
const walletData = JSON.parse(readFileSync('/root/.config/solana/snap-wallet.json', 'utf-8'));
const wallet = Keypair.fromSecretKey(new Uint8Array(walletData));

const SNAP_MINT = new PublicKey('8oCRS5SYaf4t5PGnCeQfpV7rjxGCcGqNDGHmHJBooPhX');
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

async function main() {
  console.log('=== Meteora SNAP/USDC Pool Creator ===');
  console.log('Wallet:', wallet.publicKey.toBase58());
  
  // Import DLMM
  const DLMM_mod = await import('@meteora-ag/dlmm');
  const DLMM = DLMM_mod.default || DLMM_mod.DLMM;
  const { StrategyType, ActivationType } = DLMM_mod;
  
  console.log('DLMM imported:', typeof DLMM);
  console.log('Available exports:', Object.keys(DLMM_mod));
  
  // Check balances
  const solBal = await connection.getBalance(wallet.publicKey);
  console.log(`SOL: ${(solBal / 1e9).toFixed(4)}`);
  
  // USDC balance
  const usdcAccounts = await connection.getTokenAccountsByOwner(wallet.publicKey, { mint: USDC_MINT });
  let usdcBalance = 0;
  if (usdcAccounts.value.length > 0) {
    const bal = await connection.getTokenAccountBalance(usdcAccounts.value[0].pubkey);
    usdcBalance = Number(bal.value.uiAmount);
    console.log(`USDC: ${usdcBalance.toFixed(2)}`);
  }
  
  // SNAP balance
  const snapAccounts = await connection.getTokenAccountsByOwner(wallet.publicKey, { mint: SNAP_MINT });
  let snapBalance = 0;
  if (snapAccounts.value.length > 0) {
    const bal = await connection.getTokenAccountBalance(snapAccounts.value[0].pubkey);
    snapBalance = Number(bal.value.uiAmount);
    console.log(`SNAP: ${snapBalance.toLocaleString()}`);
  }
  
  // SNAP price
  const snapPrice = 0.0001185; // from DexScreener
  
  // Calculate how much SNAP matches our USDC
  // We want balanced: $X USDC + $X worth of SNAP
  // usdcBalance USDC = snapForLP SNAP * snapPrice
  const snapForLP = usdcBalance / snapPrice;
  console.log(`\nLP Plan:`);
  console.log(`  USDC side: ${usdcBalance.toFixed(2)} USDC`);
  console.log(`  SNAP side: ${snapForLP.toLocaleString(undefined, {maximumFractionDigits: 0})} SNAP (~$${(snapForLP * snapPrice).toFixed(2)})`);
  console.log(`  Total LP value: ~$${(usdcBalance * 2).toFixed(2)}`);
  
  if (snapForLP > snapBalance) {
    console.log(`\n⚠️  Not enough SNAP! Need ${snapForLP.toLocaleString()} but only have ${snapBalance.toLocaleString()}`);
    return;
  }
  
  // Step 1: Create the pool
  // For DLMM, we need to calculate the active bin ID from the price
  // bin_step = 100 means each bin is 1% apart
  // Price = (1 + binStep/10000) ^ (activeBinId - 8388608)
  // So: activeBinId = 8388608 + log(price) / log(1 + binStep/10000)
  
  const binStep = 80; // 0.8% per bin - reasonable for memecoins
  const baseFeeRate = 250; // 2.5% base fee
  
  // Calculate active bin from price
  // SNAP/USDC price: how many USDC per SNAP
  // Both have 6 decimals, so price_per_lamport = snapPrice
  const priceRatio = snapPrice; // USDC per SNAP
  const binStepRate = 1 + binStep / 10000;
  const activeBinId = Math.round(Math.log(priceRatio) / Math.log(binStepRate)) + 8388608;
  
  console.log(`\nPool params:`);
  console.log(`  Bin step: ${binStep} (${binStep/100}%)`);
  console.log(`  Active bin ID: ${activeBinId}`);
  console.log(`  Price at active bin: ~$${snapPrice}`);
  
  try {
    // Create customizable permissionless pair
    console.log('\n📡 Creating pool transaction...');
    
    const createPoolTx = await DLMM.createCustomizablePermissionlessLbPair(
      connection,
      new BN(binStep),
      SNAP_MINT,        // tokenX
      USDC_MINT,        // tokenY
      new BN(activeBinId),
      new BN(baseFeeRate),   // fee in bps
      ActivationType.Timestamp,
      false,            // no alpha vault
      wallet.publicKey,
      null,             // no activation point (immediate)
      false,            // no creator on/off control
    );
    
    console.log('  Signing and sending...');
    const txHash = await sendAndConfirmTransaction(connection, createPoolTx, [wallet], {
      skipPreflight: true,
      commitment: 'confirmed'
    });
    console.log(`  ✅ Pool created! TX: https://solscan.io/tx/${txHash}`);
    
    // Now find the pool address
    console.log('\n🔍 Finding pool address...');
    
    // Wait a moment for indexing
    await new Promise(r => setTimeout(r, 5000));
    
    // Search for our new pool
    const pairs = await DLMM.getLbPairs(connection, {
      tokenX: SNAP_MINT,
      tokenY: USDC_MINT
    });
    
    if (pairs.length > 0) {
      const poolAddress = pairs[0].publicKey;
      console.log(`  Pool address: ${poolAddress.toBase58()}`);
      
      // Step 2: Add liquidity
      console.log('\n💧 Adding liquidity...');
      
      const dlmmPool = await DLMM.create(connection, poolAddress);
      const activeBin = await dlmmPool.getActiveBin();
      console.log(`  Active bin: ${activeBin.binId}, price: ${activeBin.price}`);
      
      const RANGE = 30; // 30 bins each side
      const minBinId = activeBin.binId - RANGE;
      const maxBinId = activeBin.binId + RANGE;
      
      // SNAP amount (6 decimals)
      const totalXAmount = new BN(Math.floor(snapForLP * 1e6).toString());
      // USDC amount (6 decimals)
      const totalYAmount = new BN(Math.floor(usdcBalance * 1e6).toString());
      
      const positionKeypair = new Keypair();
      
      const addLiqTx = await dlmmPool.initializePositionAndAddLiquidityByStrategy({
        positionPubKey: positionKeypair.publicKey,
        user: wallet.publicKey,
        totalXAmount,
        totalYAmount,
        strategy: {
          maxBinId,
          minBinId,
          strategyType: StrategyType.Spot,
        },
        slippage: 5, // 5% slippage
      });
      
      const addLiqHash = await sendAndConfirmTransaction(connection, addLiqTx, [wallet, positionKeypair], {
        skipPreflight: true,
        commitment: 'confirmed'
      });
      
      console.log(`  ✅ Liquidity added! TX: https://solscan.io/tx/${addLiqHash}`);
      console.log(`  Position: ${positionKeypair.publicKey.toBase58()}`);
      console.log(`\n🎉 SNAP/USDC Meteora DLMM pool is LIVE!`);
      console.log(`  View: https://app.meteora.ag/dlmm/${poolAddress.toBase58()}`);
    } else {
      console.log('  Could not find pool after creation. Check Solscan.');
    }
    
  } catch(e) {
    console.error('\n❌ Error:', e.message);
    if (e.logs) console.error('Logs:', e.logs.slice(-5));
    
    // If programmatic creation fails, give manual instructions
    console.log('\n📋 Manual fallback:');
    console.log('1. Go to https://app.meteora.ag/dlmm/create');
    console.log(`2. Token X: ${SNAP_MINT.toBase58()}`);
    console.log(`3. Token Y: ${USDC_MINT.toBase58()}`);
    console.log(`4. Bin step: ${binStep}`);
    console.log(`5. Initial price: ${snapPrice} USDC per SNAP`);
    console.log('6. Connect wallet: ' + wallet.publicKey.toBase58());
  }
}

main().catch(console.error);
