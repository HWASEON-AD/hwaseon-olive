/* ============================================================
 *  HWASEON – OliveYoung Front UI Script (정리/주석 보강판)
 *  - 기능 유지, 구조만 개선
 *  - 섹션: 상수/유틸 → 날짜 제한 → 전역 가드 → API → 렌더러 → 엑셀 → 바인딩
 * ============================================================ */

/* ───────────── 1) 상수 & 전역 상태 ───────────── */
const BASE_URL =
  window.location.hostname === 'localhost'
    ? 'http://localhost:5001'
    : window.location.origin;

let isLoading        = false;
let rankingData      = []; // 랭킹 조회 결과
let searchResultData = []; // 제품명 검색 결과
let capturesList     = []; // (옵션) 캡처 목록

/* ───────────── 2) 공통 유틸 ───────────── */
/** YYYY-MM-DD HH:mm:ss (KST) 또는 서버 문자열 그대로 */
function formatDateTime(dateTimeStr) {
  try {
    if (typeof dateTimeStr === 'string' && dateTimeStr.includes('서버')) return dateTimeStr;
    const d = new Date(dateTimeStr);
    if (isNaN(d.getTime())) return dateTimeStr;
    return d.toLocaleString('ko-KR', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false, timeZone: 'Asia/Seoul',
    });
  } catch {
    return dateTimeStr;
  }
}

/** 가격: 숫자일 때만 1,000 단위 + '원' */
function formatPrice(price) {
  if (!price || price === '없음') return '-';
  if (typeof price === 'string' && price.includes('원')) return price;
  const num = Number(String(price).replace(/[^0-9]/g, ''));
  return isNaN(num) || num === 0 ? price : num.toLocaleString() + '원';
}

/** KST 오늘 날짜(YYYY-MM-DD) */
function todayKST() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/* ───────────── 3) 날짜 선택 제한(IIFE) ─────────────
   - 브라우저 기본 달력 유지, 특정 구간 금지
----------------------------------------------------- */
(function enforceDateRules() {
  const $start = document.getElementById('startDate');
  const $end   = document.getElementById('endDate');

  const MIN_DATE   = '2025-05-21';
  const BLOCK_FROM = '2025-07-01';
  const BLOCK_TO   = '2025-07-07';

  const inBlocked = (iso) => iso && iso >= BLOCK_FROM && iso <= BLOCK_TO;

  function validateStart() {
    const v = $start.value;
    if (!v) return;
    if (v < MIN_DATE) {
      alert(`${MIN_DATE} 이후만 조회 가능합니다.`);
      $start.value = MIN_DATE;
    } else if (inBlocked(v)) {
      alert('2025-07-01 ~ 2025-07-07 데이터는 조회할 수 없습니다.');
      $start.value = '';
    }
    if ($end.value && $end.value < $start.value) $end.value = $start.value;
    $end.min = $start.value || MIN_DATE;
  }

  function validateEnd() {
    const v = $end.value;
    if (!v) return;
    if ($start.value && v < $start.value) {
      alert('종료일은 시작일 이후여야 합니다.');
      $end.value = $start.value;
      return;
    }
    if (inBlocked(v)) {
      alert('2025-07-01 ~ 2025-07-07 데이터는 조회할 수 없습니다.');
      $end.value = '';
    }
  }

  $start?.addEventListener('change', validateStart);
  $end?.addEventListener('change', validateEnd);
})();

/* ───────────── 4) 전역 가드(새로고침/폼 제출) ─────────────
   - 다운로드/보기 트리거는 예외
---------------------------------------------------------- */
document.addEventListener('click', (e) => {
  const id = e.target.id;
  if (id === 'productSearchDownloadBtn' || id === 'downloadExcelBtn' || id === 'showCapturesBtn') return;
  if (e.target.tagName === 'BUTTON' || e.target.tagName === 'A') {
    e.preventDefault();
    return false;
  }
}, true);

document.addEventListener('submit', (e) => {
  e.preventDefault();
  return false;
}, true);

/** 입력 밖에서 Backspace로 뒤로가기 방지 */
document.addEventListener('keydown', (e) => {
  const t = document.activeElement?.tagName;
  if (e.key === 'Backspace' && !['INPUT', 'TEXTAREA'].includes(t)) e.preventDefault();
});

/* ───────────── 5) API 래퍼 ───────────── */
/** 최근 크롤링 시각 가져와 표시 */
async function fetchLastCrawlTime() {
  try {
    const res  = await fetch(`${BASE_URL}/api/last-crawl-time`);
    if (!res.ok) throw new Error('Server response was not ok');
    const data = await res.json();
    updateTimeDisplay(data.success ? (data.lastCrawlTime || '정보 없음') : '서버 응답 오류');
  } catch (e) {
    console.error('마지막 크롤링 시간 실패:', e);
    updateTimeDisplay('서버 연결 오류');
  }
}

/** 랭킹 조회 */
async function apiFetchRanking({ category, startDate, endDate }) {
  let url = `${BASE_URL}/api/ranking?category=${encodeURIComponent(category)}`;
  if (startDate) url += `&startDate=${startDate}&yearMonth=${startDate.slice(0, 7)}`;
  if (endDate)   url += `&endDate=${endDate}`;
  const res = await fetch(url, { headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' } });
  if (!res.ok) throw new Error(`서버 오류: ${res.status}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error || '데이터 로드 실패');
  return json.data || [];
}

/** 제품명 검색 */
async function apiSearchProduct({ keyword, category, startDate, endDate }) {
  let url = `${BASE_URL}/api/search?keyword=${encodeURIComponent(keyword)}&startDate=${startDate}&endDate=${endDate}&category=${encodeURIComponent(category)}`;
  if (startDate) url += `&yearMonth=${startDate.slice(0, 7)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' } });
  if (!res.ok) throw new Error(`서버 오류: ${res.status}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error || '검색 실패');
  return json.data || [];
}

/* ───────────── 6) 렌더러 ───────────── */
/** 상단 “최근 업데이트” 표시 */
function updateTimeDisplay(crawlTime) {
  const text = `최근 업데이트: ${formatDateTime(crawlTime)}`;
  const $1 = document.getElementById('updateTime');
  const $2 = document.getElementById('rankingUpdateTime');
  if ($1) $1.innerHTML = text;
  if ($2) $2.innerHTML = text;
}

/** 제품명 검색 결과 렌더 (제품명 전체 표시, 최신 우선) */
function renderSearchResults(data, elements) {
  const { tbody, keywordInput } = elements;
  tbody.innerHTML = '';

  if (!data?.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:20px;">검색 결과가 없습니다.</td></tr>`;
    return;
  }

  const sorted = [...data].sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.time || '').localeCompare(a.time || ''));

  const term = keywordInput.value.trim();
  const hi = (name) => {
    if (!term || !name) return name || '';
    return name.replace(new RegExp(term, 'gi'), (m) => `<span style="color:#0066CC;font-weight:bold;">${m}</span>`);
  };

  sorted.forEach((p, idx) => {
    // 행사 뱃지
    let badges = '';
    if (p.promotion && p.promotion !== '없음' && p.promotion !== '-') {
      const tokens = p.promotion.toLowerCase().split(',').map(s => s.trim());
      const push = (label, bg) => { badges += `<span style="display:inline-block;background:${bg};color:#fff;padding:4px 12px;border-radius:20px;margin-right:5px;font-size:12px;font-weight:bold;">${label}</span>`; };
      tokens.forEach(t => {
        if (t.includes('쿠폰')) push('쿠폰', '#96D165');
        if (t.includes('증정')) push('증정', '#82CAFA');
        if (t.includes('오늘드림') || t.includes('드림')) push('오늘드림', '#F574B8');
        if (t.includes('세일')) push('세일', '#FF6B6B');
      });
      if (!badges && p.promotion.trim()) push(p.promotion, '#ADB5BD');
    } else {
      badges = `<span style="color:#999;font-size:12px;">-</span>`;
    }

    const date = p.date || todayKST();
    const dt   = p.time ? `${date} ${p.time}` : date;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="width:140px;text-align:center;font-weight:bold;color:#333;">${dt}</td>
      <td style="width:120px;text-align:center;"><span style="background:#12B886;color:#fff;padding:3px 8px;border-radius:4px;font-size:12px;font-weight:bold;">${p.category || '전체'}</span></td>
      <td style="width:60px;text-align:center;">${p.rank || (idx + 1)}</td>
      <td style="width:120px;text-align:left;font-weight:bold;color:#333;">${p.brand || ''}</td>
      <td style="min-width:400px;text-align:left;white-space:normal;word-break:break-word;">${hi(p.name || '')}</td>
      <td style="width:85px;text-align:left;padding-left:15px;">${formatPrice(p.originalPrice)}</td>
      <td style="width:85px;text-align:left;padding-left:15px;font-weight:bold;color:#333;font-size:.85rem;">${formatPrice(p.salePrice || p.price)}</td>
      <td style="width:180px;text-align:left;">${badges}</td>
    `;
    tbody.appendChild(tr);
  });
}

/** 랭킹 테이블 렌더(최신 우선) */
function renderRanking(data, elements) {
  const { tbody } = elements;
  tbody.innerHTML = '';

  if (!data?.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:20px;">데이터가 없습니다.</td></tr>`;
    return;
  }

  const sorted = [...data].sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.time || '').localeCompare(a.time || ''));

  sorted.forEach((p, idx) => {
    let badges = '';
    if (p.promotion && p.promotion !== '없음' && p.promotion !== '-') {
      const tokens = p.promotion.toLowerCase().split(',').map(s => s.trim());
      const push = (label, bg) => { badges += `<span style="display:inline-block;background:${bg};color:#fff;padding:4px 12px;border-radius:20px;margin-right:5px;font-size:12px;font-weight:bold;">${label}</span>`; };
      tokens.forEach(t => {
        if (t.includes('쿠폰')) push('쿠폰', '#96D165');
        if (t.includes('증정')) push('증정', '#82CAFA');
        if (t.includes('오늘드림') || t.includes('드림')) push('오늘드림', '#F574B8');
        if (t.includes('세일')) push('세일', '#FF6B6B');
      });
      if (!badges && p.promotion.trim()) push(p.promotion, '#ADB5BD');
    } else {
      badges = `<span style="color:#999;font-size:12px;">-</span>`;
    }

    const dt = p.time ? `${p.date}<br>${p.time}` : p.date;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="width:140px;text-align:center;font-weight:bold;color:#333;white-space:pre-line;">${dt}</td>
      <td style="width:120px;text-align:center;"><span style="background:#12B886;color:#fff;padding:3px 8px;border-radius:4px;font-size:12px;font-weight:bold;">${p.category || '전체'}</span></td>
      <td style="width:60px;text-align:center;">${p.rank || (idx + 1)}</td>
      <td style="width:120px;text-align:left;font-weight:bold;color:#333;">${p.brand || ''}</td>
      <td style="min-width:400px;text-align:left;white-space:normal;word-break:break-word;">${p.name || ''}</td>
      <td style="width:85px;text-align:left;padding-left:15px;">${formatPrice(p.originalPrice)}</td>
      <td style="width:85px;text-align:left;padding-left:15px;font-weight:bold;color:#333;font-size:.85rem;">${formatPrice(p.salePrice || p.price)}</td>
      <td style="width:180px;text-align:left;">${badges}</td>
    `;
    tbody.appendChild(tr);
  });

  // 헤더 정돈(선택적으로 동일 스타일)
  const headRow = document.querySelector('#rankingTable thead tr') || document.querySelector('#productSearchTable thead tr');
  if (headRow) {
    headRow.innerHTML = `
      <th style="width:140px;text-align:center;">날짜/시간</th>
      <th style="width:120px;text-align:center;">카테고리</th>
      <th style="width:60px;text-align:left;">순위</th>
      <th style="width:120px;text-align:left;">브랜드</th>
      <th style="min-width:400px;text-align:left;">제품명</th>
      <th style="width:85px;text-align:left;">소비자가</th>
      <th style="width:85px;text-align:left;">판매가</th>
      <th style="width:180px;text-align:left;">행사</th>
    `;
  }
}

/** 랭킹 에러 메시지 */
function renderRankingError(tbody, message) {
  tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:red;padding:20px;">${message}</td></tr>`;
}

/* ───────────── 7) 엑셀 다운로드 ───────────── */
async function downloadExcel(data, fileNameBase) {
  try {
    if (typeof ExcelJS === 'undefined') return alert('엑셀 라이브러리가 로드되지 않았습니다. 새로고침 후 다시 시도해주세요.');
    if (typeof saveAs  === 'undefined') return alert('파일 저장 라이브러리가 로드되지 않았습니다. 새로고침 후 다시 시도해주세요.');

    // 최신 우선 정렬(날짜/시간)
    const rows = [...data].sort((a,b) => (b.date || '').localeCompare(a.date || '') || (b.time || '').localeCompare(a.time || ''));

    // 워크북/시트
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');

    ws.columns = [
      { header: '날짜', key: 'date', width: 12 },
      { header: '시간', key: 'time', width: 8 },
      { header: '카테고리', key: 'category', width: 15 },
      { header: '순위', key: 'rank', width: 8, style: { numFmt: '0', alignment: { horizontal: 'center' } } },
      { header: '브랜드', key: 'brand', width: 20 },
      { header: '제품명', key: 'name', width: 50 },
      { header: '소비자가', key: 'originalPrice', width: 12, style: { numFmt: '#,##0"원"', alignment: { horizontal: 'right' } } },
      { header: '판매가', key: 'salePrice', width: 12, style: { numFmt: '#,##0"원"', alignment: { horizontal: 'right' } } },
      { header: '행사', key: 'promotion', width: 25 },
    ];

    ws.getRow(1).eachCell((c) => {
      c.font = { bold: true };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };
      c.border = { top:{style:'thin'}, left:{style:'thin'}, bottom:{style:'thin'}, right:{style:'thin'} };
      c.alignment = { vertical: 'middle', horizontal: 'center' };
    });

    const num = (v) => {
      if (!v || v === '없음') return null;
      const n = parseInt(String(v).replace(/[^0-9]/g,''), 10);
      return isNaN(n) ? null : n;
    };

    rows.forEach((it) => {
      const row = ws.addRow({
        date: it.date || '',
        time: it.time || '',
        category: it.category || '',
        rank: parseInt(it.rank, 10) || null,
        brand: it.brand || '',
        name: it.name || '',
        originalPrice: num(it.originalPrice) ?? '없음',
        salePrice: num(it.salePrice) ?? '없음',
        promotion: (() => {
          if (!it.promotion || it.promotion === '없음' || it.promotion === '-') return '-';
          const p = it.promotion.toLowerCase();
          const tags = [];
          if (p.includes('쿠폰')) tags.push('쿠폰');
          if (p.includes('증정')) tags.push('증정');
          if (p.includes('오늘드림') || p.includes('드림')) tags.push('오늘드림');
          if (p.includes('세일')) tags.push('세일');
          return tags.length ? tags.join(', ') : (it.promotion.trim());
        })(),
      });

      row.eachCell((cell, col) => {
        cell.border = { top:{style:'thin'}, left:{style:'thin'}, bottom:{style:'thin'}, right:{style:'thin'} };
        if (col === 4) cell.alignment = { horizontal:'center', vertical:'middle' };
        if (col === 7 || col === 8) cell.alignment = { horizontal:'right', vertical:'middle' };
      });
    });

    const fileName = `${fileNameBase}_${todayKST()}.xlsx`;
    const buf = await wb.xlsx.writeBuffer();
    saveAs(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), fileName);
    alert(`${fileName} 파일이 다운로드 되었습니다.`);
  } catch (e) {
    console.error('Excel download error:', e);
    alert('엑셀 다운로드 중 오류가 발생했습니다: ' + e.message);
  }
}

/* ───────────── 8) DOM 바인딩 ───────────── */
document.addEventListener('DOMContentLoaded', () => {
  // 요소 캐시
  const $rankingTBody   = document.querySelector('#rankingTable tbody');
  const $searchTBody    = document.querySelector('#productSearchTable tbody');
  const $searchBtn      = document.getElementById('searchBtn');
  const $productBtn     = document.getElementById('productSearchBtn');
  const $keywordInput   = document.getElementById('productSearchInput');
  const $category       = document.getElementById('category');
  const $startDate      = document.getElementById('startDate');
  const $endDate        = document.getElementById('endDate');
  const $dlSearchBtn    = document.getElementById('productSearchDownloadBtn');
  const $dlRankingBtn   = document.getElementById('downloadExcelBtn');
  const $showCaptures   = document.getElementById('showCapturesBtn');
  const $loadingOverlay = document.getElementById('loadingOverlay');

  // 초기 날짜 설정 & 자정 갱신
  const setCurrentDate = () => {
    const d = todayKST();
    if ($startDate) $startDate.value = d;
    if ($endDate)   $endDate.value   = d;
  };
  setCurrentDate();

  (function scheduleMidnight() {
    const now = new Date();
    const next = new Date(now);
    next.setDate(now.getDate() + 1);
    next.setHours(0, 0, 0, 0);
    setTimeout(() => { setCurrentDate(); scheduleMidnight(); }, next - now);
  })();

  // 크롤링 시간 표시(초기 + 5분 주기)
  fetchLastCrawlTime();
  setInterval(fetchLastCrawlTime, 5 * 60 * 1000);

  // 캡처 버튼(현재는 막기만 함)
  $showCaptures?.addEventListener('click', (e) => { e?.preventDefault(); return false; });

  // 랭킹 조회
  $searchBtn?.addEventListener('click', async (e) => {
    e?.preventDefault();
    if (isLoading) return;

    try {
      isLoading = true;
      $searchBtn.disabled = true;
      $rankingTBody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:20px;color:#888;font-size:18px;">조회 중..</td></tr>`;
      const data = await apiFetchRanking({ category: $category.value, startDate: $startDate.value || '', endDate: $endDate.value || '' });
      rankingData = data;
      if (!data.length) return renderRankingError($rankingTBody, '선택한 날짜에 해당하는 데이터가 없습니다.');
      renderRanking(data, { tbody: $rankingTBody });
    } catch (err) {
      console.error(err);
      rankingData = [];
      renderRankingError($rankingTBody, err.message);
    } finally {
      isLoading = false;
      $searchBtn.disabled = false;
      $searchBtn.textContent = '랭킹 데이터';
    }
  });

  // 제품명 검색(버튼)
  $productBtn?.addEventListener('click', async (e) => {
    e?.preventDefault();
    if (isLoading) return;

    const keyword = $keywordInput.value.trim();
    if (!keyword) return alert('검색어를 입력해주세요.');

    try {
      isLoading = true;
      $productBtn.disabled = true;
      $loadingOverlay && ($loadingOverlay.style.display = 'flex');
      $searchTBody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:20px;">검색 중...</td></tr>`;

      const data = await apiSearchProduct({ keyword, category: $category.value, startDate: $startDate.value, endDate: $endDate.value });
      searchResultData = data;
      renderSearchResults(data, { tbody: $searchTBody, keywordInput: $keywordInput });
    } catch (err) {
      console.error(err);
      searchResultData = [];
      $searchTBody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:red;padding:20px;">${err.message}</td></tr>`;
    } finally {
      isLoading = false;
      $productBtn.disabled = false;
      $loadingOverlay && ($loadingOverlay.style.display = 'none');
    }
  });

  // 제품명 검색(Enter)
  $keywordInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); $productBtn?.click(); }
  });

  // 엑셀 다운로드(검색 결과)
  $dlSearchBtn?.addEventListener('click', (e) => {
    e?.preventDefault(); e?.stopPropagation();
    if (!searchResultData.length) return alert('먼저 제품명 검색을 실행해주세요.');
    downloadExcel(searchResultData, '올리브영_제품검색결과');
    return false;
  });

  // 엑셀 다운로드(랭킹)
  $dlRankingBtn?.addEventListener('click', (e) => {
    e?.preventDefault(); e?.stopPropagation();
    if (!rankingData.length) return alert('먼저 랭킹 데이터를 조회해주세요.');
    downloadExcel(rankingData, '올리브영_랭킹데이터');
    return false;
  });

  // (옵션) 캡처 목록 초기 로드 – 외부 구현이 있을 때만 호출
  if (typeof loadCapturesFromServer === 'function') {
    try { loadCapturesFromServer(); } catch {}
  }

  // 버튼 호버 효과(디자인)
  document.querySelectorAll('.button-container button').forEach((btn) => {
    btn.addEventListener('mouseover', function(){ this.style.transform='translateY(-3px)'; this.style.boxShadow='0 6px 8px rgba(0,0,0,.2)'; });
    btn.addEventListener('mouseout',  function(){ this.style.transform='';            this.style.boxShadow='0 4px 6px rgba(0,0,0,.1)'; });
    btn.addEventListener('mousedown', function(){ this.style.transform='translateY(1px)';  this.style.boxShadow='0 2px 4px rgba(0,0,0,.1)'; });
    btn.addEventListener('mouseup',   function(){ this.style.transform='translateY(-3px)'; this.style.boxShadow='0 6px 8px rgba(0,0,0,.2)'; });
  });
});
