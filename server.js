// ✅ server.js (axios + cheerio 기반 빠른 크롤링)
const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { Builder, By, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const sharp = require('sharp');
const nodemailer = require('nodemailer');
const archiver = require('archiver');
require('dotenv').config();
const app = express();
const port = process.env.PORT || 5001;

const RANKING_DATA_PATH = '/data/ranking.json';
const capturesDir = path.join(__dirname, 'public', 'captures');

if (!fs.existsSync(capturesDir)) {
    fs.mkdirSync(capturesDir, { recursive: true });
}

// CORS 미들웨어 설정
app.use(cors());

// 정적 파일 서빙을 위한 미들웨어 설정
app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: '1h',
    etag: true,
    lastModified: true
}));
app.use('/captures', express.static(path.join(__dirname, 'public', 'captures'), {
    maxAge: '1h',
    etag: true,
    lastModified: true
}));

// 메모리 캐시 - 크롤링 결과 저장
let productCache = {
    timestamp: new Date(),
    data: {},
    allProducts: []  // 모든 제품 데이터 (검색용)
};

// 크롤링 스케줄링 관련 변수
let scheduledCrawlTimer;

// 서버 시작 시 랭킹 데이터 복원
if (fs.existsSync(RANKING_DATA_PATH)) {
    try {
        const raw = fs.readFileSync(RANKING_DATA_PATH, 'utf-8');
        productCache = JSON.parse(raw);
        if (productCache.timestamp) {
            productCache.timestamp = new Date(productCache.timestamp);
        }
        console.log('랭킹 데이터 복원 완료:', RANKING_DATA_PATH);
    } catch (e) {
        console.error('랭킹 데이터 복원 실패:', e);
    }
}



function getKSTTime() {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
}

// 다음 크롤링 시간 계산 함수
function getNextCrawlTime() {
    const kstNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    const scheduledHours = [1, 4, 7, 10, 13, 16, 19, 22];
    const scheduledMinutes = 30;
    
    const currentHour = kstNow.getHours();
    const currentMinute = kstNow.getMinutes();

    let nextCrawlTime = new Date(kstNow);
    let found = false;
    
    for (const hour of scheduledHours) {
        if (hour > currentHour || (hour === currentHour && scheduledMinutes > currentMinute)) {
            nextCrawlTime.setHours(hour, scheduledMinutes, 0, 0);
            found = true;
            break;
        }
    }
    
    if (!found) {
        nextCrawlTime.setDate(nextCrawlTime.getDate() + 1);
        nextCrawlTime.setHours(scheduledHours[0], scheduledMinutes, 0, 0);
        console.log('내일 첫 크롤링 시간으로 설정:', `${scheduledHours[0]}:${scheduledMinutes}`);
    }
    
    return nextCrawlTime;
}

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

// 캡처본 정리 및 이메일 전송 함수
async function organizeAndSendCaptures(timeStr) {
    const today = new Date().toISOString().split('T')[0];
    const zipPath = path.join(__dirname, `oliveyoung_captures_${today}_${timeStr}.zip`);
    try {
        const files = fs.readdirSync(capturesDir);
        const targetFiles = files.filter(file => {
            const match = file.match(/ranking_.+_(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2})/);
            return match && match[1] === today && match[2] === timeStr;
        });
        
        if (targetFiles.length === 0) {
            console.log(`[메일전송] ${today} ${timeStr} 캡처본 없음!`);
            return;
        }
        
        await new Promise((resolve, reject) => {
            const output = fs.createWriteStream(zipPath);
            const archive = archiver('zip', { zlib: { level: 9 } });
            output.on('close', resolve);
            archive.on('error', reject);
            archive.pipe(output);
            for (const file of targetFiles) {
                archive.file(path.join(capturesDir, file), { name: file });
            }
            archive.finalize();
        });
        
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: 'gt.min@hwaseon.com',
            subject: `올리브영 ${today} ${timeStr} 캡처본 (zip 첨부)`,
            text: `${today} ${timeStr} 올리브영 랭킹 캡처본이 zip 파일로 첨부되었습니다.`,
            attachments: [
                {
                    filename: `oliveyoung_captures_${today}_${timeStr}.zip`,
                    path: zipPath
                }
            ]
        };
        
        await transporter.sendMail(mailOptions);
        console.log(`${today} ${timeStr} 캡처본 zip 이메일 전송 완료`);
        fs.unlinkSync(zipPath);
    } catch (error) {
        console.error('캡처본 정리 및 이메일 전송 중 오류:', error);
    }
}

// 로그 출력 제어 함수
function log(message, type = 'info') {
    const essentialLogs = [
        '크롤링 시작',
        '크롤링 완료',
        '캡처 시작',
        '캡처 완료',
        '이메일 전송',
        '서버 시작',
        '서버 종료'
    ];

    if (type === 'error') {
        console.error(`[${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}] ${message}`);
        return;
    }

    if (essentialLogs.some(log => message.includes(log))) {
        console.log(`[${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}] ${message}`);
    }
}

// API 요청 로깅 미들웨어
app.use((req, res, next) => {
    if (req.path === '/health' || 
        req.path.startsWith('/static/') || 
        req.path.endsWith('.png') || 
        req.path.endsWith('.css') || 
        req.path.endsWith('.js')) {
        return next();
    }
    next();
});

// Express 설정
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 모든 카테고리 크롤링 함수
async function crawlAllCategories() {
    const kstNow = getKSTTime();
    log(`크롤링 시작: ${kstNow.toLocaleString('ko-KR')}`);
    
    const today = kstNow.toISOString().split('T')[0];
    // 캡처 시작 타임스탬프 생성 (크롤링 시작 시점 기준)
    const timeStr = `${String(kstNow.getHours()).padStart(2, '0')}-${String(kstNow.getMinutes()).padStart(2, '0')}`;
    
    try {
        // 크롤링 시작 전 메모리 정리
        if (global.gc) {
            global.gc();
        }

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

        // 모든 카테고리에 대해 크롤링
        for (const [category, categoryInfo] of Object.entries(CATEGORY_CODES)) {
            console.log(`카테고리 '${category}' 크롤링 중...`);
            
            // 크롤링 로직
            const url = `https://www.oliveyoung.co.kr/store/main/getBestList.do`;
            const params = {
                dispCatNo: '900000100100001',
                fltDispCatNo: categoryInfo.fltDispCatNo,
                pageIdx: 1,
                rowsPerPage: 24,
                selectType: 'N'
            };
            
            try {
                // 랜덤 User-Agent 생성
                const userAgents = [
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
                    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
                ];
                const randomUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)];

                // 랜덤 대기 시간 (1-3초)
                await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));

                const response = await axios.get(url, {
                    params,
                    headers: {
                        'User-Agent': randomUserAgent,
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
                        'Accept-Encoding': 'gzip, deflate, br',
                        'Connection': 'keep-alive',
                        'Referer': 'https://www.oliveyoung.co.kr/',
                        'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
                        'Sec-Ch-Ua-Mobile': '?0',
                        'Sec-Ch-Ua-Platform': '"Windows"',
                        'Sec-Fetch-Dest': 'document',
                        'Sec-Fetch-Mode': 'navigate',
                        'Sec-Fetch-Site': 'same-origin',
                        'Sec-Fetch-User': '?1',
                        'Upgrade-Insecure-Requests': '1',
                        'Cache-Control': 'max-age=0',
                        'Cookie': 'JSESSIONID=' + Math.random().toString(36).substring(7)
                    },
                    timeout: 30000, // 30초 타임아웃
                    maxRedirects: 5,
                    validateStatus: function (status) {
                        return status >= 200 && status < 500; // 500 미만의 모든 상태 코드 허용
                    }
                });

                if (!response.data) {
                    throw new Error('응답 데이터가 없습니다.');
                }

                // 응답 상태 코드 확인
                if (response.status === 403) {
                    throw new Error('접근이 거부되었습니다. 잠시 후 다시 시도해주세요.');
                }

                const $ = cheerio.load(response.data);
                const products = [];

                $('.TabsConts .prd_info').each((index, element) => {
                    const rank = index + 1;
                    const brand = $(element).find('.tx_brand').text().trim();
                    const name = $(element).find('.tx_name').text().trim();
                    const originalPrice = $(element).find('.tx_org').text().trim() || '없음';
                    const salePrice = $(element).find('.tx_cur').text().trim() || '없음';
                    const promotion = $(element).find('.icon_flag').text().trim() || '없음';
                    
                    if (!name) {
                        console.log(`경고: ${category} 카테고리의 ${rank}위 상품명이 비어있습니다.`);
                        return;
                    }
                    
                    const product = {
                        rank,
                        brand,
                        name,
                        originalPrice,
                        salePrice,
                        promotion,
                        date: today,
                        time: timeStr,
                        category
                    };
                    
                    products.push(product);
                });

                if (products.length === 0) {
                    throw new Error(`${category} 카테고리에서 상품을 찾을 수 없습니다.`);
                }

                console.log(`${category} 크롤링 완료: ${products.length}개 상품`);
                
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
            } catch (error) {
                console.error(`${category} 크롤링 중 오류:`, error.message);
            }
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
        
        // 현재 KST 시간을 정확하게 저장
        productCache.timestamp = getKSTTime();
        log('크롤링 완료');
        
        // 크롤링 완료 후 전체 랭킹 페이지 캡처 실행
        console.log('크롤링 완료 후 전체 랭킹 페이지 캡처 시작...');
        await captureOliveyoungMainRanking(timeStr);
        
        // 해당 타임스탬프 캡처본만 메일로 전송
        await organizeAndSendCaptures(timeStr);
        
        // 다음 크롤링 스케줄링
        scheduleNextCrawl();
        
        // 크롤링 완료 후 랭킹 데이터 저장
        try {
            fs.writeFileSync(RANKING_DATA_PATH, JSON.stringify(productCache, null, 2));
            console.log('랭킹 데이터 저장 완료:', RANKING_DATA_PATH);
        } catch (e) {
            console.error('랭킹 데이터 저장 실패:', e);
        }
        
        // 크롤링 완료 후 메모리 정리
        if (global.gc) {
            global.gc();
        }
        
    } catch (error) {
        log(`크롤링 오류: ${error.message}`, 'error');
        // 오류가 발생해도 다음 크롤링은 스케줄링
        scheduleNextCrawl();
    }
}

async function captureOliveyoungMainRanking(timeStr) {
    let retryCount = 0;
    const maxRetries = 3;
    let driver = null;
    
    log('캡처 시작');
    
    async function attemptCapture() {
        console.log('='.repeat(50));
        console.log('올리브영 랭킹 페이지 캡처 시작...');
        console.log('총 21개 카테고리 캡처 예정');
        console.log('='.repeat(50));
        
        const now = getKSTTime();
        const dateFormatted = now.toISOString().split('T')[0]; // YYYY-MM-DD
        // const timeFormatted = `${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
        // 파일명 포맷: ranking_카테고리_YYYY-MM-DD_HH-MM.jpeg
        let capturedCount = 0;
        const errors = [];
        
        try {
            // Selenium 설정 최적화
            const options = new chrome.Options()
                .addArguments('--headless')
                .addArguments('--no-sandbox')
                .addArguments('--disable-dev-shm-usage')
                .addArguments('--disable-gpu')
                .addArguments('--disable-extensions')
                .addArguments('--disable-notifications')
                .addArguments('--window-size=1920,1080')
                .addArguments('--hide-scrollbars')
                .addArguments('--force-device-scale-factor=1')
                .addArguments('--screenshot-format=jpeg')
                .addArguments('--screenshot-quality=80')
                .addArguments('--disable-software-rasterizer')
                .addArguments('--disable-dev-shm-usage')
                .addArguments('--disable-setuid-sandbox')
                .addArguments('--single-process')
                .addArguments('--no-zygote')
                .addArguments('--disable-features=VizDisplayCompositor');

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
            
            // 순차적으로 각 카테고리 처리
            for (const [category, categoryInfo] of Object.entries(CATEGORY_CODES)) {
                try {
                    const url = `https://www.oliveyoung.co.kr/store/main/getBestList.do?dispCatNo=900000100100001&fltDispCatNo=${categoryInfo.fltDispCatNo}&pageIdx=1&rowsPerPage=24&selectType=N`;
                    
                    console.log(`${category} 랭킹 페이지로 이동...`);
                    
                    await driver.get(url);
                    
                    // 페이지 로딩 타임아웃 설정
                    await driver.wait(until.elementLocated(By.css('.TabsConts')), 30000);
                    
                    // 상품 목록 로딩 타임아웃 설정
                    await driver.wait(async () => {
                        const products = await driver.findElements(By.css('.TabsConts .prd_info'));
                        return products.length > 0;
                    }, 30000, '상품 목록 로딩 시간 초과');
                    
                    // 추가 대기 시간
                    await driver.sleep(2000);
                    
                    
                    // 카테고리 헤더 추가
                    await driver.executeScript(`
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
                    await captureFullPageWithSelenium(driver, filePath, category, dateFormatted);
                    
                    capturedCount++;
                    console.log(`${category} 랭킹 페이지 캡처 완료: ${fileName}`);
                    console.log(`진행률: ${capturedCount}/${Object.keys(CATEGORY_CODES).length} (${Math.round(capturedCount/Object.keys(CATEGORY_CODES).length*100)}%)`);
                    console.log('-'.repeat(50));
                    
                    // 카테고리 간 대기 시간
                    await driver.sleep(1000);
                    
                } catch (error) {
                    console.error(`${category} 캡처 중 오류:`, error.message);
                    errors.push({
                        category,
                        error: error.message,
                        timestamp: new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
                    });
                    
                    // 오류 발생 시 브라우저 재시작
                    if (driver) {
                        try {
                            await driver.quit();
                        } catch (e) {
                            console.error('브라우저 종료 오류:', e.message);
                        }
                    }
                    
                    // 새 브라우저 세션 시작
                    driver = await new Builder()
                        .forBrowser('chrome')
                        .setChromeOptions(options)
                        .build();
                        
                    // 오류 후 잠시 대기
                    await driver.sleep(2000);
                }
            }
            
            return {
                success: capturedCount > 0,
                capturedCount,
                totalCategories: Object.keys(CATEGORY_CODES).length,
                errors: errors.length > 0 ? errors : null
            };
            
        } catch (error) {
            console.error('캡처 프로세스 오류:', error.message);
            return {
                success: false,
                error: error.message,
                capturedCount,
                totalCategories: Object.keys(CATEGORY_CODES).length,
                errors
            };
            
        } finally {
            if (driver) {
                try {
                    await driver.quit();
                    console.log('브라우저가 정상적으로 종료되었습니다.');
                } catch (closeError) {
                    console.error('브라우저 종료 중 오류:', closeError.message);
                }
            }
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
            break;
        }
        
        retryCount++;
        if (retryCount < maxRetries) {
            console.log(`캡처 실패, ${retryCount + 1}번째 재시도 준비 중... (5초 대기)`);
            console.log('실패 원인:', result.error);
            await new Promise(resolve => setTimeout(resolve, 5000));
        } else {
            console.log('최대 재시도 횟수 초과, 캡처 작업을 중단합니다.');
            console.log('최종 실패 원인:', result.error);
        }
    }
}

async function captureFullPageWithSelenium(driver, filePath) {
    // 전체 페이지 높이와 가로폭으로 창 크기 조정
    const totalHeight = await driver.executeScript('return document.body.scrollHeight');
    const viewportWidth = await driver.executeScript('return document.body.scrollWidth');
    await driver.manage().window().setRect({ width: viewportWidth, height: totalHeight });
    await driver.sleep(1000); // 렌더링 대기
    
    // 한 번에 전체 페이지 캡처
    const screenshot = await driver.takeScreenshot();
    const sharpBuffer = await sharp(Buffer.from(screenshot, 'base64'))
        .resize({ width: 2500, height: 8000, fit: 'inside' }) // 해상도 증가
        .jpeg({ quality: 100 }) // 화질 증가
        .toBuffer();
    
    // 파일 시스템에 저장
    await fs.promises.writeFile(filePath, sharpBuffer);
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



app.get('/api/search', (req, res) => {
    try {
        const { keyword, startDate, endDate } = req.query;

        if (!keyword || !startDate) {
            return res.status(400).json({
                success: false,
                error: '검색어와 시작 날짜를 입력해주세요.'
            });
        }

        const lowerKeyword = keyword.toLowerCase();

        // 날짜 필터 + 검색 한번에 처리
        const matchingResults = [];

        // 모든 카테고리 순회
        Object.values(productCache.data).forEach(categoryItems => {
            categoryItems.forEach(item => {
                if (!item.date) return;

                // 날짜 필터
                const inDateRange =
                    (!startDate && !endDate) ||
                    (startDate && !endDate && item.date === startDate) ||
                    (!startDate && endDate && item.date === endDate) ||
                    (startDate && endDate && item.date >= startDate && item.date <= endDate);

                if (!inDateRange) return;

                // 키워드 포함 여부 (brand + name 전부 검사)
                const text = `${item.brand || ''} ${item.name || ''}`.toLowerCase();
                if (text.includes(lowerKeyword)) {
                    matchingResults.push(item);
                }
            });
        });

        // 정렬: 최신 날짜 > 최신 시간 > 낮은 순위
        matchingResults.sort((a, b) => {
            if (a.date !== b.date) return b.date.localeCompare(a.date);
            if (a.time && b.time) return b.time.localeCompare(a.time);
            return a.rank - b.rank;
        });

        return res.json({
            success: true,
            keyword,
            total: matchingResults.length,
            data: matchingResults
        });

    } catch (error) {
        console.error('검색 오류:', error);
        return res.status(500).json({
            success: false,
            error: '검색 중 오류 발생',
            details: error.message
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
    try {
        console.log('캡처 목록 요청');
        console.log('캡처 디렉토리:', capturesDir);
        
        // 파일 시스템에서 캡처 정보 읽기
        let captures = [];
        if (fs.existsSync(capturesDir)) {
            const files = fs.readdirSync(capturesDir);
            console.log('발견된 파일 수:', files.length);
            
            captures = files
                .filter(file => file.endsWith('.jpeg'))
                .map(fileName => {
                    const match = fileName.match(/ranking_(.+)_(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2})/);
                    if (!match) {
                        console.log('파일명 매치 실패:', fileName);
                        return null;
                    }
                    
                    const [, category, date, time] = match;
                    const filePath = path.join(capturesDir, fileName);
                    
                    try {
                        const stats = fs.statSync(filePath);
                        return {
                            id: path.parse(fileName).name,
                            fileName,
                            category,
                            date,
                            time: time.replace('-', ':'),
                            timestamp: stats.mtime.getTime(),
                            imageUrl: `/captures/${fileName}`,
                            fileSize: stats.size,
                            fullDateTime: `${date} ${time.replace('-', ':')}` // 전체 날짜시간 추가
                        };
                    } catch (err) {
                        console.error('파일 정보 읽기 실패:', fileName, err);
                        return null;
                    }
                })
                .filter(capture => capture !== null);
        } else {
            console.log('캡처 디렉토리가 존재하지 않음');
        }

        // 날짜와 시간 기준으로 내림차순 정렬 (최신순)
        captures.sort((a, b) => {
            // 전체 날짜시간으로 정렬
            return b.fullDateTime.localeCompare(a.fullDateTime);
        });
        
        const response = {
            success: true,
            data: captures,
            total: captures.length,
            lastUpdated: new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
        };
        
        console.log('응답 데이터:', {
            total: response.total,
            lastUpdated: response.lastUpdated
        });
        
        res.json(response);
    } catch (error) {
        log(`캡처 목록 조회 오류: ${error.message}`, 'error');
        res.status(500).json({
            success: false,
            error: '캡처 목록 조회 중 오류가 발생했습니다.',
            details: error.message
        });
    }
});



// 에러 처리 미들웨어
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: err.message,
        domain: 'hwaseon-olive.com'
    });
});


// 서버 종료 시 랭킹 데이터 저장
function saveRankingOnExit() {
    try {
        fs.writeFileSync(RANKING_DATA_PATH, JSON.stringify(productCache, null, 2));
        console.log('서버 종료 - 랭킹 데이터 저장 완료:', RANKING_DATA_PATH);
    } catch (e) {
        console.error('서버 종료 - 랭킹 데이터 저장 실패:', e);
    }
}
process.on('SIGINT', () => { saveRankingOnExit(); process.exit(); });
process.on('SIGTERM', () => { saveRankingOnExit(); process.exit(); });

app.listen(port, () => {
    log('서버 시작');
    console.log(`Server running at http://localhost:${port}`);
    
    // 서버 시작 시 바로 크롤링 실행
    log('서버 시작 - 초기 크롤링 실행');
    crawlAllCategories().catch(error => {
        log(`초기 크롤링 실패: ${error.message}`, 'error');
    });

    // 3시간 단위 자동 크롤링 스케줄링
    log('3시간 단위 자동 크롤링 스케줄링을 시작합니다...');
    scheduleNextCrawl();
});