const puppeteer = require('puppeteer');

(async () => {
  try {
    console.log('⬇️ Installing Chromium via Puppeteer...');
    const browserFetcher = puppeteer.createBrowserFetcher();
    const revisionInfo = await browserFetcher.download('1143440');
    console.log('✅ Chromium 설치 완료:', revisionInfo.executablePath);
  } catch (err) {
    console.error('❌ Puppeteer 설치 실패:', err);
    process.exit(1);
  }
})();
