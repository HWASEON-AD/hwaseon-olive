// ✅ server.js (axios + cheerio 기반 빠른 크롤링)
const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-core');

const app = express();
const port = process.env.PORT || 5001;

// CORS 미들웨어 설정
app.use(cors());

// 정적 파일 서빙을 위한 미들웨어 설정
app.use(express.static(path.join(__dirname, 'public')));
app.use('/captures', express.static(path.join(__dirname, 'public', 'captures')));



// 캡처 저장 디렉토리 설정
const capturesDir = path.join(__dirname, 'public', 'captures');

// 메모리 캐시 - 크롤링 결과 저장
let productCache = {
    timestamp: new Date(),
    data: {},
    allProducts: []  // 모든 제품 데이터 (검색용)
};

// 크롤링 스케줄링 관련 변수
let scheduledCrawlTimer;

// Puppeteer 실행 옵션
const puppeteerOptions = {
    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920x1080',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-notifications'
    ],
    headless: 'new',
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ignoreHTTPSErrors: true,
    timeout: 30000
};

// 현재 시간 포맷 함수 (24시간제 HH:MM)
function getCurrentTimeFormat() {
    const now = new Date();
    // 한국 시간으로 변환
    const kstTime = new Date(now.getTime() + (9 * 60 * 60 * 1000));
    const hours = String(kstTime.getHours()).padStart(2, '0');
    const minutes = String(kstTime.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
}

// 다음 크롤링 시간 계산 함수
function getNextCrawlTime() {
    const now = new Date();
    // 한국 시간으로 변환
    const kstNow = new Date(now.getTime() + (9 * 60 * 60 * 1000));
    
    // 지정된 크롤링 시간 배열 (24시간 형식)
    const scheduledHours = [1, 4, 7, 10, 13, 16, 19, 22];
    const scheduledMinutes = 30;
    
    // 현재 시간과 가장 가까운 다음 크롤링 시간 찾기
    let nextCrawlTime = new Date(kstNow);
    let found = false;
    
    // 현재 시간
    const currentHour = kstNow.getHours();
    const currentMinute = kstNow.getMinutes();
    
    // 오늘 남은 시간 중 가장 가까운 크롤링 시간 찾기
    for (const hour of scheduledHours) {
        // 현재 시간이 크롤링 예정 시간과 같거나 이전이면 해당 시간으로 설정
        if (hour > currentHour || (hour === currentHour && currentMinute <= scheduledMinutes)) {
            nextCrawlTime.setHours(hour, scheduledMinutes, 0, 0);
            found = true;
            break;
        }
    }
    
    // 오늘 남은 크롤링 시간이 없으면 내일 첫 크롤링 시간으로 설정
    if (!found) {
        nextCrawlTime.setDate(nextCrawlTime.getDate() + 1);
        nextCrawlTime.setHours(scheduledHours[0], scheduledMinutes, 0, 0);
    }
    
    return nextCrawlTime;
}

// 모든 카테고리 크롤링 함수
async function crawlAllCategories() {
    console.log(`[${new Date().toLocaleString('ko-KR', {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
        timeZone: 'Asia/Seoul'
    })}] 3시간 정기 크롤링 시작`);
    
    // 현재 시간 (크롤링 시간)
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const crawlTime = getCurrentTimeFormat();
    
    try {
        // 모든 카테고리에 대해 크롤링
        for (const [category, categoryInfo] of Object.entries(CATEGORY_CODES)) {
            console.log(`카테고리 '${category}' 크롤링 중...`);
            
            // 크롤링 로직
            const url = `https://www.oliveyoung.co.kr/store/main/getBestList.do?dispCatNo=900000100100001&fltDispCatNo=${categoryInfo.fltDispCatNo}&pageIdx=1&rowsPerPage=24&selectType=N`;
            
            const response = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            });

            const $ = cheerio.load(response.data);
            const products = [];

            $('.TabsConts .prd_info').each((index, element) => {
                const rank = index + 1;
                const brand = $(element).find('.tx_brand').text().trim();
                const name = $(element).find('.tx_name').text().trim();
                const originalPrice = $(element).find('.tx_org').text().trim() || '없음';
                const salePrice = $(element).find('.tx_cur').text().trim() || '없음';
                const promotion = $(element).find('.icon_flag').text().trim() || '없음';
                
                const product = {
                    rank,
                    brand,
                    name,
                    originalPrice,
                    salePrice,
                    promotion,
                    date: today,
                    time: crawlTime, // 크롤링 시간 저장
                    category
                };
                
                products.push(product);
                
                // 전체 제품 목록에도 추가 (검색용)
                if (!productCache.allProducts.some(p => 
                    p.name === name && 
                    p.category === category && 
                    p.time === crawlTime)) {
                    productCache.allProducts.push(product);
                }
            });

            // 캐시 업데이트 (기존 데이터 유지하면서 새 데이터 추가)
            if (!productCache.data) productCache.data = {};
            
            // 기존 데이터와 새 데이터 병합
            const mergedData = [...products, ...(productCache.data[category] || [])];
            
            // 병합된 데이터를 순위, 날짜, 시간 순으로 정렬
            productCache.data[category] = mergedData.sort((a, b) => {
                // 순위 기준으로 오름차순 정렬
                if (a.rank !== b.rank) {
                    return a.rank - b.rank;
                }
                
                // 같은 순위라면 날짜 기준으로 내림차순 정렬 (최신 날짜 우선)
                if (a.date !== b.date) {
                    return b.date.localeCompare(a.date);
                }
                
                // 날짜까지 같다면 시간으로 내림차순 정렬 (최신 시간 우선)
                if (a.time && b.time) {
                    return b.time.localeCompare(a.time);
                }
                
                return 0;
            });
        }
        
        // 전체 목록도 정렬
        productCache.allProducts.sort((a, b) => {
            // 카테고리 기준으로 정렬
            if (a.category !== b.category) {
                return a.category.localeCompare(b.category);
            }
            
            // 순위 기준으로 정렬
            if (a.rank !== b.rank) {
                return a.rank - b.rank;
            }
            
            // 날짜 기준으로 정렬 (최신 우선)
            if (a.date !== b.date) {
                return b.date.localeCompare(a.date);
            }
            
            // 시간 기준으로 정렬 (최신 우선)
            if (a.time && b.time) {
                return b.time.localeCompare(a.time);
            }
            
            return 0;
        });
        
        productCache.timestamp = now;
        console.log(`[${new Date().toLocaleString('ko-KR', {
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
            timeZone: 'Asia/Seoul'
        })}] 3시간 정기 크롤링 완료`);
        
        // 크롤링 완료 후 전체 랭킹 페이지 캡처 실행
        console.log('크롤링 완료 후 전체 랭킹 페이지 캡처 시작...');
        await captureOliveyoungMainRanking();
        
        // 다음 크롤링 스케줄링
        scheduleNextCrawl();
        
    } catch (error) {
        console.error(`크롤링 오류:`, error);
        // 오류가 발생해도 다음 크롤링은 스케줄링
        scheduleNextCrawl();
    }
}

async function findChrome() {
    // Render 환경인 경우
    if (process.env.RENDER) {
        console.log('Render 환경에서 실행 중입니다.');
        return '/usr/bin/google-chrome';
    }

    // macOS의 Chrome 기본 경로
    const macChromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    
    if (fs.existsSync(macChromePath)) {
        console.log('Chrome 경로를 찾았습니다:', macChromePath);
        return macChromePath;
    }
    
    // 다른 가능한 경로들 시도
    const paths = [
        '/usr/bin/google-chrome',                // Linux
        '/usr/bin/google-chrome-stable',         // Linux alternative
        '/usr/bin/chromium-browser'             // Linux
    ];

    for (const path of paths) {
        if (fs.existsSync(path)) {
            console.log('Chrome 경로를 찾았습니다:', path);
            return path;
        }
    }
    
    console.log('Chrome을 찾을 수 없어 기본 macOS 경로를 사용합니다.');
    return macChromePath;
}



async function captureOliveyoungMainRanking() {
    console.log('='.repeat(50));
    console.log('올리브영 랭킹 페이지 캡처 시작...');
    console.log('총 21개 카테고리 캡처 예정');
    console.log('='.repeat(50));
    
    const now = new Date();
    // 한국 시간으로 변환
    const kstNow = new Date(now.getTime() + (9 * 60 * 60 * 1000));
    const today = kstNow.toISOString().split('T')[0];
    const timeStr = getCurrentTimeFormat();
    const dateTimeStr = `${today}_${timeStr.replace(':', '-')}`;
    
    let browser = null;
    let capturedCount = 0;
    const totalCategories = Object.keys(CATEGORY_CODES).length;
    
    try {
        // Chrome 설치 확인
        const chromePath = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome';
        console.log('Chrome 경로:', chromePath);
        
        try {
            const { execSync } = require('child_process');
            const chromeVersion = execSync(`${chromePath} --version`).toString();
            console.log('설치된 Chrome 버전:', chromeVersion);
        } catch (error) {
            console.error('Chrome 버전 확인 실패:', error.message);
        }

        // Puppeteer 옵션 로깅
        console.log('Puppeteer 실행 옵션:', JSON.stringify(puppeteerOptions, null, 2));
        
        // 브라우저 실행 시도
        console.log('브라우저 실행 시도...');
        browser = await puppeteer.launch(puppeteerOptions);
        console.log('브라우저 실행 성공!');
        
        const page = await browser.newPage();
        console.log('새 페이지 생성 성공!');
        
        // 브라우저 지문 설정
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
            Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
            Object.defineProperty(navigator, 'languages', { get: () => ['ko-KR', 'ko', 'en-US', 'en'] });
        });
        
        await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');
        
        await page.setViewport({
            width: 1920,
            height: 1080,
            deviceScaleFactor: 1,
        });
        
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
            'sec-ch-ua': '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"macOS"'
        });

        await page.setCookie({
            name: 'JSESSIONID',
            value: 'dummy',
            domain: '.oliveyoung.co.kr',
            path: '/'
        });

        // 먼저 전체 랭킹 캡처
        let retryCount = 0;
        const maxRetries = 3;
        
        while (retryCount < maxRetries) {
            try {
                const url = 'https://www.oliveyoung.co.kr/store/main/getBestList.do?dispCatNo=900000100100001&fltDispCatNo=&pageIdx=1&rowsPerPage=24&selectType=N';
                
                console.log(`전체 랭킹 페이지로 이동 시도 ${retryCount + 1}/${maxRetries}: ${url}`);
                
                await page.goto(url, {
                    waitUntil: ['networkidle0', 'domcontentloaded'],
                    timeout: 60000
                });
                
                // 페이지 로딩 대기 시간 증가 및 엘리먼트 대기 조건 수정
                await page.waitForTimeout(6000);
                
                // 페이지가 완전히 로드될 때까지 대기
                await page.waitForFunction(() => {
                    const element = document.querySelector('.TabsConts');
                    return element && element.children.length > 0;
                }, { timeout: 30000 });
                
                const fileName = `ranking_전체_${dateTimeStr}.jpg`;
                const filePath = path.join(capturesDir, fileName);
                
                await page.screenshot({
                    path: filePath,
                    type: 'jpeg',
                    quality: 80,
                    fullPage: true
                });
                
                console.log(`전체 랭킹 페이지 캡처 완료: ${fileName}`);
                break;
                
            } catch (error) {
                console.error(`전체 랭킹 캡처 시도 ${retryCount + 1}/${maxRetries} 실패:`, error);
                retryCount++;
                
                if (retryCount < maxRetries) {
                    console.log(`${retryCount + 1}번째 재시도 준비 중... (5초 대기)`);
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }
            }
        }

        // 각 카테고리별 캡처 수행
        for (const [category, categoryInfo] of Object.entries(CATEGORY_CODES)) {
            // 전체는 이미 캡처했으므로 스킵
            if (category === '전체') continue;
            
            retryCount = 0;
            
            while (retryCount < maxRetries) {
                try {
                    const url = `https://www.oliveyoung.co.kr/store/main/getBestList.do?dispCatNo=900000100100001&fltDispCatNo=${categoryInfo.fltDispCatNo}&pageIdx=1&rowsPerPage=24&selectType=N`;
                    
                    console.log(`${category} 랭킹 페이지로 이동 시도 ${retryCount + 1}/${maxRetries}: ${url}`);
                    
                    await page.goto(url, {
                        waitUntil: ['networkidle0', 'domcontentloaded'],
                        timeout: 60000
                    });
                    
                    // 페이지 로딩 대기 시간 증가 및 엘리먼트 대기 조건 수정
                    await page.waitForTimeout(8000);
                    
                    // 페이지가 완전히 로드될 때까지 대기
                    await page.waitForFunction(() => {
                        const element = document.querySelector('.TabsConts');
                        return element && element.children.length > 0;
                    }, { timeout: 30000 });
                    
                    const fileName = `ranking_${category}_${dateTimeStr}.jpg`;
                    const filePath = path.join(capturesDir, fileName);
                    
                    await page.screenshot({
                        path: filePath,
                        type: 'jpeg',
                        quality: 80,
                        fullPage: true
                    });
                    
                    capturedCount++;
                    console.log(`${category} 랭킹 페이지 캡처 완료: ${fileName}`);
                    console.log(`진행률: ${capturedCount}/${totalCategories} (${Math.round(capturedCount/totalCategories*100)}%)`);
                    console.log('-'.repeat(50));
                    break;
                    
                } catch (error) {
                    console.error(`${category} 캡처 시도 ${retryCount + 1}/${maxRetries} 실패:`, error);
                    retryCount++;
                    
                    if (retryCount < maxRetries) {
                        console.log(`${retryCount + 1}번째 재시도 준비 중... (5초 대기)`);
                        await new Promise(resolve => setTimeout(resolve, 5000));
                    }
                }
            }
            
            if (retryCount >= maxRetries) {
                console.error(`${category}: 최대 재시도 횟수(${maxRetries})를 초과했습니다.`);
            }
            
            // 카테고리 간 대기 시간 추가
            await page.waitForTimeout(2000);
        }
        
    } catch (error) {
        console.error('캡처 프로세스 전체 오류:', error);
        console.error('상세 에러 정보:', {
            message: error.message,
            stack: error.stack,
            name: error.name
        });
    } finally {
        if (browser) {
            try {
                await browser.close();
                console.log('브라우저가 정상적으로 종료되었습니다.');
            } catch (closeError) {
                console.error('브라우저 종료 중 오류:', closeError);
            }
        }
    }
}

// 다음 크롤링 스케줄링 함수
function scheduleNextCrawl() {
    // 기존 타이머 제거
    if (scheduledCrawlTimer) {
        clearTimeout(scheduledCrawlTimer);
    }
    
    // 다음 크롤링 시간 계산
    const nextCrawlTime = getNextCrawlTime();
    const now = new Date();
    const kstNow = new Date(now.getTime() + (9 * 60 * 60 * 1000));
    const timeUntilNextCrawl = Math.max(0, nextCrawlTime - kstNow);
    
    // 다음 크롤링 시간을 보다 명확하게 표시 - 24시간제로 변경
    const nextTimeFormatted = nextCrawlTime.toLocaleString('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'Asia/Seoul'
    });
    
    const minutesUntilNext = Math.floor(timeUntilNextCrawl/1000/60);
    const hoursUntilNext = Math.floor(minutesUntilNext/60);
    const remainingMinutes = minutesUntilNext % 60;
    
    console.log('='.repeat(50));
    console.log(`다음 작업 예정 시간: ${nextTimeFormatted}`);
    console.log(`남은 시간: ${hoursUntilNext}시간 ${remainingMinutes}분`);
    console.log('예정된 작업:');
    console.log('- 전체 카테고리 크롤링');
    console.log('- 전체 및 개별 카테고리 랭킹 페이지 캡처 (총 21개)');
    console.log('='.repeat(50));
    
    // 다음 크롤링 스케줄링
    scheduledCrawlTimer = setTimeout(() => {
        crawlAllCategories();
    }, timeUntilNextCrawl);
}

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

// Express 설정
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'olive.html'));
});

// 랭킹 데이터 가져오기
app.get('/api/ranking', async (req, res) => {
    try {
        const { category = '스킨케어', page = 1, startDate, endDate } = req.query;
        const categoryInfo = CATEGORY_CODES[category] || CATEGORY_CODES['스킨케어'];
        
        // 현재 시간
        const now = new Date();
        const today = now.toISOString().split('T')[0];
        
        console.log('요청된 날짜 범위:', startDate, endDate);
        
        // 날짜 필터링 함수
        const filterByDate = (data) => {
            // 날짜 선택이 없으면 모든 데이터 반환
            if (!startDate && !endDate) {
                return data;
            }
            
            // 날짜 필터링 적용
            return data.filter(item => {
                // 날짜가 없는 항목은 제외
                if (!item.date) return false;
                
                // 시작일만 선택된 경우
                if (startDate && !endDate) {
                    return item.date === startDate;
                }
                
                // 종료일만 선택된 경우
                if (!startDate && endDate) {
                    return item.date === endDate;
                }
                
                // 날짜 범위가 선택된 경우
                return item.date >= startDate && item.date <= endDate;
            });
        };
        
        // 데이터 정렬 함수 - 순위 기준 오름차순, 같은 순위는 최신 날짜/시간 우선
        const sortByRankAndDate = (data) => {
            return [...data].sort((a, b) => {
                // 우선 순위로 정렬 (오름차순)
                if (a.rank !== b.rank) {
                    return a.rank - b.rank;
                }
                
                // 날짜로 정렬 (내림차순 - 최신 날짜 우선)
                if (a.date !== b.date) {
                    return b.date.localeCompare(a.date);
                }
                
                // 시간으로 정렬 (내림차순 - 최신 시간 우선)
                if (a.time && b.time) {
                    return b.time.localeCompare(a.time);
                }
                
                return 0;
            });
        };
        
        // 기존에 이미 크롤링한 데이터만 사용
        if (productCache.data && productCache.data[category]) {
            // 캐시된 데이터에 날짜 필터 적용
            const filteredData = filterByDate(productCache.data[category]);
            // 필터링된 데이터를 순위별로 정렬
            const sortedData = sortByRankAndDate(filteredData);
            
            console.log(`캐시에서 ${productCache.data[category].length}개 중 ${filteredData.length}개 필터링됨`);
            
            return res.json({
                success: true,
                data: sortedData,
                total: sortedData.length,
                category,
                fromCache: true
            });
        } else {
            // 데이터가 없는 경우 빈 배열 반환
            return res.json({
                success: true,
                data: [],
                total: 0,
                category,
                message: '해당 카테고리의 데이터가 없습니다. 크롤링이 필요합니다.'
            });
        }
    } catch (error) {
        console.error('Error fetching ranking:', error);
        res.status(500).json({
            success: false,
            error: '데이터를 가져오는 중 오류가 발생했습니다.',
            details: error.message
        });
    }
});

// 제품명 검색 API
app.get('/api/search', (req, res) => {
    try {
        const { keyword, category, startDate, endDate } = req.query;
        
        if (!keyword) {
            return res.status(400).json({
                success: false,
                error: '검색어를 입력해주세요.'
            });
        }
        
        // 날짜 필터링 함수
        const filterByDate = (data) => {
            // 날짜 선택이 없으면 모든 데이터 반환
            if (!startDate && !endDate) {
                return data;
            }
            
            // 날짜 필터링 적용
            return data.filter(item => {
                // 날짜가 없는 항목은 제외
                if (!item.date) return false;
                
                // 시작일만 선택된 경우
                if (startDate && !endDate) {
                    return item.date === startDate;
                }
                
                // 종료일만 선택된 경우
                if (!startDate && endDate) {
                    return item.date === endDate;
                }
                
                // 날짜 범위가 선택된 경우
                return item.date >= startDate && item.date <= endDate;
            });
        };
        
        // 데이터 정렬 함수 - 순위 기준 오름차순, 같은 순위는 최신 날짜/시간 우선
        const sortByRankAndDate = (data) => {
            return [...data].sort((a, b) => {
                // 우선 순위로 정렬 (오름차순)
                if (a.rank !== b.rank) {
                    return a.rank - b.rank;
                }
                
                // 날짜로 정렬 (내림차순 - 최신 날짜 우선)
                if (a.date !== b.date) {
                    return b.date.localeCompare(a.date);
                }
                
                // 시간으로 정렬 (내림차순 - 최신 시간 우선)
                if (a.time && b.time) {
                    return b.time.localeCompare(a.time);
                }
                
                return 0;
            });
        };
        
        // 검색 결과 필터링
        let results = productCache.allProducts.filter(product => 
            product.name.toLowerCase().includes(keyword.toLowerCase())
        );
        
        // 카테고리 필터링
        if (category && category !== '전체') {
            results = results.filter(product => product.category === category);
        }
        
        // 날짜 필터링
        results = filterByDate(results);
        
        // 결과를 순위와 날짜/시간 기준으로 정렬
        results = sortByRankAndDate(results);
        
        res.json({
            success: true,
            data: results,
            total: results.length,
            keyword
        });
    } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({
            success: false,
            error: '검색 중 오류가 발생했습니다.',
            details: error.message
        });
    }
});

// 캡처 목록 조회 API
app.get('/api/captures', (req, res) => {
    try {
        const { category, startDate, endDate } = req.query;
        
        // captures 디렉토리의 파일 목록 읽기
        const files = fs.readdirSync(capturesDir);
        
        // 이미지 파일만 필터링 (jpg, jpeg, png)
        const imageFiles = files.filter(file => /\.(jpg|jpeg|png)$/i.test(file));
        
        // 파일 정보 생성
        let captures = imageFiles.map(fileName => {
            const filePath = path.join(capturesDir, fileName);
            const stats = fs.statSync(filePath);
            
            // 파일명에서 카테고리, 날짜와 시간 추출 (ranking_카테고리_YYYY-MM-DD_HH-MM.jpg 형식)
            const match = fileName.match(/ranking_(.+)_(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2})/);
            let extractedCategory, date, time;
            
            if (match) {
                extractedCategory = match[1];
                date = match[2];
                time = match[3].replace('-', ':');
            } else {
                // 파일명에서 추출할 수 없는 경우 파일 생성 시간 사용
                const fileDate = new Date(stats.mtime);
                extractedCategory = '전체';
                date = fileDate.toISOString().split('T')[0];
                time = fileDate.toTimeString().split(' ')[0].substr(0, 5);
            }
            
            return {
                id: path.parse(fileName).name,
                fileName,
                category: extractedCategory,
                date,
                time,
                timestamp: stats.mtime,
                imageUrl: `/captures/${fileName}`,
                fileSize: stats.size
            };
        });
        
        // 카테고리 필터링 - 정확한 매칭
        if (category) {
            captures = captures.filter(capture => capture.category === category);
        }
        
        // 날짜 필터링
        if (startDate || endDate) {
            captures = captures.filter(capture => {
                if (startDate && endDate) {
                    return capture.date >= startDate && capture.date <= endDate;
                } else if (startDate) {
                    return capture.date >= startDate;
                } else {
                    return capture.date <= endDate;
                }
            });
        }
        
        // 날짜와 시간 기준으로 내림차순 정렬 (최신순)
        captures.sort((a, b) => {
            if (a.date !== b.date) {
                return b.date.localeCompare(a.date);
            }
            return b.time.localeCompare(a.time);
        });
        
        // 사용 가능한 카테고리 목록 생성
        const availableCategories = [...new Set(captures.map(capture => capture.category))].sort();
        
        res.json({
            success: true,
            data: captures,
            total: captures.length,
            filters: {
                category,
                startDate,
                endDate
            },
            availableCategories
        });
        
    } catch (error) {
        console.error('캡처 목록 조회 중 오류:', error);
        res.status(500).json({
            success: false,
            error: '캡처 목록 조회 중 오류가 발생했습니다.',
            details: error.message
        });
    }
});

// 마지막 크롤링 시간 API 추가
app.get('/api/last-crawl-time', (req, res) => {
    try {
        if (!productCache.timestamp) {
            return res.json({
                success: true,
                lastCrawlTime: "서버 시작 후 크롤링 대기 중",
                message: '서버가 시작되었지만 아직 첫 크롤링이 실행되지 않았습니다.'
            });
        }
        
        // 마지막 크롤링 시간을 한국 시간 형식으로 변환
        const timestamp = new Date(productCache.timestamp.getTime() + (9 * 60 * 60 * 1000));
        const formattedTime = timestamp.toLocaleString('ko-KR', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
            timeZone: 'Asia/Seoul'
        });
        
        // 다음 크롤링 예정 시간 계산
        const nextCrawlTime = getNextCrawlTime();
        const nextTime = nextCrawlTime.toLocaleString('ko-KR', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
            timeZone: 'Asia/Seoul'
        });
        
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

// 이미지 다운로드 API
app.get('/api/download/:filename', (req, res) => {
    try {
        const filename = req.params.filename;
        const filePath = path.join(capturesDir, filename);
        
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
        }

        res.download(filePath);
    } catch (error) {
        console.error('파일 다운로드 중 오류:', error);
        res.status(500).json({ error: '파일 다운로드 중 오류가 발생했습니다.' });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({ 
        error: 'Internal server error', 
        message: err.message 
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'ok',
        time: getFormattedDateTime()
    });
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    
    // 캡처 디렉토리 확인 및 생성
    if (!fs.existsSync(capturesDir)) {
        fs.mkdirSync(capturesDir, { recursive: true });
    }
    
    // 서버 시작 시 자동 크롤링 스케줄링 활성화
    console.log('3시간 단위 자동 크롤링 스케줄링을 시작합니다...');
    
    // 첫 번째 크롤링 실행 후 다음 크롤링 스케줄링
    crawlAllCategories();
});
