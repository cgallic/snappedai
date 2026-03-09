#!/usr/bin/env node
/**
 * Create Meteora DAMM Pool and Permanently Lock LP
 * 
 * Approach:
 * 1. Create regular DAMM Constant Product pool
 * 2. Deposit liquidity
 * 3. Lock LP tokens permanently using lock escrow
 */

const { Connection, Keypair, PublicKey, sendAndConfirmTransaction } = require('@solana/web3.js');
const { getAccount, getAssociatedTokenAddress } = require('@solana/spl-token');
const AmmImpl = require('@mercurial-finance/dynamic-amm-sdk').default;
const { PROGRAM_ID, derivePoolAddress } = require('@mercurial-finance/dynamic-amm-sdk');
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

This creates a DAMM pool and locks liquidity forever:
1. Create DAMM Constant Product pool  
2. Deposit all SNAP + USDC
3. Lock LP tokens PERMANENTLY (irreversible)

Usage:
  --dry-run     Preview what will happen
  --confirm     Execute the pool creation and lock

Example:
  node create-locked-damm.cjs --dry-run
  node create-locked-damm.cjs --confirm
`);
        process.exit(0);
    }

    const walletData = JSON.parse(fs.readFileSync(WALLET_PATH));
    const wallet = Keypair.fromSecretKey(Uint8Array.from(walletData));
    const connection = new Connection(RPC, 'confirmed');
    const programId = new PublicKey(PROGRAM_ID);

    log(`Wallet: ${wallet.publicKey.toString()}`);
    log(`Mode: ${DRY_RUN ? 'DRY RUN' : '🚨 LIVE EXECUTION - PERMANENT LOCK'}`);

    // Get balances
    const snapAta = await getAssociatedTokenAddress(SNAP_MINT, wallet.publicKey);
    const usdcAta = await getAssociatedTokenAddress(USDC_MINT, wallet.publicKey);
    
    const snapAccount = await getAccount(connection, snapAta);
    const usdcAccount = await getAccount(connection, usdcAta);

    const snapAmount = Number(snapAccount.amount);
    const usdcAmount = Number(usdcAccount.amount);

    log(`SNAP balance: ${(snapAmount / 10**SNAP_DECIMALS).toLocaleString()} SNAP`);
    log(`USDC balance: ${(usdcAmount / 10**USDC_DECIMALS).toFixed(2)} USDC`);

    // Fee in basis points (e.g., 25 = 0.25%)
    const feeBps = new BN(25); // 0.25% fee

    // Token info objects
    const tokenInfoA = { address: SNAP_MINT.toString(), decimals: SNAP_DECIMALS };
    const tokenInfoB = { address: USDC_MINT.toString(), decimals: USDC_DECIMALS };

    log(`Will create pool with ${feeBps.toNumber() / 100}% fee`);

    if (DRY_RUN) {
        log('');
        log('=== DRY RUN PREVIEW ===');
        log(`Would create DAMM Pool with permanent lock:`);
        log(`  Token A (SNAP): ${(snapAmount / 10**SNAP_DECIMALS).toLocaleString()}`);
        log(`  Token B (USDC): ${(usdcAmount / 10**USDC_DECIMALS).toFixed(2)}`);
        log(`  Fee: ${feeBps.toNumber() / 100}%`);
        log('');
        log('⚠️  This liquidity will be PERMANENTLY LOCKED');
        log('⚠️  You can only claim fees - never withdraw');
        log('');
        log('Run with --confirm to execute.');
        return;
    }

    // Step 1: Create the pool
    log('Step 1: Creating DAMM Constant Product Pool...');
    
    const createTxs = await AmmImpl.createPermissionlessPool(
        connection,
        wallet.publicKey,
        SNAP_MINT,
        USDC_MINT,
        new BN(snapAmount),
        new BN(usdcAmount),
        false, // not stable (volatile/constant product)
        feeBps,
    );

    log(`Generated ${createTxs.length} transactions for pool creation`);

    for (let i = 0; i < createTxs.length; i++) {
        const tx = createTxs[i];
        log(`Sending transaction ${i + 1}/${createTxs.length}...`);
        
        tx.feePayer = wallet.publicKey;
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
        tx.recentBlockhash = blockhash;
        
        tx.sign(wallet);
        
        const sig = await connection.sendRawTransaction(tx.serialize(), {
            skipPreflight: false,
            maxRetries: 3,
        });
        
        await connection.confirmTransaction({
            signature: sig,
            blockhash,
            lastValidBlockHeight,
        }, 'confirmed');
        
        log(`  TX ${i + 1}: https://solscan.io/tx/${sig}`);
    }

    log('Pool created! Now loading pool to lock LP...');

    // Step 2: Load the pool and lock LP
    // Get the pool address from the SDK
    const pools = await AmmImpl.getPoolsContainingMint(connection, SNAP_MINT, { programId });
    const pool = pools.find(p => 
        p.tokenAMint.address === SNAP_MINT.toString() || 
        p.tokenBMint.address === SNAP_MINT.toString()
    );
    
    if (!pool) {
        log('ERROR: Could not find the created pool');
        process.exit(1);
    }
    
    log(`Pool found: ${pool.poolState.poolMint.toString()}`);
    
    // Get user's LP balance
    const lpBalance = await pool.getUserBalance(wallet.publicKey);
    log(`LP balance: ${lpBalance.toString()}`);

    if (lpBalance.isZero()) {
        log('WARNING: No LP tokens found. Pool creation may have deposited to different address.');
        return;
    }

    // Step 3: Lock LP permanently
    log('Step 2: Locking LP tokens permanently...');
    
    // Meteora's permanent lock uses lock escrow
    // For permanent lock, we send LP to the lock account with no unlock time
    const lockTx = await pool.lockLiquidity(
        wallet.publicKey,
        lpBalance, // lock all LP
    );

    lockTx.feePayer = wallet.publicKey;
    const { blockhash: lockBlockhash, lastValidBlockHeight: lockHeight } = await connection.getLatestBlockhash();
    lockTx.recentBlockhash = lockBlockhash;
    lockTx.sign(wallet);

    const lockSig = await connection.sendRawTransaction(lockTx.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
    });

    await connection.confirmTransaction({
        signature: lockSig,
        blockhash: lockBlockhash,
        lastValidBlockHeight: lockHeight,
    }, 'confirmed');

    log(`Lock TX: https://solscan.io/tx/${lockSig}`);

    log('');
    log('✅ POOL CREATED AND LIQUIDITY PERMANENTLY LOCKED!');
    log('');
    log('Liquidity is now permanently locked.');
    log('You can claim trading fees but NEVER withdraw the liquidity.');
    
    // Save pool info
    const poolInfo = {
        createdAt: new Date().toISOString(),
        pool: poolPubkey.toString(),
        snapMint: SNAP_MINT.toString(),
        usdcMint: USDC_MINT.toString(),
        snapAmount: snapAmount / 10**SNAP_DECIMALS,
        usdcAmount: usdcAmount / 10**USDC_DECIMALS,
        feeBps: feeBps.toNumber(),
        locked: 'PERMANENT',
    };
    
    fs.writeFileSync('/root/clawd/contracts/locked-damm-pool.json', JSON.stringify(poolInfo, null, 2));
    log(`Pool info saved to /root/clawd/contracts/locked-damm-pool.json`);
}

main().catch(err => {
    log(`Error: ${err.message}`);
    if (err.logs) log(`Logs: ${err.logs.join('\n')}`);
    if (err.stack) log(err.stack);
    process.exit(1);
});
