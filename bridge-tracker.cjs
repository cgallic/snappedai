#!/usr/bin/env node
/**
 * Cross-chain SNAP tracker
 * Monitors SNAP on both Solana and Base to ensure bridge integrity
 * Alerts if anything looks wrong
 */

const fs = require('fs');

// Contract addresses
const SOLANA_SNAP = '8oCRS5SYaf4t5PGnCeQfpV7rjxGCcGqNDGHmHJBooPhX';
const BASE_SNAP = '0xfefe0be7109bd06d62c4797079313c2eb80d2d19';
const BASE_LP = '0xf83c309f81b34e396725edc0b5950a8d4f3f106d';
const BASE_BRIDGE = '0x3eff766C76a1be2Ce1aCF2B69c78bCae257D5188';

async function fetchSolanaPrice() {
    try {
        const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${SOLANA_SNAP}`);
        const data = await response.json();
        return data.pairs?.[0]?.priceUsd ? parseFloat(data.pairs[0].priceUsd) : null;
    } catch (e) {
        return null;
    }
}

async function fetchBasePrice() {
    try {
        const response = await fetch(`https://api.dexscreener.com/latest/dex/pairs/base/${BASE_LP}`);
        const data = await response.json();
        return data.pair?.priceUsd ? parseFloat(data.pair.priceUsd) : null;
    } catch (e) {
        return null;
    }
}

async function checkBridgeHealth() {
    const solanaPrice = await fetchSolanaPrice();
    const basePrice = await fetchBasePrice();
    
    const status = {
        timestamp: Date.now(),
        solana: {
            price: solanaPrice,
            available: solanaPrice !== null
        },
        base: {
            price: basePrice,
            available: basePrice !== null
        },
        arbitrage: null,
        alerts: []
    };
    
    if (solanaPrice && basePrice) {
        const priceDiff = Math.abs(solanaPrice - basePrice);
        const priceDiffPercent = (priceDiff / solanaPrice) * 100;
        
        status.arbitrage = {
            solanaPrice,
            basePrice,
            difference: priceDiff,
            differencePercent: priceDiffPercent
        };
        
        // Alert on large price differences (might indicate bridge issues)
        if (priceDiffPercent > 5) {
            status.alerts.push({
                type: 'price_divergence',
                severity: 'warning',
                message: `Price difference between chains: ${priceDiffPercent.toFixed(2)}%`
            });
        }
    }
    
    if (!solanaPrice) {
        status.alerts.push({
            type: 'solana_data',
            severity: 'error',
            message: 'Cannot fetch Solana price data'
        });
    }
    
    if (!basePrice) {
        status.alerts.push({
            type: 'base_data',
            severity: 'warning',
            message: 'Cannot fetch Base price data (pool may be new)'
        });
    }
    
    return status;
}

async function main() {
    const status = await checkBridgeHealth();
    
    // Save status
    fs.writeFileSync('/var/www/snap/api/bridge-status.json', JSON.stringify(status, null, 2));
    
    // Log summary
    console.log(`Bridge Status: ${new Date().toISOString()}`);
    if (status.solana.available && status.base.available) {
        console.log(`Solana: $${status.solana.price?.toFixed(6)}`);
        console.log(`Base: $${status.base.price?.toFixed(6)}`);
        console.log(`Difference: ${status.arbitrage?.differencePercent?.toFixed(2)}%`);
    } else {
        console.log(`Solana: ${status.solana.available ? 'OK' : 'NO DATA'}`);
        console.log(`Base: ${status.base.available ? 'OK' : 'NO DATA'}`);
    }
    
    if (status.alerts.length > 0) {
        console.log(`Alerts: ${status.alerts.length}`);
        status.alerts.forEach(alert => {
            console.log(`  [${alert.severity.toUpperCase()}] ${alert.message}`);
        });
    }
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = { checkBridgeHealth };
