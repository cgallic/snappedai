#!/usr/bin/env node
/**
 * Create DAMM Pool and Lock LP Permanently
 */

const { Connection, Keypair, PublicKey, sendAndConfirmTransaction } = require('@solana/web3.js');
const { getAccount, getAssociatedTokenAddress } = require('@solana/spl-token');
const AmmImpl = require('@mercurial-finance/dynamic-amm-sdk').default;
const { BN } = require('bn.js');
const fs = require('fs');

const WALLET_PATH = '/root/.config/solana/snap-wallet.json';
const RPC = 'https://api.mainnet-beta.solana.com';

const SNAP_MINT = new PublicKey('8oCRS5SYaf4t5PGnCeQfpV7rjxGCcGqNDGHmHJBooPhX');
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

function log(msg) {
    console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function sendTx(connection, tx, wallet) {
    tx.feePayer = wallet.publicKey;
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.sign(wallet);
    
    const sig = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: true,
        maxRetries: 5,
    });
    
    await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
    return sig;
}

async function main() {
    const walletData = JSON.parse(fs.readFileSync(WALLET_PATH));
    const wallet = Keypair.fromSecretKey(Uint8Array.from(walletData));
    const connection = new Connection(RPC, 'confirmed');

    log(`Wallet: ${wallet.publicKey.toString()}`);

    // Get balances
    const snapAta = await getAssociatedTokenAddress(SNAP_MINT, wallet.publicKey);
    const usdcAta = await getAssociatedTokenAddress(USDC_MINT, wallet.publicKey);
    
    const snapAccount = await getAccount(connection, snapAta);
    const usdcAccount = await getAccount(connection, usdcAta);

    const snapAmount = Number(snapAccount.amount);
    const usdcAmount = Number(usdcAccount.amount);

    log(`SNAP: ${(snapAmount / 1e5).toLocaleString()}`);
    log(`USDC: ${(usdcAmount / 1e6).toFixed(2)}`);

    // Create permissionless volatile pool with 0.25% fee
    log('Creating DAMM pool...');
    
    const feeBps = new BN(25); // 0.25%
    
    const createTxs = await AmmImpl.createPermissionlessPool(
        connection,
        wallet.publicKey,
        SNAP_MINT,
        USDC_MINT,
        new BN(snapAmount),
        new BN(usdcAmount),
        false, // volatile (not stable)
        feeBps,
    );

    log(`Got ${createTxs.length} transactions`);

    for (let i = 0; i < createTxs.length; i++) {
        log(`Sending TX ${i + 1}/${createTxs.length}...`);
        const sig = await sendTx(connection, createTxs[i], wallet);
        log(`  https://solscan.io/tx/${sig}`);
    }

    log('Pool created! Finding pool to lock LP...');

    // Wait for state to settle
    await new Promise(r => setTimeout(r, 3000));

    // Find our pool
    const allPools = await AmmImpl.getAllAmmPools(connection);
    const ourPool = allPools.find(p => {
        const mints = [p.poolState.tokenAMint.toString(), p.poolState.tokenBMint.toString()];
        return mints.includes(SNAP_MINT.toString()) && mints.includes(USDC_MINT.toString());
    });

    if (!ourPool) {
        log('ERROR: Could not find pool after creation');
        // List some pools for debug
        log('Looking for SNAP in any pool...');
        const snapPools = allPools.filter(p => 
            p.poolState.tokenAMint.toString() === SNAP_MINT.toString() ||
            p.poolState.tokenBMint.toString() === SNAP_MINT.toString()
        );
        snapPools.forEach(p => log(`  Found: ${p.address.toString()}`));
        return;
    }

    log(`Found pool: ${ourPool.address.toString()}`);

    // Get LP balance
    const lpMint = ourPool.poolState.lpMint;
    const lpAta = await getAssociatedTokenAddress(lpMint, wallet.publicKey);
    
    let lpBalance;
    try {
        const lpAccount = await getAccount(connection, lpAta);
        lpBalance = new BN(lpAccount.amount.toString());
    } catch (e) {
        log('ERROR: No LP tokens found in wallet');
        return;
    }

    log(`LP balance: ${lpBalance.toString()}`);

    // Lock LP permanently
    log('Locking LP permanently...');
    
    const lockTx = await ourPool.lockLiquidity(wallet.publicKey, lpBalance);
    const lockSig = await sendTx(connection, lockTx, wallet);
    log(`Lock TX: https://solscan.io/tx/${lockSig}`);

    log('');
    log('✅ LIQUIDITY PERMANENTLY LOCKED!');
    log(`Pool: ${ourPool.address.toString()}`);
    log(`LP Mint: ${lpMint.toString()}`);
    
    // Save info
    const info = {
        createdAt: new Date().toISOString(),
        pool: ourPool.address.toString(),
        lpMint: lpMint.toString(),
        snapAmount: snapAmount / 1e5,
        usdcAmount: usdcAmount / 1e6,
        locked: 'PERMANENT',
    };
    fs.writeFileSync('/root/clawd/contracts/damm-locked.json', JSON.stringify(info, null, 2));
    log('Info saved to /root/clawd/contracts/damm-locked.json');
}

main().catch(err => {
    log(`ERROR: ${err.message}`);
    if (err.logs) err.logs.forEach(l => log(`  ${l}`));
    process.exit(1);
});
