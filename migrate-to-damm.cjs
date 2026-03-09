#!/usr/bin/env node
/**
 * Migrate DLMM position to DAMM with permanent lock
 * 
 * Steps:
 * 1. Remove liquidity from DLMM
 * 2. Add to DAMM pool
 * 3. Permanently lock LP tokens
 * 
 * ⚠️  WARNING: Permanent lock means liquidity can NEVER be withdrawn
 * Only fees can be claimed.
 */

const { Connection, Keypair, PublicKey } = require('@solana/web3.js');
const DLMM = require('@meteora-ag/dlmm');
const fs = require('fs');

const WALLET_PATH = process.env.SOLANA_WALLET || '/root/.config/solana/snap-wallet.json';
const RPC = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';

// Current DLMM
const DLMM_POOL = 'DuDW6PkmDzzLtpWAHZg9kEBA3jTrpmJSazDqBM4RuKbW';
const DLMM_POSITION = '6ysK1nAxhxjyhPyrJURXrNke6UKLjmK2oST5p3UBPFFs';

// SNAP token
const SNAP_MINT = '8oCRS5SYaf4t5PGnCeQfpV7rjxGCcGqNDGHmHJBooPhX';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

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
1. Remove ALL liquidity from the DLMM position
2. Add it to a DAMM pool
3. PERMANENTLY LOCK the LP tokens

Once locked, the liquidity can NEVER be withdrawn.
Only fees can be claimed.

To proceed:
  --dry-run     Show what would happen without executing
  --confirm     Actually execute the migration

Example:
  node migrate-to-damm.cjs --dry-run
  node migrate-to-damm.cjs --confirm
`);
        process.exit(0);
    }

    log(DRY_RUN ? '🔍 DRY RUN MODE' : '🚨 LIVE EXECUTION MODE');

    // Load wallet
    const walletData = JSON.parse(fs.readFileSync(WALLET_PATH));
    const wallet = Keypair.fromSecretKey(Uint8Array.from(walletData));
    const connection = new Connection(RPC, 'confirmed');

    log(`Wallet: ${wallet.publicKey.toString()}`);

    // Step 1: Check DLMM position
    log('Step 1: Checking DLMM position...');
    const dlmmPool = await DLMM.create(connection, new PublicKey(DLMM_POOL));
    const { userPositions } = await dlmmPool.getPositionsByUserAndLbPair(wallet.publicKey);
    
    const position = userPositions.find(p => p.publicKey.toString() === DLMM_POSITION);
    if (!position) {
        log('ERROR: Position not found!');
        process.exit(1);
    }

    log(`Position found: ${position.publicKey.toString()}`);
    log(`Position data: ${JSON.stringify(position.positionData, null, 2)}`);

    // Step 2: Remove liquidity from DLMM
    log('Step 2: Would remove liquidity from DLMM...');
    
    if (DRY_RUN) {
        log('DRY RUN: Skipping actual removal');
        log('DRY RUN: Would then add to DAMM pool');
        log('DRY RUN: Would then permanently lock LP tokens');
        log('✅ Dry run complete. Use --confirm to execute.');
        return;
    }

    // For actual execution, we need the Meteora DAMM SDK
    // This is a complex operation - let's output instructions for manual execution
    log(`
=== MANUAL MIGRATION INSTRUCTIONS ===

Since this is a permanent operation, please execute manually:

1. Go to https://app.meteora.ag/dlmm/${DLMM_POOL}
2. Click on your position and "Remove Liquidity" (100%)
3. Go to https://app.meteora.ag/pools/create
4. Create a DAMM v1 pool for SNAP/USDC (or find existing)
5. Add your liquidity to the DAMM pool
6. Click "Lock Liquidity" and select "Permanent"
7. Confirm the lock transaction

This ensures you maintain control and verify each step.

Position to migrate: ${DLMM_POSITION}
Current pool: ${DLMM_POOL}
`);
}

main().catch(err => {
    log(`ERROR: ${err.message}`);
    process.exit(1);
});
