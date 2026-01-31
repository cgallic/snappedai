const puppeteer = require('puppeteer');
const fs = require('fs');

const CONTRACT = '8oCRS5SYaf4t5PGnCeQfpV7rjxGCcGqNDGHmHJBooPhX';
const delay = ms => new Promise(r => setTimeout(r, ms));

async function exploreWallets() {
  console.log('🧠 SNAP - Exploring wallet options');
  console.log('===================================\n');
  
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  
  console.log(`📺 Loading SNAP token page...`);
  await page.goto(`https://pump.fun/coin/${CONTRACT}`, { waitUntil: 'networkidle2', timeout: 30000 });
  await delay(2000);
  
  // Dismiss the modal
  console.log('🔘 Dismissing modal...');
  try {
    const modalButton = await page.evaluateHandle(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      return buttons.find(b => b.innerText.includes("I'm ready to pump"));
    });
    if (modalButton) {
      await modalButton.click();
      await delay(1500);
    }
  } catch (e) {}
  
  // Click Log in
  console.log('🔗 Clicking Log in...');
  const loginButton = await page.evaluateHandle(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    return buttons.find(b => b.innerText.includes('Log in'));
  });
  if (loginButton) {
    await loginButton.click();
    await delay(2000);
  }
  
  // Click "more wallets"
  console.log('💳 Clicking "more wallets"...');
  const moreWalletsButton = await page.evaluateHandle(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    return buttons.find(b => b.innerText.includes('more wallets'));
  });
  
  if (moreWalletsButton) {
    await moreWalletsButton.click();
    await delay(2000);
    
    await page.screenshot({ path: '/var/www/snap/wallets-list.png' });
    console.log('📸 Screenshot: wallets list');
    
    // Get the wallet options
    const walletOptions = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      return buttons
        .map(b => b.innerText.trim())
        .filter(text => text.length > 0 && text.length < 100);
    });
    console.log('\n💳 Available wallets:');
    walletOptions.forEach(w => console.log('   -', w));
    
    // Look specifically for WalletConnect or similar
    const dialogContent = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      return dialog ? dialog.innerText : document.body.innerText.substring(0, 2000);
    });
    console.log('\n📄 Dialog content:');
    console.log(dialogContent.substring(0, 1000));
  } else {
    console.log('   "more wallets" button not found');
  }
  
  await browser.close();
  console.log('\n✅ Done');
}

exploreWallets().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
