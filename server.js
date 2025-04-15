const express = require('express');
const puppeteer = require('puppeteer');
const sqlite3 = require('sqlite3')
const cors = require('cors');
const path = require('path');
const ExcelJS = require('exceljs');
const fs = require('fs');
const app = express();
const port = 5001;


app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));


app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'olive.html'));
});





const db = new sqlite3.Database('rankings.db', (err) => {
    if (err) console.error('DB error:', err.message);
    console.log('Connected to SQLite');
});


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
        )
    `);
});


db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS captures (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now', 'localtime'))
        )
    `);
});



// 카테고리 정의
const oliveYoungCategories = {
    스킨케어: '10000010001',
    메이크업: '10000010002',
    바디케어: '10000010003',
    헤어케어: '10000010004'
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
    console.log(`크롤링 시작: ${category}`);
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true,
            executablePath: puppeteer.executablePath(),
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0');
        const baseUrl = 'https://www.oliveyoung.co.kr/store/main/getBestList.do';
        const categoryCode = oliveYoungCategories[category];
        const url = `${baseUrl}?dispCatNo=900000100100001&fltDispCatNo=${categoryCode}&pageIdx=1&rowsPerPage=100`;

        await page.goto(url, { waitUntil: 'networkidle2' });

        const products = await page.evaluate(() => {
            const result = [];
            const items = document.querySelectorAll('.prd_info');
        
            items.forEach((el, index) => {
                const brand = el.querySelector('.tx_brand')?.innerText.trim() || '';
                const product = el.querySelector('.tx_name')?.innerText.trim() || '';
                
                // 판매가와 소비자가 추출, 없으면 'X' 처리
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
                    brand,
                    product,
                    salePrice,
                    originalPrice,
                    event: eventFlags
                });
            });
        
            return result;
        });


        const date = new Date().toISOString().split('T')[0];

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

        const stmt = db.prepare(`
            INSERT OR REPLACE INTO rankings (date, rank, brand, product, salePrice, originalPrice, event, category)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);

        products.forEach(item => {
            stmt.run(date, item.rank, item.brand, item.product, item.salePrice, item.originalPrice, item.event, category);
        });

        stmt.finalize();

        console.log(`${category} 크롤링 완료`);
        return products;

    } catch (err) {
        console.error(`${category} 크롤링 실패:`, err.message);
        return [];
    } finally {
        if (browser) await browser.close();
    }
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
        `SELECT date, rank, brand, product, salePrice, originalPrice, event FROM rankings WHERE category = ? AND date = ? ORDER BY rank ASC`,
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

    // 필수 파라미터가 없으면 400 오류 반환
    if (!keyword || !startDate || !endDate) {
        return res.status(400).json({ message: '제품명과 날짜 범위를 모두 선택하세요.' });
    }

    // 유효한 날짜인지 확인
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (isNaN(start) || isNaN(end)) {
        return res.status(400).json({ message: '유효한 날짜를 입력하세요.' });
    }

    // 날짜를 YYYY-MM-DD 형식으로 변환
    const formattedStartDate = start.toISOString().split('T')[0];
    const formattedEndDate = end.toISOString().split('T')[0];

    // 수정된 쿼리문: 날짜 범위와 제품명으로 필터링
    db.all(`
        SELECT * FROM rankings 
        WHERE product LIKE ? 
        AND date BETWEEN ? AND ? 
        ORDER BY date ASC, rank ASC
    `, [`%${keyword}%`, formattedStartDate, formattedEndDate], (err, rows) => {
        if (err) {
            console.error("서버 오류:", err);
            return res.status(500).json({ error: '서버 오류' });
        }
        res.json(rows);  // 결과 반환
    });
});



app.get('/api/rankings-range', (req, res) => {
    const { category, startDate, endDate } = req.query;

    if (!category || !startDate || !endDate) {
        return res.status(400).json({ error: '카테고리와 날짜를 모두 선택하세요.' });
    }

    db.all(`
        SELECT date, rank, brand, product, salePrice, originalPrice, event
        FROM rankings
        WHERE category = ?
        AND date BETWEEN ? AND ?
        ORDER BY date ASC, rank ASC
    `, [category, startDate, endDate], (err, rows) => {
        if (err) {
            console.error("DB 오류:", err);
            return res.status(500).json({ error: '서버 오류' });
        }
        res.json(rows);
    });
});



app.get('/api/download', (req, res) => {
    const { category, startDate, endDate } = req.query;

    if (!category || !startDate || !endDate) {
        return res.status(400).json({ error: '카테고리와 날짜 범위를 전달해야 합니다.' });
    }

    db.all(
        `SELECT date, rank, brand, product, salePrice, originalPrice, event 
        FROM rankings 
        WHERE category = ? AND date BETWEEN ? AND ?
        ORDER BY date ASC, rank ASC`,
        [category, startDate, endDate],
        (err, rows) => {
            if (err) {
                console.error('DB 에러:', err);
                return res.status(500).json({ error: 'DB 오류' });
            }

            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('랭킹 데이터');

            worksheet.columns = [
                { header: '날짜', key: 'date', width: 15 },
                { header: '순위', key: 'rank', width: 6 },
                { header: '브랜드', key: 'brand', width: 15 },
                { header: '제품명', key: 'product', width: 40 },
                { header: '소비자가', key: 'originalPrice', width: 12 },
                { header: '판매가', key: 'salePrice', width: 12 },
                { header: '행사', key: 'event', width: 25 }
            ];

            worksheet.addRows(rows);

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



app.get('/api/capture', async (req, res) => {
    const { url, filename: userFilename } = req.query;
    if (!url) return res.status(400).json({ error: 'url 파라미터가 필요합니다.' });

    let browser;
    try {
        const captureDir = path.join(__dirname, 'public');
        if (!fs.existsSync(captureDir)) fs.mkdirSync(captureDir);

        browser = await puppeteer.launch({
            headless: true,
            executablePath: '/usr/bin/chromium-browser',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-web-security',
                '--allow-file-access-from-files'
            ]
        });
        

        const page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

        // 안전한 파일명 생성
        const rawName = typeof userFilename === 'string' && userFilename.trim() !== ''
        ? userFilename.trim()
        : `capture_${Date.now()}`;

        // 한글 포함 허용
        const safeFilename = rawName.replace(/[^a-zA-Z0-9가-힣_\-]/g, '_');
        const finalFilename = `${safeFilename}.png`;

        const filePath = path.join(captureDir, finalFilename);

        await page.screenshot({ path: filePath, fullPage: true });

        // DB에 기록
        db.run(`INSERT INTO captures (filename) VALUES (?)`, [finalFilename]);

        console.log('✅ 저장된 파일:', finalFilename);
        res.json({ filename: finalFilename });
    } catch (err) {
        console.error('캡처 오류:', err.message);
        res.status(500).json({ error: '캡처 실패', details: err.message });
    } finally {
        if (browser) await browser.close();
    }
});



app.get('/api/captures', (req, res) => {
    const captureDir = path.join(__dirname, 'public');

    db.all(`SELECT id, filename, created_at FROM captures ORDER BY created_at DESC`, (err, rows) => {
        if (err) {
            console.error('DB 조회 실패:', err);
            return res.status(500).json({ error: 'DB 오류' });
        }

        const validCaptures = [];

        // 파일 존재 여부 확인하고, 없으면 DB에서도 삭제
        rows.forEach(row => {
            const filePath = path.join(captureDir, row.filename);
            if (fs.existsSync(filePath)) {
                validCaptures.push(row);
            } else {
                // 파일이 없으면 DB에서 삭제
                db.run(`DELETE FROM captures WHERE id = ?`, [row.id], (err) => {
                    if (err) console.error(`DB 삭제 실패 (id=${row.id}):`, err);
                });
            }
        });

        res.json(validCaptures);
    });
});



app.get('/api/download-search', (req, res) => {
    const { keyword, startDate, endDate } = req.query;
    if (!keyword || !startDate || !endDate) {
        return res.status(400).json({ error: '검색어와 날짜 범위를 모두 입력해야 합니다.' });
    }

    db.all(
        `SELECT date, rank, brand, product, salePrice, originalPrice, event 
        FROM rankings 
        WHERE product LIKE ? 
        AND date BETWEEN ? AND ?
        ORDER BY date ASC, rank ASC`,
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
                { header: '순위', key: 'rank', width: 6 },
                { header: '브랜드', key: 'brand', width: 15 },
                { header: '제품명', key: 'product', width: 40 },
                { header: '소비자가', key: 'originalPrice', width: 12 },
                { header: '판매가', key: 'salePrice', width: 12 },
                { header: '행사', key: 'event', width: 25 }
            ];

            worksheet.addRows(rows);

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




// 서버 시작 시 오늘자 크롤링
app.listen(port, () => {
    console.log(`서버 실행됨: http://localhost:${port}`);
    (async () => {
        for (const category of Object.keys(oliveYoungCategories)) {
            await crawlOliveYoung(category);
        }
    })();
});