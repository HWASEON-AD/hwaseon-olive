const puppeteer = require('puppeteer');

(async () => {
  try {
    console.log('⬇️ Installing Chromium via Puppeteer...');
    await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox']
    });
    console.log('✅ Chromium 설치 완료');
  } catch (err) {
    console.error('❌ Puppeteer 설치 실패:', err.message);
    process.exit(1);
  }
})();
