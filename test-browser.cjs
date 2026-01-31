const puppeteer = require('puppeteer');

async function test() {
  console.log('🧪 Testing browser launch...');
  
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
    ],
  });
  
  const page = await browser.newPage();
  console.log('✅ Browser launched');
  
  console.log('📺 Navigating to pump.fun...');
  await page.goto('https://pump.fun', { waitUntil: 'networkidle2', timeout: 30000 });
  console.log('✅ Page loaded');
  
  const title = await page.title();
  console.log(`📄 Title: ${title}`);
  
  await page.screenshot({ path: '/var/www/snap/test-screenshot.png' });
  console.log('📸 Screenshot saved to /var/www/snap/test-screenshot.png');
  
  await browser.close();
  console.log('✅ Test complete!');
}

test().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
