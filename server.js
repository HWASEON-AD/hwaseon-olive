// ========================================
// 📦 모듈 및 환경 설정
// ========================================
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { Builder, By, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const sharp = require('sharp');
const cron = require('node-cron');
const nodemailer = require('nodemailer');
const archiver = require('archiver');
const os = require('os');
require('dotenv').config();

const { chain } = require('stream-chain');
const { parser } = require('stream-json');
const { streamValues } = require('stream-json/streamers/StreamValues');

// Express 앱 및 포트 설정
const app = express();
const port = process.env.PORT || 5001;

// ========== 컬러 로그 유틸리티 ========== //
const log = {
  info: (msg) => console.log(`\x1b[36m[INFO]\x1b[0m ${msg}`),
  success: (msg) => console.log(`\x1b[32m[SUCCESS]\x1b[0m ${msg}`),
  warn: (msg) => console.log(`\x1b[33m[WARN]\x1b[0m ${msg}`),
  error: (msg) => console.log(`\x1b[31m[ERROR]\x1b[0m ${msg}`),
  section: (msg) => console.log(`\n\x1b[35m========== ${msg} ==========` + '\x1b[0m'),
  line: () => console.log('\x1b[90m' + '-'.repeat(60) + '\x1b[0m'),
};

// ========================================
// 📁 디렉토리 및 파일 경로 설정
// ========================================
const capturesDir = path.join(__dirname, 'public', 'captures');
if (!fs.existsSync(capturesDir)) {
  fs.mkdirSync(capturesDir, { recursive: true });
}

// ========================================
// 🏷️ 상수 정의
// ========================================

// 카테고리별 상품 코드
const CATEGORY_CODES = {
  '전체': { fltDispCatNo: '' },
  '스킨케어': { fltDispCatNo: '10000010001' },
  '마스크팩': { fltDispCatNo: '10000010009' },
  '클렌징': { fltDispCatNo: '10000010010' },
  '선케어': { fltDispCatNo: '10000010011' },
  '메이크업': { fltDispCatNo: '10000010002' },
  '네일': { fltDispCatNo: '10000010012' },
  '뷰티소품': { fltDispCatNo: '10000010006' },
  '더모_코스메틱': { fltDispCatNo: '10000010008' },
  '맨즈케어': { fltDispCatNo: '10000010007' },
  '향수_디퓨저': { fltDispCatNo: '10000010005' },
  '헤어케어': { fltDispCatNo: '10000010004' },
  '바디케어': { fltDispCatNo: '10000010003' },
  '건강식품': { fltDispCatNo: '10000020001' },
  '푸드': { fltDispCatNo: '10000020002' },
  '구강용품': { fltDispCatNo: '10000020003' },
  '헬스_건강용품': { fltDispCatNo: '10000020005' },
  '여성_위생용품': { fltDispCatNo: '10000020004' },
  '패션': { fltDispCatNo: '10000030007' },
  '리빙_가전': { fltDispCatNo: '10000030005' },
  '취미_팬시': { fltDispCatNo: '10000030006' },
};

// User-Agent 목록
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
];

// ========================================
// 🔧 유틸리티 함수들
// ========================================
function getKSTTime() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
}
function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}
function normalizeDate(dateString) {
  if (!dateString) return null;
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return null;
  return date.toISOString().split('T')[0];
}
function inDateRange(itemDate, startDate, endDate) {
  const d = normalizeDate(itemDate);
  const s = startDate ? normalizeDate(startDate) : null;
  const e = endDate ? normalizeDate(endDate) : s;
  if (!s && !e) return true;
  if (s && !e) return d === s;
  if (!s && e) return d === e;
  return d >= s && d <= e;
}
async function safeQuitDriver(driver, category = 'unknown') {
  if (driver) {
    try { await driver.quit(); console.log(`${category} 드라이버 종료 완료`); }
    catch (error) { console.error(`${category} 드라이버 종료 중 오류:`, error.message); }
  }
}
function safeRemoveTempProfile(tmpDir, category = 'unknown') {
  if (tmpDir && fs.existsSync(tmpDir)) {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); console.log(`${category} 임시 프로필 삭제 완료:`, tmpDir); }
    catch (error) { console.error(`${category} 임시 프로필 삭제 실패:`, tmpDir, error.message); }
  }
}

// === 주간 저장 유틸 ===
function getWeekIndex(isoDate) {
  const d = new Date(isoDate);
  const y = d.getFullYear();
  const m = d.getMonth(); // 0-based
  const first = new Date(y, m, 1);
  const day = d.getDate();
  const week = Math.ceil((day + first.getDay()) / 7);
  return Math.min(week, 4); // 항상 1~4주
}
function getWeeklyDir(yearMonth) {
  return `/data/weekly_${yearMonth}`;
}
function listWeeklyFiles(yearMonth) {
  const dir = getWeeklyDir(yearMonth);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => path.join(dir, f))
    .sort();
}
function getWeeklyPathByDate(isoDate) {
  const ym = isoDate.slice(0, 7);
  const week = getWeekIndex(isoDate);
  const dir = getWeeklyDir(ym);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `ranking_${ym}_week${week}.json`);
}
function upsertWeeklyFile(dataByCategory, isoDate) {
  const p = getWeeklyPathByDate(isoDate);
  let base = { data: {} };

  if (fs.existsSync(p)) {
    try {
      base = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (!base || typeof base !== 'object' || !base.data) base = { data: {} };
    } catch { base = { data: {} }; }
  }

  for (const [cat, arr] of Object.entries(dataByCategory || {})) {
    if (!Array.isArray(arr)) continue;
    const oldArr = Array.isArray(base.data[cat]) ? base.data[cat] : [];
    const seen = new Set();
    const merged = [];

    for (const src of [oldArr, arr]) {
      for (const it of src) {
        const key = [
          it.date, it.time, it.category, it.rank,
          String(it.brand || '').trim(),
          String(it.name || '').trim(),
        ].join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(it);
      }
    }

    merged.sort((a, b) => {
      if ((a.rank ?? 1e9) !== (b.rank ?? 1e9)) return (a.rank ?? 1e9) - (b.rank ?? 1e9);
      const dc = String(b.date || '').localeCompare(String(a.date || ''));
      if (dc !== 0) return dc;
      return String(b.time || '').localeCompare(String(a.time || ''));
    });

    base.data[cat] = merged;
  }

  fs.writeFileSync(p, JSON.stringify(base, null, 2));
  log.success(`[주간 저장] ${p}`);
}

// ========================================
// 🌐 Express 앱 설정
// ========================================
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/captures', express.static(path.join(__dirname, 'public', 'captures')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ========================================
// 🛠️ 서버 설정 및 시작
// ========================================
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
  // 매일 00:00에 당일 캡처본 삭제
  cron.schedule('0 0 * * *', () => {
    fs.readdir(capturesDir, (err, files) => {
      if (err) return console.error('캡처 디렉토리 읽기 오류:', err);
      files.forEach(file => {
        const match = file.match(/_(\d{4}-\d{2}-\d{2})_/);
        if (match) {
          const filePath = path.join(capturesDir, file);
          fs.unlink(filePath, err => {
            if (err) console.error('캡처 파일 삭제 오류:', filePath, err);
            else console.log('캡처본 삭제:', filePath);
          });
        }
      });
    });
  }, { timezone: 'Asia/Seoul' });
});

// ========================================
// 🖥️ Chrome 및 브라우저 관련 함수들
// ========================================
async function findChrome() {
  try {
    const { execSync } = require('child_process');
    const chromePath = execSync('which google-chrome-stable').toString().trim();
    console.log('Chrome 경로 찾음:', chromePath);
    const version = execSync('google-chrome-stable --version').toString().trim();
    console.log('Chrome 버전:', version);
    return chromePath;
  } catch (error) {
    console.error('Chrome 확인 중 오류:', error.message);
    console.log('기본 Chrome 경로 사용');
    return '/usr/bin/google-chrome-stable';
  }
}
function createTempChromeProfile() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-profile-'));
  return tmpDir;
}

// ========================================
// 🔧 이메일 관련 설정 및 함수들
// ========================================
const transporter = nodemailer.createTransport({
  host: 'smtp.worksmobile.com',
  port: 465,
  secure: true,
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

async function organizeAndSendCapturesSplit(timeStr, dateStr) {
  log.section('📧 이메일 전송 시작');
  const files = fs.readdirSync(capturesDir)
    .filter(file => file.endsWith('.jpeg') && file.includes(dateStr) && file.includes(timeStr));
  if (files.length === 0) return;

  const MAX_FILES_PER_MAIL = 7;
  const groups = [];
  for (let i = 0; i < files.length; i += MAX_FILES_PER_MAIL) {
    groups.push(files.slice(i, i + MAX_FILES_PER_MAIL));
  }

  for (let idx = 0; idx < groups.length; idx++) {
    const group = groups[idx];
    const zipPath = path.join(__dirname, `oliveyoung_captures_${dateStr}_${timeStr}_part${idx + 1}.zip`);
    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 9 } });
      output.on('close', resolve);
      archive.on('error', reject);
      archive.pipe(output);
      for (const file of group) archive.file(path.join(capturesDir, file), { name: file });
      archive.finalize();
    });

    const categories = group.map(f => {
      const m = f.match(/ranking_(.+?)_/); return m ? m[1] : f;
    }).join(', ');

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: 'hwaseon@hwaseon.com',
      subject: `올리브영 ${dateStr} ${timeStr.replace('-', ':')} 캡처본 (part ${idx + 1}/${groups.length}, zip 첨부)`,
      text: `이번 메일에는 다음 카테고리 캡처가 포함되어 있습니다:\n${categories}`,
      attachments: [{ filename: path.basename(zipPath), path: zipPath }],
    };
    try {
      await transporter.sendMail(mailOptions);
      console.log(`[메일전송성공] ${mailOptions.subject}`);
    } catch (e) {
      console.error(`[메일전송실패] ${mailOptions.subject}`, e);
    }
    fs.unlinkSync(zipPath);
  }

  for (const file of files) {
    try { fs.unlinkSync(path.join(capturesDir, file)); console.log(`캡처본 삭제 완료: ${file}`); }
    catch (error) { console.error(`캡처본 삭제 실패: ${file}`, error.message); }
  }
}

// ========================================
// 🕷️ 크롤링
// ========================================
function logNextCrawlTime() {
  const kstNow = getKSTTime();
  const next = new Date(kstNow);
  next.setMinutes(15);
  next.setSeconds(0);
  next.setMilliseconds(0);
  if (kstNow.getMinutes() >= 15) next.setHours(kstNow.getHours() + 1);
  const diffMs = next - kstNow;
  const diffMin = Math.floor(diffMs / 60000);
  const diffSec = Math.floor((diffMs % 60000) / 1000);
  log.info(`다음 크롤링 예정 시각: ${next.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} (${diffMin}분 ${diffSec}초 남음)`);
}

async function crawlAllCategoriesV2(options = {}) {
  log.section('🕷️ 크롤링 전체 시작');
  const kstNow = getKSTTime();
  const yearMonth = kstNow.toISOString().slice(0, 7);
  const today = kstNow.toISOString().split('T')[0];
  const timeStr = `${String(kstNow.getHours()).padStart(2, '0')}-${String(kstNow.getMinutes()).padStart(2, '0')}`;

  let localProductCache = { data: {}, allProducts: [], timestamp: null };
  const targetCategories = options.onlyCategory ? [options.onlyCategory] : Object.keys(CATEGORY_CODES);

  for (const category of targetCategories) {
    log.line();
    log.info(`카테고리: ${category}`);
    localProductCache.data[category] = [];
    let rankCounter = 1;
    const seen = new Set();
    let page = 1;
    let noNewItemCount = 0;
    const MAX_NO_NEW_ITEM_PAGE = 3;

    while (localProductCache.data[category].length < 100 && page <= 30) {
      const url =
        `https://www.oliveyoung.co.kr/store/main/getBestList.do?dispCatNo=900000100100001&fltDispCatNo=${CATEGORY_CODES[category].fltDispCatNo}&pageIdx=${page}&rowsPerPage=24&t_page=%EB%9E%AD%ED%82%B9&t_click=%ED%8C%90%EB%A7%A4%EB%9E%AD%ED%82%B9_${encodeURIComponent(category.replace('_', ' '))}`;
      let driver = null;
      let tmpProfile = null;
      let newItemAdded = false;

      try {
        tmpProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-profile-'));
        const options = new chrome.Options()
          .addArguments('--headless', '--no-sandbox', '--disable-dev-shm-usage', '--window-size=1920,1500')
          .addArguments(`--user-data-dir=${tmpProfile}`)
          .addArguments(`--user-agent=${getRandomUserAgent()}`);
        if (process.env.CHROME_BIN) options.setChromeBinaryPath(process.env.CHROME_BIN);

        driver = await new Builder().forBrowser('chrome').setChromeOptions(options).build();
        await driver.get(url);
        await driver.wait(until.elementLocated(By.css('body')), 15000);
        await driver.sleep(2000);

        const products = await driver.findElements(By.css('ul.cate_prd_list > li'));
        for (const product of products) {
          if (localProductCache.data[category].length >= 100) break;
          try {
            const dataAttrElement = await product.findElement(By.css('a[data-attr]')).catch(() => null);
            let extractedRank = rankCounter;
            if (dataAttrElement) {
              const dataAttr = await dataAttrElement.getAttribute('data-attr');
              if (dataAttr) {
                const parts = dataAttr.split('^');
                if (parts.length >= 4) {
                  const rankFromAttr = parseInt(parts[3]);
                  if (!isNaN(rankFromAttr)) extractedRank = rankFromAttr;
                }
              }
            }
            if (extractedRank === rankCounter) {
              const thumbFlagElement = await product.findElement(By.css('.thumb_flag.best')).catch(() => null);
              if (thumbFlagElement) {
                const thumbFlagText = await thumbFlagElement.getText();
                const thumbRank = parseInt(thumbFlagText);
                if (!isNaN(thumbRank)) extractedRank = thumbRank;
              }
            }

            const nameElement = await product.findElement(By.css('.prd_name, .tx_name')).catch(() => null);
            let name = nameElement ? await nameElement.getText() : `상품${extractedRank}`;
            let brandElement = await product.findElement(By.css('.prd_brand, .tx_brand')).catch(() => null);
            let brand = brandElement ? await brandElement.getText() : '';
            if (!brand && name) {
              const lines = name.split('\n');
              if (lines.length > 1) { brand = lines[0].trim(); name = lines.slice(1).join(' ').trim(); }
              else {
                const match = name.match(/^([\w가-힣A-Za-z0-9]+)[\s\[]?(.*)$/);
                if (match) { brand = match[1].trim(); name = match[2].trim(); }
              }
            }
            if (brand && name && name.startsWith(brand)) name = name.slice(brand.length).trim();

            const uniqueKey = [today, timeStr, category, extractedRank, brand.trim(), name.trim()].join('|');
            if (seen.has(uniqueKey)) continue;
            seen.add(uniqueKey);

            let originalPrice = '';
            let salePrice = '';
            const orgPriceElement = await product.findElement(By.css('.prd_price .tx_org .tx_num')).catch(() => null);
            const curPriceElement = await product.findElement(By.css('.prd_price .tx_cur .tx_num')).catch(() => null);
            if (orgPriceElement) originalPrice = (await orgPriceElement.getText()).replace(/,/g, '');
            if (curPriceElement) salePrice = (await curPriceElement.getText()).replace(/,/g, '');
            if (!originalPrice || !salePrice) {
              const priceElement = await product.findElement(By.css('.prd_price')).catch(() => null);
              const priceText = priceElement ? await priceElement.getText() : '';
              const priceMatch = priceText.match(/(\d{1,3}(?:,\d{3})*)/g);
              if (!originalPrice) originalPrice = priceMatch && priceMatch[0] ? priceMatch[0].replace(/,/g, '') : '';
              if (!salePrice) salePrice = priceMatch && priceMatch[1] ? priceMatch[1].replace(/,/g, '') : originalPrice;
            }

            const promoElements = await product.findElements(By.css('.icon_flag')).catch(() => []);
            let promotion = '';
            if (promoElements && promoElements.length > 0) {
              const promoTexts = [];
              for (const el of promoElements) {
                const txt = await el.getText();
                if (txt) promoTexts.push(txt.trim());
              }
              promotion = promoTexts.join(', ');
            }

            localProductCache.data[category].push({
              date: today, time: timeStr, category,
              rank: extractedRank, brand: brand.trim(), name: name.trim(),
              originalPrice, salePrice, promotion: promotion.trim(),
            });
            rankCounter++;
            newItemAdded = true;
          } catch {
            localProductCache.data[category].push({
              date: today, time: timeStr, category,
              rank: rankCounter, brand: '', name: `상품${rankCounter}`,
              originalPrice: '', salePrice: '', promotion: '',
            });
            rankCounter++;
            newItemAdded = true;
          }
        }
      } catch (e) {
        console.error(`[${category}] ${page}페이지 크롤링 실패:`, e.message);
      } finally {
        if (driver) await driver.quit();
        if (tmpProfile && fs.existsSync(tmpProfile)) fs.rmSync(tmpProfile, { recursive: true, force: true });
      }

      if (!newItemAdded) noNewItemCount++; else noNewItemCount = 0;
      if (noNewItemCount >= MAX_NO_NEW_ITEM_PAGE) {
        log.warn(`[${category}] 연속 ${MAX_NO_NEW_ITEM_PAGE}페이지에서 새로운 상품이 없어 크롤링 종료`);
        break;
      }
      page++;
    }

    localProductCache.data[category].sort((a, b) => a.rank - b.rank);
    localProductCache.data[category] = localProductCache.data[category].slice(0, 100);
    log.success(`[${category}] 크롤링 완료: ${localProductCache.data[category].length}개`);
  }

  // ✅ 월간 저장 제거, 주간만 저장
  upsertWeeklyFile(localProductCache.data, today);

  await captureOliveyoungMainRanking(timeStr);
  logNextCrawlTime();
}

// ========================================
// 📸 캡처 관련
// ========================================
async function captureOliveyoungMainRanking(timeStr) {
  log.section('📸 캡처 전체 시작');
  console.log('총 21개 카테고리 캡처 예정');
  console.log('='.repeat(50));

  const now = getKSTTime();
  const dateFormatted = now.toISOString().split('T')[0];
  const allCategories = Object.keys(CATEGORY_CODES);
  let successSet = new Set();
  let failSet = new Set();
  const errors = [];

  async function tryCaptureCategory(category, attemptNumber) {
    let categoryDriver = null;
    let categoryTmpProfileDir = null;

    try {
      console.log(`${category} 랭킹 페이지 캡처 시도... (${attemptNumber}차 시도)`);
      categoryTmpProfileDir = createTempChromeProfile();

      const categoryOptions = new chrome.Options()
        .addArguments('--headless', '--no-sandbox', '--disable-dev-shm-usage',
          '--start-maximized', '--window-size=1920,1500', '--hide-scrollbars',
          '--force-device-scale-factor=1', '--screenshot-format=jpeg', '--screenshot-quality=80',
          '--disable-gpu', '--disable-extensions', '--disable-notifications', '--disable-web-security',
          '--disable-features=VizDisplayCompositor', '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
          '--disable-field-trial-config', '--disable-ipc-flooding-protection', '--disable-hang-monitor',
          '--disable-prompt-on-repost', '--disable-client-side-phishing-detection',
          '--disable-component-update', '--disable-default-apps', '--disable-sync',
          '--metrics-recording-only', '--no-first-run', '--safebrowsing-disable-auto-update',
          '--disable-translate', '--disable-plugins-discovery', '--disable-plugins',
          '--enable-javascript', '--enable-dom-storage', '--enable-local-storage',
          '--enable-session-storage', '--enable-cookies', '--enable-images', '--enable-scripts')
        .addArguments(`--user-data-dir=${categoryTmpProfileDir}`)
        .addArguments(`--user-agent=${getRandomUserAgent()}`);
      if (process.env.CHROME_BIN) categoryOptions.setChromeBinaryPath(process.env.CHROME_BIN);

      categoryDriver = await new Builder().forBrowser('chrome').setChromeOptions(categoryOptions).build();

      const categoryName = category.replace('_', ' ');
      const encodedCategory = encodeURIComponent(categoryName);
      const url =
        `https://www.oliveyoung.co.kr/store/main/getBestList.do?dispCatNo=900000100100001&fltDispCatNo=${CATEGORY_CODES[category].fltDispCatNo}&pageIdx=1&rowsPerPage=24&t_page=%EB%9E%AD%ED%82%B9&t_click=%ED%8C%90%EB%A7%A4%EB%9E%AD%ED%82%B9_${encodedCategory}`;

      await categoryDriver.get(url);

      await categoryDriver.wait(until.elementLocated(By.css('body')), 20000);
      await categoryDriver.sleep(3000);

      await categoryDriver.wait(async () => {
        const readyState = await categoryDriver.executeScript('return document.readyState');
        return readyState === 'complete';
      }, 15000, '페이지 로딩 시간 초과');

      await categoryDriver.sleep(3000);

      const pageSelectors = ['.TabsConts', '.prd_info', '.best_list', '.product_list', '.best_item',
        '.item', '.product_item', '.ranking_list', '.list_item'];

      let pageElementFound = false;
      for (const selector of pageSelectors) {
        try {
          const elements = await categoryDriver.findElements(By.css(selector));
          if (elements.length > 0) { console.log(`요소 발견: ${selector} (${elements.length}개)`); pageElementFound = true; break; }
        } catch {}
      }
      if (!pageElementFound) throw new Error('페이지 로딩 실패 - 필수 요소를 찾을 수 없습니다');

      await categoryDriver.sleep(2000);

      await categoryDriver.wait(async () => {
        const selectors = ['.TabsConts .prd_info', '.prd_info', '.best_list .item', '.best_item',
          '.item', '.product_item', '.ranking_list .item', '.list_item'];
        for (const selector of selectors) {
          try {
            const products = await categoryDriver.findElements(By.css(selector));
            if (products.length > 0) { console.log(`상품 요소 발견: ${selector} (${products.length}개)`); return true; }
          } catch {}
        }
        return false;
      }, 20000, '상품 목록 로딩 시간 초과');

      await categoryDriver.sleep(2000);

      await categoryDriver.executeScript(`
        const categoryDiv = document.createElement('div');
        categoryDiv.id = 'custom-category-header';
        categoryDiv.style.cssText = 'position:fixed;top:0;left:0;width:100%;background-color:#333;color:white;text-align:center;padding:10px 0;font-size:16px;font-weight:bold;z-index:9999;';
        categoryDiv.textContent = '${category === '전체' ? '전체 랭킹' : category.replace('_', ' ') + ' 랭킹'}';
        document.body.insertBefore(categoryDiv, document.body.firstChild);
        document.body.style.marginTop = '40px';
      `);

      const fileName = `ranking_${category}_${dateFormatted}_${timeStr}.jpeg`;
      const filePath = path.join(capturesDir, fileName);
      await captureFullPageWithSelenium(categoryDriver, filePath, category, dateFormatted);

      console.log(`${category} 랭킹 페이지 캡처 완료: ${fileName}`);
      console.log(`진행률: ${successSet.size + 1}/${allCategories.length} (${Math.round((successSet.size + 1) / allCategories.length * 100)}%)`);
      console.log('-'.repeat(50));

      return true;
    } catch (error) {
      console.error(`${category} 캡처 실패 (${attemptNumber}차 시도):`, error.message);
      return false;
    } finally {
      await safeQuitDriver(categoryDriver, `${category} 캡처`);
      safeRemoveTempProfile(categoryTmpProfileDir, category);
    }
  }

  console.log('=== 1차 시도 시작 ===');
  for (const category of allCategories) {
    const success = await tryCaptureCategory(category, 1);
    if (success) successSet.add(category);
    else { failSet.add(category); errors.push({ category, error: `${category} 1차 시도 실패`, timestamp: new Date().toISOString() }); }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  if (failSet.size > 0) {
    console.log('=== 2차 시도 시작 (실패한 카테고리만) ===');
    const retryCategories = Array.from(failSet);
    failSet.clear();
    for (const category of retryCategories) {
      const success = await tryCaptureCategory(category, 2);
      if (success) successSet.add(category);
      else { failSet.add(category); errors.push({ category, error: `${category} 2차 시도 실패`, timestamp: new Date().toISOString() }); }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  console.log('='.repeat(50));
  console.log('캡처 작업 최종 결과');
  console.log(`성공: ${successSet.size}/${allCategories.length} 카테고리`);
  console.log(`실패: ${failSet.size}개 카테고리`);
  if (failSet.size > 0) console.log('실패한 카테고리:', Array.from(failSet));
  console.log('='.repeat(50));

  if (successSet.size > 0) {
    console.log('='.repeat(50));
    console.log('캡처 완료 후 이메일 전송 시작...');
    console.log('='.repeat(50));
    try { await organizeAndSendCapturesSplit(timeStr, dateFormatted); console.log('이메일 전송 및 파일 삭제 완료'); }
    catch (emailError) { console.error('이메일 전송 실패:', emailError.message); }
  } else {
    console.log('캡처된 파일이 없어 이메일 전송을 건너뜁니다.');
  }

  return {
    success: successSet.size === allCategories.length,
    capturedCount: successSet.size,
    totalCategories: allCategories.length,
    errors: errors.length > 0 ? errors : null,
    capturedCategories: Array.from(successSet),
    failedCategories: Array.from(failSet),
  };
}

async function captureFullPageWithSelenium(driver, filePath) {
  const totalHeight = await driver.executeScript('return document.body.scrollHeight');
  const viewportWidth = await driver.executeScript('return document.body.scrollWidth');
  await driver.manage().window().setRect({ width: viewportWidth, height: totalHeight });
  await driver.sleep(1000);
  const screenshot = await driver.takeScreenshot();
  const sharpBuffer = await sharp(Buffer.from(screenshot, 'base64')).jpeg({ quality: 100 }).toBuffer();
  await fs.promises.writeFile(filePath, sharpBuffer);
}

// ========================================
// 🌐 API 라우트들
// ========================================
app.get('/health', async (req, res) => {
  try {
    const chromePath = await findChrome();
    const driver = await new Builder()
      .forBrowser('chrome')
      .setChromeOptions(new chrome.Options().addArguments('--headless', '--no-sandbox', '--disable-dev-shm-usage', '--window-size=1920,1080'))
      .build();
    await driver.close();
    res.json({ status: 'healthy', chrome_path: chromePath, timestamp: new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) });
  } catch (error) {
    res.status(500).json({ status: 'unhealthy', error: error.message, timestamp: new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'olive.html'));
});

// ✅ 주간만 조회
app.get('/api/ranking', async (req, res) => {
  try {
    log.section('📊 랭킹 데이터 조회 (weekly only)');
    const { category = '스킨케어', startDate, endDate, yearMonth } = req.query;

    const ym = yearMonth || new Date().toISOString().slice(0, 7);
    const weeklyFiles = listWeeklyFiles(ym);

    const pushRow = (rows, item, fallbackCategory) => {
      if (!item) return;
      const cat = item.category || fallbackCategory || '';
      if (category && cat !== category) return;
      if ((startDate || endDate) && !inDateRange(item.date, startDate, endDate)) return;
      rows.push({
        rank: item.rank, brand: item.brand, name: item.name,
        originalPrice: item.originalPrice, salePrice: item.salePrice,
        promotion: item.promotion, date: item.date, time: item.time, category: cat,
      });
    };

    const rows = [];
    for (const f of weeklyFiles) {
      try {
        let parsed = null;
        try { parsed = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
        if (parsed && parsed.data && typeof parsed.data === 'object') {
          if (category && Array.isArray(parsed.data[category])) {
            for (const item of parsed.data[category]) pushRow(rows, item, category);
          } else {
            for (const [catKey, arr] of Object.entries(parsed.data)) {
              if (!Array.isArray(arr)) continue;
              if (category && catKey !== category) continue;
              for (const item of arr) pushRow(rows, item, catKey);
            }
          }
        } else {
          await new Promise((resolve) => {
            const source = fs.createReadStream(f, { encoding: 'utf8', highWaterMark: 1 << 20 });
            const pipeline = chain([source, parser(), streamValues()]);
            pipeline.on('data', ({ value, path }) => {
              if (Array.isArray(path) && path.length === 3 && path[0] === 'data') {
                const itemCat = String(path[1] || '');
                if (category && itemCat !== category) return;
                pushRow(rows, value, itemCat);
                return;
              }
              if (value && typeof value === 'object') pushRow(rows, value, value.category || '');
            });
            pipeline.once('end', () => { try { pipeline.destroy(); } catch {} try { source.destroy(); } catch {} resolve(); });
            pipeline.once('error', () => { try { pipeline.destroy(); } catch {} try { source.destroy(); } catch {} resolve(); });
          });
        }
        log.info(`[weekly read] OK: ${path.basename(f)}`);
      } catch (e) {
        log.warn(`[weekly read fail] ${path.basename(f)}: ${e.message}`);
      }
    }

    rows.sort((a, b) => {
      const dc = String(b.date || '').localeCompare(String(a.date || ''));
      if (dc !== 0) return dc;
      if (a.time && b.time) {
        const tc = String(b.time).localeCompare(String(a.time));
        if (tc !== 0) return tc;
      }
      return (a.rank ?? 999999) - (b.rank ?? 999999);
    });

    log.success(`[응답] (weekly only) ${category} ${rows.length}건 반환 (date=${startDate || 'ALL'}~${endDate || startDate || 'ALL'})`);
    return res.json({ success: true, data: rows, total: rows.length, category, weekly: true });
  } catch (error) {
    log.error('랭킹 데이터 조회 오류: ' + (error?.message || error));
    return res.status(500).json({ success: false, error: '서버 오류가 발생했습니다.' });
  }
});

// ✅ 검색도 주간만
app.get('/api/search', async (req, res) => {
  try {
    log.section('🔍 제품명 데이터 검색 (weekly only)');
    const { keyword, startDate, endDate, category, yearMonth } = req.query;

    if (!keyword || !startDate) {
      return res.status(400).json({ success: false, error: '검색어와 시작 날짜를 입력해주세요.' });
    }

    const kwLower = String(keyword).toLowerCase();
    const ym = yearMonth || (normalizeDate(startDate)?.slice(0, 7) || new Date().toISOString().slice(0, 7));
    const weeklyFiles = listWeeklyFiles(ym);
    const HARD_LIMIT = 2000;
    const results = [];

    const pushIfMatch = (item, fallbackCategory) => {
      if (!item || !item.date) return;
      const itemCat = item.category || fallbackCategory || '';
      if (category && itemCat !== category) return;
      if (!inDateRange(item.date, startDate, endDate || startDate)) return;
      const hay = `${item.brand || ''} ${item.name || ''}`.toLowerCase();
      if (!hay.includes(kwLower)) return;
      results.push({
        date: item.date, time: item.time, category: itemCat,
        rank: item.rank, brand: item.brand, name: item.name,
        originalPrice: item.originalPrice, salePrice: item.salePrice, promotion: item.promotion,
      });
    };

    if (weeklyFiles.length === 0) {
      return res.json({ success: true, data: [], total: 0, weekly: true, message: `${ym} 주간 데이터가 없습니다.` });
    }

    for (const f of weeklyFiles) {
      if (results.length >= HARD_LIMIT) break;
      try {
        const raw = fs.readFileSync(f, 'utf8').trim();

        if (raw.startsWith('{')) {
          const j = JSON.parse(raw);
          if (j && j.data && typeof j.data === 'object') {
            if (category && Array.isArray(j.data[category])) {
              for (const it of j.data[category]) { pushIfMatch(it, category); if (results.length >= HARD_LIMIT) break; }
            } else {
              for (const [catKey, arr] of Object.entries(j.data)) {
                if (!Array.isArray(arr)) continue;
                for (const it of arr) { pushIfMatch(it, catKey); if (results.length >= HARD_LIMIT) break; }
                if (results.length >= HARD_LIMIT) break;
              }
            }
            continue;
          }
        }

        await new Promise((resolve) => {
          const source = fs.createReadStream(f, { encoding: 'utf8', highWaterMark: 1 << 20 });
          const pipeline = chain([source, parser(), streamValues()]);
          pipeline.on('data', ({ value, path }) => {
            if (results.length >= HARD_LIMIT) return;
            if (Array.isArray(path) && path.length === 3 && path[0] === 'data') {
              const itemCat = String(path[1] || '');
              if (category && itemCat !== category) return;
              pushIfMatch(value, itemCat);
              return;
            }
            if (value && typeof value === 'object') {
              const itemCat = value.category || '';
              if (category && itemCat !== category) return;
              pushIfMatch(value, itemCat);
            }
          });
          pipeline.once('end', () => { try { pipeline.destroy(); } catch {} try { source.destroy(); } catch {} resolve(); });
          pipeline.once('error', () => { try { pipeline.destroy(); } catch {} try { source.destroy(); } catch {} resolve(); });
        });
      } catch (e) {
        log.warn(`[weekly search read] ${f}: ${e.message}`);
      }
    }

    results.sort((a, b) => {
      const dc = b.date.localeCompare(a.date);
      if (dc !== 0) return dc;
      if (a.time && b.time) {
        const tc = b.time.localeCompare(a.time);
        if (tc !== 0) return tc;
      }
      if (a.category !== b.category) return a.category.localeCompare(b.category);
      return a.rank - b.rank;
    });

    log.success(`[응답] (weekly only) ${results.length}건 반환`);
    return res.json({ success: true, data: results, total: results.length, weekly: true });
  } catch (error) {
    log.error('검색 오류: ' + error?.message);
    return res.status(500).json({ success: false, error: '서버 오류가 발생했습니다.' });
  }
});

// ✅ 마지막 크롤링 시간도 주간만 스캔
app.get('/api/last-crawl-time', async (req, res) => {
  try {
    const kstNow = getKSTTime();
    const ymList = [];
    const curYM = kstNow.toISOString().slice(0, 7);
    ymList.push(curYM);
    const prev = new Date(kstNow); prev.setMonth(prev.getMonth() - 1);
    ymList.push(prev.toISOString().slice(0, 7));

    let latestDate = null, latestTime = null, found = false;

    for (const ym of ymList) {
      const files = listWeeklyFiles(ym);
      for (const f of files) {
        try {
          const j = JSON.parse(fs.readFileSync(f, 'utf8'));
          if (!j || !j.data) continue;
          Object.values(j.data).forEach(arr => {
            (arr || []).forEach(it => {
              if (it.date && it.time) {
                const dt = `${it.date} ${it.time}`;
                const cur = latestDate ? `${latestDate} ${latestTime}` : '';
                if (!latestDate || dt > cur) {
                  latestDate = it.date;
                  latestTime = it.time;
                  found = true;
                }
              }
            });
          });
        } catch {}
      }
    }

    if (!found) {
      return res.json({ success: true, lastCrawlTime: '주간 데이터 없음', message: '주간 파일에서 데이터를 찾지 못했습니다.' });
    }

    const dt = new Date(`${latestDate}T${latestTime.replace('-', ':')}:00+09:00`);
    const formatted = dt.toLocaleString('ko-KR', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false, timeZone: 'Asia/Seoul',
    });
    return res.json({ success: true, lastCrawlTime: formatted });
  } catch (error) {
    console.error('마지막 크롤링 시간 조회 오류:', error);
    res.status(500).json({ success: false, error: '마지막 크롤링 시간 조회 중 오류가 발생했습니다.', details: error.message });
  }
});

app.get('/api/captures', async (req, res) => {
  res.json({ success: true, data: [], total: 0 });
});

// 1시간마다 15분에 크롤링 실행
cron.schedule('15 * * * *', async () => {
  console.log('[CRON] 크롤링 시작:', new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }));
  await crawlAllCategoriesV2();
  console.log('[CRON] 크롤링 완료:', new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }));
}, { timezone: 'Asia/Seoul' });
