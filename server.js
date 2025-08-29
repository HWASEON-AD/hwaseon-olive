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

// 추가
const { chain } = require('stream-chain');
const { parser } = require('stream-json');
const { streamValues } = require('stream-json/streamers/StreamValues');

// 서버 보호용 상한
const SEARCH_LIMIT_DEFAULT = 300;
const SEARCH_LIMIT_MAX = 2000;

// 병합 시 이전 파일 최대 허용 크기(넘으면 병합 skip)
const MERGE_MAX_BYTES = 80 * 1024 * 1024; // 80MB
// 저장 시 프리티프린트 여부(메모리/용량 절약 위해 false 권장)
const PRETTY_JSON = false;
// (선택) 카테고리별 보존 상한. 0이면 무제한 보존
const MAX_KEEP_PER_CATEGORY = 0;

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
    '전체': {fltDispCatNo: '' }, // 전체 랭킹 추가
    '스킨케어': {fltDispCatNo: '10000010001' },
    '마스크팩': {fltDispCatNo: '10000010009' },
    '클렌징': {fltDispCatNo: '10000010010' },
    '선케어': {fltDispCatNo: '10000010011' },
    '메이크업': {fltDispCatNo: '10000010002' },
    '네일': {fltDispCatNo: '10000010012' },
    '뷰티소품': {fltDispCatNo: '10000010006' },
    '더모_코스메틱': {fltDispCatNo: '10000010008' },
    '맨즈케어': {fltDispCatNo: '10000010007' },
    '향수_디퓨저': {fltDispCatNo: '10000010005' },
    '헤어케어': {fltDispCatNo: '10000010004' },
    '바디케어': {fltDispCatNo: '10000010003' },
    '건강식품': {fltDispCatNo: '10000020001' },
    '푸드': {fltDispCatNo: '10000020002' },
    '구강용품': {fltDispCatNo: '10000020003' },
    '헬스_건강용품': {fltDispCatNo: '10000020005' },
    '여성_위생용품': {fltDispCatNo: '10000020004' },
    '패션': {fltDispCatNo: '10000030007' },
    '리빙_가전': {fltDispCatNo: '10000030005' },
    '취미_팬시': {fltDispCatNo: '10000030006' }
};

// User-Agent 목록 (2024년 최신 버전)
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 OPR/106.0.0.0',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

// ========================================
// 🔧 유틸리티 함수들
// ========================================

// 월별 랭킹 데이터 경로 생성 함수 (persistent disk 경로)
function getRankingDataPath(yearMonth) {
    return `/data/ranking_${yearMonth}.json`;
}

// KST 시간 가져오기
function getKSTTime() {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
}

// 랜덤 딜레이 함수 (현재 미사용)
function getRandomDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// 랜덤 User-Agent 선택 함수
function getRandomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}


// 날짜 정규화 함수
function normalizeDate(dateString) {
    if (!dateString) return null;
    
    // YYYY-MM-DD 형식으로 변환
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return null;
    
    return date.toISOString().split('T')[0];
}
// 안전한 드라이버 종료 함수
async function safeQuitDriver(driver, category = 'unknown') {
    if (driver) {
        try {
            await driver.quit();
            console.log(`${category} 드라이버 종료 완료`);
        } catch (error) {
            console.error(`${category} 드라이버 종료 중 오류:`, error.message);
        }
    }
}

// 안전한 임시 프로필 삭제 함수
function safeRemoveTempProfile(tmpDir, category = 'unknown') {
    if (tmpDir && fs.existsSync(tmpDir)) {
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
            console.log(`${category} 임시 프로필 삭제 완료:`, tmpDir);
        } catch (error) {
            console.error(`${category} 임시 프로필 삭제 실패:`, tmpDir, error.message);
        }
    }
}

// ========================================
// 🌐 Express 앱 설정
// ========================================

// CORS 미들웨어 설정
app.use(cors());

// 정적 파일 서빙을 위한 미들웨어 설정
app.use(express.static(path.join(__dirname, 'public')));
app.use('/captures', express.static(path.join(__dirname, 'public', 'captures')));

// JSON 파싱 미들웨어
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ========================================
// 💾 전역 변수 및 캐시
// ========================================

// 메모리 캐시 - 크롤링 결과 저장
let productCache = {
    timestamp: new Date(),
    data: {},
    allProducts: []
};

// ========================================
// 🛠️ 서버 설정 및 시작
// ========================================


// Health check endpoint
app.get('/health', async (req, res) => {
    try {
        const chromePath = await findChrome();
        const driver = await new Builder()
            .forBrowser('chrome')
            .setChromeOptions(new chrome.Options()
                .addArguments('--headless')
                .addArguments('--no-sandbox')
                .addArguments('--disable-dev-shm-usage')
                .addArguments('--window-size=1920,1080')
            )
            .build();
        await driver.close();
        res.json({
            status: 'healthy',
            chrome_path: chromePath,
            timestamp: new Date().toLocaleString('ko-KR', {
                timeZone: 'Asia/Seoul'
            })
        });
    } catch (error) {
        res.status(500).json({
            status: 'unhealthy',
            error: error.message,
            timestamp: new Date().toLocaleString('ko-KR', {
                timeZone: 'Asia/Seoul'
            })
        });
    }
});


app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    // 매일 00:00에 당일 캡처본 삭제
    cron.schedule('0 0 * * *', () => {
        fs.readdir(capturesDir, (err, files) => {
            if (err) return console.error('캡처 디렉토리 읽기 오류:', err);
            files.forEach(file => {
                // 파일명에서 날짜 추출 (예: ranking_카테고리_YYYY-MM-DD_HH-MM.jpeg)
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
    }, {
        timezone: 'Asia/Seoul'
    });
});


// ========================================
// 🖥️ Chrome 및 브라우저 관련 함수들
// ========================================

// Chrome 실행 경로 설정
async function findChrome() {
    try {
        // which 명령어로 Chrome 경로 찾기
        const { execSync } = require('child_process');
        const chromePath = execSync('which google-chrome-stable').toString().trim();
        console.log('Chrome 경로 찾음:', chromePath);
        
        // Chrome 버전 확인
        const version = execSync('google-chrome-stable --version').toString().trim();
        console.log('Chrome 버전:', version);
        
        return chromePath;
    } catch (error) {
        console.error('Chrome 확인 중 오류:', error.message);
        console.log('기본 Chrome 경로 사용');
        return '/usr/bin/google-chrome-stable';
    }
}

// 임시 프로필 디렉토리 생성
function createTempChromeProfile() {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-profile-'));
    return tmpDir;
}

// 임시 프로필 디렉토리 삭제 (기존 함수 - 하위 호환성 유지)
function removeTempChromeProfile(tmpDir) {
    safeRemoveTempProfile(tmpDir, '기본');
}

// ========================================
// 🔧 이메일 관련 설정 및 함수들
// ========================================

// 이메일 전송 설정
const transporter = nodemailer.createTransport({
    host: 'smtp.worksmobile.com',
    port: 465,
    secure: true,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// 캡처본 분할 zip 및 메일 전송 함수 (4개씩)
async function organizeAndSendCapturesSplit(timeStr, dateStr) {
    log.section('📧 이메일 전송 시작');
    const files = fs.readdirSync(capturesDir)
        .filter(file => file.endsWith('.jpeg') && file.includes(dateStr) && file.includes(timeStr));
    if (files.length === 0) return;

    const MAX_FILES_PER_MAIL = 7;
    // 파일을 4개씩 그룹핑
    const groups = [];
    for (let i = 0; i < files.length; i += MAX_FILES_PER_MAIL) {
        groups.push(files.slice(i, i + MAX_FILES_PER_MAIL));
    }

    for (let idx = 0; idx < groups.length; idx++) {
        const group = groups[idx];
        const zipPath = path.join(__dirname, `oliveyoung_captures_${dateStr}_${timeStr}_part${idx+1}.zip`);
        // zip 생성
        await new Promise((resolve, reject) => {
            const output = fs.createWriteStream(zipPath);
            const archive = archiver('zip', { zlib: { level: 9 } });
            output.on('close', resolve);
            archive.on('error', reject);
            archive.pipe(output);
            for (const file of group) {
                archive.file(path.join(capturesDir, file), { name: file });
            }
            archive.finalize();
        });

        // 포함된 카테고리명 추출
        const categories = group.map(f => {
            const m = f.match(/ranking_(.+?)_/); return m ? m[1] : f;
        }).join(', ');

        // 메일 전송
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: 'hwaseon@hwaseon.com',
            subject: `올리브영 ${dateStr} ${timeStr.replace('-', ':')} 캡처본 (part ${idx+1}/${groups.length}, zip 첨부)` ,
            text: `이번 메일에는 다음 카테고리 캡처가 포함되어 있습니다:\n${categories}`,
            attachments: [
                {
                    filename: `oliveyoung_captures_${dateStr}_${timeStr}_part${idx+1}.zip`,
                    path: zipPath
                }
            ]
        };
        try {
            await transporter.sendMail(mailOptions);
            console.log(`[메일전송성공] ${mailOptions.subject}`);
        } catch (e) {
            console.error(`[메일전송실패] ${mailOptions.subject}`, e);
        }
        fs.unlinkSync(zipPath);
    }

    // 이메일 전송이 완료된 후 캡처본 파일들 삭제
    console.log('='.repeat(50));
    console.log('이메일 전송 완료 후 캡처본 파일 삭제 시작...');
    console.log('='.repeat(50));
    
    let deletedCount = 0;
    let failedCount = 0;
    
    for (const file of files) {
        try {
            fs.unlinkSync(path.join(capturesDir, file));
            console.log(`캡처본 삭제 완료: ${file}`);
            deletedCount++;
        } catch (error) {
            console.error(`캡처본 삭제 실패: ${file}`, error.message);
            failedCount++;
        }
    }
    
    console.log('='.repeat(50));
    console.log('캡처본 삭제 결과:');
    console.log(`- 삭제 성공: ${deletedCount}개`);
    console.log(`- 삭제 실패: ${failedCount}개`);
    console.log(`- 총 파일: ${files.length}개`);
    console.log('='.repeat(50));
}

// ========================================
// 🕷️ 새로운 크롤링 함수 (카테고리별 1~100위)
// ========================================

// 다음 크롤링 예정 시각 및 남은 시간 로그 함수
function logNextCrawlTime() {
  const now = new Date();
  // Asia/Seoul 기준으로 계산
  const kstNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const next = new Date(kstNow);
  next.setMinutes(15);
  next.setSeconds(0);
  next.setMilliseconds(0);
  if (kstNow.getMinutes() >= 15) {
    next.setHours(kstNow.getHours() + 1);
  }
  const diffMs = next - kstNow;
  const diffMin = Math.floor(diffMs / 60000);
  const diffSec = Math.floor((diffMs % 60000) / 1000);
  log.info(`다음 크롤링 예정 시각: ${next.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} (${diffMin}분 ${diffSec}초 남음)`);
}

async function crawlAllCategoriesV2(options = {}) {
    log.section('🕷️ 크롤링 전체 시작');
    const kstNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    const yearMonth = kstNow.toISOString().slice(0, 7); // 'YYYY-MM'
    const today = kstNow.toISOString().split('T')[0];
    const timeStr = `${String(kstNow.getHours()).padStart(2, '0')}-${String(kstNow.getMinutes()).padStart(2, '0')}`;
    const RANKING_DATA_PATH = getRankingDataPath(yearMonth);
  
    // ✅ 기존 월 파일 통째 로드 금지 (OOM 유발). 새로 수집한 것만 담는다.
    const localProductCache = { data: {}, allProducts: [], timestamp: null };
  
    const targetCategories = options.onlyCategory ? [options.onlyCategory] : Object.keys(CATEGORY_CODES);
  
    for (const category of targetCategories) {
      log.line();
      log.info(`카테고리: ${category}`);
      localProductCache.data[category] = [];
  
      let rankCounter = 1;
      const seen = new Set(); // 중복 체크용
      let page = 1;
      let noNewItemCount = 0;
      const MAX_NO_NEW_ITEM_PAGE = 3;
  
      while (localProductCache.data[category].length < 100 && page <= 30) {
        const url = `https://www.oliveyoung.co.kr/store/main/getBestList.do?dispCatNo=900000100100001&fltDispCatNo=${CATEGORY_CODES[category].fltDispCatNo}&pageIdx=${page}&rowsPerPage=24&t_page=%EB%9E%AD%ED%82%B9&t_click=%ED%8C%90%EB%A7%A4%EB%9E%AD%ED%82%B9_${encodeURIComponent(category.replace('_', ' '))}`;
        let driver = null;
        let tmpProfile = null;
        let newItemAdded = false;
  
        try {
          tmpProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-profile-'));
          const chromeOptions = new chrome.Options()
            .addArguments('--headless')
            .addArguments('--no-sandbox')
            .addArguments('--disable-dev-shm-usage')
            .addArguments('--window-size=1920,1500')
            .addArguments(`--user-data-dir=${tmpProfile}`)
            .addArguments(`--user-agent=${getRandomUserAgent()}`);
          if (process.env.CHROME_BIN) {
            chromeOptions.setChromeBinaryPath(process.env.CHROME_BIN);
          }
  
          driver = await new Builder().forBrowser('chrome').setChromeOptions(chromeOptions).build();
          await driver.get(url);
          await driver.wait(until.elementLocated(By.css('body')), 15000);
          await driver.sleep(2000);
  
          const products = await driver.findElements(By.css('ul.cate_prd_list > li'));
          for (const product of products) {
            if (localProductCache.data[category].length >= 100) break;
  
            // 🔧 try 밖에 기본값을 둬서 예외 시에도 안전
            let extractedRankCurrent = rankCounter;
  
            try {
              // data-attr에서 랭킹 우선 추출
              const dataAttrElement = await product.findElement(By.css('a[data-attr]')).catch(() => null);
              if (dataAttrElement) {
                const dataAttr = await dataAttrElement.getAttribute('data-attr');
                if (dataAttr) {
                  const parts = dataAttr.split('^');
                  if (parts.length >= 4) {
                    const rankFromAttr = parseInt(parts[3]);
                    if (!isNaN(rankFromAttr)) extractedRankCurrent = rankFromAttr;
                  }
                }
              }
              // thumb_flag.best 백업 추출
              if (extractedRankCurrent === rankCounter) {
                const thumbFlagElement = await product.findElement(By.css('.thumb_flag.best')).catch(() => null);
                if (thumbFlagElement) {
                  const thumbFlagText = await thumbFlagElement.getText();
                  const thumbRank = parseInt(thumbFlagText);
                  if (!isNaN(thumbRank)) extractedRankCurrent = thumbRank;
                }
              }
  
              const nameElement = await product.findElement(By.css('.prd_name, .tx_name')).catch(() => null);
              let name = nameElement ? await nameElement.getText() : `상품${extractedRankCurrent}`;
  
              const brandElement = await product.findElement(By.css('.prd_brand, .tx_brand')).catch(() => null);
              let brand = brandElement ? await brandElement.getText() : '';
  
              // 브랜드/이름 정리
              if (!brand && name) {
                const lines = name.split('\n');
                if (lines.length > 1) {
                  brand = lines[0].trim();
                  name = lines.slice(1).join(' ').trim();
                } else {
                  const match = name.match(/^([\w가-힣A-Za-z0-9]+)[\s\[]?(.*)$/);
                  if (match) {
                    brand = match[1].trim();
                    name = match[2].trim();
                  }
                }
              }
              if (brand && name && name.startsWith(brand)) {
                name = name.slice(brand.length).trim();
              }
  
              // 중복 키
              const uniqueKey = [today, timeStr, category, extractedRankCurrent, (brand || '').trim(), (name || '').trim()].join('|');
              if (seen.has(uniqueKey)) continue;
              seen.add(uniqueKey);
  
              // 가격
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
  
              // 프로모션
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
  
              // push
              localProductCache.data[category].push({
                date: today,
                time: timeStr,
                category,
                rank: extractedRankCurrent,
                brand: (brand || '').trim(),
                name: (name || '').trim(),
                originalPrice,
                salePrice,
                promotion: (promotion || '').trim()
              });
  
              rankCounter++;
              newItemAdded = true;
            } catch (productError) {
              // 실패해도 자리 채우기
              localProductCache.data[category].push({
                date: today,
                time: timeStr,
                category,
                rank: extractedRankCurrent || rankCounter,
                brand: '',
                name: `상품${extractedRankCurrent || rankCounter}`,
                originalPrice: '',
                salePrice: '',
                promotion: ''
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
  
        if (!newItemAdded) noNewItemCount++;
        else noNewItemCount = 0;
  
        if (noNewItemCount >= MAX_NO_NEW_ITEM_PAGE) {
          log.warn(`[${category}] 연속 ${MAX_NO_NEW_ITEM_PAGE}페이지에서 새로운 상품이 없어 크롤링 종료`);
          break;
        }
        page++;
      }
  
      // 랭킹 정렬 후 100개 제한
      localProductCache.data[category].sort((a, b) => a.rank - b.rank);
      localProductCache.data[category] = localProductCache.data[category].slice(0, 100);
      log.success(`[${category}] 크롤링 완료: ${localProductCache.data[category].length}개 (랭킹 순서 정렬됨)`);
    }
  
    // ✅ 전체 데이터 저장 (이전 파일과 병합하되, OOM 가드 적용)
    const mergedData = { data: {}, allProducts: [], timestamp: kstNow };
  
    let prev = null;
    if (fs.existsSync(RANKING_DATA_PATH)) {
      try {
        const st = fs.statSync(RANKING_DATA_PATH);
        if (st.size <= MERGE_MAX_BYTES) {
          prev = JSON.parse(fs.readFileSync(RANKING_DATA_PATH, 'utf-8'));
        } else {
          log.warn(`[병합 건너뜀] ${RANKING_DATA_PATH} size=${(st.size/1e6).toFixed(1)}MB > ${(MERGE_MAX_BYTES/1e6)|0}MB`);
        }
      } catch (e) {
        log.warn('이전 데이터 파싱 실패(스킵): ' + e.message);
      }
    }
  
    for (const cat of Object.keys(CATEGORY_CODES)) {
      const oldArr = Array.isArray(prev?.data?.[cat]) ? prev.data[cat] : [];
      const newArr = Array.isArray(localProductCache.data[cat]) ? localProductCache.data[cat] : [];
  
      const seenMerge = new Set();
      const mergedArr = [];
  
      for (const src of [oldArr, newArr]) {
        for (const item of src) {
          const key = [
            item.date, item.time, item.category, item.rank,
            (item.brand || '').trim(), (item.name || '').trim()
          ].join('|');
          if (seenMerge.has(key)) continue;
          seenMerge.add(key);
          mergedArr.push(item);
        }
      }
  
      // 랭킹 오름차순
      mergedArr.sort((a, b) => a.rank - b.rank);
  
      // (선택) 보존 상한
      mergedData.data[cat] = (MAX_KEEP_PER_CATEGORY > 0 && mergedArr.length > MAX_KEEP_PER_CATEGORY)
        ? mergedArr.slice(0, MAX_KEEP_PER_CATEGORY)
        : mergedArr;
    }
  
    // 저장 (프리티프린트 비활성으로 메모리/용량 절약)
    try {
      const payload = PRETTY_JSON ? JSON.stringify(mergedData, null, 2) : JSON.stringify(mergedData);
      fs.writeFileSync(RANKING_DATA_PATH, payload);
      log.success(`[랭킹 데이터 저장 완료] ${RANKING_DATA_PATH}`);
    } catch (e) {
      log.error('[랭킹 데이터 저장 실패] ' + RANKING_DATA_PATH + ' ' + e.message);
    }
  
    // 캡처 + 다음 크롤링 안내
    await captureOliveyoungMainRanking(timeStr);
    logNextCrawlTime();
  }
  

// ========================================
// 📸 캡처 관련 함수들
// ========================================

async function captureOliveyoungMainRanking(timeStr) {
    log.section('📸 캡처 전체 시작');
    console.log('총 21개 카테고리 캡처 예정');
    console.log('='.repeat(50));
    
    const now = getKSTTime();
    const dateFormatted = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const allCategories = Object.keys(CATEGORY_CODES);
    let successSet = new Set(); // 성공한 카테고리
    let failSet = new Set(); // 실패한 카테고리
    const errors = []; // 에러 정보
    
    // 카테고리별 캡처 시도 함수
    async function tryCaptureCategory(category, attemptNumber) {
        let categoryDriver = null;
        let categoryTmpProfileDir = null;
        
        try {
            console.log(`${category} 랭킹 페이지 캡처 시도... (${attemptNumber}차 시도)`);
            
            // 새로운 임시 프로필 생성
            categoryTmpProfileDir = createTempChromeProfile();
            
            // Chrome 옵션 설정 (캡처용)
            const categoryOptions = new chrome.Options()
                .addArguments('--headless')
                .addArguments('--no-sandbox')
                .addArguments('--disable-dev-shm-usage')
                .addArguments('--start-maximized')
                .addArguments('--window-size=1920,1500')
                .addArguments('--hide-scrollbars')
                .addArguments('--force-device-scale-factor=1')
                .addArguments('--screenshot-format=jpeg')
                .addArguments('--screenshot-quality=80')
                .addArguments('--disable-gpu')
                .addArguments('--disable-extensions')
                .addArguments('--disable-notifications')
                .addArguments('--disable-web-security')
                .addArguments('--disable-features=VizDisplayCompositor')
                .addArguments('--disable-background-timer-throttling')
                .addArguments('--disable-backgrounding-occluded-windows')
                .addArguments('--disable-renderer-backgrounding')
                .addArguments('--disable-field-trial-config')
                .addArguments('--disable-ipc-flooding-protection')
                .addArguments('--disable-hang-monitor')
                .addArguments('--disable-prompt-on-repost')
                .addArguments('--disable-client-side-phishing-detection')
                .addArguments('--disable-component-update')
                .addArguments('--disable-default-apps')
                .addArguments('--disable-sync')
                .addArguments('--metrics-recording-only')
                .addArguments('--no-first-run')
                .addArguments('--safebrowsing-disable-auto-update')
                .addArguments('--disable-translate')
                .addArguments('--disable-plugins-discovery')
                .addArguments('--disable-plugins')
                .addArguments('--enable-javascript')
                .addArguments('--enable-dom-storage')
                .addArguments('--enable-local-storage')
                .addArguments('--enable-session-storage')
                .addArguments('--enable-cookies')
                .addArguments('--enable-images')
                .addArguments('--enable-scripts')
                .addArguments(`--user-data-dir=${categoryTmpProfileDir}`)
                .addArguments(`--user-agent=${getRandomUserAgent()}`);
                
            if (process.env.CHROME_BIN) {
                categoryOptions.setChromeBinaryPath(process.env.CHROME_BIN);
            }
            
            // 새로운 드라이버 생성
            categoryDriver = await new Builder()
                .forBrowser('chrome')
                .setChromeOptions(categoryOptions)
                .build();
            
            // 올리브영 실제 랭킹 페이지 URL 구조에 맞게 수정
            const categoryName = category.replace('_', ' ');
            const encodedCategory = encodeURIComponent(categoryName);
            const url = `https://www.oliveyoung.co.kr/store/main/getBestList.do?dispCatNo=900000100100001&fltDispCatNo=${CATEGORY_CODES[category].fltDispCatNo}&pageIdx=1&rowsPerPage=24&t_page=%EB%9E%AD%ED%82%B9&t_click=%ED%8C%90%EB%A7%A4%EB%9E%AD%ED%82%B9_${encodedCategory}`;
            
            await categoryDriver.get(url);
            
            // 페이지 로딩 대기
            await categoryDriver.wait(until.elementLocated(By.css('body')), 20000);
            await categoryDriver.sleep(3000);
            
            // 페이지가 완전히 로드될 때까지 대기
            await categoryDriver.wait(async () => {
                const readyState = await categoryDriver.executeScript('return document.readyState');
                return readyState === 'complete';
            }, 15000, '페이지 로딩 시간 초과');
            
            // 추가 대기 시간
            await categoryDriver.sleep(3000);
            
            // 여러 선택자로 요소 찾기 시도
            let pageElementFound = false;
            const pageSelectors = [
                '.TabsConts',
                '.prd_info',
                '.best_list',
                '.product_list',
                '.best_item',
                '.item',
                '.product_item',
                '.ranking_list',
                '.list_item'
            ];
            
            for (const selector of pageSelectors) {
                try {
                    const elements = await categoryDriver.findElements(By.css(selector));
                    if (elements.length > 0) {
                        console.log(`요소 발견: ${selector} (${elements.length}개)`);
                        pageElementFound = true;
                        break;
                    }
                } catch (e) {
                    console.log(`요소 없음: ${selector}`);
                }
            }
            
            if (!pageElementFound) {
                // 페이지 소스 확인
                const pageSource = await categoryDriver.getPageSource();
                console.log('페이지 소스 일부:', pageSource.substring(0, 1000));
                
                // 현재 URL 확인
                const currentUrl = await categoryDriver.getCurrentUrl();
                console.log('현재 URL:', currentUrl);
                
                // 페이지 제목 확인
                const pageTitle = await categoryDriver.getTitle();
                console.log('페이지 제목:', pageTitle);
                
                // JavaScript 오류 확인
                const jsErrors = await categoryDriver.executeScript(`
                    return window.performance.getEntries().filter(entry => 
                        entry.entryType === 'resource' && entry.name.includes('error')
                    ).length;
                `).catch(() => 0);
                console.log('JavaScript 오류 수:', jsErrors);
                
                throw new Error('페이지 로딩 실패 - 필수 요소를 찾을 수 없습니다');
            }
            
            // 추가 대기 시간
            await categoryDriver.sleep(2000);
            
            // 필수 요소 로딩 대기 - 더 유연한 선택자 사용
            await categoryDriver.wait(async () => {
                const selectors = [
                    '.TabsConts .prd_info',
                    '.prd_info',
                    '.best_list .item',
                    '.best_item',
                    '.item',
                    '.product_item',
                    '.ranking_list .item',
                    '.list_item'
                ];
                
                for (const selector of selectors) {
                    try {
                        const products = await categoryDriver.findElements(By.css(selector));
                        if (products.length > 0) {
                            console.log(`상품 요소 발견: ${selector} (${products.length}개)`);
                            return true;
                        }
                    } catch (e) {
                        // 무시하고 다음 선택자 시도
                    }
                }
                return false;
            }, 20000, '상품 목록 로딩 시간 초과');
            
            // 추가 대기 시간
            await categoryDriver.sleep(2000);
            
            // 카테고리 헤더 추가
            await categoryDriver.executeScript(`
                const categoryDiv = document.createElement('div');
                categoryDiv.id = 'custom-category-header';
                categoryDiv.style.cssText = 'position:fixed;top:0;left:0;width:100%;background-color:#333;color:white;text-align:center;padding:10px 0;font-size:16px;font-weight:bold;z-index:9999;';
                categoryDiv.textContent = '${category === '전체' ? '전체 랭킹' : category.replace('_', ' ') + ' 랭킹'}';
                document.body.insertBefore(categoryDiv, document.body.firstChild);
                document.body.style.marginTop = '40px';
            `);
            
            // 스크린샷 캡처
            const fileName = `ranking_${category}_${dateFormatted}_${timeStr}.jpeg`;
            const filePath = path.join(capturesDir, fileName);
            await captureFullPageWithSelenium(categoryDriver, filePath, category, dateFormatted);
            
            console.log(`${category} 랭킹 페이지 캡처 완료: ${fileName}`);
            console.log(`진행률: ${successSet.size + 1}/${allCategories.length} (${Math.round((successSet.size + 1)/allCategories.length*100)}%)`);
            console.log('-'.repeat(50));
            
            return true; // 성공
            
        } catch (error) {
            console.error(`${category} 캡처 실패 (${attemptNumber}차 시도):`, error.message);
            return false; // 실패
        } finally {
            await safeQuitDriver(categoryDriver, `${category} 캡처`);
            safeRemoveTempProfile(categoryTmpProfileDir, category);
        }
    }
    
    // 1차 시도: 전체 카테고리 순회
    console.log('=== 1차 시도 시작 ===');
    for (const category of allCategories) {
        const success = await tryCaptureCategory(category, 1);
        if (success) {
            successSet.add(category);
        } else {
            failSet.add(category);
            errors.push({
                category,
                error: `${category} 1차 시도 실패`,
                timestamp: new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
            });
        }
        // 카테고리 간 대기 시간
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.log(`1차 시도 결과: 성공 ${successSet.size}개, 실패 ${failSet.size}개`);
    
    // 2차 시도: 실패한 카테고리만 재시도
    if (failSet.size > 0) {
        console.log('=== 2차 시도 시작 (실패한 카테고리만) ===');
        const retryCategories = Array.from(failSet);
        failSet.clear(); // 2차 시도용으로 초기화
        
        for (const category of retryCategories) {
            const success = await tryCaptureCategory(category, 2);
            if (success) {
                successSet.add(category);
            } else {
                failSet.add(category);
                errors.push({
                    category,
                    error: `${category} 2차 시도 실패`,
                    timestamp: new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
                });
            }
            // 카테고리 간 대기 시간
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        console.log(`2차 시도 결과: 성공 ${successSet.size}개, 실패 ${failSet.size}개`);
    }
    
    // 최종 결과 확인
    const finalSuccessCount = successSet.size;
    const finalFailCount = failSet.size;
    const allSuccess = finalSuccessCount === allCategories.length;
    
    console.log('='.repeat(50));
    console.log('캡처 작업 최종 결과');
    console.log(`성공: ${finalSuccessCount}/${allCategories.length} 카테고리`);
    console.log(`실패: ${finalFailCount}개 카테고리`);
    if (finalFailCount > 0) {
        console.log('실패한 카테고리:', Array.from(failSet));
    }
    console.log('='.repeat(50));
    
    // 캡처 완료 후 이메일 전송 처리
    if (finalSuccessCount > 0) {
        console.log('='.repeat(50));
        console.log('캡처 완료 후 이메일 전송 시작...');
        console.log('='.repeat(50));
        
        try {
            await organizeAndSendCapturesSplit(timeStr, dateFormatted);
            console.log('이메일 전송 및 파일 삭제 완료');
        } catch (emailError) {
            console.error('이메일 전송 실패:', emailError.message);
        }
    } else {
        console.log('캡처된 파일이 없어 이메일 전송을 건너뜁니다.');
    }
    
    return {
        success: allSuccess,
        capturedCount: finalSuccessCount,
        totalCategories: allCategories.length,
        errors: errors.length > 0 ? errors : null,
        capturedCategories: Array.from(successSet),
        failedCategories: Array.from(failSet)
    };
}

// 전체 페이지 분할 캡처 후 이어붙이기 함수
async function captureFullPageWithSelenium(driver, filePath, category, dateFormatted) {
    // 전체 페이지 높이와 가로폭으로 창 크기 조정
    const totalHeight = await driver.executeScript('return document.body.scrollHeight');
    const viewportWidth = await driver.executeScript('return document.body.scrollWidth');
    await driver.manage().window().setRect({ width: viewportWidth, height: totalHeight });
    await driver.sleep(1000); // 렌더링 대기

    // 한 번에 전체 페이지 캡처
    const screenshot = await driver.takeScreenshot();
    const sharpBuffer = await sharp(Buffer.from(screenshot, 'base64'))
        .jpeg({ quality: 100 }) // 화질 증가
        .toBuffer();

    // 파일 시스템에 저장
    await fs.promises.writeFile(filePath, sharpBuffer);
}

// ========================================
// 🌐 API 라우트들
// ========================================

// 메인 페이지
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'olive.html'));
});

app.get('/api/ranking', async (req, res) => {
    try {
      log.section('📊 랭킹 데이터 조회');
      const { category = '스킨케어', startDate, endDate, yearMonth, limit } = req.query;
  
      const ym = yearMonth || new Date().toISOString().slice(0, 7);
      const filePath = resolveMonthlyFilePath(ym);
      if (!filePath) {
        log.warn(`[파일없음] ${ym}: /data/ranking_${ym}.json`);
        return res.json({ success: true, data: [], total: 0, category, message: `${ym} 데이터가 없습니다.` });
      }
  
      const HARD_LIMIT = Math.min(parseInt(limit || 1000, 10) || 1000, 5000);
      const rows = [];
      let responded = false;
  
      const source = fs.createReadStream(filePath, { encoding: 'utf8', highWaterMark: 1 << 20 });
      const pipeline = chain([source, parser(), streamValues()]);
  
      const safeClose = (payload) => {
        if (responded) return;
        responded = true;
        try { pipeline.destroy(); } catch {}
        try { source.destroy(); } catch {}
        res.json(payload);
      };
  
      pipeline.on('data', ({ value, path }) => {
        if (!Array.isArray(path) || path.length !== 3 || path[0] !== 'data') return;
        const itemCategory = String(path[1] || '');
        if (itemCategory !== category) return;
  
        const item = value || {};
        if (startDate || endDate) {
          if (!item.date || !inDateRange(item.date, startDate, endDate || startDate)) return;
        }
  
        rows.push({
          rank: item.rank,
          brand: item.brand,
          name: item.name,
          originalPrice: item.originalPrice,
          salePrice: item.salePrice,
          promotion: item.promotion,
          date: item.date,
          time: item.time,
          category: item.category || itemCategory
        });
  
        if (rows.length >= HARD_LIMIT) {
          rows.sort((a, b) => {
            const dc = b.date.localeCompare(a.date);
            if (dc !== 0) return dc;
            if (a.time && b.time) {
              const tc = b.time.localeCompare(a.time);
              if (tc !== 0) return tc;
            }
            return a.rank - b.rank;
          });
          return safeClose({ success: true, data: rows, total: rows.length, truncated: true, category });
        }
      });
  
      pipeline.once('end', () => {
        rows.sort((a, b) => {
          const dc = b.date.localeCompare(a.date);
          if (dc !== 0) return dc;
          if (a.time && b.time) {
            const tc = b.time.localeCompare(a.time);
            if (tc !== 0) return tc;
          }
          return a.rank - b.rank;
        });
        safeClose({ success: true, data: rows, total: rows.length, category });
      });
  
      pipeline.once('error', (err) => {
        log.error(`[${ym}] 랭킹 스트림 오류: ${err?.message}`);
        safeClose({ success: false, error: '랭킹 조회 중 스트림 오류가 발생했습니다.' });
      });
    } catch (error) {
      log.error('랭킹 핸들러 오류: ' + error?.message);
      return res.status(500).json({ success: false, error: '서버 오류가 발생했습니다.' });
    }
  });
  

  app.get('/api/search', async (req, res) => {
    try {
      log.section('🔍 제품명 데이터 검색');
      const { keyword, startDate, endDate, category, yearMonth, limit } = req.query;
      if (!keyword || !startDate) {
        return res.status(400).json({ success: false, error: '검색어와 시작 날짜를 입력해주세요.' });
      }
  
      const HARD_LIMIT = Math.min(parseInt(limit || SEARCH_LIMIT_DEFAULT, 10) || SEARCH_LIMIT_DEFAULT, SEARCH_LIMIT_MAX);
      const kwLower = String(keyword).toLowerCase();
  
      // 조회 대상 월 결정
      let months = [];
      if (yearMonth) {
        months = [yearMonth];
      } else {
        months = monthSpan(startDate, endDate || startDate);
        if (!months.length) {
          const ym = toYM(startDate);
          if (!ym) return res.status(400).json({ success: false, error: '날짜 형식이 올바르지 않습니다.' });
          months = [ym];
        }
      }
  
      const results = [];
      let responded = false;
  
      const sortResults = () => {
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
      };
  
      // 🔴 여기: 각 월을 순차 처리(완료까지 대기)
      for (const ym of months) {
        if (responded) break;
  
        const filePath = resolveMonthlyFilePath(ym);
        if (!filePath) {
          log.warn(`[파일없음] ${ym}: /data/ranking_${ym}.json`);
          continue;
        }
  
        await new Promise((resolve) => {
          const source = fs.createReadStream(filePath, { encoding: 'utf8', highWaterMark: 1 << 20 });
          const pipeline = chain([source, parser(), streamValues()]);
  
          const safeClose = (payload) => {
            if (responded) return;
            responded = true;
            try { pipeline.destroy(); } catch {}
            try { source.destroy(); } catch {}
            sortResults();
            res.json(payload);
            resolve(); // 중요: 응답했어도 루프 탈출 위해 resolve
          };
  
          pipeline.on('data', ({ value, path }) => {
            // path === ['data','카테고리', index] 인 지점에서 value가 레코드
            if (!Array.isArray(path) || path.length !== 3 || path[0] !== 'data') return;
  
            const itemCategory = String(path[1] || '');
            if (category && itemCategory !== category) return;
  
            const item = value || {};
            if (!item || !item.date) return;
            if (!inDateRange(item.date, startDate, endDate || startDate)) return;
  
            const hay = `${item.brand || ''} ${item.name || ''}`.toLowerCase();
            if (!hay.includes(kwLower)) return;
  
            results.push({
              date: item.date,
              time: item.time,
              category: item.category || itemCategory,
              rank: item.rank,
              brand: item.brand,
              name: item.name,
              originalPrice: item.originalPrice,
              salePrice: item.salePrice,
              promotion: item.promotion
            });
  
            if (results.length >= HARD_LIMIT) {
              return safeClose({ success: true, data: results, total: results.length, truncated: true });
            }
          });
  
          pipeline.once('end', () => {
            try { pipeline.destroy(); } catch {}
            try { source.destroy(); } catch {}
            resolve(); // 이 달 처리 완료 → 다음 달로
          });
  
          pipeline.once('error', (err) => {
            log.error(`[${ym}] 검색 스트림 오류: ${err?.message}`);
            try { pipeline.destroy(); } catch {}
            try { source.destroy(); } catch {}
            resolve(); // 에러 나도 다음 달 진행
          });
        });
      }
  
      if (!responded) {
        sortResults();
        return res.json({ success: true, data: results, total: results.length });
      }
    } catch (error) {
      log.error('검색 핸들러 오류: ' + error?.message);
      return res.status(500).json({ success: false, error: '서버 오류가 발생했습니다.' });
    }
  });
  
  

  app.get('/api/last-crawl-time', async (req, res) => {
    try {
      const kstNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
      const tryMonths = [];
      // 1순위: 이번 달
      tryMonths.push(kstNow.toISOString().slice(0, 7));
      // 2~4순위: 파일 없을 때만 이전 달들
      for (let off = 1; off <= 3; off++) {
        const d = new Date(kstNow); d.setMonth(d.getMonth() - off);
        tryMonths.push(d.toISOString().slice(0, 7));
      }
  
      let latestDate = null, latestTime = null;
      for (const ym of tryMonths) {
        const filePath = resolveMonthlyFilePath(ym);
        if (!filePath) continue;
  
        // 이번 달 파일을 스캔해서 뭔가 하나라도 나오면 바로 종료
        let foundInThisFile = false;
        await new Promise((resolve) => {
          const source = fs.createReadStream(filePath, { encoding: 'utf8', highWaterMark: 1 << 20 });
          const pipeline = chain([source, parser(), streamValues()]);
  
          pipeline.on('data', ({ value, path }) => {
            if (!Array.isArray(path) || path.length !== 3 || path[0] !== 'data') return;
            const item = value || {};
            if (!item.date || !item.time) return;
            const cur = `${item.date} ${item.time}`;
            const best = latestDate ? `${latestDate} ${latestTime}` : null;
            if (!best || cur > best) {
              latestDate = item.date;
              latestTime = item.time;
            }
            foundInThisFile = true;
          });
  
          const cleanup = () => { try { pipeline.destroy(); } catch {} try { source.destroy(); } catch {} resolve(); };
          pipeline.once('end', cleanup);
          pipeline.once('error', cleanup);
        });
  
        if (foundInThisFile) break; // 이번 달에서 찾았으면 과거 달은 볼 필요 없음
      }
  
      if (!latestDate || !latestTime) {
        return res.json({ success: true, lastCrawlTime: '서버 시작 후 크롤링 대기 중', message: '아직 첫 크롤링 기록이 없습니다.' });
      }
  
      const dt = new Date(`${latestDate}T${latestTime.replace('-', ':')}:00+09:00`);
      const formattedTime = dt.toLocaleString('ko-KR', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false, timeZone: 'Asia/Seoul'
      });
      return res.json({ success: true, lastCrawlTime: formattedTime });
    } catch (error) {
      log.error('마지막 크롤링 시간 조회 오류: ' + error.message);
      return res.status(500).json({ success: false, error: '마지막 크롤링 시간 조회 중 오류' });
    }
  });
  
  


// 캡처 목록 조회 API
app.get('/api/captures', async (req, res) => {
    res.json({
        success: true,
        data: [],
        total: 0
    });
});


// 1시간마다 15분에 크롤링 실행 (매일 00:15 ~ 23:15, 1년 내내)
cron.schedule('15 * * * *', async () => {
  console.log('[CRON] 크롤링 시작:', new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }));
  await crawlAllCategoriesV2();
  console.log('[CRON] 크롤링 완료:', new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }));
}, {
  timezone: 'Asia/Seoul'
});



function toYM(isoDate) {
    if (!isoDate) return null;
    const d = new Date(`${isoDate}T00:00:00+09:00`);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 7);
  }
  function monthSpan(startDate, endDate) {
    const start = new Date(`${startDate}T00:00:00+09:00`);
    const end = new Date(`${endDate || startDate}T00:00:00+09:00`);
    if (Number.isNaN(start) || Number.isNaN(end)) return [];
    const list = [];
    const cur = new Date(start);
    cur.setDate(1);
    const GUARD = 36;
    let i = 0;
    while (cur <= end && i++ < GUARD) {
      list.push(cur.toISOString().slice(0, 7));
      cur.setMonth(cur.getMonth() + 1);
    }
    return list;
  }
  function resolveMonthlyFilePath(ym) {
    const p = `/data/ranking_${ym}.json`;
    return fs.existsSync(p) ? p : null;
  }
  function inDateRange(itemDate, startDate, endDate) {
    const d = normalizeDate(itemDate);
    const s = normalizeDate(startDate);
    const e = normalizeDate(endDate);
    if (!s && !e) return true;
    if (s && !e) return d === s;
    if (!s && e) return d === e;
    return d >= s && d <= e;
  }
  