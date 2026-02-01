#!/usr/bin/env node
const { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction, ComputeBudgetProgram } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID } = require('@solana/spl-token');
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
  console.log('=== Adding Liquidity via Anchor ===');
  
  const program = dlmm.createProgram(connection);
  
  // Fetch pool state
  const lbPair = await program.account.lbPair.fetch(POOL);
  const activeBinId = lbPair.activeId;
  const binStep = lbPair.binStep;
  console.log(`Pool active bin: ${activeBinId}, bin step: ${binStep}`);

  // Get token accounts
  const usdcAccounts = await connection.getTokenAccountsByOwner(wallet.publicKey, { mint: USDC_MINT });
  const snapAccounts = await connection.getTokenAccountsByOwner(wallet.publicKey, { mint: SNAP_MINT });
  const userTokenX = snapAccounts.value[0].pubkey; // SNAP
  const userTokenY = usdcAccounts.value[0].pubkey; // USDC
  
  const usdcBal = await connection.getTokenAccountBalance(userTokenY);
  const snapBal = await connection.getTokenAccountBalance(userTokenX);
  console.log(`USDC: ${usdcBal.value.uiAmountString}, SNAP: ${Number(snapBal.value.uiAmount).toLocaleString()}`);

  // Amounts
  const usdcAmount = new BN(Math.floor(1348 * 1e6).toString()); // ~1348 USDC
  const snapPrice = 0.0001185;
  const snapTokens = Math.floor((1348 / snapPrice) * 1e6);
  const snapAmount = new BN(snapTokens.toString());
  
  console.log(`Depositing: ${snapTokens / 1e6} SNAP + ${1348} USDC`);

  // Position range: 30 bins each side
  const RANGE = 30;
  const minBinId = activeBinId - RANGE;
  const maxBinId = activeBinId + RANGE;
  const width = maxBinId - minBinId + 1;
  console.log(`Range: ${minBinId} to ${maxBinId} (${width} bins)`);

  // Derive accounts
  const programId = program.programId;
  const [reserveX] = dlmm.deriveReserve(SNAP_MINT, POOL, programId);
  const [reserveY] = dlmm.deriveReserve(USDC_MINT, POOL, programId);
  const [eventAuthority] = dlmm.deriveEventAuthority(programId);
  const [bitmapExt] = dlmm.deriveBinArrayBitmapExtension(POOL, programId);
  
  // Bin arrays for the range
  const binArrayLowerIdx = dlmm.binIdToBinArrayIndex(new BN(minBinId));
  const binArrayUpperIdx = dlmm.binIdToBinArrayIndex(new BN(maxBinId));
  const [binArrayLower] = dlmm.deriveBinArray(POOL, binArrayLowerIdx, programId);
  const [binArrayUpper] = dlmm.deriveBinArray(POOL, binArrayUpperIdx, programId);
  
  console.log(`Bin array lower: ${binArrayLower.toBase58()} (idx ${binArrayLowerIdx})`);
  console.log(`Bin array upper: ${binArrayUpper.toBase58()} (idx ${binArrayUpperIdx})`);

  // Create position keypair
  const positionKp = Keypair.generate();
  
  // Strategy parameters with zero-filled parameteres array
  const parameteres = Buffer.alloc(64, 0);
  
  try {
    // Step 0: Initialize bin arrays and bitmap extension if needed
    const preTx = new Transaction();
    preTx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }));
    preTx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100000 }));
    let needsPreTx = false;
    
    // Initialize bitmap extension if it doesn't exist
    const [bitmapExtPdaCheck] = dlmm.deriveBinArrayBitmapExtension(POOL, programId);
    const bitmapInfo = await connection.getAccountInfo(bitmapExtPdaCheck);
    if (!bitmapInfo) {
      console.log('Initializing bitmap extension...');
      const initBitmapIx = await program.methods
        .initializeBinArrayBitmapExtension()
        .accounts({
          lbPair: POOL,
          binArrayBitmapExtension: bitmapExtPdaCheck,
          funder: wallet.publicKey,
          systemProgram: SystemProgram.programId,
          rent: new PublicKey('SysvarRent111111111111111111111111111111111'),
        })
        .instruction();
      preTx.add(initBitmapIx);
      needsPreTx = true;
    }
    
    // Initialize bin arrays
    const binArrayLowerInfo = await connection.getAccountInfo(binArrayLower);
    if (!binArrayLowerInfo) {
      console.log(`Initializing bin array lower (idx ${binArrayLowerIdx})...`);
      const initBinLowerIx = await program.methods
        .initializeBinArray(binArrayLowerIdx)
        .accounts({
          lbPair: POOL,
          binArray: binArrayLower,
          funder: wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .instruction();
      preTx.add(initBinLowerIx);
      needsPreTx = true;
    }
    
    const binArrayUpperInfo = await connection.getAccountInfo(binArrayUpper);
    if (!binArrayUpperInfo) {
      console.log(`Initializing bin array upper (idx ${binArrayUpperIdx})...`);
      const initBinUpperIx = await program.methods
        .initializeBinArray(binArrayUpperIdx)
        .accounts({
          lbPair: POOL,
          binArray: binArrayUpper,
          funder: wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .instruction();
      preTx.add(initBinUpperIx);
      needsPreTx = true;
    }
    
    if (needsPreTx) {
      console.log('Sending pre-initialization transaction...');
      const preSig = await sendAndConfirmTransaction(connection, preTx, [wallet], {
        skipPreflight: true,
        commitment: 'confirmed',
      });
      console.log(`Pre-init TX: https://solscan.io/tx/${preSig}`);
      // Wait a bit
      await new Promise(r => setTimeout(r, 3000));
    }
    
    // Build init position instruction
    const initPosIx = await program.methods
      .initializePosition(minBinId, width)
      .accounts({
        payer: wallet.publicKey,
        position: positionKp.publicKey,
        lbPair: POOL,
        owner: wallet.publicKey,
        systemProgram: SystemProgram.programId,
        rent: new PublicKey('SysvarRent111111111111111111111111111111111'),
        eventAuthority,
        program: programId,
      })
      .instruction();

    // Build add liquidity by strategy instruction
    const addLiqIx = await program.methods
      .addLiquidityByStrategy({
        amountX: snapAmount,
        amountY: usdcAmount,
        activeId: activeBinId,
        maxActiveBinSlippage: 5,
        strategyParameters: {
          minBinId,
          maxBinId,
          strategyType: { spotBalanced: {} },
          parameteres: Array.from(parameteres),
        },
      })
      .accounts({
        position: positionKp.publicKey,
        lbPair: POOL,
        binArrayBitmapExtension: bitmapExt,
        userTokenX,
        userTokenY,
        reserveX,
        reserveY,
        tokenXMint: SNAP_MINT,
        tokenYMint: USDC_MINT,
        binArrayLower,
        binArrayUpper,
        sender: wallet.publicKey,
        tokenXProgram: TOKEN_PROGRAM_ID,
        tokenYProgram: TOKEN_PROGRAM_ID,
        eventAuthority,
        program: programId,
      })
      .instruction();

    // Build and send transaction
    const tx = new Transaction();
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1400000 }));
    tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100000 }));
    tx.add(initPosIx);
    tx.add(addLiqIx);
    
    console.log('\nSending transaction...');
    const sig = await sendAndConfirmTransaction(connection, tx, [wallet, positionKp], {
      skipPreflight: true,
      commitment: 'confirmed',
    });
    
    console.log(`\n🎉 SUCCESS!`);
    console.log(`TX: https://solscan.io/tx/${sig}`);
    console.log(`Position: ${positionKp.publicKey.toBase58()}`);
    console.log(`Pool: https://app.meteora.ag/dlmm/${POOL.toBase58()}`);
    
    // Save
    const poolData = JSON.parse(fs.readFileSync('/var/www/snap/data/meteora-pool.json', 'utf8'));
    poolData.position = positionKp.publicKey.toBase58();
    poolData.liquidityTx = sig;
    poolData.liquidityAddedAt = new Date().toISOString();
    fs.writeFileSync('/var/www/snap/data/meteora-pool.json', JSON.stringify(poolData, null, 2));
    
  } catch(e) {
    console.error('\n❌ Error:', e.message);
    if (e.getLogs) {
      const logs = await e.getLogs(connection);
      console.error('\nProgram logs:');
      logs.slice(-10).forEach(l => console.error('  ', l));
    } else if (e.logs) {
      console.error('\nLogs:', e.logs.slice(-10));
    }
    console.log(`\n📋 Manual: https://app.meteora.ag/dlmm/${POOL.toBase58()}`);
  }
}

main().catch(console.error);
