const puppeteer = require('puppeteer');
const fs = require('fs');

const CONTRACT = '8oCRS5SYaf4t5PGnCeQfpV7rjxGCcGqNDGHmHJBooPhX';

async function explore() {
  console.log('🧠 SNAP - Exploring pump.fun UI');
  console.log('================================\n');
  
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
    ],
  });
  
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  
  // Go to pump.fun
  console.log('📺 Loading pump.fun...');
  await page.goto('https://pump.fun', { waitUntil: 'networkidle2', timeout: 30000 });
  
  const delay = ms => new Promise(r => setTimeout(r, ms));
  
  // Dismiss the modal
  console.log('🔘 Dismissing modal...');
  try {
    await page.click('button:has-text("I\'m ready to pump")');
    await delay(1000);
  } catch (e) {
    console.log('   Modal not found or already dismissed');
  }
  
  await page.screenshot({ path: '/var/www/snap/explore-1-home.png' });
  console.log('📸 Screenshot: home page');
  
  // Navigate to SNAP token
  console.log(`\n📺 Loading SNAP token page: ${CONTRACT}...`);
  await page.goto(`https://pump.fun/coin/${CONTRACT}`, { waitUntil: 'networkidle2', timeout: 30000 });
  await delay(2000);
  
  await page.screenshot({ path: '/var/www/snap/explore-2-token.png', fullPage: true });
  console.log('📸 Screenshot: SNAP token page');
  
  // Get page content for analysis
  const pageText = await page.evaluate(() => document.body.innerText);
  fs.writeFileSync('/var/www/snap/explore-pagetext.txt', pageText);
  console.log('📝 Page text saved');
  
  // Look for go live related elements
  console.log('\n🔍 Looking for streaming/live elements...');
  
  const buttons = await page.$$eval('button', els => 
    els.map(el => ({ text: el.innerText, class: el.className }))
  );
  console.log('Buttons found:', JSON.stringify(buttons.slice(0, 10), null, 2));
  
  // Look for any "live" or "stream" text
  const liveElements = await page.$$eval('*', els => 
    els.filter(el => /live|stream/i.test(el.innerText))
      .slice(0, 5)
      .map(el => ({ tag: el.tagName, text: el.innerText.substring(0, 100) }))
  );
  console.log('\nLive/Stream elements:', JSON.stringify(liveElements.slice(0, 5), null, 2));
  
  // Check if there's a wallet connect button
  const connectButtons = await page.$$eval('button', els => 
    els.filter(el => /connect|wallet/i.test(el.innerText))
      .map(el => ({ text: el.innerText, class: el.className }))
  );
  console.log('\nConnect/Wallet buttons:', JSON.stringify(connectButtons, null, 2));
  
  // Click on Livestreams in sidebar to see what's there
  console.log('\n📺 Checking Livestreams page...');
  try {
    await page.goto('https://pump.fun/board?tab=livestreams', { waitUntil: 'networkidle2' });
    await delay(2000);
    await page.screenshot({ path: '/var/www/snap/explore-3-livestreams.png' });
    console.log('📸 Screenshot: livestreams page');
  } catch (e) {
    console.log('Error loading livestreams:', e.message);
  }
  
  await browser.close();
  console.log('\n✅ Exploration complete! Check screenshots.');
}

explore().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
