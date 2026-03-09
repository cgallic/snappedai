#!/usr/bin/env node
/**
 * Meteora DLMM Auto-Compounder for SNAP/USDC
 * 
 * Claims fees from the position and re-adds them as liquidity.
 * Run on a cron (e.g., every 6 hours).
 */

const { Connection, Keypair, PublicKey } = require('@solana/web3.js');
const DLMM = require('@meteora-ag/dlmm'); // DLMM is the class itself
const BN = require('bn.js');
const fs = require('fs');
const path = require('path');

const WALLET_PATH = process.env.SOLANA_WALLET || '/root/.config/solana/snap-wallet.json';
const RPC = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';
const POOL = 'DuDW6PkmDzzLtpWAHZg9kEBA3jTrpmJSazDqBM4RuKbW';
const POSITION = 'CnwzFwnn1W9K8uvebdU4hxXo4MkhmBcsDFkBvZyjcVMy';
const SNAP_DECIMALS = 5;
const USDC_DECIMALS = 6;

// Minimum fees worth compounding (avoid dust)
const MIN_SNAP_FEES = 1000; // 1000 SNAP minimum
const MIN_USDC_FEES = 0.01; // $0.01 minimum

const LOG_PATH = '/var/log/meteora-compounder.log';

function log(msg) {
    const ts = new Date().toISOString();
    const line = `[${ts}] ${msg}`;
    console.log(line);
    fs.appendFileSync(LOG_PATH, line + '\n');
}

async function main() {
    try {
        const walletData = JSON.parse(fs.readFileSync(WALLET_PATH));
        const wallet = Keypair.fromSecretKey(Uint8Array.from(walletData));
        const connection = new Connection(RPC, 'confirmed');
        
        log(`Wallet: ${wallet.publicKey.toString()}`);
        log(`Pool: ${POOL}`);
        log(`Position: ${POSITION}`);

        // Load the DLMM pool
        const dlmmPool = await DLMM.create(connection, new PublicKey(POOL));
        
        // Get position info
        const positionPubkey = new PublicKey(POSITION);
        const { userPositions } = await dlmmPool.getPositionsByUserAndLbPair(wallet.publicKey);
        
        const position = userPositions.find(p => p.publicKey.equals(positionPubkey));
        if (!position) {
            log('Position not found. Checking all positions...');
            log(`Found ${userPositions.length} positions`);
            userPositions.forEach(p => log(`  - ${p.publicKey.toString()}`));
            return;
        }

        // Get claimable fees
        const feeX = position.positionData.feeX ? 
            new BN(position.positionData.feeX.toString()).toNumber() / (10 ** SNAP_DECIMALS) : 0;
        const feeY = position.positionData.feeY ? 
            new BN(position.positionData.feeY.toString()).toNumber() / (10 ** USDC_DECIMALS) : 0;

        log(`Claimable fees: ${feeX.toFixed(2)} SNAP, ${feeY.toFixed(6)} USDC`);

        if (feeX < MIN_SNAP_FEES && feeY < MIN_USDC_FEES) {
            log('Fees below minimum threshold, skipping compound.');
            return;
        }

        // Claim fees
        log('Claiming fees...');
        const claimTx = await dlmmPool.claimAllSwapFee({
            owner: wallet.publicKey,
            positions: [position],
        });

        // claimTx can be a single tx or array
        const txs = Array.isArray(claimTx) ? claimTx : [claimTx];
        for (const tx of txs) {
            tx.feePayer = wallet.publicKey;
            const { blockhash } = await connection.getLatestBlockhash();
            tx.recentBlockhash = blockhash;
            tx.sign(wallet);
            const sig = await connection.sendRawTransaction(tx.serialize(), {
                skipPreflight: true,
                maxRetries: 3,
            });
            await connection.confirmTransaction(sig, 'confirmed');
            log(`  Claim TX: https://solscan.io/tx/${sig}`);
        }

        // Wait a moment for balance to settle
        await new Promise(r => setTimeout(r, 3000));

        // Now re-add the claimed fees as liquidity
        // Get current active bin
        await dlmmPool.refetchStates();
        const activeBin = dlmmPool.lbPair.activeId;
        log(`Active bin: ${activeBin}`);

        // Calculate raw amounts to re-add (use the claimed fee amounts)
        const rawX = Math.floor(feeX * (10 ** SNAP_DECIMALS));
        const rawY = Math.floor(feeY * (10 ** USDC_DECIMALS));

        if (rawX < 100 && rawY < 100) {
            log('Claimed amounts too small to re-add. Done.');
            return;
        }

        // spotBalanced fails on single-sided adds. Only re-add when both sides have fees.
        if (rawX < 100 || rawY < 100) {
            log(`Single-sided fees (SNAP: ${feeX.toFixed(2)}, USDC: ${feeY.toFixed(6)}). Fees claimed to wallet — will compound when both sides accumulate.`);
            // Still log the claim to state
            const stateFile = '/root/clawd/contracts/compounder-state.json';
            let state = { compounds: [], totalSnapCompounded: 0, totalUsdcCompounded: 0 };
            try { state = JSON.parse(fs.readFileSync(stateFile)); } catch(e) {}
            state.compounds.push({
                date: new Date().toISOString(),
                snapFees: feeX,
                usdcFees: feeY,
                action: 'claimed_only',
            });
            state.totalSnapCompounded += feeX;
            state.totalUsdcCompounded += feeY;
            state.lastCompound = new Date().toISOString();
            fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
            return;
        }

        // Get the existing bin range from position
        const minBin = position.positionData.lowerBinId;
        const maxBin = position.positionData.upperBinId;
        const binCount = maxBin - minBin + 1;

        log(`Re-adding: ${feeX.toFixed(2)} SNAP + ${feeY.toFixed(6)} USDC to bins ${minBin}-${maxBin}`);

        // Add liquidity using the same strategy
        const addLiqTx = await dlmmPool.addLiquidityByStrategy({
            positionPubKey: positionPubkey,
            user: wallet.publicKey,
            totalXAmount: new BN(rawX),
            totalYAmount: new BN(rawY),
            strategy: {
                maxBinId: maxBin,
                minBinId: minBin,
                strategyType: { spotBalanced: {} },
            },
            slippage: 5,
        });

        const addTxs = Array.isArray(addLiqTx) ? addLiqTx : [addLiqTx];
        for (const tx of addTxs) {
            tx.feePayer = wallet.publicKey;
            const { blockhash } = await connection.getLatestBlockhash();
            tx.recentBlockhash = blockhash;
            tx.sign(wallet);
            const sig = await connection.sendRawTransaction(tx.serialize(), {
                skipPreflight: true,
                maxRetries: 3,
            });
            await connection.confirmTransaction(sig, 'confirmed');
            log(`  Add liquidity TX: https://solscan.io/tx/${sig}`);
        }

        log(`✅ Compounded: ${feeX.toFixed(2)} SNAP + ${feeY.toFixed(6)} USDC`);

        // Log to state file
        const stateFile = '/root/clawd/contracts/compounder-state.json';
        let state = { compounds: [], totalSnapCompounded: 0, totalUsdcCompounded: 0 };
        try { state = JSON.parse(fs.readFileSync(stateFile)); } catch(e) {}
        state.compounds.push({
            date: new Date().toISOString(),
            snapFees: feeX,
            usdcFees: feeY,
        });
        state.totalSnapCompounded += feeX;
        state.totalUsdcCompounded += feeY;
        state.lastCompound = new Date().toISOString();
        fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));

    } catch (err) {
        log(`❌ Error: ${err.message}`);
        if (err.logs) log(`  Logs: ${err.logs.join('\n  ')}`);
        process.exit(1);
    }
}

main();
