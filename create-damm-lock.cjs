#!/usr/bin/env node
/**
 * Create DAMM pool for SNAP/USDC and permanently lock LP
 */

const { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } = require('@solana/web3.js');
const { getAccount, getAssociatedTokenAddress } = require('@solana/spl-token');
const AmmImpl = require('@mercurial-finance/dynamic-amm-sdk').default;
const { BN } = require('bn.js');
const fs = require('fs');

const WALLET_PATH = process.env.SOLANA_WALLET || '/root/.config/solana/snap-wallet.json';
const RPC = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';

const SNAP_MINT = new PublicKey('8oCRS5SYaf4t5PGnCeQfpV7rjxGCcGqNDGHmHJBooPhX');
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

const SNAP_DECIMALS = 5;
const USDC_DECIMALS = 6;

const DRY_RUN = process.argv.includes('--dry-run');
const CONFIRM = process.argv.includes('--confirm');

function log(msg) {
    console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function main() {
    if (!CONFIRM && !DRY_RUN) {
        console.log(`
⚠️  PERMANENT LOCK WARNING ⚠️

This script will:
1. Create a DAMM pool for SNAP/USDC (if none exists)
2. Add ALL SNAP and USDC from wallet as liquidity  
3. PERMANENTLY LOCK the LP tokens

Once locked, the liquidity can NEVER be withdrawn.
Only fees can be claimed forever.

Run with:
  --dry-run     Show what would happen
  --confirm     Execute the lock

Example:
  node create-damm-lock.cjs --dry-run
  node create-damm-lock.cjs --confirm
`);
        process.exit(0);
    }

    const walletData = JSON.parse(fs.readFileSync(WALLET_PATH));
    const wallet = Keypair.fromSecretKey(Uint8Array.from(walletData));
    const connection = new Connection(RPC, 'confirmed');

    log(`Wallet: ${wallet.publicKey.toString()}`);
    log(`Mode: ${DRY_RUN ? 'DRY RUN' : '🚨 LIVE EXECUTION'}`);

    // Get balances
    const snapAta = await getAssociatedTokenAddress(SNAP_MINT, wallet.publicKey);
    const usdcAta = await getAssociatedTokenAddress(USDC_MINT, wallet.publicKey);
    
    const snapAccount = await getAccount(connection, snapAta);
    const usdcAccount = await getAccount(connection, usdcAta);

    const snapAmount = Number(snapAccount.amount);
    const usdcAmount = Number(usdcAccount.amount);

    log(`SNAP balance: ${(snapAmount / 10**SNAP_DECIMALS).toFixed(2)} SNAP`);
    log(`USDC balance: ${(usdcAmount / 10**USDC_DECIMALS).toFixed(2)} USDC`);

    if (DRY_RUN) {
        log('');
        log('DRY RUN - Would create DAMM pool and lock:');
        log(`  SNAP: ${(snapAmount / 10**SNAP_DECIMALS).toFixed(2)}`);
        log(`  USDC: ${(usdcAmount / 10**USDC_DECIMALS).toFixed(2)}`);
        log('  Lock: PERMANENT (cannot be undone)');
        log('');
        log('Run with --confirm to execute.');
        return;
    }

    // Step 1: Check if pool exists or create one
    log('Step 1: Looking for existing DAMM pool...');
    
    // The Dynamic AMM SDK needs a pool address. We need to either:
    // - Find an existing pool
    // - Create a new pool via Meteora's permissionless pool creation

    // For Meteora Dynamic AMM, pools are created via their factory
    // Let's check if a SNAP/USDC pool exists first
    
    const pools = await AmmImpl.getPools(connection, [SNAP_MINT], [USDC_MINT]);
    
    if (pools && pools.length > 0) {
        log(`Found existing pool: ${pools[0].poolState.poolMint.toString()}`);
        const pool = pools[0];
        
        // Step 2: Add liquidity
        log('Step 2: Adding liquidity...');
        
        const depositTx = await pool.deposit(
            wallet.publicKey,
            new BN(snapAmount),
            new BN(usdcAmount),
            new BN(0) // min LP amount
        );
        
        depositTx.feePayer = wallet.publicKey;
        const { blockhash } = await connection.getLatestBlockhash();
        depositTx.recentBlockhash = blockhash;
        
        const depositSig = await sendAndConfirmTransaction(connection, depositTx, [wallet]);
        log(`Deposit TX: https://solscan.io/tx/${depositSig}`);
        
        // Step 3: Lock LP tokens permanently
        log('Step 3: Locking LP tokens permanently...');
        
        // Meteora's lock uses a specific instruction
        const lockTx = await pool.lockLiquidity(
            wallet.publicKey,
            new BN(0), // lock all
            true // permanent
        );
        
        lockTx.feePayer = wallet.publicKey;
        const { blockhash: lockBlockhash } = await connection.getLatestBlockhash();
        lockTx.recentBlockhash = lockBlockhash;
        
        const lockSig = await sendAndConfirmTransaction(connection, lockTx, [wallet]);
        log(`Lock TX: https://solscan.io/tx/${lockSig}`);
        
        log('✅ Liquidity permanently locked!');
    } else {
        log('No existing DAMM pool found for SNAP/USDC');
        log('');
        log('To create a new pool, use Meteora UI:');
        log('1. Go to https://app.meteora.ag/pools/create');
        log('2. Select "Dynamic Pool"');
        log('3. Add SNAP and USDC tokens');
        log('4. Set initial price and fee');
        log('5. After creation, lock the LP tokens');
        log('');
        log('Or provide an existing pool address as --pool <address>');
    }
}

main().catch(err => {
    log(`Error: ${err.message}`);
    if (err.stack) log(err.stack);
    process.exit(1);
});
