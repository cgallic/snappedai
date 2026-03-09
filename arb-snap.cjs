#!/usr/bin/env node
/**
 * SNAP/USDC Arbitrage Bot
 * 
 * Monitors price on Meteora DLMM vs Jupiter (PumpSwap/Raydium/Orca)
 * and executes trades when spread exceeds threshold.
 * 
 * Strategy:
 *   1. Get SNAP price on Meteora DLMM (our pool)
 *   2. Get SNAP price via Jupiter aggregator (best route)
 *   3. If spread > threshold:
 *      - Buy cheap, sell expensive
 *      - Meteora: direct swap on pool
 *      - Jupiter: aggregated swap
 * 
 * Usage:
 *   node arb-snap.cjs                    # Monitor mode (dry run)
 *   node arb-snap.cjs --execute          # Live execution
 *   node arb-snap.cjs --loop             # Continuous monitoring
 *   node arb-snap.cjs --loop --execute   # Continuous live arb
 */

const { Connection, Keypair, PublicKey, VersionedTransaction } = require('@solana/web3.js');
const { getAssociatedTokenAddress } = require('@solana/spl-token');
const DLMM = require('@meteora-ag/dlmm');
const BN = require('bn.js');
const fs = require('fs');

// ── Config ──────────────────────────────────────────────────────────────────
const SNAP_MINT = '8oCRS5SYaf4t5PGnCeQfpV7rjxGCcGqNDGHmHJBooPhX';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const POOL_ADDRESS = 'DuDW6PkmDzzLtpWAHZg9kEBA3jTrpmJSazDqBM4RuKbW';
const WALLET_PATH = '/root/.config/solana/snap-wallet.json';
const RPC_URL = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';

const SNAP_DECIMALS = 6;
const USDC_DECIMALS = 6;

// Arb parameters
const MIN_SPREAD_BPS = 100;       // Min spread to arb (1% = 100 bps)
const TRADE_AMOUNT_USDC = 5;      // USDC per arb trade
const TRADE_AMOUNT_SNAP = 50000;  // SNAP per arb trade
const MAX_SLIPPAGE_BPS = 200;     // Max slippage (2%)
const LOOP_INTERVAL_MS = 10000;   // Check every 10s
const LOG_FILE = '/var/log/snap-arb.log';

// ── Helpers ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const EXECUTE = args.includes('--execute');
const LOOP = args.includes('--loop');

function log(msg) {
    const ts = new Date().toISOString();
    const line = `[${ts}] ${msg}`;
    console.log(line);
    try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch(e) {}
}

// ── Jupiter Quote ───────────────────────────────────────────────────────────
async function getJupiterQuote(inputMint, outputMint, amount, slippageBps = 100) {
    const url = `https://lite-api.jup.ag/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippageBps}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Jupiter quote failed: ${resp.status} ${await resp.text()}`);
    return resp.json();
}

async function executeJupiterSwap(quote, walletPubkey) {
    const resp = await fetch('https://lite-api.jup.ag/swap/v1/swap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            quoteResponse: quote,
            userPublicKey: walletPubkey.toString(),
            wrapAndUnwrapSol: true,
            dynamicComputeUnitLimit: true,
            prioritizationFeeLamports: 100000,
        }),
    });
    if (!resp.ok) throw new Error(`Jupiter swap failed: ${resp.status}`);
    return resp.json();
}

// ── Meteora Quote ───────────────────────────────────────────────────────────
async function getMeteoraPrices(dlmmPool) {
    const activeBin = await dlmmPool.getActiveBin();
    const pricePerLamport = activeBin.price; // price of X in terms of Y
    
    // Price = how much USDC per 1 SNAP
    // pricePerLamport is already in human readable if from getActiveBin
    const snapPriceUsdc = parseFloat(pricePerLamport);
    
    return {
        activeBinId: activeBin.binId,
        snapPriceUsdc,
        raw: activeBin,
    };
}

async function executeMeteorSwap(dlmmPool, wallet, inToken, inAmount, minOutAmount) {
    const isXtoY = inToken === SNAP_MINT; // SNAP→USDC = X→Y
    
    const swapQuote = await dlmmPool.swapQuote(
        new BN(inAmount),
        isXtoY,
        new BN(MAX_SLIPPAGE_BPS),
    );
    
    const swapTx = await dlmmPool.swap({
        inToken: new PublicKey(inToken),
        binArraysPubkey: swapQuote.binArraysPubkey,
        inAmount: new BN(inAmount),
        lbPair: dlmmPool.pubkey,
        user: wallet.publicKey,
        minOutAmount: swapQuote.minOutAmount,
        outToken: new PublicKey(isXtoY ? USDC_MINT : SNAP_MINT),
    });
    
    return swapTx;
}

// ── Arb Logic ───────────────────────────────────────────────────────────────
async function checkAndArb(connection, wallet, dlmmPool) {
    try {
        // 1. Get Meteora price
        const meteoraPrice = await getMeteoraPrices(dlmmPool);
        
        // 2. Get Jupiter price (USDC → SNAP)
        const jupBuyQuote = await getJupiterQuote(
            USDC_MINT, SNAP_MINT,
            TRADE_AMOUNT_USDC * (10 ** USDC_DECIMALS),
            MAX_SLIPPAGE_BPS
        );
        const jupSnapOut = parseInt(jupBuyQuote.outAmount) / (10 ** SNAP_DECIMALS);
        const jupBuyPrice = TRADE_AMOUNT_USDC / jupSnapOut; // USDC per SNAP via Jupiter
        
        // 3. Get Jupiter price (SNAP → USDC)
        const jupSellQuote = await getJupiterQuote(
            SNAP_MINT, USDC_MINT,
            TRADE_AMOUNT_SNAP * (10 ** SNAP_DECIMALS),
            MAX_SLIPPAGE_BPS
        );
        const jupUsdcOut = parseInt(jupSellQuote.outAmount) / (10 ** USDC_DECIMALS);
        const jupSellPrice = jupUsdcOut / TRADE_AMOUNT_SNAP; // USDC per SNAP via Jupiter
        
        // 4. Get Meteora swap quotes
        let meteoraBuySnapOut = 0, meteoraSellUsdcOut = 0;
        
        // Load bin arrays for swap quotes
        const binArrays = await dlmmPool.getBinArrayForSwap(false);
        const binArraysSell = await dlmmPool.getBinArrayForSwap(true);
        
        try {
            const metBuyQuote = dlmmPool.swapQuote(
                new BN(TRADE_AMOUNT_USDC * (10 ** USDC_DECIMALS)),
                false, // Y→X (USDC→SNAP)
                new BN(MAX_SLIPPAGE_BPS),
                binArrays,
            );
            meteoraBuySnapOut = parseInt(metBuyQuote.outAmount.toString()) / (10 ** SNAP_DECIMALS);
        } catch(e) {
            log(`  Meteora buy quote failed: ${e.message}`);
        }
        
        let meteoraBuyPrice = meteoraBuySnapOut > 0 ? TRADE_AMOUNT_USDC / meteoraBuySnapOut : 0;
        
        try {
            const metSellQuote = dlmmPool.swapQuote(
                new BN(TRADE_AMOUNT_SNAP * (10 ** SNAP_DECIMALS)),
                true, // X→Y (SNAP→USDC) 
                new BN(MAX_SLIPPAGE_BPS),
                binArraysSell,
            );
            meteoraSellUsdcOut = parseInt(metSellQuote.outAmount.toString()) / (10 ** USDC_DECIMALS);
        } catch(e) {
            log(`  Meteora sell quote failed: ${e.message}`);
        }
        
        let meteoraSellPrice = meteoraSellUsdcOut > 0 ? meteoraSellUsdcOut / TRADE_AMOUNT_SNAP : 0;
        
        // 5. Calculate spreads
        // Opportunity A: Buy on Jupiter, sell on Meteora
        const spreadA = meteoraSellPrice > 0 && jupBuyPrice > 0 
            ? ((meteoraSellPrice - jupBuyPrice) / jupBuyPrice) * 10000 
            : 0;
        
        // Opportunity B: Buy on Meteora, sell on Jupiter  
        const spreadB = jupSellPrice > 0 && meteoraBuyPrice > 0
            ? ((jupSellPrice - meteoraBuyPrice) / meteoraBuyPrice) * 10000
            : 0;
        
        // Display
        log(`━━━ Price Check ━━━`);
        log(`  Meteora active bin: ${meteoraPrice.activeBinId}, price: $${meteoraPrice.snapPriceUsdc.toFixed(8)}`);
        log(`  Jupiter buy  (${TRADE_AMOUNT_USDC} USDC → SNAP): ${jupSnapOut.toFixed(0)} SNAP ($${jupBuyPrice.toFixed(8)}/SNAP)`);
        log(`  Jupiter sell (${TRADE_AMOUNT_SNAP} SNAP → USDC): $${jupUsdcOut.toFixed(4)} ($${jupSellPrice.toFixed(8)}/SNAP)`);
        log(`  Meteora buy  (${TRADE_AMOUNT_USDC} USDC → SNAP): ${meteoraBuySnapOut.toFixed(0)} SNAP ($${meteoraBuyPrice.toFixed(8)}/SNAP)`);
        log(`  Meteora sell (${TRADE_AMOUNT_SNAP} SNAP → USDC): $${meteoraSellUsdcOut.toFixed(4)} ($${meteoraSellPrice.toFixed(8)}/SNAP)`);
        log(`  Spread A (buy Jup, sell Met): ${spreadA.toFixed(1)} bps`);
        log(`  Spread B (buy Met, sell Jup): ${spreadB.toFixed(1)} bps`);
        
        // 6. Execute if profitable
        if (spreadA > MIN_SPREAD_BPS) {
            log(`🔥 ARB OPPORTUNITY A: Buy Jupiter → Sell Meteora (+${spreadA.toFixed(1)} bps)`);
            if (EXECUTE) {
                await executeArbA(connection, wallet, dlmmPool, jupBuyQuote);
            } else {
                log(`  [DRY RUN] Would buy ${jupSnapOut.toFixed(0)} SNAP on Jupiter for $${TRADE_AMOUNT_USDC}, sell on Meteora for ~$${(jupSnapOut * meteoraSellPrice).toFixed(4)}`);
                const profit = (jupSnapOut * meteoraSellPrice) - TRADE_AMOUNT_USDC;
                log(`  Estimated profit: $${profit.toFixed(4)}`);
            }
        } else if (spreadB > MIN_SPREAD_BPS) {
            log(`🔥 ARB OPPORTUNITY B: Buy Meteora → Sell Jupiter (+${spreadB.toFixed(1)} bps)`);
            if (EXECUTE) {
                await executeArbB(connection, wallet, dlmmPool, jupSellQuote);
            } else {
                log(`  [DRY RUN] Would buy ${meteoraBuySnapOut.toFixed(0)} SNAP on Meteora for $${TRADE_AMOUNT_USDC}, sell on Jupiter for ~$${(meteoraBuySnapOut * jupSellPrice).toFixed(4)}`);
                const profit = (meteoraBuySnapOut * jupSellPrice) - TRADE_AMOUNT_USDC;
                log(`  Estimated profit: $${profit.toFixed(4)}`);
            }
        } else {
            log(`  No arb opportunity (need >${MIN_SPREAD_BPS} bps)`);
        }
        
        return { spreadA, spreadB, meteoraPrice, jupBuyPrice, jupSellPrice };
        
    } catch (err) {
        log(`Error in arb check: ${err.message}`);
        return null;
    }
}

// ── Execute Arb ─────────────────────────────────────────────────────────────
async function executeArbA(connection, wallet, dlmmPool, jupQuote) {
    // Step 1: Buy SNAP on Jupiter (USDC → SNAP)
    log('  Step 1: Buying SNAP on Jupiter...');
    const swapData = await executeJupiterSwap(jupQuote, wallet.publicKey);
    const swapTx = VersionedTransaction.deserialize(Buffer.from(swapData.swapTransaction, 'base64'));
    swapTx.sign([wallet]);
    const sig1 = await connection.sendRawTransaction(swapTx.serialize(), { skipPreflight: true, maxRetries: 3 });
    await connection.confirmTransaction(sig1, 'confirmed');
    log(`  Jupiter buy TX: https://solscan.io/tx/${sig1}`);
    
    // Wait for balance settlement
    await new Promise(r => setTimeout(r, 3000));
    
    // Step 2: Sell SNAP on Meteora (SNAP → USDC)
    log('  Step 2: Selling SNAP on Meteora...');
    const snapAmount = parseInt(jupQuote.outAmount);
    await dlmmPool.refetchStates();
    const sellQuote = await dlmmPool.swapQuote(new BN(snapAmount), true, new BN(MAX_SLIPPAGE_BPS));
    
    const sellTx = await dlmmPool.swap({
        inToken: new PublicKey(SNAP_MINT),
        binArraysPubkey: sellQuote.binArraysPubkey,
        inAmount: new BN(snapAmount),
        lbPair: dlmmPool.pubkey,
        user: wallet.publicKey,
        minOutAmount: sellQuote.minOutAmount,
        outToken: new PublicKey(USDC_MINT),
    });
    
    sellTx.feePayer = wallet.publicKey;
    const { blockhash } = await connection.getLatestBlockhash();
    sellTx.recentBlockhash = blockhash;
    sellTx.sign(wallet);
    const sig2 = await connection.sendRawTransaction(sellTx.serialize(), { skipPreflight: true, maxRetries: 3 });
    await connection.confirmTransaction(sig2, 'confirmed');
    log(`  Meteora sell TX: https://solscan.io/tx/${sig2}`);
    log(`  ✅ Arb A complete!`);
}

async function executeArbB(connection, wallet, dlmmPool, jupQuote) {
    // Step 1: Buy SNAP on Meteora (USDC → SNAP)
    log('  Step 1: Buying SNAP on Meteora...');
    const usdcAmount = TRADE_AMOUNT_USDC * (10 ** USDC_DECIMALS);
    await dlmmPool.refetchStates();
    const buyQuote = await dlmmPool.swapQuote(new BN(usdcAmount), false, new BN(MAX_SLIPPAGE_BPS));
    
    const buyTx = await dlmmPool.swap({
        inToken: new PublicKey(USDC_MINT),
        binArraysPubkey: buyQuote.binArraysPubkey,
        inAmount: new BN(usdcAmount),
        lbPair: dlmmPool.pubkey,
        user: wallet.publicKey,
        minOutAmount: buyQuote.minOutAmount,
        outToken: new PublicKey(SNAP_MINT),
    });
    
    buyTx.feePayer = wallet.publicKey;
    const { blockhash: bh1 } = await connection.getLatestBlockhash();
    buyTx.recentBlockhash = bh1;
    buyTx.sign(wallet);
    const sig1 = await connection.sendRawTransaction(buyTx.serialize(), { skipPreflight: true, maxRetries: 3 });
    await connection.confirmTransaction(sig1, 'confirmed');
    log(`  Meteora buy TX: https://solscan.io/tx/${sig1}`);
    
    // Wait for balance settlement
    await new Promise(r => setTimeout(r, 3000));
    
    // Step 2: Sell SNAP on Jupiter (SNAP → USDC)
    log('  Step 2: Selling SNAP on Jupiter...');
    // Re-quote Jupiter with actual amount received
    const snapBought = parseInt(buyQuote.consumedOutAmount.toString());
    const freshQuote = await getJupiterQuote(SNAP_MINT, USDC_MINT, snapBought, MAX_SLIPPAGE_BPS);
    const swapData = await executeJupiterSwap(freshQuote, wallet.publicKey);
    const swapTx = VersionedTransaction.deserialize(Buffer.from(swapData.swapTransaction, 'base64'));
    swapTx.sign([wallet]);
    const sig2 = await connection.sendRawTransaction(swapTx.serialize(), { skipPreflight: true, maxRetries: 3 });
    await connection.confirmTransaction(sig2, 'confirmed');
    log(`  Jupiter sell TX: https://solscan.io/tx/${sig2}`);
    log(`  ✅ Arb B complete!`);
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
    log(`\n${'='.repeat(60)}`);
    log(`SNAP Arbitrage Bot | ${EXECUTE ? 'LIVE' : 'DRY RUN'} | ${LOOP ? 'LOOP' : 'SINGLE'}`);
    log(`Pool: ${POOL_ADDRESS}`);
    log(`Min spread: ${MIN_SPREAD_BPS} bps | Trade: $${TRADE_AMOUNT_USDC} USDC / ${TRADE_AMOUNT_SNAP} SNAP`);
    log(`${'='.repeat(60)}`);
    
    const connection = new Connection(RPC_URL);
    const wallet = Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(fs.readFileSync(WALLET_PATH, 'utf8')))
    );
    log(`Wallet: ${wallet.publicKey.toString()}`);
    
    const dlmmPool = await DLMM.create(connection, new PublicKey(POOL_ADDRESS));
    log(`Pool loaded: ${dlmmPool.lbPair.tokenXMint.toString()} / ${dlmmPool.lbPair.tokenYMint.toString()}`);
    
    if (LOOP) {
        log(`Starting loop (every ${LOOP_INTERVAL_MS / 1000}s)...`);
        while (true) {
            await dlmmPool.refetchStates();
            await checkAndArb(connection, wallet, dlmmPool);
            await new Promise(r => setTimeout(r, LOOP_INTERVAL_MS));
        }
    } else {
        await checkAndArb(connection, wallet, dlmmPool);
    }
}

main().catch(e => {
    log(`Fatal: ${e.message}`);
    process.exit(1);
});
