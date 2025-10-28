/**
 * ============================================================
 *  HWASEON · OliveYoung Weekly Crawler & Capture Server
 *  - Node.js + Express + Selenium + Sharp + Cron + Nodemailer
 * ============================================================
 */

/* ─────────────── 1) 모듈 & 환경 ─────────────── */
require('dotenv').config();

const express   = require('express');
const cors      = require('cors');
const path      = require('path');
const fs        = require('fs');
const os        = require('os');

const { Builder, By, until } = require('selenium-webdriver');
const chrome    = require('selenium-webdriver/chrome');
const sharp     = require('sharp');
const cron      = require('node-cron');
const nodemailer= require('nodemailer');
const archiver  = require('archiver');

const { chain }       = require('stream-chain');
const { parser }      = require('stream-json');
const { streamValues }= require('stream-json/streamers/StreamValues');


/* ─────────────── 2) 서버 기본 설정 ─────────────── */
const app  = express();
const port = process.env.PORT || 5001;

/** 색상 로그 유틸 */
const log = {
  info    : (m) => console.log(`\x1b[36m[INFO]\x1b[0m ${m}`),
  success : (m) => console.log(`\x1b[32m[SUCCESS]\x1b[0m ${m}`),
  warn    : (m) => console.log(`\x1b[33m[WARN]\x1b[0m ${m}`),
  error   : (m) => console.log(`\x1b[31m[ERROR]\x1b[0m ${m}`),
  section : (m) => console.log(`\n\x1b[35m========== ${m} ==========\x1b[0m`),
  line    : () => console.log('\x1b[90m' + '-'.repeat(60) + '\x1b[0m'),
};


/* ─────────────── 3) 경로/디렉토리 ─────────────── */
const PUBLIC_DIR   = path.join(__dirname, 'public');
const CAPTURE_DIR  = path.join(PUBLIC_DIR, 'captures');

if (!fs.existsSync(CAPTURE_DIR)) {
  fs.mkdirSync(CAPTURE_DIR, { recursive: true });
}


/* ─────────────── 4) 상수(카테고리/UA) ─────────────── */

/** 올리브영 카테고리 코드 맵 */
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

/** 랜덤 User-Agent */
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
];


/* ─────────────── 5) 공통 유틸 함수 ─────────────── */

/** KST(Asia/Seoul) 현재 시간 */
function getKSTTime() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
}

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function normalizeDate(dateString) {
  if (!dateString) return null;
  const d = new Date(dateString);
  return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
}

/** 날짜 범위 포함 여부 */
function inDateRange(itemDate, startDate, endDate) {
  const d = normalizeDate(itemDate);
  const s = startDate ? normalizeDate(startDate) : null;
  const e = endDate ? normalizeDate(endDate) : s;
  if (!s && !e) return true;
  if (s && !e) return d === s;
  if (!s && e) return d === e;
  return d >= s && d <= e;
}

/** 드라이버 안전 종료 */
async function safeQuitDriver(driver, tag = 'driver') {
  if (!driver) return;
  try { await driver.quit(); console.log(`${tag} 종료 완료`); }
  catch (e) { console.error(`${tag} 종료 오류:`, e.message); }
}

/** 임시 프로필 삭제 */
function safeRemoveTempProfile(tmpDir, tag = 'profile') {
  if (tmpDir && fs.existsSync(tmpDir)) {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); console.log(`${tag} 임시 프로필 삭제:`, tmpDir); }
    catch (e) { console.error(`${tag} 임시 프로필 삭제 실패:`, e.message); }
  }
}

/** 다음 크롤링 시간 로그(매시 15분) */
function logNextCrawlTime() {
  const now = getKSTTime();
  const next = new Date(now);
  next.setMinutes(15, 0, 0);
  if (now.getMinutes() >= 15) next.setHours(now.getHours() + 1);
  const diffMs  = next - now;
  const diffMin = Math.floor(diffMs / 60000);
  const diffSec = Math.floor((diffMs % 60000) / 1000);
  log.info(`다음 크롤링: ${next.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} (약 ${diffMin}분 ${diffSec}초 후)`);
}

/** Chrome 바이너리 경로 확인 */
async function findChrome() {
  try {
    const { execSync } = require('child_process');
    const chromePath = execSync('which google-chrome-stable').toString().trim();
    const version    = execSync('google-chrome-stable --version').toString().trim();
    console.log('Chrome 경로:', chromePath);
    console.log('Chrome 버전:', version);
    return chromePath;
  } catch (e) {
    console.error('Chrome 경로 확인 실패:', e.message);
    return '/usr/bin/google-chrome-stable';
  }
}

/** 임시 크롬 프로필 생성 */
function createTempChromeProfile() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-profile-'));
}


/* ─────────────── 6) 주간 파일 유틸(저장/조회) ─────────────── */

/** 특정 날짜가 속한 월의 1~4주 인덱스 */
function getWeekIndex(isoDate) {
  const d = new Date(isoDate);
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const week = Math.ceil((d.getDate() + first.getDay()) / 7);
  return Math.min(week, 4);
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
  const ym   = isoDate.slice(0, 7);
  const week = getWeekIndex(isoDate);
  const dir  = getWeeklyDir(ym);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `ranking_${ym}_week${week}.json`);
}

/** 주간 파일 upsert (카테고리별 중복 제거 후 병합) */
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
    const seen   = new Set();
    const merged = [];

    for (const src of [oldArr, arr]) {
      for (const it of src) {
        const key = [
          it.date, it.time, it.category, it.rank,
          String(it.brand || '').trim(),
          String(it.name  || '').trim(),
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


/* ─────────────── 7) 이메일(캡처 ZIP 전송) ─────────────── */
const transporter = nodemailer.createTransport({
  host: 'smtp.worksmobile.com',
  port: 465,
  secure: true,
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

/**
 * 캡처본을 7개씩 ZIP으로 분할하여 메일 전송 후 원본 삭제
 */
async function organizeAndSendCapturesSplit(timeStr, dateStr) {
  log.section('📧 이메일 전송 시작');

  const files = fs.readdirSync(CAPTURE_DIR)
    .filter(f => f.endsWith('.jpeg') && f.includes(dateStr) && f.includes(timeStr));

  if (files.length === 0) return;

  const MAX_FILES_PER_MAIL = 7;
  const groups = [];
  for (let i = 0; i < files.length; i += MAX_FILES_PER_MAIL) {
    groups.push(files.slice(i, i + MAX_FILES_PER_MAIL));
  }

  for (let idx = 0; idx < groups.length; idx++) {
    const group   = groups[idx];
    const zipPath = path.join(__dirname, `oliveyoung_captures_${dateStr}_${timeStr}_part${idx + 1}.zip`);

    // ZIP 생성
    await new Promise((resolve, reject) => {
      const output  = fs.createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 9 } });
      output.on('close', resolve);
      archive.on('error', reject);
      archive.pipe(output);
      for (const f of group) {
        archive.file(path.join(CAPTURE_DIR, f), { name: f });
      }
      archive.finalize();
    });

    const categories = group.map(f => f.match(/ranking_(.+?)_/)?.[1] || f).join(', ');

    const mail = {
      from: process.env.EMAIL_USER,
      to  : 'hwaseon@hwaseon.com',
      subject: `올리브영 ${dateStr} ${timeStr.replace('-', ':')} 캡처본 (part ${idx + 1}/${groups.length})`,
      text   : `포함 카테고리:\n${categories}`,
      attachments: [{ filename: path.basename(zipPath), path: zipPath }],
    };

    try {
      await transporter.sendMail(mail);
      console.log(`[메일전송성공] ${mail.subject}`);
    } catch (e) {
      console.error(`[메일전송실패] ${mail.subject}`, e);
    }

    fs.unlinkSync(zipPath);
  }

  // 개별 캡처 삭제
  for (const f of files) {
    try { fs.unlinkSync(path.join(CAPTURE_DIR, f)); console.log('캡처 삭제:', f); }
    catch (e) { console.error('캡처 삭제 실패:', f, e.message); }
  }
}


/* ─────────────── 8) 캡처 도우미 ─────────────── */

/** 페이지 전체 스크린샷 저장(jpeg) */
async function captureFullPageWithSelenium(driver, filePath) {
  const totalHeight   = await driver.executeScript('return document.body.scrollHeight');
  const viewportWidth = await driver.executeScript('return document.body.scrollWidth');

  await driver.manage().window().setRect({ width: viewportWidth, height: totalHeight });
  await driver.sleep(1000);

  const screenshot  = await driver.takeScreenshot();
  const sharpBuffer = await sharp(Buffer.from(screenshot, 'base64')).jpeg({ quality: 100 }).toBuffer();

  await fs.promises.writeFile(filePath, sharpBuffer);
}


/* ─────────────── 9) 캡처(카테고리별) ─────────────── */

/**
 * 모든 카테고리 랭킹 페이지 캡처
 * - 각 카테고리 1~2차 시도
 * - 성공분 ZIP 메일 전송
 */
async function captureOliveyoungMainRanking(timeStr) {
  log.section('📸 캡처 전체 시작');
  console.log('총 21개 카테고리 캡처 예정');
  console.log('='.repeat(50));

  const now           = getKSTTime();
  const dateFormatted = now.toISOString().split('T')[0];
  const categories    = Object.keys(CATEGORY_CODES);

  const successSet = new Set();
  const failSet    = new Set();
  const errors     = [];

  async function tryCaptureCategory(category, attempt) {
    let driver  = null;
    let tmpDir  = null;

    try {
      console.log(`${category} 캡처 시도... (${attempt}차)`);
      tmpDir = createTempChromeProfile();

      const opts = new chrome.Options()
        .addArguments(
          '--headless', '--no-sandbox', '--disable-dev-shm-usage',
          '--start-maximized', '--window-size=1920,1500',
          '--hide-scrollbars', '--force-device-scale-factor=1',
          '--screenshot-format=jpeg', '--screenshot-quality=80',
          '--disable-gpu', '--disable-extensions', '--disable-notifications',
          '--disable-web-security', '--disable-features=VizDisplayCompositor',
          '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding', '--disable-field-trial-config',
          '--disable-ipc-flooding-protection', '--disable-hang-monitor',
          '--disable-prompt-on-repost', '--disable-client-side-phishing-detection',
          '--disable-component-update', '--disable-default-apps', '--disable-sync',
          '--metrics-recording-only', '--no-first-run', '--safebrowsing-disable-auto-update',
          '--disable-translate', '--disable-plugins-discovery', '--disable-plugins',
          '--enable-javascript', '--enable-dom-storage', '--enable-local-storage',
          '--enable-session-storage', '--enable-cookies', '--enable-images', '--enable-scripts',
        )
        .addArguments(`--user-data-dir=${tmpDir}`)
        .addArguments(`--user-agent=${getRandomUserAgent()}`);

      if (process.env.CHROME_BIN) opts.setChromeBinaryPath(process.env.CHROME_BIN);

      driver = await new Builder().forBrowser('chrome').setChromeOptions(opts).build();

      const catName   = category.replace('_', ' ');
      const encoded   = encodeURIComponent(catName);
      const url =
        `https://www.oliveyoung.co.kr/store/main/getBestList.do?dispCatNo=900000100100001&fltDispCatNo=${CATEGORY_CODES[category].fltDispCatNo}&pageIdx=1&rowsPerPage=24&t_page=%EB%9E%AD%ED%82%B9&t_click=%ED%8C%90%EB%A7%A4%EB%9E%AD%ED%82%B9_${encoded}`;

      await driver.get(url);
      await driver.wait(until.elementLocated(By.css('body')), 20000);
      await driver.sleep(3000);

      // 상품 리스트가 실제로 로드될 때까지 대기
      try {
        await driver.wait(
          until.elementLocated(By.css('ul.cate_prd_list')), 
          15000
        );
        console.log(`${category} 상품 리스트 로드 완료`);
      } catch (e) {
        console.log(`${category} 상품 리스트 대기 시간 초과, 페이지 상태 확인 진행`);
      }
      
      await driver.wait(async () => (await driver.executeScript('return document.readyState')) === 'complete', 15000);
      await driver.sleep(2000);
      
      // 올리브영 페이지의 실제 DOM 구조에 맞춘 셀렉터
      const checkSelectors = [
        'ul.cate_prd_list',           // 메인 상품 리스트
        'ul.cate_prd_list > li',      // 개별 상품 아이템
        '.prd_info',                  // 상품 정보
        '.prd_name',                  // 상품명
        '.tx_name'                    // 상품명 (대체)
      ];

      let found = false;
      for (const sel of checkSelectors) {
        try {
          const els = await driver.findElements(By.css(sel));
          if (els.length > 0) { console.log(`요소 발견: ${sel} (${els.length})`); found = true; break; }
        } catch {}
      }
      if (!found) throw new Error('필수 요소를 찾지 못함');

      // 고정 헤더(카테고리 텍스트) 삽입
      await driver.executeScript(`
        const div = document.createElement('div');
        div.id = 'custom-category-header';
        div.style.cssText = 'position:fixed;top:0;left:0;width:100%;background:#333;color:#fff;text-align:center;padding:10px 0;font-size:16px;font-weight:bold;z-index:9999;';
        div.textContent = '${category === '전체' ? '전체 랭킹' : catName + ' 랭킹'}';
        document.body.prepend(div);
        document.body.style.marginTop = '40px';
      `);

      const fileName = `ranking_${category}_${dateFormatted}_${timeStr}.jpeg`;
      const filePath = path.join(CAPTURE_DIR, fileName);
      await captureFullPageWithSelenium(driver, filePath);

      console.log(`${category} 캡처 완료: ${fileName}`);
      console.log(`진행률: ${successSet.size + 1}/${categories.length} (${Math.round((successSet.size + 1) / categories.length * 100)}%)`);
      console.log('-'.repeat(50));

      return true;
    } catch (e) {
      console.error(`${category} 캡처 실패 (${attempt}차):`, e.message);
      return false;
    } finally {
      await safeQuitDriver(driver, `${category} 캡처`);
      safeRemoveTempProfile(tmpDir, category);
    }
  }

  // 1차 시도
  console.log('=== 1차 시도 시작 ===');
  for (const category of categories) {
    const ok = await tryCaptureCategory(category, 1);
    if (ok) successSet.add(category);
    else { failSet.add(category); errors.push({ category, error: `${category} 1차 실패`, timestamp: new Date().toISOString() }); }
    await new Promise(r => setTimeout(r, 1000));
  }

  // 2차 재시도
  if (failSet.size > 0) {
    console.log('=== 2차 시도(실패분) ===');
    const retry = Array.from(failSet);
    failSet.clear();

    for (const category of retry) {
      const ok = await tryCaptureCategory(category, 2);
      if (ok) successSet.add(category);
      else { failSet.add(category); errors.push({ category, error: `${category} 2차 실패`, timestamp: new Date().toISOString() }); }
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  // 요약
  console.log('='.repeat(50));
  console.log('캡처 결과 요약');
  console.log(`성공: ${successSet.size}/${categories.length}`);
  console.log(`실패: ${failSet.size}`);
  if (failSet.size > 0) console.log('실패 카테고리:', Array.from(failSet));
  console.log('='.repeat(50));

  // 메일 발송
  if (successSet.size > 0) {
    console.log('이메일 전송 시작...');
    try { await organizeAndSendCapturesSplit(timeStr, dateFormatted); console.log('이메일 전송 및 파일 삭제 완료'); }
    catch (e) { console.error('이메일 전송 실패:', e.message); }
  } else {
    console.log('캡처 파일 없음 → 메일 전송 생략');
  }

  return {
    success: successSet.size === categories.length,
    capturedCount     : successSet.size,
    totalCategories   : categories.length,
    capturedCategories: Array.from(successSet),
    failedCategories  : Array.from(failSet),
    errors            : errors.length ? errors : null,
  };
}


/* ─────────────── 10) 크롤러(랭킹 수집) ─────────────── */

/**
 * 모든 카테고리 1~100위 수집 후 주간 파일에 반영
 * - 셀레니움으로 리스트 파싱
 * - 월간 저장 제거(주간만)
 */
async function crawlAllCategoriesV2(options = {}) {
  log.section('🕷️ 크롤링 전체 시작');

  const now       = getKSTTime();
  const today     = now.toISOString().split('T')[0];
  const timeStr   = `${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
  const target    = options.onlyCategory ? [options.onlyCategory] : Object.keys(CATEGORY_CODES);

  const local = { data: {}, allProducts: [], timestamp: null };

  for (const category of target) {
    log.line();
    log.info(`카테고리: ${category}`);
    local.data[category] = [];

    let rankCounter     = 1;
    let page            = 1;
    let noNewItemCount  = 0;
    const seen          = new Set();
    const MAX_NO_NEW    = 3;     // 연속 새 항목 없음 → 중단

    while (local.data[category].length < 100 && page <= 30) {
      const url = `https://www.oliveyoung.co.kr/store/main/getBestList.do?dispCatNo=900000100100001&fltDispCatNo=${CATEGORY_CODES[category].fltDispCatNo}&pageIdx=${page}&rowsPerPage=24&t_page=%EB%9E%AD%ED%82%B9&t_click=%ED%8C%90%EB%A7%A4%EB%9E%AD%ED%82%B9_${encodeURIComponent(category.replace('_',' '))}`;

      let driver  = null;
      let tmpDir  = null;
      let added   = false;

      try {
        tmpDir = createTempChromeProfile();
        const opts = new chrome.Options()
          .addArguments('--headless', '--no-sandbox', '--disable-dev-shm-usage', '--window-size=1920,1500')
          .addArguments(`--user-data-dir=${tmpDir}`)
          .addArguments(`--user-agent=${getRandomUserAgent()}`);

        if (process.env.CHROME_BIN) opts.setChromeBinaryPath(process.env.CHROME_BIN);

        driver = await new Builder().forBrowser('chrome').setChromeOptions(opts).build();
        await driver.get(url);
        await driver.wait(until.elementLocated(By.css('body')), 15000);
        await driver.sleep(2000);

        const products = await driver.findElements(By.css('ul.cate_prd_list > li'));
        for (const el of products) {
          if (local.data[category].length >= 100) break;

          try {
            // 랭킹 추출
            let extractedRank = rankCounter;

            const dataAttrEl = await el.findElement(By.css('a[data-attr]')).catch(() => null);
            if (dataAttrEl) {
              const dataAttr = await dataAttrEl.getAttribute('data-attr');
              if (dataAttr) {
                const parts = dataAttr.split('^');
                const rAttr = parseInt(parts[3]);
                if (!isNaN(rAttr)) extractedRank = rAttr;
              }
            }
            if (extractedRank === rankCounter) {
              const flagEl = await el.findElement(By.css('.thumb_flag.best')).catch(() => null);
              if (flagEl) {
                const t = await flagEl.getText();
                const r = parseInt(t);
                if (!isNaN(r)) extractedRank = r;
              }
            }

            // 브랜드/상품명
            const nameEl  = await el.findElement(By.css('.prd_name, .tx_name')).catch(() => null);
            let name      = nameEl ? await nameEl.getText() : `상품${extractedRank}`;

            const brandEl = await el.findElement(By.css('.prd_brand, .tx_brand')).catch(() => null);
            let brand     = brandEl ? await brandEl.getText() : '';

            if (!brand && name) {
              const lines = name.split('\n');
              if (lines.length > 1) { brand = lines[0].trim(); name = lines.slice(1).join(' ').trim(); }
              else {
                const m = name.match(/^([\w가-힣A-Za-z0-9]+)[\s\[]?(.*)$/);
                if (m) { brand = m[1].trim(); name = m[2].trim(); }
              }
            }
            if (brand && name.startsWith(brand)) name = name.slice(brand.length).trim();

            const key = [today, timeStr, category, extractedRank, brand.trim(), name.trim()].join('|');
            if (seen.has(key)) continue;
            seen.add(key);

            // 가격
            let originalPrice = '';
            let salePrice     = '';
            const orgEl = await el.findElement(By.css('.prd_price .tx_org .tx_num')).catch(() => null);
            const curEl = await el.findElement(By.css('.prd_price .tx_cur .tx_num')).catch(() => null);

            if (orgEl) originalPrice = (await orgEl.getText()).replace(/,/g, '');
            if (curEl) salePrice     = (await curEl.getText()).replace(/,/g, '');

            if (!originalPrice || !salePrice) {
              const priceEl   = await el.findElement(By.css('.prd_price')).catch(() => null);
              const priceText = priceEl ? await priceEl.getText() : '';
              const m = priceText.match(/(\d{1,3}(?:,\d{3})*)/g);
              if (!originalPrice) originalPrice = m?.[0]?.replace(/,/g,'') || '';
              if (!salePrice)     salePrice     = m?.[1]?.replace(/,/g,'') || originalPrice;
            }

            // 프로모션
            const promoEls = await el.findElements(By.css('.icon_flag')).catch(() => []);
            let promotion  = '';
            if (promoEls?.length) {
              const arr = [];
              for (const pEl of promoEls) { const t = await pEl.getText(); if (t) arr.push(t.trim()); }
              promotion = arr.join(', ');
            }

            local.data[category].push({
              date: today, time: timeStr, category,
              rank: extractedRank, brand: brand.trim(), name: name.trim(),
              originalPrice, salePrice, promotion: promotion.trim(),
            });

            rankCounter++;
            added = true;
          } catch {
            // 실패해도 자리 채우기(랭킹 유지)
            local.data[category].push({
              date: today, time: timeStr, category,
              rank: rankCounter, brand: '', name: `상품${rankCounter}`,
              originalPrice: '', salePrice: '', promotion: '',
            });
            rankCounter++;
            added = true;
          }
        }
      } catch (e) {
        console.error(`[${category}] ${page}페이지 크롤링 실패:`, e.message);
      } finally {
        await safeQuitDriver(driver, `${category} 목록`);
        safeRemoveTempProfile(tmpDir, `${category} 목록`);
      }

      // 종료 조건
      noNewItemCount = added ? 0 : (noNewItemCount + 1);
      if (noNewItemCount >= MAX_NO_NEW) {
        log.warn(`[${category}] 연속 ${MAX_NO_NEW} 페이지 신규 없음 → 종료`);
        break;
      }
      page++;
    }

    local.data[category].sort((a,b)=> a.rank - b.rank);
    local.data[category] = local.data[category].slice(0, 100);
    log.success(`[${category}] 완료: ${local.data[category].length}개`);
  }

  // 주간 파일에만 저장
  upsertWeeklyFile(local.data, today);

  // 캡처 & 다음 일정 로그
  await captureOliveyoungMainRanking(timeStr);
  logNextCrawlTime();
}


/* ─────────────── 11) 미들웨어 ─────────────── */
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(PUBLIC_DIR));
app.use('/captures', express.static(CAPTURE_DIR));


/* ─────────────── 12) 라우트(API) ─────────────── */

/** 헬스체크(Chrome 구동 테스트) */
app.get('/health', async (_req, res) => {
  try {
    const chromePath = await findChrome();
    const driver = await new Builder()
      .forBrowser('chrome')
      .setChromeOptions(new chrome.Options().addArguments('--headless','--no-sandbox','--disable-dev-shm-usage','--window-size=1920,1080'))
      .build();
    await driver.close();
    res.json({ status: 'healthy', chrome_path: chromePath, timestamp: new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) });
  } catch (e) {
    res.status(500).json({ status: 'unhealthy', error: e.message, timestamp: new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) });
  }
});

/** 메인 페이지 */
app.get('/', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'olive.html'));
});

/**
 * 주간 랭킹 조회
 * - /api/ranking?category=스킨케어&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&yearMonth=YYYY-MM
 */
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
            for (const it of parsed.data[category]) pushRow(rows, it, category);
          } else {
            for (const [catKey, arr] of Object.entries(parsed.data)) {
              if (!Array.isArray(arr)) continue;
              if (category && catKey !== category) continue;
              for (const it of arr) pushRow(rows, it, catKey);
            }
          }
        } else {
          // 대용량 파일 스트림 파싱
          await new Promise((resolve) => {
            const source   = fs.createReadStream(f, { encoding: 'utf8', highWaterMark: 1 << 20 });
            const pipeline = chain([source, parser(), streamValues()]);
            pipeline.on('data', ({ value, path }) => {
              if (Array.isArray(path) && path.length === 3 && path[0] === 'data') {
                const itemCat = String(path[1] || '');
                if (category && itemCat !== category) return;
                pushRow(rows, value, itemCat); return;
              }
              if (value && typeof value === 'object') pushRow(rows, value, value.category || '');
            });
            pipeline.once('end',   () => { try { pipeline.destroy(); } catch {} try { source.destroy(); } catch {} resolve(); });
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

    log.success(`[응답] ${category} ${rows.length}건 (weekly)`);
    res.json({ success: true, data: rows, total: rows.length, category, weekly: true });
  } catch (error) {
    log.error('랭킹 조회 오류: ' + (error?.message || error));
    res.status(500).json({ success: false, error: '서버 오류가 발생했습니다.' });
  }
});

/**
 * 주간 검색
 * - /api/search?keyword=에센스&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&category=스킨케어&yearMonth=YYYY-MM
 */
app.get('/api/search', async (req, res) => {
  try {
    log.section('🔍 제품명 검색 (weekly only)');

    const { keyword, startDate, endDate, category, yearMonth } = req.query;
    if (!keyword || !startDate) {
      return res.status(400).json({ success: false, error: '검색어와 시작 날짜를 입력해주세요.' });
    }

    const kwLower = String(keyword).toLowerCase();
    const ym      = yearMonth || (normalizeDate(startDate)?.slice(0,7) || new Date().toISOString().slice(0,7));
    const files   = listWeeklyFiles(ym);

    const HARD_LIMIT = 2000;
    const results = [];

    const pushIfMatch = (item, fallbackCategory) => {
      if (!item || !item.date) return;
      const cat = item.category || fallbackCategory || '';
      if (category && cat !== category) return;
      if (!inDateRange(item.date, startDate, endDate || startDate)) return;
      const hay = `${item.brand || ''} ${item.name || ''}`.toLowerCase();
      if (!hay.includes(kwLower)) return;

      results.push({
        date: item.date, time: item.time, category: cat,
        rank: item.rank, brand: item.brand, name: item.name,
        originalPrice: item.originalPrice, salePrice: item.salePrice, promotion: item.promotion,
      });
    };

    if (files.length === 0) {
      return res.json({ success: true, data: [], total: 0, weekly: true, message: `${ym} 주간 데이터가 없습니다.` });
    }

    for (const f of files) {
      if (results.length >= HARD_LIMIT) break;

      try {
        const raw = fs.readFileSync(f, 'utf8').trim();

        if (raw.startsWith('{')) {
          const j = JSON.parse(raw);
          if (j?.data && typeof j.data === 'object') {
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

        // 스트림 파싱
        await new Promise((resolve) => {
          const source   = fs.createReadStream(f, { encoding: 'utf8', highWaterMark: 1 << 20 });
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
          pipeline.once('end',   () => { try { pipeline.destroy(); } catch {} try { source.destroy(); } catch {} resolve(); });
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

    log.success(`[응답] ${results.length}건 (weekly)`);
    res.json({ success: true, data: results, total: results.length, weekly: true });
  } catch (error) {
    log.error('검색 오류: ' + error?.message);
    res.status(500).json({ success: false, error: '서버 오류가 발생했습니다.' });
  }
});

/** 마지막 크롤링 시간(주간 파일 스캔) */
app.get('/api/last-crawl-time', async (_req, res) => {
  try {
    const now    = getKSTTime();
    const ymNow  = now.toISOString().slice(0,7);
    const prev   = new Date(now); prev.setMonth(prev.getMonth() - 1);
    const ymPrev = prev.toISOString().slice(0,7);

    let latestDate = null, latestTime = null, found = false;

    for (const ym of [ymNow, ymPrev]) {
      const files = listWeeklyFiles(ym);
      for (const f of files) {
        try {
          const j = JSON.parse(fs.readFileSync(f, 'utf8'));
          if (!j?.data) continue;
          Object.values(j.data).forEach(arr => {
            (arr || []).forEach(it => {
              if (it.date && it.time) {
                const dt = `${it.date} ${it.time}`;
                const cur = latestDate ? `${latestDate} ${latestTime}` : '';
                if (!latestDate || dt > cur) {
                  latestDate = it.date; latestTime = it.time; found = true;
                }
              }
            });
          });
        } catch {}
      }
    }

    if (!found) return res.json({ success: true, lastCrawlTime: '주간 데이터 없음', message: '주간 파일에서 데이터를 찾지 못했습니다.' });

    const dt = new Date(`${latestDate}T${latestTime.replace('-', ':')}:00+09:00`);
    const formatted = dt.toLocaleString('ko-KR', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false, timeZone:'Asia/Seoul' });

    res.json({ success: true, lastCrawlTime: formatted });
  } catch (error) {
    console.error('마지막 크롤링 시간 조회 오류:', error);
    res.status(500).json({ success: false, error: '마지막 크롤링 시간 조회 중 오류가 발생했습니다.', details: error.message });
  }
});

/** (현재 미사용) 캡처 목록 */
app.get('/api/captures', async (_req, res) => {
  res.json({ success: true, data: [], total: 0 });
});


/* ─────────────── 13) 스케줄러(CRON) ─────────────── */

/** 매일 00:00 - 당일자 캡처본 삭제 */
cron.schedule('0 0 * * *', () => {
  fs.readdir(CAPTURE_DIR, (err, files) => {
    if (err) return console.error('캡처 디렉토리 읽기 오류:', err);
    files.forEach(file => {
      const match = file.match(/_(\d{4}-\d{2}-\d{2})_/);
      if (!match) return;
      const filePath = path.join(CAPTURE_DIR, file);
      fs.unlink(filePath, (e) => e ? console.error('캡처 삭제 오류:', filePath, e) : console.log('캡처 삭제:', filePath));
    });
  });
}, { timezone: 'Asia/Seoul' });

/** 매시 15분 - 크롤링 실행 */
cron.schedule('15 * * * *', async () => {
  console.log('[CRON] 크롤링 시작:', new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }));
  await crawlAllCategoriesV2();
  console.log('[CRON] 크롤링 완료:', new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }));
}, { timezone: 'Asia/Seoul' });


/* ─────────────── 14) 서버 시작 ─────────────── */
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
