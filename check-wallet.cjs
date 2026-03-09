#!/usr/bin/env node
/**
 * Wallet Balance Checker — checks SOL + SNAP + USDC balances
 * Outputs JSON to /var/www/snap/api/wallet-status.json
 * Alerts if balance drops below thresholds
 */
const https = require('https');
const fs = require('fs');

const WALLET = '4DGfMLB5rJBBVqVRXoSrGcFMzYMMHpeFUHhNrbvX9c9Z';
const RPC = 'https://api.mainnet-beta.solana.com';
const OUT = '/var/www/snap/api/wallet-status.json';

const THRESHOLDS = {
  SNAP: 100000,  // Alert if under 100K SNAP
  SOL: 0.05,     // Alert if under 0.05 SOL (can't pay tx fees)
};

function rpc(method, params) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
    const req = https.request(RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length }
    }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve(JSON.parse(body).result); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  // Get SOL balance
  const solResult = await rpc('getBalance', [WALLET]);
  const sol = solResult.value / 1e9;

  // Get token accounts
  const tokenResult = await rpc('getTokenAccountsByOwner', [
    WALLET,
    { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
    { encoding: 'jsonParsed' }
  ]);

  const tokens = {};
  for (const acct of tokenResult.value) {
    const info = acct.account.data.parsed.info;
    const mint = info.mint;
    const amount = parseFloat(info.tokenAmount.uiAmountString);
    if (mint === '8oCRS5SYaf4t5PGnCeQfpV7rjxGCcGqNDGHmHJBooPhX') tokens.SNAP = amount;
    if (mint === 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v') tokens.USDC = amount;
    if (mint === 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN') tokens.JUP = amount;
  }

  const status = {
    wallet: WALLET,
    sol,
    snap: tokens.SNAP || 0,
    usdc: tokens.USDC || 0,
    jup: tokens.JUP || 0,
    checkedAt: new Date().toISOString(),
    alerts: []
  };

  if (status.snap < THRESHOLDS.SNAP) {
    status.alerts.push(`⚠️ SNAP balance low: ${status.snap.toLocaleString()} (threshold: ${THRESHOLDS.SNAP.toLocaleString()})`);
  }
  if (status.sol < THRESHOLDS.SOL) {
    status.alerts.push(`⚠️ SOL balance low: ${status.sol} (can't pay tx fees)`);
  }

  fs.mkdirSync(require('path').dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(status, null, 2));

  console.log(`Wallet: ${WALLET}`);
  console.log(`SOL: ${sol}`);
  console.log(`SNAP: ${(tokens.SNAP || 0).toLocaleString()}`);
  console.log(`USDC: $${tokens.USDC || 0}`);
  if (status.alerts.length) {
    console.log('\nALERTS:');
    status.alerts.forEach(a => console.log(a));
  }
}

main().catch(e => console.error('Error:', e.message));
