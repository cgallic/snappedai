#!/usr/bin/env node
/**
 * Create SNAP/USDC DLMM Pool on Meteora and add liquidity
 * Using standalone functions from the SDK
 */

const { Connection, Keypair, PublicKey, sendAndConfirmTransaction } = require('@solana/web3.js');
const fs = require('fs');
const BN = require('bn.js');
const dlmm = require('@meteora-ag/dlmm');

const RPC = 'https://api.mainnet-beta.solana.com';
const connection = new Connection(RPC, 'confirmed');

// Load wallet
const walletData = JSON.parse(fs.readFileSync('/root/.config/solana/snap-wallet.json', 'utf-8'));
const wallet = Keypair.fromSecretKey(new Uint8Array(walletData));

const SNAP_MINT = new PublicKey('8oCRS5SYaf4t5PGnCeQfpV7rjxGCcGqNDGHmHJBooPhX');
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

async function main() {
  console.log('=== Meteora SNAP/USDC Pool ===');
  console.log('Wallet:', wallet.publicKey.toBase58());
  
  // Check balances
  const solBal = await connection.getBalance(wallet.publicKey);
  console.log(`SOL: ${(solBal / 1e9).toFixed(4)}`);
  
  const usdcAccounts = await connection.getTokenAccountsByOwner(wallet.publicKey, { mint: USDC_MINT });
  let usdcBalance = 0;
  if (usdcAccounts.value.length > 0) {
    const bal = await connection.getTokenAccountBalance(usdcAccounts.value[0].pubkey);
    usdcBalance = Number(bal.value.uiAmount);
  }
  console.log(`USDC: ${usdcBalance.toFixed(2)}`);
  
  const snapAccounts = await connection.getTokenAccountsByOwner(wallet.publicKey, { mint: SNAP_MINT });
  let snapBalance = 0;
  if (snapAccounts.value.length > 0) {
    const bal = await connection.getTokenAccountBalance(snapAccounts.value[0].pubkey);
    snapBalance = Number(bal.value.uiAmount);
  }
  console.log(`SNAP: ${snapBalance.toLocaleString()}`);

  const snapPrice = 0.0001185;
  const snapForLP = usdcBalance / snapPrice;
  console.log(`\nLP: ${usdcBalance.toFixed(2)} USDC + ${Math.floor(snapForLP).toLocaleString()} SNAP (~$${(usdcBalance * 2).toFixed(0)} total)`);
  
  // Calculate active bin ID
  // SNAP (6 dec) / USDC (6 dec) - price = 0.0001185 USDC per SNAP
  const binStep = 80; // 0.8% per bin
  const binStepRate = 1 + binStep / 10000;
  // Meteora DLMM: price = (1 + binStep/10000)^binId (NO offset!)
  const activeBinId = Math.round(Math.log(snapPrice) / Math.log(binStepRate));
  console.log(`Bin step: ${binStep}, Active bin: ${activeBinId}`);
  
  const step = process.argv[2] || 'create';
  
  if (step === 'create') {
    console.log('\n📡 Step 1: Creating SNAP/USDC pool...');
    
    try {
      const createTx = await dlmm.createCustomizablePermissionlessLbPair(
        connection,
        new BN(binStep),
        SNAP_MINT,
        USDC_MINT,
        new BN(activeBinId),
        new BN(250),  // 2.5% fee
        dlmm.ActivationType.Timestamp,
        false,
        wallet.publicKey,
        null,
        false,
      );
      
      console.log('  TX built, sending...');
      const sig = await sendAndConfirmTransaction(connection, createTx, [wallet], {
        skipPreflight: true,
        commitment: 'confirmed',
      });
      console.log(`  ✅ Pool created! TX: https://solscan.io/tx/${sig}`);
      
      // Derive the pool address
      const [pairKey] = dlmm.deriveCustomizablePermissionlessLbPair(
        SNAP_MINT,
        USDC_MINT,
        new PublicKey(dlmm.LBCLMM_PROGRAM_IDS['mainnet-beta'])
      );
      console.log(`  Pool address: ${pairKey.toBase58()}`);
      console.log(`  View: https://app.meteora.ag/dlmm/${pairKey.toBase58()}`);
      
      // Save pool address
      fs.writeFileSync('/var/www/snap/data/meteora-pool.json', JSON.stringify({
        pool: pairKey.toBase58(),
        tokenX: SNAP_MINT.toBase58(),
        tokenY: USDC_MINT.toBase58(),
        binStep,
        activeBinId,
        createdAt: new Date().toISOString()
      }, null, 2));
      
      console.log('\n  Now run: node meteora-go.cjs liquidity');
      
    } catch(e) {
      console.error('❌ Error:', e.message);
      if (e.logs) console.error('Logs:', e.logs.slice(-5));
      
      // Try to derive the pair to see if it already exists
      try {
        const [pairKey] = dlmm.deriveCustomizablePermissionlessLbPair(
          SNAP_MINT,
          USDC_MINT,
          new PublicKey(dlmm.LBCLMM_PROGRAM_IDS['mainnet-beta'])
        );
        const info = await connection.getAccountInfo(pairKey);
        if (info) {
          console.log(`\n  Pool already exists: ${pairKey.toBase58()}`);
          console.log(`  View: https://app.meteora.ag/dlmm/${pairKey.toBase58()}`);
          console.log('  Run: node meteora-go.cjs liquidity');
        }
      } catch(e2) {}
    }
  }
  
  if (step === 'liquidity') {
    // Load pool address
    let poolAddress;
    try {
      const poolData = JSON.parse(fs.readFileSync('/var/www/snap/data/meteora-pool.json', 'utf8'));
      poolAddress = new PublicKey(poolData.pool);
    } catch {
      // Derive it
      const [pairKey] = dlmm.deriveCustomizablePermissionlessLbPair(
        SNAP_MINT,
        USDC_MINT,
        new PublicKey(dlmm.LBCLMM_PROGRAM_IDS['mainnet-beta'])
      );
      poolAddress = pairKey;
    }
    
    console.log(`\n💧 Step 2: Adding liquidity to ${poolAddress.toBase58()}...`);
    
    // The SDK's DLMM class isn't properly exported in CJS, 
    // so we need to use a workaround
    // Let's try requiring it differently
    try {
      // Find the DLMM class - it should be in the module somewhere
      let DLMMClass = null;
      for (const key of Object.keys(dlmm)) {
        const val = dlmm[key];
        if (typeof val === 'function' && val.create && val.prototype && val.prototype.getActiveBin) {
          DLMMClass = val;
          break;
        }
      }
      
      if (!DLMMClass) {
        // Try to find it via the module's internal structure
        const modPath = require.resolve('@meteora-ag/dlmm');
        const mod = require(modPath);
        for (const key of Object.keys(mod)) {
          if (typeof mod[key] === 'function') {
            try {
              const proto = Object.getOwnPropertyNames(mod[key].prototype || {});
              if (proto.includes('getActiveBin')) {
                DLMMClass = mod[key];
                console.log(`  Found DLMM class as: ${key}`);
                break;
              }
            } catch {}
          }
        }
      }

      if (!DLMMClass) {
        console.log('  ⚠️  DLMM class not found in CJS exports.');
        console.log('  The pool is created. Add liquidity via Meteora UI:');
        console.log(`  https://app.meteora.ag/dlmm/${poolAddress.toBase58()}`);
        return;
      }
      
      const pool = await DLMMClass.create(connection, poolAddress);
      const activeBin = await pool.getActiveBin();
      console.log(`  Active bin: ${activeBin.binId}, price: ${activeBin.price}`);
      
      const RANGE = 30;
      const minBinId = activeBin.binId - RANGE;
      const maxBinId = activeBin.binId + RANGE;
      
      const totalXAmount = new BN(Math.floor(snapForLP * 1e6).toString());
      const totalYAmount = new BN(Math.floor(usdcBalance * 1e6).toString());
      
      const positionKeypair = Keypair.generate();
      
      const addLiqTx = await pool.initializePositionAndAddLiquidityByStrategy({
        positionPubKey: positionKeypair.publicKey,
        user: wallet.publicKey,
        totalXAmount,
        totalYAmount,
        strategy: {
          maxBinId,
          minBinId,
          strategyType: dlmm.StrategyType.Spot,
        },
        slippage: 5,
      });
      
      const sig = await sendAndConfirmTransaction(connection, addLiqTx, [wallet, positionKeypair], {
        skipPreflight: true,
        commitment: 'confirmed',
      });
      
      console.log(`  ✅ Liquidity added! TX: https://solscan.io/tx/${sig}`);
      console.log(`  Position: ${positionKeypair.publicKey.toBase58()}`);
      console.log(`\n🎉 SNAP/USDC Meteora pool is LIVE!`);
      
    } catch(e) {
      console.error('❌ Liquidity error:', e.message);
      console.log(`\n  Add liquidity manually: https://app.meteora.ag/dlmm/${poolAddress.toBase58()}`);
    }
  }
}

main().catch(console.error);
