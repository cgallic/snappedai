/**
 * SNAP AI - Full Pump.fun Livestream Automation
 * 
 * Complete flow:
 * 1. Launch browser with Phantom
 * 2. Import SNAP wallet via private key
 * 3. Navigate to pump.fun
 * 4. Connect wallet
 * 5. Go Live!
 */

const puppeteer = require('puppeteer');
const { Keypair } = require('@solana/web3.js');
const bs58 = require('bs58').default;
const fs = require('fs');

const delay = ms => new Promise(r => setTimeout(r, ms));

const CONTRACT = '8oCRS5SYaf4t5PGnCeQfpV7rjxGCcGqNDGHmHJBooPhX';
const PHANTOM_PATH = '/var/www/snap/extensions/phantom';
const WALLET_PASSWORD = 'SnapAI2026!'; // Password for Phantom wallet

// Load wallet
const walletData = JSON.parse(fs.readFileSync('/root/.config/solana/snap-wallet.json'));
const keypair = Keypair.fromSecretKey(Uint8Array.from(walletData));
const publicKey = keypair.publicKey.toBase58();
const secretKeyBase58 = bs58.encode(keypair.secretKey);

console.log('🧠 SNAP AI - Full Livestream Automation');
console.log('=======================================');
console.log(`Wallet: ${publicKey}`);

async function setupPhantom(browser) {
  console.log('\n📱 Setting up Phantom wallet...');
  
  // Wait for Phantom to initialize
  await delay(3000);
  
  // Find Phantom onboarding page
  const targets = await browser.targets();
  const onboardingTarget = targets.find(t => t.url().includes('onboarding'));
  
  if (!onboardingTarget) {
    throw new Error('Phantom onboarding not found');
  }
  
  const page = await onboardingTarget.page();
  await delay(1000);
  
  // Step 1: Click "I already have a wallet"
  console.log('   Step 1: Selecting import option...');
  const importBtn = await page.evaluateHandle(() => {
    return Array.from(document.querySelectorAll('button'))
      .find(b => b.innerText.includes('already have'));
  });
  await importBtn.click();
  await delay(2000);
  
  // Step 2: Click "Import Private Key"
  console.log('   Step 2: Selecting private key import...');
  const privateKeyBtn = await page.evaluateHandle(() => {
    return Array.from(document.querySelectorAll('button'))
      .find(b => b.innerText.includes('Private Key'));
  });
  await privateKeyBtn.click();
  await delay(2000);
  
  await page.screenshot({ path: '/var/www/snap/auto-step2.png' });
  
  // Step 3: Select Solana network (if network selection appears)
  console.log('   Step 3: Looking for Solana option...');
  try {
    const solanaBtn = await page.$('button:has-text("Solana")');
    if (solanaBtn) {
      await solanaBtn.click();
      await delay(2000);
    } else {
      // Try clicking via evaluate
      await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button'))
          .find(b => b.innerText.includes('Solana'));
        if (btn) btn.click();
      });
      await delay(2000);
    }
  } catch (e) {
    console.log('   No network selection, continuing...');
  }
  
  await page.screenshot({ path: '/var/www/snap/auto-step3.png' });
  
  // Step 4: Enter private key
  console.log('   Step 4: Entering private key...');
  const keyInput = await page.$('input[type="password"], textarea');
  if (keyInput) {
    await keyInput.type(secretKeyBase58);
    await delay(500);
  } else {
    // Try to find any input
    const inputs = await page.$$('input');
    if (inputs.length > 0) {
      await inputs[0].type(secretKeyBase58);
    }
  }
  
  await page.screenshot({ path: '/var/www/snap/auto-step4.png' });
  
  // Step 5: Click Continue/Import
  console.log('   Step 5: Confirming import...');
  const continueBtn = await page.evaluateHandle(() => {
    return Array.from(document.querySelectorAll('button'))
      .find(b => b.innerText.includes('Continue') || b.innerText.includes('Import'));
  });
  if (continueBtn) {
    await continueBtn.click();
    await delay(2000);
  }
  
  await page.screenshot({ path: '/var/www/snap/auto-step5.png' });
  
  // Step 6: Create password
  console.log('   Step 6: Setting password...');
  const passwordInputs = await page.$$('input[type="password"]');
  if (passwordInputs.length >= 2) {
    await passwordInputs[0].type(WALLET_PASSWORD);
    await passwordInputs[1].type(WALLET_PASSWORD);
    await delay(500);
    
    // Check terms checkbox if present
    const checkbox = await page.$('input[type="checkbox"]');
    if (checkbox) await checkbox.click();
    
    // Click continue
    const pwContinueBtn = await page.evaluateHandle(() => {
      return Array.from(document.querySelectorAll('button'))
        .find(b => b.innerText.includes('Continue') || b.innerText.includes('Create'));
    });
    if (pwContinueBtn) {
      await pwContinueBtn.click();
      await delay(3000);
    }
  }
  
  await page.screenshot({ path: '/var/www/snap/auto-step6.png' });
  
  // Check if setup complete
  const pageText = await page.evaluate(() => document.body.innerText);
  console.log('   Current page:', pageText.substring(0, 200));
  
  return page;
}

async function connectToPumpFun(browser) {
  console.log('\n🌐 Connecting to pump.fun...');
  
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  
  // Go to SNAP token page
  await page.goto(`https://pump.fun/coin/${CONTRACT}`, { 
    waitUntil: 'networkidle2',
    timeout: 30000 
  });
  await delay(3000);
  
  // Dismiss the modal
  console.log('   Dismissing modal...');
  try {
    const modalBtn = await page.evaluateHandle(() => {
      return Array.from(document.querySelectorAll('button'))
        .find(b => b.innerText.includes("ready to pump"));
    });
    if (modalBtn) {
      await modalBtn.click();
      await delay(1500);
    }
  } catch (e) {}
  
  await page.screenshot({ path: '/var/www/snap/pump-1.png' });
  
  // Click Log in
  console.log('   Clicking Log in...');
  const loginBtn = await page.evaluateHandle(() => {
    return Array.from(document.querySelectorAll('button'))
      .find(b => b.innerText === 'Log in');
  });
  if (loginBtn) {
    await loginBtn.click();
    await delay(2000);
  }
  
  await page.screenshot({ path: '/var/www/snap/pump-2-login.png' });
  
  // Click Phantom option
  console.log('   Selecting Phantom...');
  const phantomBtn = await page.evaluateHandle(() => {
    return Array.from(document.querySelectorAll('button'))
      .find(b => b.innerText.includes('Phantom'));
  });
  if (phantomBtn) {
    await phantomBtn.click();
    await delay(3000);
  }
  
  await page.screenshot({ path: '/var/www/snap/pump-3-phantom.png' });
  
  // Handle Phantom popup
  console.log('   Handling Phantom approval...');
  const pages = await browser.pages();
  for (const p of pages) {
    const url = p.url();
    if (url.includes('chrome-extension://') && url.includes('popup')) {
      console.log('   Found Phantom popup!');
      await p.screenshot({ path: '/var/www/snap/phantom-popup.png' });
      
      // Click Connect/Approve
      const approveBtn = await p.evaluateHandle(() => {
        return Array.from(document.querySelectorAll('button'))
          .find(b => b.innerText.includes('Connect') || b.innerText.includes('Approve'));
      });
      if (approveBtn) {
        await approveBtn.click();
        await delay(2000);
      }
    }
  }
  
  await page.screenshot({ path: '/var/www/snap/pump-4-connected.png' });
  
  return page;
}

async function findGoLive(page) {
  console.log('\n🎬 Looking for Go Live option...');
  
  // Check if we're logged in as creator
  const pageText = await page.evaluate(() => document.body.innerText);
  
  if (pageText.includes('Go Live') || pageText.includes('Start Stream')) {
    console.log('   ✅ Found Go Live button!');
    
    const goLiveBtn = await page.evaluateHandle(() => {
      return Array.from(document.querySelectorAll('button'))
        .find(b => b.innerText.includes('Go Live') || b.innerText.includes('Start Stream'));
    });
    
    if (goLiveBtn) {
      console.log('   🎥 Clicking Go Live...');
      await goLiveBtn.click();
      await delay(3000);
      await page.screenshot({ path: '/var/www/snap/golive-active.png' });
      return true;
    }
  }
  
  // Search the entire page
  const buttons = await page.$$eval('button', els => 
    els.map(el => el.innerText.trim())
  );
  console.log('   Available buttons:', buttons.filter(b => b.length > 0 && b.length < 50));
  
  // Check creator rewards section
  if (pageText.includes('Creator rewards')) {
    console.log('   ✅ Found Creator rewards section - you are the creator!');
    console.log('   Looking for stream controls...');
  }
  
  return false;
}

async function main() {
  console.log('\n🚀 Launching browser...');
  
  const browser = await puppeteer.launch({
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      `--disable-extensions-except=${PHANTOM_PATH}`,
      `--load-extension=${PHANTOM_PATH}`,
      '--window-size=1920,1080',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
    ],
    defaultViewport: { width: 1920, height: 1080 },
  });
  
  try {
    // Step 1: Setup Phantom wallet
    await setupPhantom(browser);
    
    // Step 2: Connect to pump.fun
    const pumpPage = await connectToPumpFun(browser);
    
    // Step 3: Find and click Go Live
    const foundGoLive = await findGoLive(pumpPage);
    
    if (foundGoLive) {
      console.log('\n✨ SUCCESS! Stream started!');
    } else {
      console.log('\n⚠️ Go Live button not found. Check screenshots.');
    }
    
    console.log('\nScreenshots saved to /var/www/snap/');
    console.log('Browser open for inspection. Press Ctrl+C to exit.');
    
    // Keep alive
    await new Promise(() => {});
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    await browser.screenshot({ path: '/var/www/snap/error.png' }).catch(() => {});
    throw error;
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
