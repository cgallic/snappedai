/**
 * Setup Phantom wallet once, then leave browser open for agent-browser
 */
const puppeteer = require('puppeteer');
const { Keypair } = require('@solana/web3.js');
const bs58 = require('bs58').default;
const fs = require('fs');

const delay = ms => new Promise(r => setTimeout(r, ms));
const PHANTOM_PATH = '/var/www/snap/extensions/phantom';
const WALLET_PASSWORD = 'SnapAI2026!';

// Load wallet
const walletData = JSON.parse(fs.readFileSync('/root/.config/solana/snap-wallet.json'));
const keypair = Keypair.fromSecretKey(Uint8Array.from(walletData));
const secretKeyBase58 = bs58.encode(keypair.secretKey);

console.log('🧠 Setting up Phantom wallet...');
console.log(`Wallet: ${keypair.publicKey.toBase58()}`);

async function main() {
  const browser = await puppeteer.launch({
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      `--disable-extensions-except=${PHANTOM_PATH}`,
      `--load-extension=${PHANTOM_PATH}`,
      '--window-size=1920,1080',
      '--remote-debugging-port=9222', // Enable CDP for agent-browser to connect
    ],
    defaultViewport: { width: 1920, height: 1080 },
  });

  await delay(3000);

  // Find Phantom onboarding page
  const targets = await browser.targets();
  let phantomPage = null;
  
  for (const target of targets) {
    const url = target.url();
    console.log('Target:', url);
    if (url.includes('chrome-extension://') && url.includes('onboarding')) {
      phantomPage = await target.page();
      break;
    }
  }

  if (!phantomPage) {
    // Open onboarding manually
    const extId = 'bfnaelmomeimhlpmgjnjophhpkkoljpa';
    phantomPage = await browser.newPage();
    await phantomPage.goto(`chrome-extension://${extId}/onboarding.html`);
    await delay(2000);
  }

  console.log('📱 On Phantom onboarding page');
  await phantomPage.screenshot({ path: '/var/www/snap/phantom-setup-1.png' });

  // Step 1: Click "I already have a wallet"
  console.log('Step 1: Clicking "I already have a wallet"...');
  await phantomPage.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button'))
      .find(b => b.innerText.includes('already have'));
    if (btn) btn.click();
  });
  await delay(2000);
  await phantomPage.screenshot({ path: '/var/www/snap/phantom-setup-2.png' });

  // Step 2: Click "Import Private Key"
  console.log('Step 2: Clicking "Import Private Key"...');
  await phantomPage.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button'))
      .find(b => b.innerText.includes('Private Key'));
    if (btn) btn.click();
  });
  await delay(2000);
  await phantomPage.screenshot({ path: '/var/www/snap/phantom-setup-3.png' });

  // Step 3: Fill in wallet name and private key
  console.log('Step 3: Entering wallet details...');
  const inputs = await phantomPage.$$('input');
  const textareas = await phantomPage.$$('textarea');
  
  // Find and fill name input
  for (const input of inputs) {
    const placeholder = await input.evaluate(el => el.placeholder || el.name || '');
    console.log('  Input placeholder:', placeholder);
    if (placeholder.toLowerCase().includes('name')) {
      await input.type('SNAP Wallet');
    }
  }
  
  // Find and fill private key input (might be textarea)
  const keyInputs = [...inputs, ...textareas];
  for (const input of keyInputs) {
    const placeholder = await input.evaluate(el => el.placeholder || el.name || '');
    if (placeholder.toLowerCase().includes('key') || placeholder.toLowerCase().includes('private')) {
      await input.type(secretKeyBase58);
      console.log('  ✓ Entered private key');
    }
  }
  
  await delay(500);
  await phantomPage.screenshot({ path: '/var/www/snap/phantom-setup-4.png' });

  // Step 4: Click Import
  console.log('Step 4: Clicking Import...');
  await phantomPage.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button'))
      .find(b => b.innerText === 'Import');
    if (btn) btn.click();
  });
  await delay(3000);
  await phantomPage.screenshot({ path: '/var/www/snap/phantom-setup-5.png' });

  // Step 5: Set password
  console.log('Step 5: Setting password...');
  const pwInputs = await phantomPage.$$('input[type="password"]');
  console.log(`  Found ${pwInputs.length} password inputs`);
  
  if (pwInputs.length >= 2) {
    await pwInputs[0].type(WALLET_PASSWORD);
    await pwInputs[1].type(WALLET_PASSWORD);
    
    // Check terms checkbox
    const checkboxes = await phantomPage.$$('input[type="checkbox"]');
    for (const cb of checkboxes) {
      await cb.click();
    }
    
    await delay(500);
    
    // Click Continue/Create
    await phantomPage.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button'))
        .find(b => b.innerText.includes('Continue') || b.innerText.includes('Create') || b.innerText.includes('Save'));
      if (btn) btn.click();
    });
    await delay(3000);
  }
  
  await phantomPage.screenshot({ path: '/var/www/snap/phantom-setup-6.png' });

  // Check final state
  const pageText = await phantomPage.evaluate(() => document.body.innerText);
  console.log('\n📄 Final page state:', pageText.substring(0, 300));

  console.log('\n✨ Phantom setup complete!');
  console.log('CDP port: 9222');
  console.log('Browser staying open - connect with: agent-browser connect 9222');

  // Keep browser open
  await new Promise(() => {});
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
