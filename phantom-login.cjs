/**
 * SNAP AI - Phantom Wallet Login Automation
 * 
 * This script:
 * 1. Launches browser with Phantom extension
 * 2. Imports SNAP wallet using secret key
 * 3. Logs into pump.fun
 * 4. Looks for Go Live option
 */

const puppeteer = require('puppeteer');
const { Keypair } = require('@solana/web3.js');
const bs58 = require('bs58').default;
const fs = require('fs');

const delay = ms => new Promise(r => setTimeout(r, ms));

const CONTRACT = '8oCRS5SYaf4t5PGnCeQfpV7rjxGCcGqNDGHmHJBooPhX';
const PHANTOM_PATH = '/var/www/snap/extensions/phantom';

// Load wallet
const walletData = JSON.parse(fs.readFileSync('/root/.config/solana/snap-wallet.json'));
const keypair = Keypair.fromSecretKey(Uint8Array.from(walletData));
const publicKey = keypair.publicKey.toBase58();
const secretKeyBase58 = bs58.encode(keypair.secretKey);

console.log('🧠 SNAP - Phantom Wallet Automation');
console.log('====================================');
console.log(`Wallet: ${publicKey}`);
console.log(`Secret (first 10): ${secretKeyBase58.substring(0, 10)}...`);

async function main() {
  console.log('\n🚀 Launching browser with Phantom...');
  
  const browser = await puppeteer.launch({
    headless: false, // Need visible browser for extension
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      `--disable-extensions-except=${PHANTOM_PATH}`,
      `--load-extension=${PHANTOM_PATH}`,
      '--window-size=1920,1080',
    ],
    defaultViewport: { width: 1920, height: 1080 },
  });
  
  // Give Phantom time to initialize
  await delay(3000);
  
  // Get all pages/targets
  const pages = await browser.pages();
  console.log(`Found ${pages.length} pages`);
  
  // Find Phantom onboarding page
  let phantomPage = null;
  const targets = await browser.targets();
  for (const target of targets) {
    const url = target.url();
    console.log(`  Target: ${url}`);
    if (url.includes('chrome-extension://') && url.includes('onboarding')) {
      phantomPage = await target.page();
      break;
    }
  }
  
  // If no onboarding, open Phantom popup
  if (!phantomPage) {
    console.log('\n📱 Opening Phantom extension...');
    // Find extension ID
    const extensionTarget = targets.find(t => t.url().includes('chrome-extension://'));
    if (extensionTarget) {
      const extId = extensionTarget.url().match(/chrome-extension:\/\/([^\/]+)/)?.[1];
      console.log(`Extension ID: ${extId}`);
      
      // Open onboarding page directly
      phantomPage = await browser.newPage();
      await phantomPage.goto(`chrome-extension://${extId}/onboarding.html`);
      await delay(2000);
    }
  }
  
  if (phantomPage) {
    console.log('\n📱 Found Phantom page!');
    await phantomPage.screenshot({ path: '/var/www/snap/phantom-1.png' });
    console.log('📸 Screenshot: phantom-1.png');
    
    // Look for "I already have a wallet" or import option
    const pageText = await phantomPage.evaluate(() => document.body.innerText);
    console.log('\nPhantom page text:');
    console.log(pageText.substring(0, 500));
    
    // Get all buttons
    const buttons = await phantomPage.$$eval('button', els => 
      els.map(el => el.innerText.trim()).filter(t => t.length > 0)
    );
    console.log('\nButtons:', buttons);
    
    // Click "I already have a wallet" if present
    try {
      const importButton = await phantomPage.evaluateHandle(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        return btns.find(b => 
          b.innerText.includes('already have') || 
          b.innerText.includes('Import') ||
          b.innerText.includes('Use Secret')
        );
      });
      if (importButton) {
        await importButton.click();
        await delay(2000);
        await phantomPage.screenshot({ path: '/var/www/snap/phantom-2.png' });
        console.log('📸 Screenshot: phantom-2.png (after clicking import)');
      }
    } catch (e) {
      console.log('Could not find import button:', e.message);
    }
    
    // Look for secret key input
    const inputs = await phantomPage.$$('input');
    console.log(`Found ${inputs.length} inputs`);
    
    // Get current page content again
    const newText = await phantomPage.evaluate(() => document.body.innerText);
    console.log('\nCurrent page text:');
    console.log(newText.substring(0, 500));
  } else {
    console.log('❌ Could not find Phantom page');
  }
  
  console.log('\n⏸️ Browser open for manual inspection. Press Ctrl+C to exit.');
  
  // Keep browser open
  await new Promise(() => {});
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
