#!/usr/bin/env node
/**
 * Lock SNAP tokens using StreamFlow - Token Lock
 */

const { Connection, Keypair, PublicKey } = require('@solana/web3.js');
const { getAccount, getAssociatedTokenAddress } = require('@solana/spl-token');
const { SolanaStreamClient, getBN } = require('@streamflow/stream');
const { BN } = require('bn.js');
const fs = require('fs');

const WALLET_PATH = '/root/.config/solana/snap-wallet.json';
const RPC = 'https://api.mainnet-beta.solana.com';
const SNAP_MINT = '8oCRS5SYaf4t5PGnCeQfpV7rjxGCcGqNDGHmHJBooPhX';
const SNAP_DECIMALS = 5;

function log(msg) {
    console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function main() {
    const walletData = JSON.parse(fs.readFileSync(WALLET_PATH));
    const wallet = Keypair.fromSecretKey(Uint8Array.from(walletData));
    const connection = new Connection(RPC, 'confirmed');

    log(`Wallet: ${wallet.publicKey.toString()}`);

    // Get SNAP balance
    const snapAta = await getAssociatedTokenAddress(
        new PublicKey(SNAP_MINT), 
        wallet.publicKey
    );
    const snapAccount = await getAccount(connection, snapAta);
    const rawBalance = new BN(snapAccount.amount.toString());
    
    log(`SNAP balance: ${(Number(rawBalance) / 1e5).toLocaleString()}`);

    // Initialize StreamFlow client
    const client = new SolanaStreamClient(RPC);

    // 10 years from now in seconds (StreamFlow has timestamp limits)
    const now = Math.floor(Date.now() / 1000);
    const tenYears = 10 * 365 * 24 * 60 * 60;
    const unlockTime = now + tenYears;

    // Token lock parameters - cliff amount = total - 1 (smallest unit)
    const cliffAmount = rawBalance.subn(1);

    const createParams = {
        recipient: wallet.publicKey.toString(), // Lock to self
        tokenId: SNAP_MINT,
        start: unlockTime, // Start = unlock time (100 years from now)
        amount: rawBalance,
        period: 1, // 1 second
        cliff: unlockTime, // Cliff = start = unlock time
        cliffAmount: cliffAmount, // Almost all unlocks at cliff
        amountPerPeriod: new BN(1), // Remaining 1 unit over 1 second
        name: 'SNAP 100yr Lock',
        canTopup: false,
        cancelableBySender: false,
        cancelableByRecipient: false,
        transferableBySender: false,
        transferableByRecipient: false,
        automaticWithdrawal: false,
    };

    const solanaParams = {
        sender: wallet,
    };

    log('Creating StreamFlow token lock...');
    log(`Amount: ${(Number(rawBalance) / 1e5).toLocaleString()} SNAP`);
    log(`Unlock: ${new Date(unlockTime * 1000).toISOString()} (10 years)`);
    log(`Cancelable: NO`);
    log(`Transferable: NO`);

    try {
        const result = await client.create(createParams, solanaParams);
        
        log(`✅ StreamFlow lock created!`);
        log(`Stream ID: ${result.metadataId}`);
        log(`TX: https://solscan.io/tx/${result.txId || result.tx}`);
        
        // Save info
        const info = {
            createdAt: new Date().toISOString(),
            streamId: result.metadataId,
            tx: result.txId || result.tx,
            amount: Number(rawBalance) / 1e5,
            unlockDate: new Date(unlockTime * 1000).toISOString(),
            cancelable: false,
            transferable: false,
        };
        fs.writeFileSync('/root/clawd/contracts/streamflow-lock.json', JSON.stringify(info, null, 2));
        log('Info saved to /root/clawd/contracts/streamflow-lock.json');
        
    } catch (err) {
        log(`Error: ${err.message}`);
        if (err.logs) err.logs.forEach(l => log(`  ${l}`));
        throw err;
    }
}

main().catch(err => {
    log(`FAILED: ${err.message}`);
    process.exit(1);
});
