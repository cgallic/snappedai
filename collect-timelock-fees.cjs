#!/usr/bin/env node
/**
 * Collect fees from NFT Timelock on Base
 * Run on cron (e.g., every 6 hours)
 */

const { ethers } = require('ethers');
const fs = require('fs');

const RPC = process.env.BASE_RPC || 'https://mainnet.base.org';
const WALLET_PATH = process.env.ETH_WALLET || '/root/.config/solana/evm-wallet.json';
const TIMELOCK_ADDRESS = '0xD8925aC0922FaC56c3eBd51e4Ad0A8D822A98eC2';

const TIMELOCK_ABI = [
  'function collectFees() external returns (uint256 amount0, uint256 amount1)',
  'function nftId() view returns (uint256)',
  'function unlockDate() view returns (uint256)',
  'function deposited() view returns (bool)',
  'function withdrawn() view returns (bool)',
  'function owner() view returns (address)'
];

const LOG_PATH = '/var/log/timelock-fees.log';

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_PATH, line + '\n');
}

async function main() {
  try {
    // Load wallet
    let wallet;
    if (fs.existsSync(WALLET_PATH)) {
      const keyData = JSON.parse(fs.readFileSync(WALLET_PATH));
      const privateKey = keyData.privateKey || keyData;
      const provider = new ethers.JsonRpcProvider(RPC);
      wallet = new ethers.Wallet(privateKey, provider);
    } else {
      // Try .secrets
      const secretPath = '/root/clawd/.secrets/evm-wallet.json';
      if (fs.existsSync(secretPath)) {
        const keyData = JSON.parse(fs.readFileSync(secretPath));
        const provider = new ethers.JsonRpcProvider(RPC);
        wallet = new ethers.Wallet(keyData.privateKey, provider);
      } else {
        log('ERROR: No wallet found');
        process.exit(1);
      }
    }

    log(`Wallet: ${wallet.address}`);
    log(`Timelock: ${TIMELOCK_ADDRESS}`);

    const timelock = new ethers.Contract(TIMELOCK_ADDRESS, TIMELOCK_ABI, wallet);

    // Check state
    const owner = await timelock.owner();
    const deposited = await timelock.deposited();
    const withdrawn = await timelock.withdrawn();
    const nftId = await timelock.nftId();
    const unlockDate = await timelock.unlockDate();

    log(`Owner: ${owner}`);
    log(`NFT ID: ${nftId.toString()}`);
    log(`Deposited: ${deposited}, Withdrawn: ${withdrawn}`);
    log(`Unlock: ${new Date(Number(unlockDate) * 1000).toISOString()}`);

    if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
      log('ERROR: Wallet is not the owner');
      process.exit(1);
    }

    if (!deposited || withdrawn) {
      log('Cannot collect: not deposited or already withdrawn');
      process.exit(0);
    }

    // Collect fees
    log('Collecting fees...');
    const tx = await timelock.collectFees();
    log(`TX: ${tx.hash}`);
    
    const receipt = await tx.wait();
    log(`Confirmed in block ${receipt.blockNumber}`);

    // Parse events for amounts
    for (const event of receipt.logs) {
      log(`Log: ${event.topics[0]}`);
    }

    log('✅ Fees collected successfully');

  } catch (err) {
    log(`ERROR: ${err.message}`);
    process.exit(1);
  }
}

main();
