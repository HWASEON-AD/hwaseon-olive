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
const DB_MAIN_FILE = 'rankings.db';
const DB_BACKUP_DIR = path.join(__dirname, 'backups');
const DROPBOX_CAPTURES_PATH = '/olive_rankings/captures';

// Render 배포 감지 및 환경 설정
const IS_RENDER = process.env.RENDER === 'true';
const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;

// 기본 데이터베이스 연결 및 초기화
const db = new sqlite3.Database(DB_MAIN_FILE, (err) => {
    if (err) {
        console.error('DB error:', err.message);
        return;
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

// 데이터베이스 쿼리를 Promise로 래핑하는 유틸리티 함수
const dbRun = promisify(db.run.bind(db));
const dbAll = promisify(db.all.bind(db));
const dbGet = promisify(db.get.bind(db));

// Enable GZIP compression
app.use(compression());
app.use(cors());
app.use(express.json());
// Serve static files with 1-day cache
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1d' }));

// ... rest of the code ...