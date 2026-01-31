const puppeteer = require('puppeteer');
const fs = require('fs');

const CONTRACT = '8oCRS5SYaf4t5PGnCeQfpV7rjxGCcGqNDGHmHJBooPhX';
const delay = ms => new Promise(r => setTimeout(r, ms));

async function findGoLive() {
  console.log('🧠 SNAP - Finding Go Live button');
  console.log('=================================\n');
  
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  
  // Go directly to token page
  console.log(`📺 Loading SNAP token page...`);
  await page.goto(`https://pump.fun/coin/${CONTRACT}`, { waitUntil: 'networkidle2', timeout: 30000 });
  await delay(2000);
  
  // Dismiss the modal by clicking "I'm ready to pump"
  console.log('🔘 Looking for modal...');
  try {
    const modalButton = await page.evaluateHandle(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      return buttons.find(b => b.innerText.includes("I'm ready to pump"));
    });
    if (modalButton) {
      await modalButton.click();
      console.log('   ✅ Dismissed modal');
      await delay(1500);
    }
  } catch (e) {
    console.log('   No modal found');
  }
  
  await page.screenshot({ path: '/var/www/snap/golive-1-token.png', fullPage: true });
  console.log('📸 Screenshot: token page (modal dismissed)');
  
  // Click Log in button
  console.log('\n🔗 Looking for Log in button...');
  const loginButton = await page.evaluateHandle(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    return buttons.find(b => b.innerText.includes('Log in'));
  });
  
  if (loginButton) {
    await loginButton.click();
    console.log('   ✅ Clicked Log in');
    await delay(2000);
    
    await page.screenshot({ path: '/var/www/snap/golive-2-login.png' });
    console.log('📸 Screenshot: login dialog');
    
    // Look for wallet options in the dialog
    const dialogText = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]') || 
                     document.querySelector('.modal') ||
                     document.querySelector('[class*="modal"]');
      return dialog ? dialog.innerText : 'No dialog found';
    });
    console.log('\nLogin dialog content:');
    console.log(dialogText.substring(0, 500));
  } else {
    console.log('   No Log in button found');
  }
  
  // Also look for any "Go Live" or "Stream" buttons on the page
  console.log('\n🔍 Searching for Go Live / Stream elements...');
  const streamElements = await page.evaluate(() => {
    const allElements = Array.from(document.querySelectorAll('*'));
    return allElements
      .filter(el => /go\s*live|start\s*stream|livestream|broadcast/i.test(el.innerText))
      .slice(0, 10)
      .map(el => ({
        tag: el.tagName,
        text: el.innerText.substring(0, 100),
        classes: el.className
      }));
  });
  console.log('Stream elements found:', JSON.stringify(streamElements, null, 2));
  
  // Check the Creator rewards section specifically
  console.log('\n🔍 Looking in Creator rewards section...');
  const creatorSection = await page.evaluate(() => {
    const allText = document.body.innerText;
    const creatorIndex = allText.indexOf('Creator rewards');
    if (creatorIndex > -1) {
      return allText.substring(creatorIndex, creatorIndex + 300);
    }
    return 'Creator rewards section not found';
  });
  console.log(creatorSection);
  
  await browser.close();
  console.log('\n✅ Done');
}

findGoLive().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
