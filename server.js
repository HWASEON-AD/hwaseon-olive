const express = require('express');
const puppeteer = require('puppeteer');
const sqlite3 = require('sqlite3')
const cors = require('cors');
const path = require('path');
const cron = require('node-cron');
const ExcelJS = require('exceljs');
const fs = require('fs');
process.env.PUPPETEER_CACHE_DIR = '/opt/render/.cache/puppeteer';

const app = express();
const port = 5001;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));


app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'olive.html'));
});

app.get('/ping', (req, res) => {
    res.send('pong');
});


const db = new sqlite3.Database('rankings.db', (err) => {
    if (err) console.error('DB error:', err.message);
    console.log('Connected to SQLite');
});


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


// update_logs 테이블 (최종 업데이트 기록용 - 따로)
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



// 크롤링 함수
async function crawlOliveYoung(category) {
    let products = [];
    let browser;

    console.log(`크롤링 시작: ${category}`);

    try {
        browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 ...');
        await page.setJavaScriptEnabled(true);
        await page.setExtraHTTPHeaders({ 'accept-language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7' });

        const baseUrl = 'https://www.oliveyoung.co.kr/store/main/getBestList.do';
        const categoryCode = oliveYoungCategories[category];
        const url = `${baseUrl}?dispCatNo=900000100100001&fltDispCatNo=${categoryCode}&pageIdx=1&rowsPerPage=100`;

        await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });

        products = await page.evaluate((cat) => {
            const result = [];
            const items = document.querySelectorAll('.prd_info');
        
            items.forEach((el, index) => {
                const brand = el.querySelector('.tx_brand')?.innerText.trim() || '';
                const product = el.querySelector('.tx_name')?.innerText.trim() || '';
                let salePrice = el.querySelector('.prd_price .tx_cur .tx_num')?.innerText.trim() || 'X';
                let originalPrice = el.querySelector('.tx_org .tx_num')?.innerText.trim() || 'X';
        
                salePrice = salePrice !== 'X' ? salePrice.replace('원', '').trim() + '원' : salePrice;
                originalPrice = originalPrice !== 'X' ? originalPrice.replace('원', '').trim() + '원' : originalPrice;
        
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
            });
            return result;
        }, category);
        
    
        const now = new Date();
        const koreaTime = new Date(now.getTime() + 9 * 60 * 60 * 1000);
        const date = koreaTime.toISOString().split('T')[0];


        // 오늘 날짜 + 해당 카테고리 데이터 삭제
        await new Promise((resolve, reject) => {
            db.run(`DELETE FROM rankings WHERE date = ? AND category = ?`, [date, category], (err) => {
                if (err) {
                    console.error('오늘자 데이터 삭제 실패:', err.message);
                    reject(err);
                } else {
                    resolve();
                }
            });
        });

        // 크롤링한 데이터를 삽입
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO rankings (date, category, rank, brand, product, salePrice, originalPrice, event)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        products.forEach(item => {
            stmt.run(
                date,
                item.category,
                item.rank,
                item.brand,
                item.product,
                item.salePrice,
                item.originalPrice,
                item.event
            );
        });

        stmt.finalize();

        // 최종 업데이트 시간 기록
        await new Promise((resolve, reject) => {
            db.run(`INSERT INTO update_logs (updated_at) VALUES (datetime('now', 'localtime'))`, (err) => {
                if (err) {
                    console.error('업데이트 기록 실패:', err.message);
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
        console.log(`${category} 크롤링 완료`);
    } catch (err) {
        console.error(`${category} 크롤링 실패:`, err.message);
        return [];
    } finally {
        if (browser) await browser.close();
    }

    return products;
}



// 카테고리별 크롤링 API
app.get('/api/crawl', async (req, res) => {
    const { category } = req.query;
    if (!category || !oliveYoungCategories[category]) {
        return res.status(400).json({ error: '잘못된 카테고리' });
    }
    const data = await crawlOliveYoung(category);
    res.json(data);
});



// 날짜별 랭킹 조회
app.get('/api/rankings', (req, res) => {
    const { category, date } = req.query;
    db.all(
        `SELECT date, rank, brand, product, salePrice, originalPrice, event, category FROM rankings WHERE category = ? AND date = ? ORDER BY rank ASC`,
        [category, date],
        (err, rows) => {
            if (err) {
                console.error("DB 에러:", err);
                return res.status(500).json({ error: 'DB 오류' });
            }
            res.json(rows);
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
                { header: '소비자가', key: 'originalPrice', width: 12 },
                { header: '판매가', key: 'salePrice', width: 12 },
                { header: '행사', key: 'event', width: 40 }
            ];

            // null 처리 및 데이터 정리
            const processedRows = rows.map(row => ({
                ...row,
                brand: row.brand || '-',
                originalPrice: row.originalPrice || '-',
                salePrice: row.salePrice || '-',
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
                { header: '소비자가', key: 'originalPrice', width: 12 },
                { header: '판매가', key: 'salePrice', width: 12 },
                { header: '행사', key: 'event', width: 40 }
            ];

            // null 값 처리 및 데이터 정리
            const processedRows = rows.map(row => ({
                ...row,
                category: row.category || '미분류',
                brand: row.brand || '-',
                originalPrice: row.originalPrice || '-',
                salePrice: row.salePrice || '-',
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



app.get('/api/last-updated', (req, res) => {
    db.get(`SELECT updated_at FROM update_logs ORDER BY updated_at DESC LIMIT 1`, (err, row) => {
        if (err) {
            console.error("최신 업데이트 시간 조회 오류:", err);
            return res.status(500).json({ error: 'DB 오류' });
        }
        if (!row) {
            return res.status(404).json({ error: '업데이트 기록 없음' });
        }

        res.json({
            last_updated: row.updated_at
        });
    });
});



// 서버 시작 시 오늘자 크롤링
app.listen(port, () => {
    console.log(`서버 실행됨: http://localhost:${port}`);
    (async () => {
        for (const category of Object.keys(oliveYoungCategories)) {
            await crawlOliveYoung(category);
        }
    })();
});



cron.schedule('15 1-23/3 * * *', async () => {
    console.log('3시간 주기 자동 크롤링 시작됨');

    for (const category of Object.keys(oliveYoungCategories)) {
        await crawlOliveYoung(category);
    }

    console.log('3시간 주기 자동 크롤링 완료됨');
});