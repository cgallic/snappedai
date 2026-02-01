#!/usr/bin/env node
/**
 * Initialize Meteora pool accounts step by step, then add liquidity
 */
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

const RENT = new PublicKey('SysvarRent111111111111111111111111111111111');

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function sendTx(tx, signers, label) {
  console.log(`  Sending: ${label}...`);
  try {
    const sig = await sendAndConfirmTransaction(connection, tx, signers, {
      skipPreflight: true,
      commitment: 'confirmed',
    });
    console.log(`  ✅ ${label}: https://solscan.io/tx/${sig}`);
    return sig;
  } catch(e) {
    if (e.logs) {
      console.error(`  ❌ ${label} failed:`, e.logs.slice(-5).join('\n  '));
    } else {
      console.error(`  ❌ ${label} failed:`, e.message);
    }
    throw e;
  }
}

async function main() {
  const step = process.argv[2] || 'all';
  const program = dlmm.createProgram(connection);
  const programId = program.programId;
  
  const lbPair = await program.account.lbPair.fetch(POOL);
  const activeBinId = lbPair.activeId;
  console.log(`Pool: ${POOL.toBase58()}, active bin: ${activeBinId}`);
  console.log(`SOL: ${(await connection.getBalance(wallet.publicKey)) / 1e9}`);

  const RANGE = 30;
  const minBinId = activeBinId - RANGE;
  const maxBinId = activeBinId + RANGE;
  
  const binArrayLowerIdx = dlmm.binIdToBinArrayIndex(new BN(minBinId));
  const binArrayUpperIdx = dlmm.binIdToBinArrayIndex(new BN(maxBinId));
  const [binArrayLower] = dlmm.deriveBinArray(POOL, binArrayLowerIdx, programId);
  const [binArrayUpper] = dlmm.deriveBinArray(POOL, binArrayUpperIdx, programId);
  const [bitmapExt] = dlmm.deriveBinArrayBitmapExtension(POOL, programId);
  const [reserveX] = dlmm.deriveReserve(SNAP_MINT, POOL, programId);
  const [reserveY] = dlmm.deriveReserve(USDC_MINT, POOL, programId);
  const [eventAuthority] = dlmm.deriveEventAuthority(programId);

  // STEP 1: Init bitmap extension
  if (step === 'all' || step === 'bitmap') {
    const info = await connection.getAccountInfo(bitmapExt);
    if (!info) {
      const tx = new Transaction();
      tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 }));
      tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100000 }));
      tx.add(await program.methods
        .initializeBinArrayBitmapExtension()
        .accounts({ lbPair: POOL, binArrayBitmapExtension: bitmapExt, funder: wallet.publicKey, systemProgram: SystemProgram.programId, rent: RENT })
        .instruction());
      await sendTx(tx, [wallet], 'Init bitmap extension');
      await sleep(2000);
    } else {
      console.log('  Bitmap extension already exists ✓');
    }
  }

  // STEP 2: Init bin array lower
  if (step === 'all' || step === 'bins') {
    const infoLower = await connection.getAccountInfo(binArrayLower);
    if (!infoLower) {
      const tx = new Transaction();
      tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 }));
      tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100000 }));
      tx.add(await program.methods
        .initializeBinArray(binArrayLowerIdx)
        .accounts({ lbPair: POOL, binArray: binArrayLower, funder: wallet.publicKey, systemProgram: SystemProgram.programId })
        .instruction());
      await sendTx(tx, [wallet], `Init bin array lower (idx ${binArrayLowerIdx})`);
      await sleep(2000);
    } else {
      console.log(`  Bin array lower already exists ✓`);
    }

    const infoUpper = await connection.getAccountInfo(binArrayUpper);
    if (!infoUpper) {
      const tx = new Transaction();
      tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 }));
      tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100000 }));
      tx.add(await program.methods
        .initializeBinArray(binArrayUpperIdx)
        .accounts({ lbPair: POOL, binArray: binArrayUpper, funder: wallet.publicKey, systemProgram: SystemProgram.programId })
        .instruction());
      await sendTx(tx, [wallet], `Init bin array upper (idx ${binArrayUpperIdx})`);
      await sleep(2000);
    } else {
      console.log(`  Bin array upper already exists ✓`);
    }
  }

  // STEP 3: Init position + add liquidity
  if (step === 'all' || step === 'liq') {
    const width = maxBinId - minBinId + 1;
    const positionKp = Keypair.generate();
    
    // Get token accounts
    const usdcAccounts = await connection.getTokenAccountsByOwner(wallet.publicKey, { mint: USDC_MINT });
    const snapAccounts = await connection.getTokenAccountsByOwner(wallet.publicKey, { mint: SNAP_MINT });
    const userTokenX = snapAccounts.value[0].pubkey;
    const userTokenY = usdcAccounts.value[0].pubkey;
    
    const usdcBal = await connection.getTokenAccountBalance(userTokenY);
    const snapBal = await connection.getTokenAccountBalance(userTokenX);
    console.log(`\n  USDC: ${usdcBal.value.uiAmountString}, SNAP: ${Number(snapBal.value.uiAmount).toLocaleString()}`);
    
    const usdcAmount = new BN(Math.floor(1340 * 1e6).toString()); // ~1340 USDC (small buffer)
    const snapPrice = 0.0001185;
    const snapTokens = Math.floor((1340 / snapPrice) * 1e6);
    const snapAmount = new BN(snapTokens.toString());
    
    console.log(`  Depositing: ${(snapTokens / 1e6).toLocaleString()} SNAP + 1340 USDC`);
    console.log(`  Position range: bins ${minBinId} to ${maxBinId} (${width} bins)`);
    
    const parameteres = Array.from(Buffer.alloc(64, 0));
    
    // Init position TX
    const tx1 = new Transaction();
    tx1.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 }));
    tx1.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100000 }));
    tx1.add(await program.methods
      .initializePosition(minBinId, width)
      .accounts({
        payer: wallet.publicKey,
        position: positionKp.publicKey,
        lbPair: POOL,
        owner: wallet.publicKey,
        systemProgram: SystemProgram.programId,
        rent: RENT,
        eventAuthority,
        program: programId,
      })
      .instruction());
    
    await sendTx(tx1, [wallet, positionKp], 'Init position');
    await sleep(3000);
    
    // Add liquidity TX
    const tx2 = new Transaction();
    tx2.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1400000 }));
    tx2.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100000 }));
    tx2.add(await program.methods
      .addLiquidityByStrategy({
        amountX: snapAmount,
        amountY: usdcAmount,
        activeId: activeBinId,
        maxActiveBinSlippage: 5,
        strategyParameters: {
          minBinId,
          maxBinId,
          strategyType: { spotBalanced: {} },
          parameteres,
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
      .instruction());
    
    const sig = await sendTx(tx2, [wallet], 'Add liquidity');
    
    console.log(`\n🎉 SNAP/USDC Meteora DLMM Pool is LIVE!`);
    console.log(`Position: ${positionKp.publicKey.toBase58()}`);
    console.log(`Pool: https://app.meteora.ag/dlmm/${POOL.toBase58()}`);
    
    // Save
    const poolData = JSON.parse(fs.readFileSync('/var/www/snap/data/meteora-pool.json', 'utf8'));
    poolData.position = positionKp.publicKey.toBase58();
    poolData.liquidityTx = sig;
    poolData.liquidityAddedAt = new Date().toISOString();
    fs.writeFileSync('/var/www/snap/data/meteora-pool.json', JSON.stringify(poolData, null, 2));
  }
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
