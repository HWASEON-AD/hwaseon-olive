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

// 중복 제거 함수
function deduplicate(arr) {
    const map = new Map();
    arr.forEach(item => {
        const key = `${item.date}_${item.time}_${item.rank}_${item.name}`;
        map.set(key, item);
    });
    return Array.from(map.values());
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

// app.listen 내부에서 즉시 크롤링 및 캡처 실행 부분 제거
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

async function crawlAllCategoriesV2() {
    log.section('🕷️ 크롤링 전체 시작');
    const kstNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    const yearMonth = kstNow.toISOString().slice(0, 7); // '2025-07'
    const today = kstNow.toISOString().split('T')[0];
    const timeStr = `${String(kstNow.getHours()).padStart(2, '0')}-${String(kstNow.getMinutes()).padStart(2, '0')}`;
    const RANKING_DATA_PATH = getRankingDataPath(yearMonth); // 수정: 일관된 경로 사용
    let localProductCache = { data: {}, allProducts: [], timestamp: null };
    if (fs.existsSync(RANKING_DATA_PATH)) {
        try {
            const prev = JSON.parse(fs.readFileSync(RANKING_DATA_PATH, 'utf-8'));
            if (prev && typeof prev === 'object') {
                localProductCache = prev;
            }
        } catch (e) {
            log.error('기존 월별 랭킹 데이터 로드 실패: ' + e);
        }
    }
    for (const [category, categoryInfo] of Object.entries(CATEGORY_CODES)) {
        log.line();
        log.info(`카테고리: ${category}`);
        localProductCache.data[category] = [];
        let totalRank = 1;
        for (let page = 1; page <= 13; page++) {
            if (localProductCache.data[category].length >= 100) break;
            const url = `https://www.oliveyoung.co.kr/store/main/getBestList.do?dispCatNo=900000100100001&fltDispCatNo=${categoryInfo.fltDispCatNo}&pageIdx=${page}&rowsPerPage=8&t_page=%EB%9E%AD%ED%82%B9&t_click=%ED%8C%90%EB%A7%A4%EB%9E%AD%ED%82%B9_${encodeURIComponent(category.replace('_', ' '))}`;
            let driver = null;
            let tmpProfile = null;
            try {
                tmpProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-profile-'));
                const options = new chrome.Options()
                    .addArguments('--headless')
                    .addArguments('--no-sandbox')
                    .addArguments('--disable-dev-shm-usage')
                    .addArguments('--window-size=1920,1500')
                    .addArguments(`--user-data-dir=${tmpProfile}`)
                    .addArguments(`--user-agent=${getRandomUserAgent()}`);
                if (process.env.CHROME_BIN) {
                    options.setChromeBinaryPath(process.env.CHROME_BIN);
                }
                driver = await new Builder().forBrowser('chrome').setChromeOptions(options).build();
                await driver.get(url);
                await driver.wait(until.elementLocated(By.css('body')), 15000);
                await driver.sleep(2000);
                // 상품 리스트 파싱 - thumb_flag.best 텍스트와 무관하게 순서대로 랭킹 부여
                const products = await driver.findElements(By.css('li.flag'));
                let rankCounter = 1;
                for (const product of products) {
                    if (localProductCache.data[category].length >= 100) break;
                    try {
                        const nameElement = await product.findElement(By.css('.prd_name, .tx_name')).catch(() => null);
                        let name = nameElement ? await nameElement.getText() : `상품${rankCounter}`;
                        let brandElement = await product.findElement(By.css('.prd_brand, .tx_brand')).catch(() => null);
                        let brand = brandElement ? await brandElement.getText() : '';
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
                        let originalPrice = '';
                        let salePrice = '';
                        const orgPriceElement = await product.findElement(By.css('.prd_price .tx_org .tx_num')).catch(() => null);
                        const curPriceElement = await product.findElement(By.css('.prd_price .tx_cur .tx_num')).catch(() => null);
                        if (orgPriceElement) {
                            originalPrice = (await orgPriceElement.getText()).replace(/,/g, '');
                        }
                        if (curPriceElement) {
                            salePrice = (await curPriceElement.getText()).replace(/,/g, '');
                        }
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
                        const productData = {
                            date: today,
                            time: timeStr,
                            category,
                            rank: rankCounter, // thumb_flag.best 텍스트와 무관하게 순서대로 부여
                            brand: brand.trim(),
                            name: name.trim(),
                            originalPrice: originalPrice,
                            salePrice: salePrice,
                            promotion: promotion.trim()
                        };
                        localProductCache.data[category].push(productData);
                        rankCounter++;
                    } catch (productError) {
                        localProductCache.data[category].push({
                            date: today,
                            time: timeStr,
                            category,
                            rank: rankCounter,
                            brand: '',
                            name: `상품${rankCounter}`,
                            originalPrice: '',
                            salePrice: '',
                            promotion: ''
                        });
                        rankCounter++;
                    }
                }
            } catch (e) {
                console.error(`[${category}] ${page}페이지 크롤링 실패:`, e.message);
            } finally {
                if (driver) await driver.quit();
                if (tmpProfile && fs.existsSync(tmpProfile)) fs.rmSync(tmpProfile, { recursive: true, force: true });
            }
        }
        // 100개까지만 저장
        localProductCache.data[category] = localProductCache.data[category].slice(0, 100);
        log.success(`[${category}] 크롤링 완료: ${localProductCache.data[category].length}개`);
    }
    // 전체 데이터 저장
    localProductCache.timestamp = kstNow;
    try {
        fs.writeFileSync(RANKING_DATA_PATH, JSON.stringify(localProductCache, null, 2));
        log.success(`[랭킹 데이터 저장 완료] ${RANKING_DATA_PATH}`);
    } catch (e) {
        log.error('[랭킹 데이터 저장 실패] ' + RANKING_DATA_PATH + ' ' + e);
    }
    // 크롤링 끝나면 캡처 함수 호출
    await captureOliveyoungMainRanking(timeStr);
    // 크롤링/캡처 끝난 후 다음 크롤링 시각 로그
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

// 랭킹 데이터 가져오기
app.get('/api/ranking', async (req, res) => {
    try {
        log.section('📊 랭킹 데이터 조회');
        log.info(`카테고리: ${req.query.category}, 날짜: ${req.query.startDate} ~ ${req.query.endDate}, yearMonth: ${req.query.yearMonth}`);
        const { category = '스킨케어', page = 1, startDate, endDate, yearMonth } = req.query;
        const ym = yearMonth || new Date().toISOString().slice(0, 7); // 기본값: 현재 월
        const filePath = getRankingDataPath(ym);
        
        if (!fs.existsSync(filePath)) {
            log.warn(`[파일없음] ${filePath}`);
            return res.json({
                success: true,
                data: [],
                total: 0,
                category,
                message: `${ym} 데이터가 없습니다. 크롤링이 필요합니다.`
            });
        }

        // 메모리 효율적인 파일 읽기
        const fileData = await new Promise((resolve, reject) => {
            const chunks = [];
            const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
            
            stream.on('data', (chunk) => {
                chunks.push(chunk);
            });
            
            stream.on('end', () => {
                try {
                    const content = chunks.join('');
                    const data = JSON.parse(content);
                    resolve(data);
                } catch (error) {
                    reject(error);
                }
            });
            
            stream.on('error', reject);
        });

        const categoryData = fileData.data && fileData.data[category] ? fileData.data[category] : [];
        
        // 날짜 필터
        const filterByDate = (data) => {
            if (!startDate && !endDate) return data;
            return data.filter(item => {
                if (!item.date) return false;
                const itemDate = normalizeDate(item.date);
                const sDate = normalizeDate(startDate);
                const eDate = normalizeDate(endDate);
                // 디버깅 로그 제거
                // console.log('[filterByDate]', { 'item.date': item.date, itemDate, sDate, eDate });
                if (sDate && !eDate) return itemDate === sDate;
                if (!sDate && eDate) return itemDate === eDate;
                return itemDate >= sDate && itemDate <= eDate;
            });
        };
        
        // 정렬 - 최신 날짜, 최신 시간이 위로
        const sortByDateAndTime = (data) => {
            return [...data].sort((a, b) => {
                // 1순위: 날짜 내림차순 (최신 날짜가 위로)
                const dateCompare = b.date.localeCompare(a.date);
                if (dateCompare !== 0) return dateCompare;
                
                // 2순위: 시간 내림차순 (최신 시간이 위로)
                if (a.time && b.time) {
                    const timeCompare = b.time.localeCompare(a.time);
                    if (timeCompare !== 0) return timeCompare;
                }
                
                // 3순위: 순위 오름차순 (1위, 2위, 3위...)
                return a.rank - b.rank;
            });
        };
        
        const filteredData = filterByDate(categoryData);
        const sortedData = sortByDateAndTime(filteredData);
        
        // 필드 순서 재정렬 (원하는 순서대로)
        const reorderedData = sortedData.map(item => ({
            rank: item.rank,
            brand: item.brand,
            name: item.name,
            originalPrice: item.originalPrice,
            salePrice: item.salePrice,
            promotion: item.promotion,
            date: item.date,
            time: item.time,
            category: item.category
        }));
        
        // 메모리 정리
        if (global.gc) {
            global.gc();
        }
        
        log.success(`[응답] ${category} ${sortedData.length}건 반환`);
        return res.json({
            success: true,
            data: reorderedData,
            total: reorderedData.length,
            category,
            fromCache: false
        });
    } catch (error) {
        log.error('랭킹 데이터 조회 오류: ' + error);
        return res.status(500).json({
            success: false,
            error: '서버 오류가 발생했습니다.'
        });
    }
});

app.get('/api/search', async (req, res) => {
    try {
        log.section('🔍 제품명 데이터 검색');
        log.info(`키워드: ${req.query.keyword}, 카테고리: ${req.query.category}, 날짜: ${req.query.startDate} ~ ${req.query.endDate}, yearMonth: ${req.query.yearMonth}`);
        const { keyword, startDate, endDate, category, yearMonth } = req.query;
        if (!keyword || !startDate) {
            return res.status(400).json({
                success: false,
                error: '검색어와 시작 날짜를 입력해주세요.'
            });
        }
        const ym = yearMonth || new Date().toISOString().slice(0, 7);
        const filePath = getRankingDataPath(ym);
        
        if (!fs.existsSync(filePath)) {
            log.warn(`[파일없음] ${filePath}`);
            return res.json({
                success: true,
                data: [],
                total: 0,
                message: `${ym} 데이터가 없습니다. 크롤링이 필요합니다.`
            });
        }

        // 메모리 효율적인 파일 읽기
        const fileData = await new Promise((resolve, reject) => {
            const chunks = [];
            const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
            
            stream.on('data', (chunk) => {
                chunks.push(chunk);
            });
            
            stream.on('end', () => {
                try {
                    const content = chunks.join('');
                    const data = JSON.parse(content);
                    resolve(data);
                } catch (error) {
                    reject(error);
                }
            });
            
            stream.on('error', reject);
        });

        const lowerKeyword = keyword.toLowerCase();
        
        // 날짜 필터
        const isInDateRange = (itemDate, startDate, endDate) => {
            const itemD = normalizeDate(itemDate);
            const sDate = normalizeDate(startDate);
            const eDate = normalizeDate(endDate);
            if (!sDate && !eDate) return true;
            if (sDate && !eDate) return itemD === sDate;
            if (!sDate && eDate) return itemD === eDate;
            if (sDate && eDate) {
                return itemD >= sDate && itemD <= eDate;
            }
            return false;
        };
        
        let matchingResults = [];
        if (category && fileData.data[category]) {
            const categoryItems = fileData.data[category];
            categoryItems.forEach(item => {
                if (!item.date) return;
                if (!isInDateRange(item.date, startDate, endDate)) return;
                const text = `${item.brand || ''} ${item.name || ''}`.toLowerCase();
                if (text.includes(lowerKeyword)) {
                    matchingResults.push(item);
                }
            });
        } else {
            Object.values(fileData.data).forEach(categoryItems => {
                categoryItems.forEach(item => {
                    if (!item.date) return;
                    if (!isInDateRange(item.date, startDate, endDate)) return;
                    const text = `${item.brand || ''} ${item.name || ''}`.toLowerCase();
                    if (text.includes(lowerKeyword)) {
                        matchingResults.push(item);
                    }
                });
            });
        }
        
        // 정렬: 날짜 내림차순, 시간 내림차순, 카테고리, 순위
        matchingResults.sort((a, b) => {
            const dateCompare = b.date.localeCompare(a.date);
            if (dateCompare !== 0) return dateCompare;
            if (a.time && b.time) {
                const timeCompare = b.time.localeCompare(a.time);
                if (timeCompare !== 0) return timeCompare;
            }
            if (a.category !== b.category) {
                return a.category.localeCompare(b.category);
            }
            return a.rank - b.rank;
        });
        
        // 메모리 정리
        if (global.gc) {
            global.gc();
        }
        
        log.success(`[응답] 검색결과 ${matchingResults.length}건 반환`);
        return res.json({
            success: true,
            data: matchingResults,
            total: matchingResults.length
        });
    } catch (error) {
        log.error('검색 오류: ' + error);
        return res.status(500).json({
            success: false,
            error: '서버 오류가 발생했습니다.'
        });
    }
});

// 마지막 크롤링 시간 API
app.get('/api/last-crawl-time', (req, res) => {
    try {
        if (!productCache.timestamp) {
            return res.json({
                success: true,
                lastCrawlTime: "서버 시작 후 크롤링 대기 중",
                message: '서버가 시작되었지만 아직 첫 크롤링이 실행되지 않았습니다.'
            });
        }
        
        // KST 시간으로 변환하여 표시
        const kstTimestamp = new Date(productCache.timestamp.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
        const formattedTime = kstTimestamp.toLocaleString('ko-KR', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
        
        // 스케줄링이 비활성화되어 있으므로 다음 크롤링 시간은 표시하지 않음
        
        // 디버그용 로그
        console.log('현재 서버 시간:', new Date().toLocaleString());
        console.log('현재 KST 시간:', getKSTTime().toLocaleString());
        console.log('마지막 크롤링 시간 (KST):', formattedTime);
        
        return res.json({
            success: true,
            lastCrawlTime: formattedTime
        });
    } catch (error) {
        console.error('마지막 크롤링 시간 조회 오류:', error);
        res.status(500).json({
            success: false,
            error: '마지막 크롤링 시간 조회 중 오류가 발생했습니다.',
            details: error.message
        });
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