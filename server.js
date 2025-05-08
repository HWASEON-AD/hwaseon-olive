// 환경변수 설정
require('dotenv').config();

// 환경변수 로드 테스트
console.log('=== 환경변수 로드 테스트 ===');
console.log('DROPBOX_TOKEN:', process.env.DROPBOX_TOKEN ? '설정됨' : '설정되지 않음');
console.log('DROPBOX_REFRESH_TOKEN:', process.env.DROPBOX_REFRESH_TOKEN ? '설정됨' : '설정되지 않음');
console.log('DROPBOX_CLIENT_ID:', process.env.DROPBOX_CLIENT_ID ? '설정됨' : '설정되지 않음');
console.log('DROPBOX_CLIENT_SECRET:', process.env.DROPBOX_CLIENT_SECRET ? '설정됨' : '설정되지 않음');
console.log('========================');

const express = require('express');
const puppeteer = require('puppeteer');
const sqlite3 = require('sqlite3')
const cors = require('cors');
const path = require('path');
const cron = require('node-cron');
const ExcelJS = require('exceljs');
const fs = require('fs');
const compression = require('compression');
const app = express();
const port = process.env.PORT || 5001;
const tmpCachePath = '/tmp/puppeteer';
process.env.PUPPETEER_CACHE_DIR = tmpCachePath;


if (!fs.existsSync(tmpCachePath)) {
    fs.mkdirSync(tmpCachePath, { recursive: true });
    console.log(`✅ Puppeteer 캐시 경로 생성됨: ${tmpCachePath}`);
}


// Dropbox 모듈 추가
const { Dropbox } = require('dropbox');

const axios = require('axios');
const { promisify } = require('util');

// 설정 및 환경 변수
const DB_MAIN_FILE = 'rankings.db';
const DB_BACKUP_DIR = path.join(__dirname, 'backups');
const DROPBOX_CAPTURES_PATH = '/olive_rankings/captures';

// Render 배포 감지 및 환경 설정
const IS_RENDER = process.env.RENDER === 'true';
const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;

// Puppeteer 캐시 디렉토리 설정 및 생성
let puppeteerCacheDir;
if (IS_RENDER) {
    puppeteerCacheDir = '/opt/render/.cache/puppeteer';
} else {
    puppeteerCacheDir = path.join(__dirname, '.cache', 'puppeteer');
}
process.env.PUPPETEER_CACHE_DIR = puppeteerCacheDir;
if (!fs.existsSync(puppeteerCacheDir)) {
    fs.mkdirSync(puppeteerCacheDir, { recursive: true });
    console.log(`🚀 Created Puppeteer cache directory: ${puppeteerCacheDir}`);
}

// Render 환경 정보 로깅
if (IS_RENDER) {
    console.log('🚀 Render 환경에서 실행 중입니다.');
    console.log(`🌐 외부 URL: ${RENDER_EXTERNAL_URL || '설정되지 않음'}`);
}

// Enable GZIP compression
app.use(compression());
app.use(cors());
app.use(express.json());
// Serve static files with 1-day cache
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1d' }));


app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'olive.html'));
});

app.get('/ping', (req, res) => {
    res.send('pong');
});

// 백업 디렉토리 생성
if (!fs.existsSync(DB_BACKUP_DIR)) {
    fs.mkdirSync(DB_BACKUP_DIR, { recursive: true });
}

// Dropbox 클라이언트 초기화
let dropboxClient = null;
if (process.env.DROPBOX_TOKEN) {
    try {
        dropboxClient = new Dropbox({
            accessToken: process.env.DROPBOX_TOKEN
        });
        console.log('✅ Dropbox 클라이언트가 초기화되었습니다.');
    } catch (error) {
        console.error('❌ Dropbox 클라이언트 초기화 실패:', error.message);
    }
} else {
    console.warn('⚠️ Dropbox 액세스 토큰이 없습니다. Dropbox 백업이 비활성화됩니다.');
}

// Dropbox 폴더 초기화 (캡처 및 백업 경로)
if (dropboxClient) {
    [DROPBOX_CAPTURES_PATH, '/olive_rankings/backup'].forEach(folder => {
        dropboxClient.filesCreateFolderV2({ path: folder, autorename: false })
        .then(() => console.log(`✅ Dropbox 폴더 생성 완료: ${folder}`))
        .catch(err => {
            // 이미 존재하는 폴더(409 Conflict)인 경우 무시
            if (err.status === 409 || (err.error_summary && err.error_summary.startsWith('path/conflict/folder'))) {
                console.log(`✅ Dropbox 폴더가 이미 존재합니다: ${folder}`);
            } else {
                console.error(`❌ Dropbox 폴더 생성 중 오류 (${folder}):`, err);
            }
        });
    });
}

// 기본 데이터베이스 연결
const db = new sqlite3.Database(DB_MAIN_FILE, (err) => {
    if (err) console.error('DB error:', err.message);
    console.log('Connected to SQLite');
});

// 데이터베이스 쿼리를 Promise로 래핑하는 유틸리티 함수
const dbRun = promisify(db.run.bind(db));
const dbAll = promisify(db.all.bind(db));
const dbGet = promisify(db.get.bind(db));

// rankings 테이블 (기존 구조 유지)
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS rankings (
            date TEXT,
            rank INTEGER,
            brand TEXT,
            product TEXT,
            salePrice TEXT,
            originalPrice TEXT,
            event TEXT,
            category TEXT,
            PRIMARY KEY (date, category, rank)
        );
    `);
});


// update_logs 테이블 생성
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS update_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            updated_at TEXT DEFAULT (datetime('now', 'localtime'))
        );
    `, (err) => {
        if (err) {
            console.error('update_logs 테이블 생성 실패:', err.message);
        } else {
            console.log('update_logs 테이블 생성 완료');
        }
    });
});


db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS captures (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT NOT NULL,
            category TEXT NOT NULL,
            capture_date TEXT NOT NULL,
            dropbox_path TEXT,
            created_at TEXT DEFAULT (datetime('now', 'localtime'))
        );
    `);
});

// captures 테이블 마이그레이션: dropbox_path 컬럼이 없으면 추가
db.all("PRAGMA table_info(captures);", (err, rows) => {
    if (err) {
        console.error("captures 테이블 구조 확인 오류:", err);
        return;
    }
    const columnNames = rows.map(row => row.name);
    if (!columnNames.includes("category")) {
        db.run("ALTER TABLE captures ADD COLUMN category TEXT DEFAULT '';", (err) => {
            if (err) console.error("category 컬럼 추가 실패:", err);
            else console.log("✅ captures 테이블에 category 컬럼이 추가되었습니다.");
        });
    }
    if (!columnNames.includes("capture_date")) {
        db.run("ALTER TABLE captures ADD COLUMN capture_date TEXT DEFAULT '';", (err) => {
            if (err) console.error("capture_date 컬럼 추가 실패:", err);
            else console.log("✅ captures 테이블에 capture_date 컬럼이 추가되었습니다.");
        });
    }
    if (!columnNames.includes("dropbox_path")) {
        db.run("ALTER TABLE captures ADD COLUMN dropbox_path TEXT;", (err) => {
            if (err) console.error("dropbox_path 컬럼 추가 실패:", err);
            else console.log("✅ captures 테이블에 dropbox_path 컬럼이 추가되었습니다.");
        });
    }
});

// 백업 로그 테이블 추가
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS backup_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            backup_file TEXT NOT NULL,
            backup_date TEXT NOT NULL,
            dropbox_path TEXT,
            is_success BOOLEAN DEFAULT 1,
            error_message TEXT,
            created_at TEXT DEFAULT (datetime('now', 'localtime'))
        );
    `);
});


const oliveYoungCategories = {
    스킨케어: '10000010001',
    마스크팩: '10000010009',
    클렌징: '10000010010',
    선케어: '10000010011',
    메이크업: '10000010002',
    네일: '10000010012',
    뷰티소품: '10000010006',
    더모_코스메틱: '10000010008',
    맨즈케어: '10000010007',
    향수_디퓨저: '10000010005',
    헤어케어: '10000010004',
    바디케어: '10000010003',
    건강식품: '10000020001',
    푸드: '10000020002',
    구강용품: '10000020003',
    헬스_건강용품: '10000020005',
    여성_위생용품: '10000020004',
    패션: '10000030007',
    리빙_가전: '10000030005',
    취미_팬시: '10000030006'
};


db.all("PRAGMA table_info(rankings);", (err, rows) => {
    if (err) {
        console.error("테이블 구조 확인 오류:", err);
        return;
    }
    const columnNames = rows.map(row => row.name);

    if (!columnNames.includes("event")) {
        db.run(`ALTER TABLE rankings ADD COLUMN event TEXT;`);
    }
    if (!columnNames.includes("salePrice")) {
        db.run(`ALTER TABLE rankings ADD COLUMN salePrice TEXT;`);
    }
    if (!columnNames.includes("originalPrice")) {
        db.run(`ALTER TABLE rankings ADD COLUMN originalPrice TEXT;`);
    }
});

// 데이터베이스 백업 기능
async function backupDatabase() {
    try {
        const now = new Date();
        const timestamp = now.toISOString().replace(/[:.]/g, '-');
        const backupFileName = `rankings_${timestamp}.db`;
        const backupPath = path.join(DB_BACKUP_DIR, backupFileName);
        
        console.log(`🔄 DB 백업 시작: ${backupFileName}`);
        
        // 기존 DB 파일 복사
        await new Promise((resolve, reject) => {
            const readStream = fs.createReadStream(DB_MAIN_FILE);
            const writeStream = fs.createWriteStream(backupPath);
            
            readStream.on('error', (error) => reject(error));
            writeStream.on('error', (error) => reject(error));
            writeStream.on('finish', () => resolve());
            
            readStream.pipe(writeStream);
        });
        
        console.log(`✅ 로컬 백업 완료: ${backupPath}`);
        
        // 백업 로그 기록
        let dropboxPath = null;
        
        // Dropbox에 업로드
        if (dropboxClient) {
            try {
                const dropboxFilePath = `/olive_rankings/backup/${backupFileName}`;
                const fileContent = fs.readFileSync(backupPath);
                
                const response = await dropboxClient.filesUpload({
                    path: dropboxFilePath,
                    contents: fileContent,
                    mode: {'.tag': 'overwrite'}
                });
                
                console.log(`✅ Dropbox 백업 완료: ${dropboxFilePath}`);
                dropboxPath = dropboxFilePath;
                
            } catch (error) {
                // Handle expired access token
                if (error.error && error.error['.tag'] === 'expired_access_token') {
                    console.error('❌ Dropbox access token expired. Please renew DROPBOX_TOKEN. Disabling Dropbox backups.');
                    dropboxClient = null;
                } else {
                    console.error('❌ Dropbox 백업 실패:', error);
                }
                // 오류 메시지를 로그에 기록
                await dbRun(
                    `INSERT INTO backup_logs (backup_file, backup_date, dropbox_path, is_success, error_message)
                    VALUES (?, ?, ?, ?, ?)`,
                    [backupFileName, now.toISOString(), null, 0, error.message]
                );
                return false;
            }
        }
        
        // 성공 로그 기록
        await dbRun(
            `INSERT INTO backup_logs (backup_file, backup_date, dropbox_path, is_success) 
            VALUES (?, ?, ?, ?)`,
            [backupFileName, now.toISOString(), dropboxPath, 1]
        );
        
        return true;
    } catch (error) {
        console.error('❌ 데이터베이스 백업 과정에서 오류 발생:', error);
        return false;
    }
}

// 크롤링한 데이터를 데이터베이스에 저장하는 함수 - 당일 데이터만 업데이트하도록 수정
async function saveProductsToDB(products, category, date) {
    if (!products || products.length === 0) {
        console.warn(`${category} 카테고리의 데이터가 없습니다.`);
        return;
    }

    // 데이터 정규화
    const normalizedProducts = products.map((item, index) => ({
        category,
        rank: index + 1,
        brand: item.brand || '',
        product: item.product || '',
        salePrice: item.salePrice || '',
        originalPrice: item.originalPrice || '',
        event: item.event || ''
    }));

    try {
        // 트랜잭션 시작
        await dbRun('BEGIN TRANSACTION');

        // 기존 데이터 삭제하지 않고 UPSERT 사용
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO rankings (date, category, rank, brand, product, salePrice, originalPrice, event)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const item of normalizedProducts) {
            await new Promise((resolve, reject) => {
                stmt.run(
                    date,
                    item.category,
                    item.rank,
                    item.brand,
                    item.product,
                    item.salePrice,
                    item.originalPrice,
                    item.event,
                    (err) => {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });
        }

        stmt.finalize();
        await dbRun('COMMIT');
        console.log(`✅ ${category} 데이터 저장 완료`);
    } catch (error) {
        console.error(`❌ ${category} 데이터 저장 실패:`, error);
        await dbRun('ROLLBACK');
        throw error;
    }
}

// 가격 정규화 함수: 모든 줄바꿈, 공백을 제거하고 한 줄로 만드는 함수
function normalizePrice(price) {
    if (!price || price === '-' || price === 'X') return price;
    
    // 숫자와 통화 기호 사이의 줄바꿈이나 공백을 처리하기 위한 정규화 과정
    let normalized = price
        .replace(/\n/g, '') // 모든 줄바꿈 제거
        .replace(/\r/g, '') // 캐리지 리턴 제거
        .replace(/\s+/g, ' ') // 연속된 공백을 단일 공백으로
        .trim(); // 앞뒤 공백 제거
    
    // 숫자 형식 정규화
    normalized = normalized
        .replace(/(\d)\s+(\d)/g, '$1$2') // 숫자 사이 공백 제거
        .replace(/(\d+)\s*원/g, '$1원') // 숫자와 '원' 사이 공백 제거
        .replace(/(\d+),(\d+)원/g, '$1$2원') // 'n,nnn원' 형식 정규화
        .replace(/(\d+),(\d+),(\d+)원/g, '$1$2$3원'); // 'n,nnn,nnn원' 형식 정규화
    
    // 추가적인 가격 패턴 정규화
    if (normalized.match(/^\d+$/)) {
        // 숫자만 있는 경우 '원' 추가
        normalized += '원';
    }
    
    return normalized;
}

// Chrome 바이너리 경로 자동 탐지 함수 추가
const CHROME_CACHE_DIR = process.env.PUPPETEER_CACHE_DIR;
function getChromeBinaryPath() {
    // 1) 프로젝트 로컬 'chromium' 디렉토리 우선 탐색
    try {
        const localRoot = path.join(__dirname, 'chromium');
        if (fs.existsSync(localRoot)) {
            const localVersions = fs.readdirSync(localRoot);
            for (const ver of localVersions) {
                const base = path.join(localRoot, ver);
                const candidate = path.join(base, 'chrome-linux64', 'chrome');
                if (fs.existsSync(candidate)) return candidate;
                const candidate2 = path.join(base, 'chrome');
                if (fs.existsSync(candidate2)) return candidate2;
            }
        }
    } catch (e) {
        console.warn('로컬 chromium 탐지 실패:', e.message);
    }
    // 2) Puppeteer 캐시 디렉토리 탐색
    try {
        const chromeRoot = path.join(CHROME_CACHE_DIR, 'chrome');
        const versions = fs.readdirSync(chromeRoot);
        for (const ver of versions) {
            const base = path.join(chromeRoot, ver);
            const candidate = path.join(base, 'chrome-linux64', 'chrome');
            if (fs.existsSync(candidate)) return candidate;
            const candidate2 = path.join(base, 'chrome');
            if (fs.existsSync(candidate2)) return candidate2;
        }
    } catch (e) {
        console.warn('Puppeteer 캐시 chrome 탐지 실패:', e.message);
    }
    // 3) fallback to Puppeteer default
    return puppeteer.executablePath();
}
// Chrome executable path: prefer environment override, then local cache, then Puppeteer default
const CHROME_PATH = process.env.CHROME_PATH || getChromeBinaryPath();
console.log('▶️ Using Chrome executable:', CHROME_PATH);

// 크롤링 함수
async function crawlOliveYoung(category) {
    let products = [];
    let browser;

    console.log(`${category} 크롤링 중...`);

    try {
        browser = await puppeteer.launch({
            executablePath: CHROME_PATH,
            headless: 'new',
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--disable-extensions',
                '--disable-audio-output',
                '--js-flags=--max-old-space-size=512'
            ],
            timeout: 30000
        });

        const page = await browser.newPage();
        
        // 성능 최적화: 이미지, 스타일시트, 폰트 등 불필요한 리소스 차단
        await page.setRequestInterception(true);
        page.on('request', req => {
            const t = req.resourceType();
            if (['image','font','media','stylesheet'].includes(t)) req.abort();
            else req.continue();
        });
        
        // 브라우저 설정
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.159 Safari/537.36');
        await page.setJavaScriptEnabled(true);
        await page.setExtraHTTPHeaders({ 
            'accept-language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
            'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8'
        });
        
        // 타임아웃 설정 (30초로 단축)
        await page.setDefaultNavigationTimeout(30000);
        await page.setDefaultTimeout(30000);

        const baseUrl = 'https://www.oliveyoung.co.kr/store/main/getBestList.do';
        const categoryCode = oliveYoungCategories[category];
        const url = `${baseUrl}?dispCatNo=900000100100001&fltDispCatNo=${categoryCode}&pageIdx=1&rowsPerPage=100`;

        // URL 로그 제거
        await page.goto(url, {
            waitUntil: 'domcontentloaded', // networkidle0 대신 더 빠른 domcontentloaded 사용
            timeout: 60000
        });
        
        // 페이지 로딩 확인
        try {
            await page.waitForSelector('.prd_info', { timeout: 30000 });
        } catch (err) {
            console.warn(`${category} 상품 목록 로딩 지연: ${err.message}. 계속 진행합니다.`);
        }

        // 상세 로그 제거
        products = await page.evaluate((cat) => {
            const result = [];
            const items = document.querySelectorAll('.prd_info');
            
            if (!items || items.length === 0) {
                return result; // 빈 배열 반환
            }
        
            items.forEach((el, index) => {
                try {
                const brand = el.querySelector('.tx_brand')?.innerText.trim() || '';
                const product = el.querySelector('.tx_name')?.innerText.trim() || '';
                let salePrice = el.querySelector('.prd_price .tx_cur .tx_num')?.innerText.trim() || 'X';
                let originalPrice = el.querySelector('.tx_org .tx_num')?.innerText.trim() || 'X';
        
                    // 줄바꿈 및 공백 정리
                    salePrice = salePrice !== 'X' ? salePrice.replace(/\n/g, '').replace(/\s+/g, ' ').replace('원', '').trim() + '원' : salePrice;
                    originalPrice = originalPrice !== 'X' ? originalPrice.replace(/\n/g, '').replace(/\s+/g, ' ').replace('원', '').trim() + '원' : originalPrice;
        
                if (salePrice === 'X' && originalPrice !== 'X') {
                    salePrice = originalPrice;
                } else if (originalPrice === 'X' && salePrice !== 'X') {
                    originalPrice = salePrice;
                }
        
                const eventFlags = Array.from(el.querySelectorAll('.icon_flag'))
                    .map(flag => flag.textContent.trim())
                    .join(' / ') || 'X';
        
                result.push({
                    rank: index + 1,
                    category: cat,
                    brand,
                    product,
                    salePrice,
                    originalPrice,
                    event: eventFlags
                });
                } catch (error) {
                    console.error(`상품 정보 추출 중 오류(${index+1}번째): ${error.message}`);
                }
            });
            return result;
        }, category);
        
        // 간소화된 로그
        if (products.length === 0) {
            throw new Error(`${category} 상품 데이터를 찾을 수 없습니다.`);
        }
    
        const now = new Date();
        const koreaTime = new Date(now.getTime() + 9 * 60 * 60 * 1000);
        const date = koreaTime.toISOString().split('T')[0];

        // DB 저장 함수 호출로 대체
        await saveProductsToDB(products, category, date);
        console.log(`✅ ${category} 크롤링 성공: ${products.length}개 상품`);
    
    } catch (err) {
        console.error(`❌ ${category} 크롤링 실패:`, err.message);
        // 오류 발생 시 재시도 없이 빈 배열 반환
        return [];
    } finally {
        if (browser) {
            try {
                await browser.close();
            } catch (error) {
                console.error('브라우저 종료 오류:', error.message);
            }
        }
    }
    return products;
}




// 모든 카테고리를 크롤링하는 함수
async function crawlAllCategories() {
    const today = new Date().toISOString().split('T')[0];
    console.log(`📊 ${today} - 모든 카테고리 크롤링 시작`);
    
    const categories = Object.keys(oliveYoungCategories);
    const results = [];
    // 순차 처리: 카테고리별 크롤링
    for (const category of categories) {
        console.log(`🔄 ${category} 크롤링 시작`);
        const res = await crawlOliveYoung(category);
        results.push(res);
        // 서버 부하 완화를 위한 짧은 대기
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    const successCount = results.filter(r => Array.isArray(r) && r.length > 0).length;
    console.log(`✨ ${today} - 모든 카테고리 크롤링 완료: 성공 ${successCount}/${categories.length}`);
    return true;
}



// 모든 카테고리 크롤링 API - 수정
app.get('/api/crawl-all', async (req, res) => {
    console.log('🚀 API 호출: 전체 카테고리 크롤링 시작');
    try {
        await crawlAllCategories();
        res.json({ success: true, message: '모든 카테고리 크롤링이 완료되었습니다.' });
    } catch (error) {
        console.error('❌ API 크롤링 중 오류 발생:', error);
        res.status(500).json({ success: false, error: '크롤링 중 오류가 발생했습니다.' });
    }
});



// 날짜별 랭킹 조회
app.get('/api/rankings', (req, res) => {
    const { category, date } = req.query;
    
    db.all(
        `SELECT 
            date,
            rank,
            brand,
            product,
            salePrice,
            originalPrice,
            event,
            category,
            datetime('now', 'localtime') as crawled_at,
            strftime('%H:%M', 'now', 'localtime') as crawled_at_formatted
        FROM rankings 
        WHERE category = ? AND date = ?
        ORDER BY rank ASC`,
        [category, date],
        (err, rows) => {
            if (err) {
                console.error("DB 에러:", err);
                return res.status(500).json({ error: 'DB 오류' });
            }
            res.json({ rankings: rows });
        }
    );
});



function updateTable(rankings) {
    console.log("업데이트할 랭킹 데이터:", rankings);
    const tbody = document.querySelector('#rankingTable tbody');
    tbody.innerHTML = '';

    if (!Array.isArray(rankings) || rankings.length === 0) {
        const row = document.createElement('tr');
        row.innerHTML = `<td colspan="7">데이터가 없습니다.</td>`;
        tbody.appendChild(row);
        return;
    }

    rankings.forEach(item => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${item.date}</td>
            <td>${item.category}</td>
            <td>${item.rank}</td>
            <td>${item.brand}</td>
            <td>${item.product}</td>
            <td>${item.originalPrice}</td>
            <td>${item.salePrice}</td>
            <td>${item.event}</td>
            
        `;
        tbody.appendChild(row);
    });
}



app.get('/api/search', (req, res) => {
    const { keyword } = req.query;
    if (!keyword) {
        return res.status(400).json({ error: '검색어를 입력해주세요.' });
    }
    db.all(
        `SELECT * FROM rankings WHERE product LIKE ?`,
        [`%${keyword}%`],
        (err, rows) => {
            if (err) {
                console.error("DB 에러:", err);
                return res.status(500).json({ error: 'DB 오류' });
            }
            res.json(rows);
        }
    );
});



app.get('/api/search-range', (req, res) => {
    const { keyword, startDate, endDate } = req.query;

    if (!keyword || !startDate || !endDate) {
        return res.status(400).json({ message: '제품명과 날짜 범위를 모두 선택하세요.' });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    if (isNaN(start) || isNaN(end)) {
        return res.status(400).json({ message: '유효한 날짜를 입력하세요.' });
    }

    const formattedStartDate = start.toISOString().split('T')[0];
    const formattedEndDate = end.toISOString().split('T')[0];

    // 중복 제거 및 데이터 순서 정렬
    db.all(`
        WITH RankedResults AS (
            SELECT 
                date,
                category,
                CAST(rank AS INTEGER) as rank,
                brand,
                product,
                originalPrice,
                salePrice,
                event,
                ROW_NUMBER() OVER (
                    PARTITION BY date, product 
                    ORDER BY 
                        CASE 
                            WHEN category IN (
                                '스킨케어', '마스크팩', '클렌징', '선케어', '메이크업',
                                '네일', '뷰티소품', '더모_코스메틱', '맨즈케어', '향수_디퓨저',
                                '헤어케어', '바디케어', '건강식품', '푸드', '구강용품',
                                '헬스_건강용품', '여성_위생용품', '패션', '리빙_가전', '취미_팬시'
                            ) THEN 0
                            ELSE 1
                        END,
                        CAST(rank AS INTEGER)
                ) as rn
            FROM rankings
            WHERE product LIKE ? 
            AND date BETWEEN ? AND ?
        )
        SELECT 
            date,
            category,
            rank,
            brand,
            product,
            originalPrice,
            salePrice,
            event
        FROM RankedResults
        WHERE rn = 1
        ORDER BY date ASC, CAST(rank AS INTEGER) ASC
    `, [`%${keyword}%`, formattedStartDate, formattedEndDate], (err, rows) => {
        if (err) {
            console.error("서버 오류:", err);
            return res.status(500).json({ error: '서버 오류' });
        }
        res.json(rows);
    });
});



app.get('/api/rankings-range', (req, res) => {
    const { category, startDate, endDate } = req.query;
    console.log('서버에서 받은 카테고리:', category);

    if (!category || !startDate || !endDate) {
        console.log('필수 파라미터 누락:', { category, startDate, endDate });
        return res.status(400).json({ error: '카테고리와 날짜를 모두 선택하세요.' });
    }

    db.all(`
        SELECT date, rank, brand, product, salePrice, originalPrice, event, category
        FROM rankings
        WHERE category = ?
        AND date BETWEEN ? AND ?
        ORDER BY date ASC, rank ASC
    `, [category, startDate, endDate], (err, rows) => {
        if (err) {
            console.error("DB 오류:", err);
            return res.status(500).json({ error: '서버 오류' });
        }
        console.log('DB 쿼리 결과:', rows);
        res.json(rows);
    });
});



app.get('/api/download', (req, res) => {
    const { category, startDate, endDate } = req.query;

    if (!category || !startDate || !endDate) {
        return res.status(400).json({ error: '카테고리와 날짜 범위를 전달해야 합니다.' });
    }

    db.all(
        `SELECT 
            date,
            ? as category,
            CAST(rank AS INTEGER) as rank,
            brand,
            product,
            originalPrice,
            salePrice,
            event
        FROM rankings 
        WHERE category = ? AND date BETWEEN ? AND ?
        ORDER BY date ASC, CAST(rank AS INTEGER) ASC`,
        [category, category, startDate, endDate],
        (err, rows) => {
            if (err) {
                console.error('DB 에러:', err);
                return res.status(500).json({ error: 'DB 오류' });
            }

            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('랭킹 데이터');

            worksheet.columns = [
                { header: '날짜', key: 'date', width: 15 },
                { header: '카테고리', key: 'category', width: 15 },
                { header: '순위', key: 'rank', width: 6 },
                { header: '브랜드', key: 'brand', width: 15 },
                { header: '제품명', key: 'product', width: 60 },
                { header: '소비자가', key: 'originalPrice', width: 20 },
                { header: '판매가', key: 'salePrice', width: 20 },
                { header: '행사', key: 'event', width: 40 }
            ];

            // null 처리 및 데이터 정리
            const processedRows = rows.map(row => ({
                ...row,
                brand: row.brand || '-',
                originalPrice: normalizePrice(row.originalPrice),
                salePrice: normalizePrice(row.salePrice),
                event: row.event || '-'
            }));

            worksheet.addRows(processedRows);

            // 헤더 스타일
            worksheet.getRow(1).eachCell((cell) => {
                cell.font = { bold: true };
                cell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFEEEEEE' }
                };
                cell.alignment = { vertical: 'middle', horizontal: 'center' };
            });

            worksheet.eachRow((row) => {
                row.height = 20;
                row.alignment = { vertical: 'middle', wrapText: true };
            });

            const filename = `ranking_data_${startDate}~${endDate}.xlsx`;
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

            workbook.xlsx.write(res).then(() => {
                res.end();
            });
        }
    );
});



app.get('/api/download-search', (req, res) => {
    const { keyword, startDate, endDate } = req.query;
    if (!keyword || !startDate || !endDate) {
        return res.status(400).json({ error: '검색어와 날짜 범위를 모두 입력해야 합니다.' });
    }
    db.all(
        `WITH RankedResults AS (
            SELECT 
                date,
                category,
                CAST(rank AS INTEGER) as rank,
                brand,
                product,
                originalPrice,
                salePrice,
                event,
                ROW_NUMBER() OVER (
                    PARTITION BY date, product 
                    ORDER BY 
                        CASE 
                            WHEN category IN (
                                '스킨케어', '마스크팩', '클렌징', '선케어', '메이크업',
                                '네일', '뷰티소품', '더모_코스메틱', '맨즈케어', '향수_디퓨저',
                                '헤어케어', '바디케어', '건강식품', '푸드', '구강용품',
                                '헬스_건강용품', '여성_위생용품', '패션', '리빙_가전', '취미_팬시'
                            ) THEN 0
                            ELSE 1
                        END,
                        CAST(rank AS INTEGER)
                ) as rn
            FROM rankings
            WHERE product LIKE ? 
            AND date BETWEEN ? AND ?
        )
        SELECT 
            date,
            category,
            rank,
            brand,
            product,
            originalPrice,
            salePrice,
            event
        FROM RankedResults
        WHERE rn = 1
        ORDER BY date ASC, CAST(rank AS INTEGER) ASC`,
        [`%${keyword}%`, startDate, endDate],
        (err, rows) => {
            if (err) {
                console.error('DB 에러:', err);
                return res.status(500).json({ error: 'DB 오류' });
            }

            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('검색 결과');

            worksheet.columns = [
                { header: '날짜', key: 'date', width: 15 },
                { header: '카테고리', key: 'category', width: 15 },
                { header: '순위', key: 'rank', width: 6 },
                { header: '브랜드', key: 'brand', width: 15 },
                { header: '제품명', key: 'product', width: 60 },
                { header: '소비자가', key: 'originalPrice', width: 20 },
                { header: '판매가', key: 'salePrice', width: 20 },
                { header: '행사', key: 'event', width: 40 }
            ];

            // null 값 처리 및 데이터 정리
            const processedRows = rows.map(row => ({
                ...row,
                category: row.category || '미분류',
                brand: row.brand || '-',
                originalPrice: normalizePrice(row.originalPrice),
                salePrice: normalizePrice(row.salePrice),
                event: row.event || '-'
            }));

            worksheet.addRows(processedRows);

            // 헤더 스타일
            worksheet.getRow(1).eachCell((cell) => {
                cell.font = { bold: true };
                cell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFEEEEEE' }
                };
                cell.alignment = { vertical: 'middle', horizontal: 'center' };
            });

            worksheet.eachRow((row) => {
                row.height = 20;
                row.alignment = { vertical: 'middle', wrapText: true };
            });

            const filename = `product_search_${startDate}~${endDate}.xlsx`;
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

            workbook.xlsx.write(res).then(() => {
                res.end();
            });
        }
    );
});






// 서버 URL 가져오는 함수
const getServerUrl = () => {
    if (IS_RENDER && RENDER_EXTERNAL_URL) {
        return RENDER_EXTERNAL_URL;
    }
    return `http://localhost:${port}`;
};

// 서버 구동 설정 - 수정된 부분
app.listen(port, () => {
    console.log(`📡 서버가 http://localhost:${port} 에서 실행 중입니다.`);
    
    // 슬립 방지 ping 설정
    setupAntiSleepPing();
    
    // 서버 시작 시 모든 카테고리 크롤링 실행
    console.log('🔄 서버 시작 시 자동 크롤링 실행 중...');
    crawlAllCategories().then(() => {
        console.log('✅ 초기 크롤링 완료');
        
        // 크롤링 완료 후 DB 백업 실행
        return backupDatabase();
    }).then((backupResult) => {
        if (backupResult) {
            console.log('✅ 서버 시작 시 DB 백업 완료');
        }
        
        // Dropbox에 업로드되지 않은 캡처 이미지 확인 및 업로드
        if (dropboxClient) {
            return dbAll(`SELECT COUNT(*) as count FROM captures WHERE dropbox_path IS NULL`);
        }
    }).then(result => {
        if (result && result[0] && result[0].count > 0) {
            console.log(`🔄 미업로드 캡처 이미지 ${result[0].count}개 발견. 자동 업로드 시작...`);
            
            // 서버 URL 구성
            const serverUrl = getServerUrl();
            
            // 백그라운드에서 실행 (응답을 기다리지 않음)
            axios.post(`${serverUrl}/api/captures/upload-to-dropbox`)
                .catch(err => console.error('캡처 자동 업로드 요청 실패:', err));
        }
    }).catch(err => {
        console.error('❌ 초기 처리 중 오류:', err);
    });
    
    // 매일 오전 9시에 모든 카테고리 크롤링 스케줄 설정
    cron.schedule('0 9 * * *', async () => {
        console.log('⏰ 예약된 크롤링 작업 시작 - 오전 9시');
        try {
            // 자기 자신 깨우기
            const serverUrl = getServerUrl();
            await axios.get(`${serverUrl}/api/wake-up?run_tasks=true`);
            
            await crawlAllCategories();
            console.log('✅ 예약된 크롤링 작업 완료');
            
            // 크롤링 후 DB 백업
            const backupResult = await backupDatabase();
            if (backupResult) {
                console.log('✅ 예약된 DB 백업 완료');
            }
        } catch (error) {
            console.error('❌ 예약된 작업 중 오류:', error);
        }
    }, {
        timezone: 'Asia/Seoul'
    });
    
    // 매일 밤 12시에 DB 백업 스케줄 설정
    cron.schedule('0 0 * * *', async () => {
        console.log('⏰ 예약된 백업 작업 시작 - 밤 12시');
        try {
            // 자기 자신 깨우기
            const serverUrl = getServerUrl();
            await axios.get(`${serverUrl}/api/wake-up`);
            
            const backupResult = await backupDatabase();
            if (backupResult) {
                console.log('✅ 예약된 DB 백업 완료');
            } else {
                console.error('❌ 백업 실패');
            }
            
            // 미업로드 이미지 확인 및 업로드
            if (dropboxClient) {
                const result = await dbAll(`SELECT COUNT(*) as count FROM captures WHERE dropbox_path IS NULL`);
                if (result[0].count > 0) {
                    console.log(`🔄 미업로드 캡처 이미지 ${result[0].count}개 발견. 자동 업로드 시작...`);
                    
                    // 백그라운드에서 실행
                    axios.post(`${serverUrl}/api/captures/upload-to-dropbox`)
                        .catch(err => console.error('캡처 자동 업로드 요청 실패:', err));
                }
            }
        } catch (error) {
            console.error('❌ 예약된 백업 작업 중 오류:', error);
        }
    }, {
        timezone: 'Asia/Seoul'
    });
    
    // 추가: 서버 활성화 유지를 위한 스케줄 (12시간마다)
    cron.schedule('0 */12 * * *', async () => {
        const serverUrl = getServerUrl();
        console.log(`⏰ 12시간 주기 서버 활성화 확인 중...`);
        
        try {
            await axios.get(`${serverUrl}/ping`);
            console.log('✅ 서버 활성화 확인 완료');
        } catch (error) {
            console.error('❌ 서버 활성화 확인 실패:', error.message);
        }
    }, {
        timezone: 'Asia/Seoul'
    });
});

// 캡처 이미지 저장 디렉토리 생성
const capturesDir = path.join(__dirname, 'public', 'captures');
if (!fs.existsSync(capturesDir)) {
    fs.mkdirSync(capturesDir, { recursive: true });
}

// Dropbox 토큰 갱신 함수
async function refreshDropboxToken() {
    if (!process.env.DROPBOX_REFRESH_TOKEN || !process.env.DROPBOX_CLIENT_ID || !process.env.DROPBOX_CLIENT_SECRET) {
        console.error('❌ Dropbox 토큰 갱신에 필요한 환경변수가 없습니다.');
        return false;
    }

    try {
        const response = await axios.post('https://api.dropbox.com/oauth2/token', null, {
            params: {
                grant_type: 'refresh_token',
                refresh_token: process.env.DROPBOX_REFRESH_TOKEN,
                client_id: process.env.DROPBOX_CLIENT_ID,
                client_secret: process.env.DROPBOX_CLIENT_SECRET
            }
        });

        if (response.data && response.data.access_token) {
            // 새로운 액세스 토큰으로 클라이언트 재초기화
            dropboxClient = new Dropbox({
                accessToken: response.data.access_token,
                refreshToken: process.env.DROPBOX_REFRESH_TOKEN,
                clientId: process.env.DROPBOX_CLIENT_ID,
                clientSecret: process.env.DROPBOX_CLIENT_SECRET
            });
            console.log('✅ Dropbox 토큰이 갱신되었습니다.');
            return true;
        }
    } catch (error) {
        console.error('❌ Dropbox 토큰 갱신 실패:', error.message);
        return false;
    }
    return false;
}

// Dropbox API 호출 전 토큰 확인 및 갱신
async function ensureValidDropboxToken() {
    if (!dropboxClient) return false;
    
    try {
        // 간단한 API 호출로 토큰 유효성 테스트
        await dropboxClient.filesListFolder({ path: '' });
        return true;
    } catch (error) {
        if (error.status === 401) {
            // 토큰이 만료된 경우 갱신 시도
            return await refreshDropboxToken();
        }
        throw error;
    }
}

// uploadImageToDropbox 함수 수정
async function uploadImageToDropbox(localFilePath, fileName, category) {
    if (!dropboxClient) {
        console.warn('⚠️ Dropbox 클라이언트가 초기화되지 않았습니다. 이미지 업로드를 건너뜁니다.');
        return null;
    }
    
    try {
        // 토큰 유효성 확인 및 갱신
        await ensureValidDropboxToken();
        
        // 현재 날짜 기반 경로 생성 (YYYY-MM 형식)
        const now = new Date();
        const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        
        // Dropbox 경로 생성: /olive_rankings/captures/YYYY-MM/카테고리/파일명
        const dropboxFilePath = `${DROPBOX_CAPTURES_PATH}/${yearMonth}/${category}/${fileName}`;
        
        console.log(`🔄 Dropbox에 이미지 업로드 중: ${dropboxFilePath}`);
        
        // 파일 읽기
        const fileContent = fs.readFileSync(localFilePath);
        
        // Dropbox에 업로드
        const response = await dropboxClient.filesUpload({
            path: dropboxFilePath,
            contents: fileContent,
            mode: {'.tag': 'overwrite'}
        });
        
        console.log(`✅ Dropbox 이미지 업로드 완료: ${dropboxFilePath}`);
        return dropboxFilePath;
    } catch (error) {
        console.error('❌ Dropbox 이미지 업로드 실패:', error.message);
        return null;
    }
}

// 캡처 API
app.post('/api/capture', async (req, res) => {
    const { html, category, date } = req.body;
    if (!html || !category || !date) {
        return res.status(400).json({ error: '필수 데이터가 누락되었습니다.' });
    }

    try {
        const browser = await puppeteer.launch({
            executablePath: CHROME_PATH,
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        
        // HTML 컨텐츠 설정
        await page.setContent(html);
        await page.addStyleTag({
            content: `
                body { 
                    background: white;
                    padding: 20px;
                }
                table {
                    width: 100%;
                    border-collapse: collapse;
                }
                th, td {
                    border: 1px solid #ddd;
                    padding: 8px;
                    text-align: left;
                }
                th {
                    background-color: #f5f5f5;
                }
            `
        });

        // 페이지의 실제 높이 계산
        const bodyHandle = await page.$('body');
        const { height } = await bodyHandle.boundingBox();
        await bodyHandle.dispose();

        // 뷰포트 크기 설정
        await page.setViewport({
            width: 1200,
            height: Math.ceil(height)
        });

        // 스크린샷 찍기
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `capture_${category}_${date}_${timestamp}.png`;
        const filepath = path.join(capturesDir, filename);
        
        await page.screenshot({
            path: filepath,
            fullPage: true
        });

        await browser.close();

        // Dropbox에 이미지 업로드
        let dropboxPath = null;
        if (dropboxClient) {
            dropboxPath = await uploadImageToDropbox(filepath, filename, category);
        }

        // DB에 캡처 정보 저장 (이제 Dropbox 경로도 포함)
        await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO captures (filename, category, capture_date, dropbox_path, created_at) 
                VALUES (?, ?, ?, ?, datetime('now', 'localtime'))`,
                [filename, category, date, dropboxPath],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });

        res.json({ 
            success: true, 
            filename,
            url: `/captures/${filename}`,
            dropbox_path: dropboxPath
        });

    } catch (error) {
        console.error('캡처 중 오류:', error);
        res.status(500).json({ error: '캡처 생성 중 오류가 발생했습니다.' });
    }
});

// 기존 캡처 이미지를 Dropbox에 업로드하는 API 추가
app.post('/api/captures/upload-to-dropbox', async (req, res) => {
    if (!dropboxClient) {
        return res.status(400).json({ 
            success: false, 
            error: 'Dropbox 클라이언트가 구성되지 않았습니다.' 
        });
    }
    
    try {
        // Dropbox에 업로드되지 않은 캡처 이미지 조회
        const captures = await dbAll(`
            SELECT id, filename, category, capture_date
            FROM captures
            WHERE dropbox_path IS NULL
        `);
        
        if (captures.length === 0) {
            return res.json({
                success: true,
                message: 'Dropbox에 업로드할 이미지가 없습니다.',
                uploaded: 0
            });
        }
        
        let successCount = 0;
        
        // 각 이미지를 Dropbox에 업로드
        for (const capture of captures) {
            const localFilePath = path.join(capturesDir, capture.filename);
            
            // 파일이 존재하는지 확인
            if (!fs.existsSync(localFilePath)) {
                console.warn(`파일을 찾을 수 없습니다: ${localFilePath}`);
                continue;
            }
            
            // Dropbox에 업로드
            const dropboxPath = await uploadImageToDropbox(
                localFilePath, 
                capture.filename, 
                capture.category
            );
            
            if (dropboxPath) {
                // DB 업데이트
                await dbRun(
                    `UPDATE captures SET dropbox_path = ? WHERE id = ?`,
                    [dropboxPath, capture.id]
                );
                successCount++;
            }
        }
        
        res.json({
            success: true,
            message: `${successCount}/${captures.length} 개의 이미지가 Dropbox에 업로드되었습니다.`,
            uploaded: successCount,
            total: captures.length
        });
        
    } catch (error) {
        console.error('❌ 기존 캡처 업로드 중 오류:', error);
        res.status(500).json({
            success: false,
            error: `캡처 업로드 중 오류가 발생했습니다: ${error.message}`
        });
    }
});

// DB 상태 확인 API
app.get('/api/status', (req, res) => {
    try {
        // 서버 상태 정보
        const serverInfo = {
            status: 'running',
            uptime: process.uptime() + ' seconds',
            timestamp: new Date().toISOString()
        };
        
        // DB 테이블 정보 조회
        db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, tables) => {
            if (err) {
                return res.status(500).json({
                    ...serverInfo,
                    db_status: 'error',
                    error: err.message
                });
            }
            
            // DB의 rankings 테이블 레코드 수
            db.get("SELECT COUNT(*) as count FROM rankings", (err, countResult) => {
                if (err) {
                    return res.status(500).json({
                        ...serverInfo,
                        db_status: 'error',
                        tables,
                        error: err.message
                    });
                }
                
                // 최신 업데이트 시간 정보
                db.get("SELECT updated_at FROM update_logs ORDER BY updated_at DESC LIMIT 1", (err, updateLog) => {
                    // 응답 데이터 준비
                    const responseData = {
                        ...serverInfo,
                        db_status: 'connected',
                        tables: tables.map(t => t.name),
                        rankings_count: countResult ? countResult.count : 0,
                    };
                    
                    res.json(responseData);
                });
            });
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            error: error.message
        });
    }
});

// 백업 관리 API 추가
app.get('/api/backups', async (req, res) => {
    try {
        const logs = await dbAll(
            `SELECT * FROM backup_logs ORDER BY created_at DESC LIMIT 100`
        );
        
        res.json({
            success: true,
            backups: logs
        });
    } catch (error) {
        console.error('백업 로그 조회 오류:', error);
        res.status(500).json({
            success: false,
            error: '백업 정보를 조회하는 중 오류가 발생했습니다.'
        });
    }
});

// 수동 백업 API 추가
app.post('/api/backup', async (req, res) => {
    try {
        const result = await backupDatabase();
        if (result) {
            res.json({
                success: true,
                message: '데이터베이스 백업이 성공적으로 완료되었습니다.'
            });
        } else {
            res.status(500).json({
                success: false,
                error: '백업 처리 중 오류가 발생했습니다.'
            });
        }
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Dropbox에서 최신 백업 복원 API
app.post('/api/restore', async (req, res) => {
    if (!dropboxClient) {
        return res.status(400).json({
            success: false,
            error: 'Dropbox 클라이언트가 구성되지 않았습니다.'
        });
    }
    
    try {
        // 복원 전에 현재 DB 백업
        const tempBackupPath = path.join(DB_BACKUP_DIR, `pre_restore_${Date.now()}.db`);
        fs.copyFileSync(DB_MAIN_FILE, tempBackupPath);
        
        // Dropbox에서 최신 백업 파일 목록 가져오기
        const { result } = await dropboxClient.filesListFolder({
            path: '/olive_rankings/backup'
        });
        
        if (!result.entries || result.entries.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Dropbox에 백업 파일이 없습니다.'
            });
        }
        
        // 파일명으로 정렬하여 최신 백업 찾기 (rankings_날짜-시간.db 형식)
        const backupFiles = result.entries
            .filter(entry => entry.name.startsWith('rankings_') && entry.name.endsWith('.db'))
            .sort((a, b) => b.name.localeCompare(a.name));
        
        if (backupFiles.length === 0) {
            return res.status(404).json({
                success: false,
                error: '유효한 백업 파일을 찾을 수 없습니다.'
            });
        }
        
        const latestBackup = backupFiles[0];
        console.log(`🔄 최신 백업 파일에서 복원 중: ${latestBackup.name}`);
        
        // 임시 파일로 다운로드
        const tempPath = path.join(DB_BACKUP_DIR, `temp_${Date.now()}.db`);
        const downloadResponse = await dropboxClient.filesDownload({
            path: latestBackup.path_lower
        });
        
        fs.writeFileSync(tempPath, downloadResponse.result.fileBinary);
        
        // DB 연결 종료 (복원을 위해)
        await new Promise(resolve => {
            db.close(err => {
                if (err) console.error('DB 연결 종료 중 오류:', err);
                resolve();
            });
        });
        
        // 다운로드한 파일을 메인 DB 파일로 복사
        fs.copyFileSync(tempPath, DB_MAIN_FILE);
        
        // 임시 파일 삭제
        fs.unlinkSync(tempPath);
        
        // DB 다시 연결
        const newDb = new sqlite3.Database(DB_MAIN_FILE, err => {
            if (err) {
                console.error('DB 재연결 오류:', err);
                return res.status(500).json({
                    success: false,
                    error: '데이터베이스 재연결 중 오류가 발생했습니다.'
                });
            }
            
            // 전역 DB 객체 교체
            global.db = newDb;
            
            res.json({
                success: true,
                message: `백업 파일 '${latestBackup.name}'에서 성공적으로 복원되었습니다.`,
                backup: latestBackup
            });
        });
    } catch (error) {
        console.error('복원 중 오류:', error);
        res.status(500).json({
            success: false,
            error: `복원 중 오류가 발생했습니다: ${error.message}`
        });
    }
});

// 캡처 목록 조회 API
app.get('/api/captures', (req, res) => {
    const { category, startDate, endDate } = req.query;
    let query = `SELECT * FROM captures`;
    const params = [];

    if (category || (startDate && endDate)) {
        query += ` WHERE 1=1`;
        if (category) {
            query += ` AND category = ?`;
            params.push(category);
        }
        if (startDate && endDate) {
            query += ` AND capture_date BETWEEN ? AND ?`;
            params.push(startDate, endDate);
        }
    }

    query += ` ORDER BY created_at DESC`;

    db.all(query, params, (err, rows) => {
        if (err) {
            console.error('캡처 목록 조회 오류:', err);
            return res.status(500).json({ error: 'DB 오류' });
        }
        res.json(rows);
    });
});

// Render 서버 슬립 방지를 위한 자동 핑 설정 (5분마다)
const setupAntiSleepPing = () => {
    const PING_INTERVAL = 5 * 60 * 1000; // 5분
    
    setInterval(async () => {
        const serverUrl = getServerUrl();
        try {
            console.log(`🔄 서버 슬립 방지 ping 실행... (${new Date().toISOString()})`);
            const response = await axios.get(`${serverUrl}/ping`);
            console.log(`✅ Ping 성공: ${response?.data || 'OK'}`);
        } catch (error) {
            console.error(`❌ Ping 실패 (${serverUrl}/ping):`, error.message);
        }
    }, PING_INTERVAL);
    
    console.log(`⏰ 서버 슬립 방지 기능 활성화: ${PING_INTERVAL/1000}초 간격`);
};



// 서버 시작 시 cron 작업에서 외부 핑 요청을 받도록 설정
app.get('/api/wake-up', async (req, res) => {
    const timestamp = new Date().toISOString();
    console.log(`🔔 Wake-up 요청 받음: ${timestamp}`);
    
    try {
        // 서버 상태 정보 수집
        const serverStatus = {
            timestamp,
            uptime: process.uptime() + '초',
            memory: process.memoryUsage()
        };
        
        // 핑 후 상태 반환
        res.json({
            success: true,
            message: '서버가 활성화되었습니다.',
            status: serverStatus
        });
        
        // 서버가 깨어났을 때 자동으로 크롤링 등 필요한 작업 수행
        if (req.query.run_tasks === 'true') {
            console.log('🔄 Wake-up 요청으로 인한 자동 작업 수행 중...');
            // 필요한 경우 크롤링 등 실행 (백그라운드로)
            setTimeout(() => {
                backupDatabase().catch(err => console.error('자동 백업 오류:', err));
            }, 5000);
        }
    } catch (error) {
        console.error('Wake-up 처리 중 오류:', error);
        res.status(500).json({
            success: false,
            error: '서버 상태 확인 중 오류가 발생했습니다.'
        });
    }
});

// Dropbox 백업 파일 목록 조회 API
app.get('/api/backup-files', async (req, res) => {
    if (!dropboxClient) {
        return res.status(400).json({
            success: false,
            error: 'Dropbox 클라이언트가 구성되지 않았습니다.'
        });
    }
    
    try {
        const { result } = await dropboxClient.filesListFolder({
            path: '/olive_rankings/backup'
        });
        
        // 파일명으로 정렬하여 최신 백업 찾기 (rankings_날짜-시간.db 형식)
        const backupFiles = result.entries
            .filter(entry => entry.name.startsWith('rankings_') && entry.name.endsWith('.db'))
            .sort((a, b) => b.name.localeCompare(a.name));
        
        res.json({
            success: true,
            files: backupFiles
        });
    } catch (error) {
        console.error('백업 파일 목록 조회 오류:', error);
        res.status(500).json({
            success: false,
            error: '백업 파일 목록을 조회하는 중 오류가 발생했습니다.'
        });
    }
});

// 특정 백업 파일 복원 API
app.post('/api/restore-backup', async (req, res) => {
    const { filePath } = req.body;
    
    if (!dropboxClient) {
        return res.status(400).json({
            success: false,
            error: 'Dropbox 클라이언트가 구성되지 않았습니다.'
        });
    }
    
    if (!filePath) {
        return res.status(400).json({
            success: false,
            error: '복원할 백업 파일 경로를 지정해주세요.'
        });
    }
    
    try {
        // 복원 전에 현재 DB 백업
        const tempBackupPath = path.join(DB_BACKUP_DIR, `pre_restore_${Date.now()}.db`);
        fs.copyFileSync(DB_MAIN_FILE, tempBackupPath);
        
        // Dropbox에서 백업 파일 다운로드
        const downloadResponse = await dropboxClient.filesDownload({
            path: filePath
        });
        
        // 임시 파일로 저장
        const tempPath = path.join(DB_BACKUP_DIR, `temp_${Date.now()}.db`);
        fs.writeFileSync(tempPath, downloadResponse.result.fileBinary);
        
        // DB 연결 종료
        await new Promise(resolve => {
            db.close(err => {
                if (err) console.error('DB 연결 종료 중 오류:', err);
                resolve();
            });
        });
        
        // 다운로드한 파일을 메인 DB 파일로 복사
        fs.copyFileSync(tempPath, DB_MAIN_FILE);
        
        // 임시 파일 삭제
        fs.unlinkSync(tempPath);
        
        // DB 다시 연결
        const newDb = new sqlite3.Database(DB_MAIN_FILE, err => {
            if (err) {
                console.error('DB 재연결 오류:', err);
                return res.status(500).json({
                    success: false,
                    error: '데이터베이스 재연결 중 오류가 발생했습니다.'
                });
            }
            
            // 전역 DB 객체 교체
            global.db = newDb;
            
            res.json({
                success: true,
                message: `백업 파일 '${filePath}'에서 성공적으로 복원되었습니다.`
            });
        });
    } catch (error) {
        console.error('복원 중 오류:', error);
        res.status(500).json({
            success: false,
            error: `복원 중 오류가 발생했습니다: ${error.message}`
        });
    }
});

// 크롤링 업데이트 시간 조회 API
app.get('/api/last-update', (req, res) => {
    db.get(
        `SELECT updated_at FROM update_logs ORDER BY updated_at DESC LIMIT 1`,
        (err, row) => {
            if (err) {
                console.error('업데이트 시간 조회 오류:', err);
                return res.status(500).json({
                    success: false,
                    error: '업데이트 시간을 조회하는 중 오류가 발생했습니다.'
                });
            }
            
            res.json({
                success: true,
                lastUpdate: row ? row.updated_at : null
            });
        }
    );
});