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
const sqlite3 = require('sqlite3');
const cors = require('cors');
const path = require('path');
const cron = require('node-cron');
const ExcelJS = require('exceljs');
const fs = require('fs');
const compression = require('compression');
const { promisify } = require('util');
const { Dropbox } = require('dropbox');
const axios = require('axios');

const app = express();
const port = process.env.PORT || 5001;

// 설정 및 환경 변수
const DB_MAIN_FILE = path.join(__dirname, 'rankings.db');
const DB_BACKUP_DIR = path.join(__dirname, 'backups');
const DROPBOX_CAPTURES_PATH = '/olive_rankings/captures';

// Render 배포 감지 및 환경 설정
const IS_RENDER = process.env.RENDER === 'true';
const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;

// 백업 디렉토리 생성
if (!fs.existsSync(DB_BACKUP_DIR)) {
    fs.mkdirSync(DB_BACKUP_DIR, { recursive: true });
}

// 기본 데이터베이스 연결 및 초기화
let db;
try {
    db = new sqlite3.Database(DB_MAIN_FILE, (err) => {
        if (err) {
            console.error('DB error:', err.message);
            process.exit(1);
        }
        console.log('Connected to SQLite');
        
        // 테이블 생성
        db.serialize(() => {
            // 제품 테이블
            db.run(`CREATE TABLE IF NOT EXISTS products (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL,
                category TEXT NOT NULL,
                rank INTEGER NOT NULL,
                brand TEXT,
                name TEXT NOT NULL,
                consumer_price TEXT,
                sale_price TEXT,
                events TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            // 크롤링 로그 테이블
            db.run(`CREATE TABLE IF NOT EXISTS crawl_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                category TEXT NOT NULL,
                status TEXT NOT NULL,
                message TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            // 백업 로그 테이블
            db.run(`CREATE TABLE IF NOT EXISTS backup_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filename TEXT NOT NULL,
                status TEXT NOT NULL,
                message TEXT,
                dropbox_path TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            // 캡처 로그 테이블
            db.run(`CREATE TABLE IF NOT EXISTS capture_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                category TEXT NOT NULL,
                date TEXT NOT NULL,
                filename TEXT NOT NULL,
                dropbox_path TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            // 마지막 크롤링 시간 테이블
            db.run(`CREATE TABLE IF NOT EXISTS last_crawled (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                category TEXT NOT NULL,
                last_crawled_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);
        });
    });
} catch (error) {
    console.error('Failed to initialize database:', error);
    process.exit(1);
}

// 데이터베이스 쿼리를 Promise로 래핑하는 유틸리티 함수
const dbRun = promisify(db.run.bind(db));
const dbAll = promisify(db.all.bind(db));
const dbGet = promisify(db.get.bind(db));

// Enable GZIP compression
app.use(compression());
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static files with 1-day cache
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1d' }));

// 서버 시작
const startServer = () => {
    const server = app.listen(port, '0.0.0.0', () => {
        console.log(`Server is running on port ${port}`);
        console.log(`Environment: ${IS_RENDER ? 'Production (Render)' : 'Development'}`);
        if (IS_RENDER) {
            console.log(`External URL: ${RENDER_EXTERNAL_URL}`);
        }
    });

    // 서버 에러 핸들링
    server.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
            console.error(`Port ${port} is already in use`);
            process.exit(1);
        } else {
            console.error('Server error:', error);
        }
    });

    // 프로세스 종료 시 정리
    const cleanup = () => {
        console.log('Cleaning up resources...');
        server.close(() => {
            console.log('Server closed');
            if (db) {
                db.close((err) => {
                    if (err) {
                        console.error('Error closing database:', err);
                    } else {
                        console.log('Database connection closed');
                    }
                    process.exit(0);
                });
            } else {
                process.exit(0);
            }
        });
    };

    process.on('SIGTERM', cleanup);
    process.on('SIGINT', cleanup);
    process.on('uncaughtException', (error) => {
        console.error('Uncaught Exception:', error);
        cleanup();
    });
    process.on('unhandledRejection', (reason, promise) => {
        console.error('Unhandled Rejection at:', promise, 'reason:', reason);
        cleanup();
    });
};

// 서버 시작
startServer();

// 마지막 크롤링 시간 가져오기
app.get('/api/last-crawled', async (req, res) => {
    try {
        const result = await dbGet('SELECT last_crawled_at FROM last_crawled ORDER BY id DESC LIMIT 1');
        if (result) {
            res.json({ lastCrawled: result.last_crawled_at });
        } else {
            res.json({ lastCrawled: null });
        }
    } catch (error) {
        console.error('Error getting last crawled time:', error);
        res.status(500).json({ error: 'Failed to get last crawled time' });
    }
});

// 마지막 크롤링 시간 업데이트
const updateLastCrawled = async (category) => {
    try {
        await dbRun(
            'INSERT INTO last_crawled (category, last_crawled_at) VALUES (?, CURRENT_TIMESTAMP)',
            [category]
        );
    } catch (error) {
        console.error('Error updating last crawled time:', error);
    }
};

// ... rest of the code ...