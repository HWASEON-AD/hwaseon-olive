#!/usr/bin/env node
const axios = require('axios');

function usage() {
  console.log('Usage: node fetchBestRankingMobile.js <dispCatNo> <fltDispCatNo> [pageIdx] [rowsPerPage]');
  console.log('Example: node fetchBestRankingMobile.js 900000100100001 10000010001 1 100');
}

const [,, dispCatNo, fltDispCatNo, pageIdx = 1, rowsPerPage = 100] = process.argv;
if (!dispCatNo || !fltDispCatNo) {
  usage();
  process.exit(1);
}

(async () => {
  const url = 'https://api.oliveyoung.co.kr/app/best/ranking';
  console.log(`🔗 Requesting: ${url}?dispCatNo=${dispCatNo}&fltDispCatNo=${fltDispCatNo}&pageIdx=${pageIdx}&rowsPerPage=${rowsPerPage}`);

  try {
    const res = await axios.get(url, {
      params: { dispCatNo, fltDispCatNo, pageIdx, rowsPerPage },
      headers: {
        'User-Agent': 'OliveYoung/7.8.0 (Android 11; Nexus 5X)',
        'Accept-Language': 'ko-KR,ko;q=0.9'
      }
    });
    console.log(JSON.stringify(res.data, null, 2));
  } catch (err) {
    console.error('Error fetching best ranking:', err.response?.status || '', err.response?.data || err.message);
    process.exit(1);
  }
})(); 