#!/usr/bin/env node
/**
 * Add liquidity to the Meteora SNAP/USDC pool using Anchor program directly
 */

const { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction, ComputeBudgetProgram } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, ASSOCIATED_TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const fs = require('fs');
const BN = require('bn.js');
const dlmm = require('@meteora-ag/dlmm');

const RPC = 'https://api.mainnet-beta.solana.com';
const connection = new Connection(RPC, 'confirmed');

const walletData = JSON.parse(fs.readFileSync('/root/.config/solana/snap-wallet.json', 'utf-8'));
const wallet = Keypair.fromSecretKey(new Uint8Array(walletData));

const SNAP_MINT = new PublicKey('8oCRS5SYaf4t5PGnCeQfpV7rjxGCcGqNDGHmHJBooPhX');
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const POOL = new PublicKey('DuDW6PkmDzzLtpWAHZg9kEBA3jTrpmJSazDqBM4RuKbW');

async function main() {
  console.log('=== Adding Liquidity to Meteora SNAP/USDC Pool ===');
  console.log('Pool:', POOL.toBase58());
  console.log('Wallet:', wallet.publicKey.toBase58());

  // Get balances
  const usdcAcc = await connection.getTokenAccountsByOwner(wallet.publicKey, { mint: USDC_MINT });
  const usdcBal = usdcAcc.value.length > 0 ? 
    await connection.getTokenAccountBalance(usdcAcc.value[0].pubkey) : null;
  const snapAcc = await connection.getTokenAccountsByOwner(wallet.publicKey, { mint: SNAP_MINT });
  const snapBal = snapAcc.value.length > 0 ?
    await connection.getTokenAccountBalance(snapAcc.value[0].pubkey) : null;
  
  console.log(`USDC: ${usdcBal?.value.uiAmountString || '0'}`);
  console.log(`SNAP: ${Number(snapBal?.value.uiAmount || 0).toLocaleString()}`);
  
  const program = dlmm.createProgram(connection);
  
  // Fetch the lb pair account to get the active bin
  const lbPairAccount = await program.account.lbPair.fetch(POOL);
  const activeBinId = lbPairAccount.activeId;
  const binStep = lbPairAccount.binStep;
  console.log(`Active bin: ${activeBinId}, Bin step: ${binStep}`);

  // Calculate amounts
  const usdcAmount = Math.floor(1348 * 1e6); // ~1348 USDC (leave some buffer)  
  const snapPrice = 0.0001185;
  const snapAmount = Math.floor((1348 / snapPrice) * 1e6); // matching SNAP amount
  
  console.log(`Adding: ${usdcAmount / 1e6} USDC + ${(snapAmount / 1e6).toLocaleString()} SNAP`);
  
  // Range: 30 bins each side of active bin  
  const RANGE = 30;
  const minBinId = activeBinId - RANGE;
  const maxBinId = activeBinId + RANGE;
  console.log(`Range: bins ${minBinId} to ${maxBinId}`);
  
  // Build the distribution - Spot strategy (even across bins)
  const numBins = maxBinId - minBinId + 1;
  const liquidityParams = dlmm.buildLiquidityStrategyParameters({
    binStep,
    minBinId,
    maxBinId,
    activeBinId,
    totalXAmount: new BN(snapAmount.toString()),
    totalYAmount: new BN(usdcAmount.toString()),
    strategyType: dlmm.StrategyType.Spot,
  });
  
  console.log('Strategy built, bins:', liquidityParams.binLiquidityDist?.length || 'N/A');
  
  // Create position keypair
  const positionKeypair = Keypair.generate();
  
  // Derive required accounts
  const [binArrayBitmapExtension] = dlmm.deriveBinArrayBitmapExtension(POOL, program.programId);
  
  // Get user token accounts
  const userTokenX = snapAcc.value[0].pubkey;
  const userTokenY = usdcAcc.value[0].pubkey;
  
  // Derive reserve accounts
  const [reserveX] = dlmm.deriveReserve(SNAP_MINT, POOL, program.programId);
  const [reserveY] = dlmm.deriveReserve(USDC_MINT, POOL, program.programId);
  
  // Derive position
  const [positionPda] = dlmm.derivePosition(POOL, positionKeypair.publicKey, program.programId);
  
  // Event authority
  const [eventAuthority] = dlmm.deriveEventAuthority(program.programId);
  
  // Get bin arrays needed
  const binArrayKeys = dlmm.getBinArraysRequiredByPositionRange(POOL, minBinId, maxBinId, program.programId);
  console.log('Bin arrays needed:', binArrayKeys.length);
  
  try {
    // Step 1: Initialize position
    console.log('\n1. Initializing position...');
    
    const initPosIx = await program.methods
      .initializePosition2(minBinId, maxBinId - minBinId + 1)
      .accounts({
        payer: wallet.publicKey,
        position: positionKeypair.publicKey,
        lbPair: POOL,
        owner: wallet.publicKey,
        systemProgram: SystemProgram.programId,
        rent: new PublicKey('SysvarRent111111111111111111111111111111111'),
        eventAuthority,
        program: program.programId,
      })
      .instruction();
    
    // Step 2: Add liquidity by strategy
    console.log('2. Building add liquidity instruction...');
    
    const strategyParams = {
      minBinId,
      maxBinId,
      strategyType: { spot: {} },
    };
    
    const addLiqIx = await program.methods
      .addLiquidityByStrategy2({
        amountX: new BN(snapAmount.toString()),
        amountY: new BN(usdcAmount.toString()),
        activeId: activeBinId,
        maxActiveBinSlippage: 5,
        strategyParameters: strategyParams,
      })
      .accounts({
        position: positionKeypair.publicKey,
        lbPair: POOL,
        binArrayBitmapExtension,
        userTokenX,
        userTokenY,
        reserveX,
        reserveY,
        tokenXMint: SNAP_MINT,
        tokenYMint: USDC_MINT,
        sender: wallet.publicKey,
        tokenXProgram: TOKEN_PROGRAM_ID,
        tokenYProgram: TOKEN_PROGRAM_ID,
        eventAuthority,
        program: program.programId,
      })
      .remainingAccounts(binArrayKeys.map(key => ({
        pubkey: key,
        isWritable: true,
        isSigner: false,
      })))
      .instruction();
    
    // Build transaction
    const tx = new Transaction();
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 800000 }));
    tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50000 }));
    tx.add(initPosIx);
    tx.add(addLiqIx);
    
    console.log('3. Sending transaction...');
    const sig = await sendAndConfirmTransaction(connection, tx, [wallet, positionKeypair], {
      skipPreflight: true,
      commitment: 'confirmed',
    });
    
    console.log(`\n✅ Liquidity added!`);
    console.log(`TX: https://solscan.io/tx/${sig}`);
    console.log(`Position: ${positionKeypair.publicKey.toBase58()}`);
    console.log(`Pool: https://app.meteora.ag/dlmm/${POOL.toBase58()}`);
    
    // Save position info
    const poolData = JSON.parse(fs.readFileSync('/var/www/snap/data/meteora-pool.json', 'utf8'));
    poolData.position = positionKeypair.publicKey.toBase58();
    poolData.liquidityTx = sig;
    poolData.liquidityAddedAt = new Date().toISOString();
    fs.writeFileSync('/var/www/snap/data/meteora-pool.json', JSON.stringify(poolData, null, 2));
    
  } catch(e) {
    console.error('\n❌ Error:', e.message);
    if (e.logs) {
      console.error('\nProgram logs:');
      e.logs.slice(-10).forEach(l => console.error('  ', l));
    }
    
    console.log(`\n📋 Fallback: Add liquidity manually at:`);
    console.log(`   https://app.meteora.ag/dlmm/${POOL.toBase58()}`);
  }
}

main().catch(console.error);
