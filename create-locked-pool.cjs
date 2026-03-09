#!/usr/bin/env node
/**
 * Create Meteora DAMM Memecoin Pool with PERMANENT LOCK
 * 
 * This creates a new pool where initial liquidity is locked forever.
 * Only fees can be claimed - liquidity can NEVER be withdrawn.
 */

const { Connection, Keypair, PublicKey, sendAndConfirmTransaction } = require('@solana/web3.js');
const { getAccount, getAssociatedTokenAddress } = require('@solana/spl-token');
const AmmImpl = require('@mercurial-finance/dynamic-amm-sdk').default;
const { PROGRAM_ID } = require('@mercurial-finance/dynamic-amm-sdk');
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

This creates a Memecoin Pool (DAMM) where:
- Initial liquidity is PERMANENTLY LOCKED at creation
- Liquidity can NEVER be withdrawn
- You can still claim trading fees forever

Usage:
  --dry-run     Preview what will happen
  --confirm     Execute the pool creation

Example:
  node create-locked-pool.cjs --dry-run
  node create-locked-pool.cjs --confirm
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

    // Get fee configurations
    log('Fetching fee configurations...');
    const feeConfigurations = await AmmImpl.getFeeConfigurations(connection, { programId });
    
    log(`Found ${feeConfigurations.length} fee configurations`);
    
    // Find a permissionless config - these have no authority restriction
    // Known permissionless configs for volatile pools
    const PERMISSIONLESS_CONFIGS = [
        'FiENCCbPi3rFh5pW2AJ59HC53pBaXkJbbGpfSXnH5rF1', // 0.25% fee
        'HyRjXpzwMGrdZqqs3Q9qkF55RqWw4h2Vhk6KWLj8uxoU', // 0.5% fee
        'D1SwC8bXv4SWgGfXuFcSJdEPcgXsGVPxh4Pq2TN5v6Gp', // 1% fee
    ];

    let config = null;
    for (const configAddr of PERMISSIONLESS_CONFIGS) {
        config = feeConfigurations.find(c => c.publicKey.toString() === configAddr);
        if (config) break;
    }

    // Fallback: look for any config that might work
    if (!config) {
        // Try configs with lower trade fee (more likely to be permissionless)
        for (const c of feeConfigurations) {
            if (c.tradeFeeBps && c.tradeFeeBps <= 100) { // <= 1% fee
                config = c;
                break;
            }
        }
    }

    if (!config) {
        config = feeConfigurations[0];
    }

    log(`Using config: ${config.publicKey.toString()}`);
    if (config.tradeFeeBps) log(`Trade fee: ${config.tradeFeeBps / 100}%`);

    if (DRY_RUN) {
        log('');
        log('=== DRY RUN PREVIEW ===');
        log(`Would create Memecoin Pool (permanently locked):`);
        log(`  Token A (SNAP): ${(snapAmount / 10**SNAP_DECIMALS).toLocaleString()}`);
        log(`  Token B (USDC): ${(usdcAmount / 10**USDC_DECIMALS).toFixed(2)}`);
        log(`  Fee config: ${config.publicKey.toString()}`);
        log('');
        log('⚠️  This liquidity will be PERMANENTLY LOCKED');
        log('⚠️  You can only claim fees - never withdraw');
        log('');
        log('Run with --confirm to execute.');
        return;
    }

    // Create the memecoin pool with permanent lock
    log('Creating Memecoin Pool with permanent lock...');
    
    const transactions = await AmmImpl.createPermissionlessConstantProductMemecoinPoolWithConfig(
        connection,
        wallet.publicKey,
        SNAP_MINT,
        USDC_MINT,
        new BN(snapAmount),
        new BN(usdcAmount),
        config.publicKey,
        { isMinted: true }
    );

    log(`Generated ${transactions.length} transactions`);

    for (let i = 0; i < transactions.length; i++) {
        const tx = transactions[i];
        log(`Sending transaction ${i + 1}/${transactions.length}...`);
        
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

    log('');
    log('✅ MEMECOIN POOL CREATED WITH PERMANENT LOCK!');
    log('');
    log('Liquidity is now permanently locked.');
    log('You can claim trading fees but NEVER withdraw the liquidity.');
    
    // Save pool info
    const poolInfo = {
        createdAt: new Date().toISOString(),
        snapMint: SNAP_MINT.toString(),
        usdcMint: USDC_MINT.toString(),
        snapAmount: snapAmount / 10**SNAP_DECIMALS,
        usdcAmount: usdcAmount / 10**USDC_DECIMALS,
        feeConfig: config.publicKey.toString(),
        locked: 'PERMANENT',
    };
    
    fs.writeFileSync('/root/clawd/contracts/locked-pool.json', JSON.stringify(poolInfo, null, 2));
    log(`Pool info saved to /root/clawd/contracts/locked-pool.json`);
}

main().catch(err => {
    log(`Error: ${err.message}`);
    if (err.logs) log(`Logs: ${err.logs.join('\n')}`);
    process.exit(1);
});
