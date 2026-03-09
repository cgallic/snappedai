#!/usr/bin/env node
/**
 * Create DAMM Pool with Config and Lock LP Permanently
 */

const { Connection, Keypair, PublicKey } = require('@solana/web3.js');
const { getAccount, getAssociatedTokenAddress } = require('@solana/spl-token');
const AmmImpl = require('@mercurial-finance/dynamic-amm-sdk').default;
const { PROGRAM_ID } = require('@mercurial-finance/dynamic-amm-sdk');
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
    const programId = new PublicKey(PROGRAM_ID);

    log(`Wallet: ${wallet.publicKey.toString()}`);

    // Get balances
    const snapAta = await getAssociatedTokenAddress(SNAP_MINT, wallet.publicKey);
    const usdcAta = await getAssociatedTokenAddress(USDC_MINT, wallet.publicKey);
    
    const snapAccount = await getAccount(connection, snapAta);
    const usdcAccount = await getAccount(connection, usdcAta);

    const snapAmount = new BN(snapAccount.amount.toString());
    const usdcAmount = new BN(usdcAccount.amount.toString());

    log(`SNAP: ${(Number(snapAmount) / 1e5).toLocaleString()}`);
    log(`USDC: ${(Number(usdcAmount) / 1e6).toFixed(2)}`);

    // Get fee configurations and pick one with ~0.5% fee (50 bps)
    log('Finding fee configuration...');
    const configs = await AmmImpl.getFeeConfigurations(connection, { programId });
    
    // Find a config with 50 bps (0.5%) trade fee - common permissionless config
    let config = configs.find(c => {
        const fee = c.tradeFeeBps?.toNumber?.() || 0;
        return fee === 50; // 0.5%
    });
    
    // Fallback to 100 bps (1%)
    if (!config) {
        config = configs.find(c => {
            const fee = c.tradeFeeBps?.toNumber?.() || 0;
            return fee === 100;
        });
    }
    
    // Fallback to first available
    if (!config) {
        config = configs[0];
    }

    const feeBps = config.tradeFeeBps?.toNumber?.() || 0;
    log(`Using config: ${config.publicKey.toString()} (fee: ${feeBps / 100}%)`);

    // Create pool with config
    log('Creating DAMM pool...');
    
    const createTxs = await AmmImpl.createPermissionlessConstantProductPoolWithConfig2(
        connection,
        wallet.publicKey,
        SNAP_MINT,
        USDC_MINT,
        snapAmount,
        usdcAmount,
        config.publicKey,
    );

    log(`Got ${createTxs.length} transactions`);

    for (let i = 0; i < createTxs.length; i++) {
        log(`Sending TX ${i + 1}/${createTxs.length}...`);
        const sig = await sendTx(connection, createTxs[i], wallet);
        log(`  https://solscan.io/tx/${sig}`);
    }

    log('Pool created! Finding pool to lock LP...');

    // Wait for state to settle
    await new Promise(r => setTimeout(r, 5000));

    // Find our pool by looking for SNAP pools
    log('Searching for pool...');
    const allPools = await AmmImpl.getAllAmmPools(connection);
    
    const ourPool = allPools.find(p => {
        const mintA = p.poolState.tokenAMint.toString();
        const mintB = p.poolState.tokenBMint.toString();
        return (mintA === SNAP_MINT.toString() || mintB === SNAP_MINT.toString()) &&
               (mintA === USDC_MINT.toString() || mintB === USDC_MINT.toString());
    });

    if (!ourPool) {
        log('ERROR: Could not find pool after creation');
        log(`Searched ${allPools.length} pools`);
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
        snapAmount: Number(snapAmount) / 1e5,
        usdcAmount: Number(usdcAmount) / 1e6,
        feeConfig: config.publicKey.toString(),
        feeBps: feeBps,
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
