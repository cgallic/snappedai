const { Connection, PublicKey } = require('@solana/web3.js');
const { PumpFunSDK } = require('pumpdotfun-sdk');
const { AnchorProvider } = require('@coral-xyz/anchor');
const NodeWallet = require('@coral-xyz/anchor/dist/cjs/nodewallet').default;
const { Keypair } = require('@solana/web3.js');
const fs = require('fs');

async function main() {
  const SNAP_MINT = '8oCRS5SYaf4t5PGnCeQfpV7rjxGCcGqNDGHmHJBooPhX';
  
  // Connect
  const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
  const walletData = JSON.parse(fs.readFileSync('/root/.config/solana/snap-wallet.json', 'utf8'));
  const wallet = Keypair.fromSecretKey(Uint8Array.from(walletData));
  
  const provider = new AnchorProvider(connection, new NodeWallet(wallet), { commitment: 'confirmed' });
  const sdk = new PumpFunSDK(provider);
  
  console.log('Checking SNAP token bonding curve...\n');
  
  try {
    // Get bonding curve data
    const bondingCurve = await sdk.getBondingCurveAccount(new PublicKey(SNAP_MINT));
    
    if (bondingCurve) {
      console.log('Bonding Curve Data:');
      console.log('-------------------');
      console.log('Virtual Token Reserves:', bondingCurve.virtualTokenReserves?.toString());
      console.log('Virtual SOL Reserves:', bondingCurve.virtualSolReserves?.toString());
      console.log('Real Token Reserves:', bondingCurve.realTokenReserves?.toString());
      console.log('Real SOL Reserves:', bondingCurve.realSolReserves?.toString());
      console.log('Token Total Supply:', bondingCurve.tokenTotalSupply?.toString());
      console.log('Complete:', bondingCurve.complete);
      
      // Log all properties
      console.log('\nAll properties:');
      for (const [key, value] of Object.entries(bondingCurve)) {
        if (typeof value !== 'function') {
          console.log(`  ${key}:`, value?.toString ? value.toString() : value);
        }
      }
    } else {
      console.log('No bonding curve found');
    }
    
    // Check global account for fee info
    const globalAccount = await sdk.getGlobalAccount();
    console.log('\nGlobal Account:');
    console.log('Fee Recipient:', globalAccount.feeRecipient?.toString());
    console.log('Fee Basis Points:', globalAccount.feeBasisPoints?.toString());
    
  } catch (e) {
    console.error('Error:', e.message);
  }
}

main();
