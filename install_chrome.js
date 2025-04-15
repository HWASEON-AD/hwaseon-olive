const puppeteer = require('puppeteer');

(async () => {
  try {
    console.log('⬇️  Installing Chromium via Puppeteer...');
    await puppeteer.launch(); // 이 호출이 설치까지 유도함
    console.log('✅ Chromium 설치 완료');
  } catch (err) {
    console.error('❌ Chromium 설치 실패:', err);
    process.exit(1);
  }
})();
