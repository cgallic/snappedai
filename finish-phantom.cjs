const puppeteer = require('puppeteer');
const delay = ms => new Promise(r => setTimeout(r, ms));
const PHANTOM_PATH = '/var/www/snap/extensions/phantom';
const bs58 = require('bs58').default;
const { Keypair } = require('@solana/web3.js');
const fs = require('fs');

const walletData = JSON.parse(fs.readFileSync('/root/.config/solana/snap-wallet.json'));
const keypair = Keypair.fromSecretKey(Uint8Array.from(walletData));
const secretKey = bs58.encode(keypair.secretKey);

async function main() {
  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox', `--disable-extensions-except=${PHANTOM_PATH}`, `--load-extension=${PHANTOM_PATH}`, '--remote-debugging-port=9222'],
  });
  
  await delay(3000);
  const targets = await browser.targets();
  let page = targets.find(t => t.url().includes('onboarding'));
  if (page) page = await page.page();
  else {
    page = await browser.newPage();
    await page.goto('chrome-extension://bfnaelmomeimhlpmgjnjophhpkkoljpa/onboarding.html');
    await delay(2000);
  }
  
  // Click "I already have a wallet"
  await page.evaluate(() => Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('already have'))?.click());
  await delay(1500);
  
  // Click "Import Private Key"
  await page.evaluate(() => Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Private Key'))?.click());
  await delay(1500);
  
  // Fill name and key
  await page.type('input[placeholder*="Name"], input[name*="name"]', 'SNAP', { delay: 50 });
  await page.type('textarea, input[placeholder*="key"]', secretKey, { delay: 5 });
  await delay(500);
  await page.screenshot({ path: '/var/www/snap/fin-1.png' });
  
  // Click Import
  await page.evaluate(() => Array.from(document.querySelectorAll('button')).find(b => b.innerText === 'Import')?.click());
  await delay(2000);
  await page.screenshot({ path: '/var/www/snap/fin-2.png' });
  
  // Password page
  const pwInputs = await page.$$('input[type="password"]');
  if (pwInputs.length >= 2) {
    await pwInputs[0].type('SnapAI2026!', { delay: 30 });
    await pwInputs[1].type('SnapAI2026!', { delay: 30 });
    await page.click('input[type="checkbox"]').catch(() => {});
    await delay(500);
    await page.evaluate(() => Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Continue'))?.click());
    await delay(2000);
  }
  await page.screenshot({ path: '/var/www/snap/fin-3.png' });
  
  // Username page - skip if possible
  const skipBtn = await page.$('button:has-text("Skip")');
  if (skipBtn) await skipBtn.click();
  else {
    const nameInput = await page.$('input[placeholder*="username"], input[placeholder*="Username"]');
    if (nameInput) {
      await nameInput.type('snap' + Date.now(), { delay: 30 });
      await delay(1500);
      await page.evaluate(() => Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Continue'))?.click());
      await delay(2000);
    }
  }
  await page.screenshot({ path: '/var/www/snap/fin-4.png' });
  
  console.log('✅ Phantom setup complete! CDP: 9222');
  console.log('Now run: agent-browser connect 9222');
  
  // Keep browser open
  await new Promise(() => {});
}
main().catch(e => console.error(e));
