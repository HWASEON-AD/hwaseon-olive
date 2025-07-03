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

// 월별 랭킹 데이터 경로 생성 함수
function getRankingDataPath(yearMonth) {
    return `/data/ranking_${yearMonth}.json`;
}

// KST 시간 가져오기
function getKSTTime() {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
}

// 랜덤 딜레이 함수
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

// 크롤링 스케줄링 관련 변수
let scheduledCrawlTimer;



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

// 임시 프로필 디렉토리 삭제
function removeTempChromeProfile(tmpDir) {
    if (tmpDir && fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
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
    for (const file of files) {
        try {
            fs.unlinkSync(path.join(capturesDir, file));
            console.log('캡처본 삭제 완료:', file);
        } catch (error) {
            console.error('캡처본 삭제 실패:', file, error);
        }
    }
}


// ========================================
// 🕷️ 크롤링 관련 함수들
// ========================================

// 모든 카테고리 크롤링 함수 (Selenium 기반)
async function crawlAllCategories() {
    try {
        const kstNow = getKSTTime();
        const yearMonth = kstNow.toISOString().slice(0, 7); // '2025-07'
        const RANKING_DATA_PATH = getRankingDataPath(yearMonth);
        // 월별 파일 누적 로드
        let productCache = { data: {}, allProducts: [], timestamp: null };
        if (fs.existsSync(RANKING_DATA_PATH)) {
            try {
                const prev = JSON.parse(fs.readFileSync(RANKING_DATA_PATH, 'utf-8'));
                if (prev && typeof prev === 'object') {
                    productCache = prev;
                }
            } catch (e) {
                console.error('기존 월별 랭킹 데이터 로드 실패:', e);
            }
        }
        console.log(`[${kstNow.toLocaleString('ko-KR', {
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        })}] 1시간 정기 크롤링 시작 (Selenium)`);
        const today = kstNow.toISOString().split('T')[0];
        const timeStr = `${String(kstNow.getHours()).padStart(2, '0')}-${String(kstNow.getMinutes()).padStart(2, '0')}`;
        try {
            // 이전 캡처 파일 모두 삭제
            if (fs.existsSync(capturesDir)) {
                const files = fs.readdirSync(capturesDir);
                for (const file of files) {
                    if (/^ranking_.*\.jpeg$/.test(file)) {
                        fs.unlinkSync(path.join(capturesDir, file));
                        console.log('이전 캡처 파일 삭제:', file);
                    }
                }
            }
            // 모든 카테고리에 대해 크롤링 (카테고리별로 드라이버 새로 생성)
            for (const [category, categoryInfo] of Object.entries(CATEGORY_CODES)) {
                console.log(`카테고리 '${category}' 크롤링 중...(Selenium)`);
                
                // 카테고리별로 새로운 드라이버 생성
                let categoryDriver = null;
                let categoryTmpProfileDir = null;
                let categoryRetryCount = 0;
                const maxCategoryRetries = 1;
                while (categoryRetryCount < maxCategoryRetries) {
                    try {
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
                        const url = `https://www.oliveyoung.co.kr/store/main/getBestList.do?dispCatNo=900000100100001&fltDispCatNo=${categoryInfo.fltDispCatNo}&pageIdx=1&rowsPerPage=24&t_page=%EB%9E%AD%ED%82%B9&t_click=%ED%8C%90%EB%A7%A4%EB%9E%AD%ED%82%B9_${encodedCategory}`;
                        
                        console.log(`${category} 랭킹 페이지로 이동... (시도 ${categoryRetryCount + 1}/${maxCategoryRetries})`);
                        
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
                        const fileName = `ranking_${category}_${today}_${timeStr}.jpeg`;
                        const filePath = path.join(capturesDir, fileName);
                        await captureFullPageWithSelenium(categoryDriver, filePath, category, today);
                        
                        if (!productCache.data) productCache.data = {};
                        if (!productCache.data[category]) productCache.data[category] = [];
                        productCache.data[category].push({
                            rank: 1,
                            brand: '',
                            name: '',
                            originalPrice: '',
                            salePrice: '',
                            promotion: '',
                            date: today,
                            time: timeStr,
                            category
                        });
                        productCache.data[category] = deduplicate(productCache.data[category]);
                        productCache.data[category].sort((a, b) => {
                            const dateCompare = (b.date || '').localeCompare(a.date || '');
                            if (dateCompare !== 0) return dateCompare;
                            const timeCompare = (b.time || '').localeCompare(a.time || '');
                            if (timeCompare !== 0) return timeCompare;
                            return 0;
                        });
                        // allProducts도 누적
                        for (const p of productCache.data[category]) {
                            if (!productCache.allProducts.some(ap => ap.name === p.name && ap.category === p.category && ap.time === p.time)) {
                                productCache.allProducts.push(p);
                            }
                        }
                        console.log(`${category} 크롤링 성공!(Selenium)`);
                    } catch (error) {
                        console.error(`${category} 크롤링 실패(Selenium):`, error.message);
                        if (!productCache.failedCategories) productCache.failedCategories = [];
                        productCache.failedCategories.push({
                            category,
                            timestamp: new Date().toISOString(),
                            error: error.message,
                            status: error.response ? error.response.status : 'unknown'
                        });
                    } finally {
                        // 카테고리별 드라이버 정리
                        if (categoryDriver) {
                            try { 
                                await categoryDriver.quit(); 
                                console.log(`${category} 드라이버 종료 완료`);
                            } catch (e) { 
                                console.error(`${category} 드라이버 종료 중 오류:`, e.message); 
                            }
                        }
                        if (categoryTmpProfileDir) {
                            removeTempChromeProfile(categoryTmpProfileDir);
                            console.log(`${category} 임시 프로필 삭제 완료`);
                        }
                    }
                }
                // 카테고리 간 대기 시간
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            
            // 모든 카테고리 캡처가 완료되었는지 확인
            const allCategoriesCaptured = Object.keys(CATEGORY_CODES).every(cat => productCache.data[cat] && productCache.data[cat].length > 0);
            
            return {
                success: allCategoriesCaptured,
                capturedCount: Object.keys(CATEGORY_CODES).reduce((count, cat) => count + productCache.data[cat].length, 0),
                totalCategories: Object.keys(CATEGORY_CODES).length,
                errors: productCache.failedCategories ? productCache.failedCategories.map(error => ({
                    category: error.category,
                    error: error.error,
                    timestamp: error.timestamp
                })) : null,
                capturedCategories: Object.keys(productCache.data)
            };
        } catch (error) {
            console.error('캡처 프로세스 오류:', error.message);
            return {
                success: false,
                error: error.message,
                capturedCount: 0,
                totalCategories: Object.keys(CATEGORY_CODES).length,
                errors: productCache.failedCategories ? productCache.failedCategories.map(error => ({
                    category: error.category,
                    error: error.error,
                    timestamp: error.timestamp
                })) : null,
                capturedCategories: []
            };
        } finally {
            productCache.timestamp = getKSTTime();
            console.log(`[${new Date().toLocaleString('ko-KR', {
                year: 'numeric',
                month: 'numeric',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false,
                timeZone: 'Asia/Seoul'
            })}] 1시간 정기 크롤링 완료 (Selenium)`);
            // 크롤링 완료 직후 월별 랭킹 데이터 저장
            try {
                fs.writeFileSync(RANKING_DATA_PATH, JSON.stringify(productCache, null, 2));
                console.log(`[랭킹 데이터 저장] ${RANKING_DATA_PATH} (${Object.keys(productCache.data).length}개 카테고리)`);
            } catch (e) {
                console.error('[랭킹 데이터 저장 실패]', RANKING_DATA_PATH, e);
            }
            // 크롤링 완료 후 전체 랭킹 페이지 캡처 실행
            console.log('크롤링 완료 후 전체 랭킹 페이지 캡처 시작...');
            const captureResult = await captureOliveyoungMainRanking(timeStr);
            if (!captureResult.success) {
                console.error('캡처 실패:', captureResult.error);
                console.log('성공한 카테고리:', captureResult.capturedCategories);
                try {
                    const now = new Date();
                    await transporter.sendMail({
                        from: process.env.EMAIL_USER,
                        to: process.env.EMAIL_USER,
                        subject: `[올리브영 캡처 오류] 일부 카테고리 캡처 실패`,
                        text: `오류 발생 시각: ${now.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}\n\n실패한 카테고리:\n${JSON.stringify(captureResult.errors, null, 2)}\n\n성공한 카테고리:\n${captureResult.capturedCategories.join(', ')}`
                    });
                    console.log('캡처 오류 메일 발송 완료');
                } catch (mailErr) {
                    console.error('캡처 오류 메일 발송 실패:', mailErr);
                }
            } else {
                await organizeAndSendCapturesSplit(timeStr, today);
            }
        }
    } catch (err) {
        console.error('crawlAllCategories 전체 에러:', err);
    }
}

// 임시 프로필 디렉토리 생성
function createTempChromeProfile() {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-profile-'));
    return tmpDir;
}

// 임시 프로필 디렉토리 삭제
function removeTempChromeProfile(tmpDir) {
    if (tmpDir && fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

// ========================================
// 📸 캡처 관련 함수들
// ========================================

async function captureOliveyoungMainRanking(timeStr) {
    let retryCount = 0;
    const maxRetries = 3;
    let driver = null;
    let tmpProfileDir = null;
    let capturedCategories = new Set(); // 캡처 성공한 카테고리 추적
    
    async function attemptCapture() {
        console.log('='.repeat(50));
        console.log('올리브영 랭킹 페이지 캡처 시작...');
        console.log('총 21개 카테고리 캡처 예정');
        console.log('='.repeat(50));
        
        const now = getKSTTime();
        const dateFormatted = now.toISOString().split('T')[0]; // YYYY-MM-DD
        let capturedCount = 0;
        const errors = [];
        
        try {
            // Selenium 설정
            tmpProfileDir = createTempChromeProfile();
            const options = new chrome.Options()
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
                .addArguments(`--user-data-dir=${tmpProfileDir}`)
                .addArguments(`--user-agent=${getRandomUserAgent()}`);

            if (process.env.CHROME_BIN) {
                options.setChromeBinaryPath(process.env.CHROME_BIN);
            }
            
            console.log('Chrome 옵션:', options);
            console.log('브라우저 실행 시도...');
            
            driver = await new Builder()
                .forBrowser('chrome')
                .setChromeOptions(options)
                .build();
                
            console.log('브라우저 실행 성공!');
            
            // 순차적으로 각 카테고리 처리 (카테고리별로 드라이버 새로 생성)
            for (const [category, categoryInfo] of Object.entries(CATEGORY_CODES)) {
                // 이미 캡처된 카테고리는 스킵
                if (capturedCategories.has(category)) {
                    console.log(`${category}는 이미 캡처 완료되어 스킵합니다.`);
                    continue;
                }

                // 카테고리별로 새로운 드라이버 생성
                let categoryDriver = null;
                let categoryTmpProfileDir = null;
                let categoryRetryCount = 0;
                const maxCategoryRetries = 1;
                while (categoryRetryCount < maxCategoryRetries) {
                    try {
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
                        const url = `https://www.oliveyoung.co.kr/store/main/getBestList.do?dispCatNo=900000100100001&fltDispCatNo=${categoryInfo.fltDispCatNo}&pageIdx=1&rowsPerPage=24&t_page=%EB%9E%AD%ED%82%B9&t_click=%ED%8C%90%EB%A7%A4%EB%9E%AD%ED%82%B9_${encodedCategory}`;
                        
                        console.log(`${category} 랭킹 페이지로 이동... (시도 ${categoryRetryCount + 1}/${maxCategoryRetries})`);
                        
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
                        
                        capturedCount++;
                        capturedCategories.add(category);
                        console.log(`${category} 랭킹 페이지 캡처 완료: ${fileName}`);
                        console.log(`진행률: ${capturedCount}/${Object.keys(CATEGORY_CODES).length} (${Math.round(capturedCount/Object.keys(CATEGORY_CODES).length*100)}%)`);
                        console.log('-'.repeat(50));
                        
                        // 성공적으로 캡처했으므로 while 루프 종료
                        break;
                        
                    } catch (error) {
                        categoryRetryCount++;
                        if (categoryRetryCount === maxCategoryRetries) {
                            errors.push({
                                category,
                                error: error.message,
                                timestamp: new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
                            });
                        } else {
                            await new Promise(resolve => setTimeout(resolve, 2000));
                        }
                    } finally {
                        if (categoryDriver) {
                            try {
                                await categoryDriver.quit();
                            } catch (closeError) {}
                        }
                        if (categoryTmpProfileDir) {
                            removeTempChromeProfile(categoryTmpProfileDir);
                        }
                    }
                }
                // 카테고리 간 대기 시간
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            
            // 모든 카테고리 캡처가 완료되었는지 확인
            const allCategoriesCaptured = Object.keys(CATEGORY_CODES).every(cat => capturedCategories.has(cat));
            
            return {
                success: allCategoriesCaptured,
                capturedCount,
                totalCategories: Object.keys(CATEGORY_CODES).length,
                errors: errors.length > 0 ? errors : null,
                capturedCategories: Array.from(capturedCategories)
            };
        } catch (error) {
            console.error('캡처 프로세스 오류:', error.message);
            return {
                success: false,
                error: error.message,
                capturedCount,
                totalCategories: Object.keys(CATEGORY_CODES).length,
                errors,
                capturedCategories: Array.from(capturedCategories)
            };
        } finally {
            if (driver) {
                try {
                    await driver.quit();
                } catch (closeError) {
                    console.error('브라우저 종료 중 오류:', closeError.message);
                }
            }
            removeTempChromeProfile(tmpProfileDir);
        }
    }
    
    // 최대 3번까지 재시도
    while (retryCount < maxRetries) {
        console.log(`캡처 시도 ${retryCount + 1}/${maxRetries}`);
        const result = await attemptCapture();
        
        if (result.success) {
            console.log('캡처 작업 성공!');
            console.log(`총 ${result.capturedCount}/${result.totalCategories} 카테고리 캡처 완료`);
            if (result.errors) {
                console.log('일부 카테고리 캡처 실패:', result.errors);
            }
            return result;
        }
        
        retryCount++;
        if (retryCount < maxRetries) {
            console.log(`캡처 실패, ${retryCount + 1}번째 재시도 준비 중... (5초 대기)`);
            console.log('실패 원인:', result.error);
            console.log('성공한 카테고리:', result.capturedCategories);
            await new Promise(resolve => setTimeout(resolve, 5000));
        } else {
            console.log('최대 재시도 횟수 초과, 캡처 작업을 중단합니다.');
            console.log('최종 실패 원인:', result.error);
            console.log('성공한 카테고리:', result.capturedCategories);
            return result;
        }
    }
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
        const { category = '스킨케어', page = 1, startDate, endDate, yearMonth } = req.query;
        const ym = yearMonth || new Date().toISOString().slice(0, 7); // 기본값: 현재 월
        const filePath = getRankingDataPath(ym);
        if (!fs.existsSync(filePath)) {
            return res.json({
                success: true,
                data: [],
                total: 0,
                category,
                message: `${ym} 데이터가 없습니다. 크롤링이 필요합니다.`
            });
        }
        const fileData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        const categoryData = fileData.data && fileData.data[category] ? fileData.data[category] : [];
        // 날짜 필터
        const filterByDate = (data) => {
            if (!startDate && !endDate) return data;
            return data.filter(item => {
                if (!item.date) return false;
                if (startDate && !endDate) return item.date === startDate;
                if (!startDate && endDate) return item.date === endDate;
                return item.date >= startDate && item.date <= endDate;
            });
        };
        // 정렬
        const sortByDateAndTime = (data) => {
            return [...data].sort((a, b) => {
                const dateCompare = b.date.localeCompare(a.date);
                if (dateCompare !== 0) return dateCompare;
                if (a.time && b.time) {
                    const timeCompare = b.time.localeCompare(a.time);
                    if (timeCompare !== 0) return timeCompare;
                }
                return a.rank - b.rank;
            });
        };
        const filteredData = filterByDate(categoryData);
        const sortedData = sortByDateAndTime(filteredData);
        return res.json({
            success: true,
            data: sortedData,
            total: sortedData.length,
            category,
            fromCache: false
        });
    } catch (error) {
        console.error('랭킹 데이터 조회 오류:', error);
        return res.status(500).json({
            success: false,
            error: '서버 오류가 발생했습니다.'
        });
    }
});



app.get('/api/search', (req, res) => {
    try {
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
            return res.json({
                success: true,
                data: [],
                total: 0,
                message: `${ym} 데이터가 없습니다. 크롤링이 필요합니다.`
            });
        }
        const fileData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        const lowerKeyword = keyword.toLowerCase();
        // 날짜 필터
        const isInDateRange = (itemDate, startDate, endDate) => {
            if (!startDate && !endDate) return true;
            if (startDate && !endDate) return itemDate === startDate;
            if (!startDate && endDate) return itemDate === endDate;
            if (startDate && endDate) {
                const d = new Date(itemDate);
                const s = new Date(startDate);
                const e = new Date(endDate);
                return d >= s && d <= e;
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
        return res.json({
            success: true,
            data: matchingResults,
            total: matchingResults.length
        });
    } catch (error) {
        console.error('검색 오류:', error);
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
        
        const formattedTime = productCache.timestamp.toLocaleString('ko-KR', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
        
        const nextCrawlTime = getNextCrawlTime();
        const nextTime = nextCrawlTime.toLocaleString('ko-KR', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        }).replace(/\./g, '').replace(/\s+/g, ' ');
        
        // 디버그용 로그
        console.log('현재 서버 시간:', new Date().toLocaleString());
        console.log('현재 KST 시간:', getKSTTime().toLocaleString());
        console.log('마지막 크롤링 시간:', formattedTime);
        console.log('다음 크롤링 예정 시간:', nextTime);
        
        return res.json({
            success: true,
            lastCrawlTime: formattedTime,
            nextCrawlTime: nextTime
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





// ========================================
// 🛠️ 서버 설정 및 시작
// ========================================

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({ 
        error: 'Internal server error', 
        message: err.message 
    });
});

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



app.listen(port, async () => {
    console.log(`Server running at http://localhost:${port}`);
    // 서버 시작 시 자동 크롤링 스케줄링 활성화
    console.log('1시간 단위 자동 크롤링 스케줄링을 시작합니다...');
    
    // 다음 크롤링 시간 정보 표시
    const nextCrawlTime = getNextCrawlTime();
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    const timeUntilNextCrawl = nextCrawlTime.getTime() - now.getTime();
    const minutesUntilNext = Math.floor(timeUntilNextCrawl/1000/60);
    const hoursUntilNext = Math.floor(minutesUntilNext/60);
    const remainingMinutes = minutesUntilNext % 60;
    
    console.log('='.repeat(50));
    console.log(`다음 크롤링 예정 시간: ${nextCrawlTime.toLocaleString('ko-KR', {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    })}`);
    console.log(`남은 시간: ${hoursUntilNext}시간 ${remainingMinutes}분`);
    console.log('예정된 작업:');
    console.log('- 전체 카테고리 크롤링');
    console.log('- 전체 및 개별 카테고리 랭킹 페이지 캡처 (총 21개)');
    console.log('='.repeat(50));

    // 서버 시작 시 캡처만 즉시 실행
    const kstNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    const timeStr = `${String(kstNow.getHours()).padStart(2, '0')}-${String(kstNow.getMinutes()).padStart(2, '0')}`;
    await captureOliveyoungMainRanking(timeStr);

    // 크롤링은 예약 스케줄에만 동작
    initializeServer();

    // 매일 00:00에 당일 캡처본 삭제
    cron.schedule('0 0 * * *', () => {
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
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
// ⏰ 스케줄링 관련 함수들
// ========================================

// 다음 크롤링 시간 계산 함수
function getNextCrawlTime() {
    // 현재 KST 시간 가져오기
    const kstNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    const scheduledMinutes = 15; // 매 시간 15분에 실행
    
    // 현재 시간
    const currentHour = kstNow.getHours();
    const currentMinute = kstNow.getMinutes();

    // 다음 크롤링 시간 계산
    let nextCrawlTime = new Date(kstNow);
    
    // 현재 시간이 15분을 지났다면 다음 시간으로 설정
    if (currentMinute >= scheduledMinutes) {
        nextCrawlTime.setHours(currentHour + 1, scheduledMinutes, 0, 0);
    } else {
        // 현재 시간의 15분으로 설정
        nextCrawlTime.setHours(currentHour, scheduledMinutes, 0, 0);
    }
    
    // 다음 날로 넘어가는 경우 처리
    if (nextCrawlTime <= kstNow) {
        nextCrawlTime.setHours(nextCrawlTime.getHours() + 1);
    }

    return nextCrawlTime;
}

// 다음 크롤링 스케줄링 함수
function scheduleNextCrawl() {
    // 기존 타이머 제거
    if (scheduledCrawlTimer) {
        clearTimeout(scheduledCrawlTimer);
    }
    
    const nextCrawlTime = getNextCrawlTime();
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    
    // 시간 차이 계산 (밀리초)
    const timeUntilNextCrawl = nextCrawlTime.getTime() - now.getTime();
    
    const minutesUntilNext = Math.floor(timeUntilNextCrawl/1000/60);
    const hoursUntilNext = Math.floor(minutesUntilNext/60);
    const remainingMinutes = minutesUntilNext % 60;
    
    console.log('='.repeat(50));
    console.log(`다음 크롤링 예정 시간: ${nextCrawlTime.toLocaleString('ko-KR', {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    })}`);
    console.log(`남은 시간: ${hoursUntilNext}시간 ${remainingMinutes}분`);
    console.log('예정된 작업:');
    console.log('- 전체 카테고리 크롤링');
    console.log('- 전체 및 개별 카테고리 랭킹 페이지 캡처 (총 21개)');
    console.log('='.repeat(50));
    
    // 다음 크롤링 스케줄링
    scheduledCrawlTimer = setTimeout(() => {
        console.log('스케줄된 크롤링 시작...');
        crawlAllCategories();
    }, timeUntilNextCrawl);
}

// 서버 시작 시 실행되는 초기화 함수
async function initializeServer() {
    try {
        // 다음 크롤링과 캡처 시간 설정
        scheduleNextCrawl();
    } catch (error) {
        console.error('서버 초기화 중 오류 발생:', error);
        // 오류 발생 시에도 다음 크롤링 스케줄링
        scheduleNextCrawl();
    }
}