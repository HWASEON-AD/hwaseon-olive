// API 기본 URL 설정
const BASE_URL = window.location.hostname === 'localhost' 
    ? 'http://localhost:5001' 
    : window.location.origin;

// 전역 변수 선언
let isLoading = false;
let rankingData = []; // 전체 랭킹 데이터 저장
let searchResultData = []; // 검색 결과 데이터 저장
let capturesList = []; // 캡처 목록 저장

// 전역 이벤트 차단기 - 새로고침 및 폼 제출 방지 (다운로드 버튼 예외 처리)
document.addEventListener('click', function(e) {
    // 엑셀 다운로드 버튼은 예외 처리
    if (e.target.id === 'productSearchDownloadBtn' || e.target.id === 'downloadExcelBtn' || 
        e.target.id === 'showCapturesBtn') {
        // 다운로드 버튼은 이벤트 차단하지 않음
        return true;
    }
    
    // 다른 버튼이나 링크의 기본 동작은 방지
    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'A') {
        e.preventDefault();
        return false;
    }
}, true);

document.addEventListener('submit', function(e) {
    e.preventDefault();
    return false;
}, true);

// 백스페이스 키 방지 (새로고침 관련)
document.addEventListener('keydown', function(e) {
    if (e.key === 'Backspace' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
        e.preventDefault();
    }
});

// 시간 표시 업데이트 함수
function updateTimeDisplay(crawlTime) {
    if (!crawlTime) {
        fetchLastCrawlTime();
        return;
    }
    
    // 날짜 형식 변환
    const timeText = `최근 업데이트: ${formatDateTime(crawlTime)}`;
    
    const updateTime = document.getElementById('updateTime');
    const rankingUpdateTime = document.getElementById('rankingUpdateTime');
    
    if (updateTime) updateTime.innerHTML = timeText;
    if (rankingUpdateTime) rankingUpdateTime.innerHTML = timeText;
}

// 날짜/시간 포맷 함수
function formatDateTime(dateTimeStr) {
    try {
        if (typeof dateTimeStr === 'string' && dateTimeStr.includes('서버')) {
            return dateTimeStr;
        }
        
        const date = new Date(dateTimeStr);
        if (isNaN(date.getTime())) {
            return dateTimeStr;
        }
        
        return date.toLocaleString('ko-KR', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
            timeZone: 'Asia/Seoul'
        });
    } catch (error) {
        console.error('Date formatting error:', error);
        return dateTimeStr;
    }
}

// 가격 포맷 함수: 이미 '원'이 붙어 있으면 그대로, 아니면 숫자만 있을 때만 '원' 붙이기
function formatPrice(price) {
    if (!price || price === '없음') return '-';
    if (typeof price === 'string' && price.includes('원')) return price;
    // 숫자만 있을 때만 '원' 붙이기
    const num = Number(price.toString().replace(/[^0-9]/g, ''));
    if (isNaN(num) || num === 0) return price;
    return num.toLocaleString() + '원';
}

document.addEventListener('DOMContentLoaded', () => {
    // DOM 요소 참조
    const searchBtn = document.getElementById('searchBtn');
    const rankingTable = document.getElementById('rankingTable').getElementsByTagName('tbody')[0];
    const rankingUpdateTime = document.getElementById('rankingUpdateTime');
    const categorySelect = document.getElementById('category');
    const productSearchBtn = document.getElementById('productSearchBtn');
    const productSearchInput = document.getElementById('productSearchInput');
    const productSearchTable = document.getElementById('productSearchTable').getElementsByTagName('tbody')[0];
    const updateTime = document.getElementById('updateTime');
    const startDateInput = document.getElementById('startDate');
    const endDateInput = document.getElementById('endDate');
    const productSearchDownloadBtn = document.getElementById('productSearchDownloadBtn');
    const downloadExcelBtn = document.getElementById('downloadExcelBtn');
    const showCapturesBtn = document.getElementById('showCapturesBtn');
    const captureListModal = document.getElementById('captureListModal');
    const captureListContainer = document.getElementById('captureListContainer');

    // 초기 시간 표시 업데이트
    fetchLastCrawlTime();

    // 날짜 관련 함수 - 현재 한국 시간 기준으로 날짜 설정
    function setCurrentDate() {
        // 현재 날짜 객체 생성
        const now = new Date();
        
        // 현재 날짜 포맷팅
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const formattedDate = `${year}-${month}-${day}`;
        
        console.log('현재 날짜 설정:', formattedDate);
        
        // 날짜 입력 필드 업데이트
        const startDateEl = document.getElementById('startDate');
        const endDateEl = document.getElementById('endDate');
        
        if (startDateEl) startDateEl.value = formattedDate;
        if (endDateEl) endDateEl.value = formattedDate;
    }
    
    // 초기 날짜 설정
    setCurrentDate();
    
    // 자정에 날짜가 자동으로 변경되도록 타이머 설정
    function scheduleNextMidnightUpdate() {
        const now = new Date();
        
        // 다음 자정 시간 계산 (로컬 시간 기준)
        const nextMidnight = new Date(now);
        nextMidnight.setDate(nextMidnight.getDate() + 1);
        nextMidnight.setHours(0, 0, 0, 0);
        
        // 다음 자정까지 남은 시간 (밀리초)
        const timeUntilMidnight = nextMidnight - now;
        
        console.log(`다음 자정까지 ${Math.floor(timeUntilMidnight / 1000 / 60)} 분 남음`);
        
        // 자정에 날짜 업데이트 타이머 설정
        setTimeout(() => {
            // 날짜 업데이트
            setCurrentDate();
            
            // 다음 자정 업데이트 스케줄링
            scheduleNextMidnightUpdate();
            
            console.log('자정이 지나 날짜가 업데이트되었습니다.');
        }, timeUntilMidnight);
    }
    
    // 자정 업데이트 스케줄링 시작
    scheduleNextMidnightUpdate();

    // API 엔드포인트 함수들
    async function fetchLastCrawlTime() {
        try {
            const response = await fetch(`${BASE_URL}/api/last-crawl-time`);
            if (!response.ok) throw new Error('Server response was not ok');
            const data = await response.json();
            if (data.success) {
                const lastCrawlTime = data.lastCrawlTime || '정보 없음';
                updateTimeDisplay(lastCrawlTime);
            } else {
                updateTimeDisplay('서버 응답 오류');
            }
        } catch (error) {
            console.error('마지막 크롤링 시간 가져오기 실패:', error);
            updateTimeDisplay('서버 연결 오류');
        }
    }

    // 캡처 목록 보기 버튼 클릭 이벤트
    showCapturesBtn.addEventListener('click', function(e) {
        if (e) e.preventDefault();
        
        // 캡처 목록 모달을 열고 필터 UI 먼저 표시
        showCaptureFilterUI();
        
        // 초기 캡처 목록 불러오기 (전체 카테고리)
        loadCapturesFromServer('전체', null, null);
        
        return false;
    });

    // 캡처 필터 UI 표시 함수
    function showCaptureFilterUI() {
        const captureListModal = document.getElementById('captureListModal');
        if (captureListModal) captureListModal.style.display = 'block';
        const filterEl = document.getElementById('captureFilterContainer');
        if (!filterEl) return;
        filterEl.style.display = 'block';
        
        // 날짜 입력 필드 생성
        const dateFilterDiv = document.createElement('div');
        dateFilterDiv.style.marginBottom = '10px';
        dateFilterDiv.innerHTML = `
            <input type="date" id="startDate" style="margin-right: 10px;">
            <input type="date" id="endDate" style="margin-right: 10px;">
            <button onclick="applyDateFilter()" style="padding: 5px 10px;">적용</button>
        `;
        
        // 필터 UI 컨테이너에 추가
        const filterContainer = document.getElementById('filterContainer');
        filterContainer.innerHTML = ''; // 기존 필터 초기화
        filterContainer.appendChild(dateFilterDiv);
    }

    // 서버에서 캡처 목록 불러오기
    function loadCapturesFromServer(category, startDate, endDate) {
        // 로딩 메시지 표시
        captureListContainer.innerHTML = '<div style="text-align: center; padding: 20px;">캡처 목록을 불러오는 중...</div>';
        
        // API URL 생성
        let url = `${BASE_URL}/api/captures`;
        const params = [];
        
        if (category) {
            params.push(`category=${encodeURIComponent(category)}`);
        }
        
        if (startDate) {
            params.push(`startDate=${encodeURIComponent(startDate)}`);
        }
        
        if (endDate) {
            params.push(`endDate=${encodeURIComponent(endDate)}`);
        }
        
        if (params.length > 0) {
            url += '?' + params.join('&');
        }
        
        // 서버에서 캡처 목록 가져오기
        fetch(url)
            .then(response => response.json())
            .then(response => {
                if (response.success) {
                    capturesList = response.data;
                    showCaptureList();
                } else {
                    throw new Error(response.error || '데이터 로드 실패');
                }
            })
            .catch(error => {
                console.error('캡처 목록 로드 실패:', error);
                capturesList = [];
                showCaptureList();
            });
    }

    // 캡처 목록 표시 함수
    function showCaptureList() {
        captureListContainer.innerHTML = '';
        if (!capturesList || capturesList.length === 0) {
            const emptyMessage = document.createElement('div');
            emptyMessage.style.width = '100%';
            emptyMessage.style.textAlign = 'center';
            emptyMessage.style.padding = '50px 0';
            emptyMessage.style.fontSize = '18px';
            emptyMessage.style.color = '#666';
            emptyMessage.style.gridColumn = '1 / -1';
            emptyMessage.innerHTML = '저장된 캡처가 없습니다.';
            captureListContainer.appendChild(emptyMessage);
            return;
        }
        // 날짜별로 그룹화
        const capturesByDate = {};
        capturesList.forEach(capture => {
            const date = capture.date;
            if (!capturesByDate[date]) capturesByDate[date] = [];
            capturesByDate[date].push(capture);
        });
        // 날짜별로 정렬 (최신 날짜 먼저)
        const sortedDates = Object.keys(capturesByDate).sort((a, b) => b.localeCompare(a));
        // 날짜별로 캡처 목록 표시
        sortedDates.forEach(dateStr => {
            // 날짜 헤더 추가 (상단에 한 번만)
            const dateHeader = document.createElement('div');
            dateHeader.className = 'capture-date-header';
            dateHeader.style.gridColumn = '1 / -1';
            dateHeader.style.borderBottom = '2px solid #007BFF';
            dateHeader.style.padding = '10px 5px';
            dateHeader.style.marginTop = '20px';
            dateHeader.style.marginBottom = '15px';
            dateHeader.style.fontSize = '18px';
            dateHeader.style.fontWeight = 'bold';
            dateHeader.style.color = '#007BFF';
            dateHeader.innerHTML = dateStr;
            captureListContainer.appendChild(dateHeader);
            // 해당 날짜의 캡처들 표시 (카테고리 상관없이 모두)
            capturesByDate[dateStr].forEach(capture => {
                const captureItem = document.createElement('div');
                const categoryName = capture.category.replace('_', ' ');
                const imageUrl = `${BASE_URL}${capture.imageUrl}`;
                const timeStr = capture.time || '';
                captureItem.innerHTML = `
                    <div style="margin-bottom: 30px; border: 1px solid #ddd; border-radius: 5px; overflow: hidden;">
                        <div style="padding: 10px; background-color: #f8f9fa; border-bottom: 1px solid #ddd; display: flex; justify-content: space-between; align-items: center;">
                            <div>
                                <span style="font-weight: bold; margin-right: 10px; font-size: 16px;">${timeStr}</span>
                                <span style="background-color: #12B886; color: white; padding: 3px 8px; border-radius: 4px; font-size: 12px; font-weight: bold;">${categoryName}</span>
                            </div>
                            <div>
                                <button onclick="downloadImage('${capture.imageUrl}')" style="background: #4CAF50; color: white; border: none; border-radius: 3px; padding: 5px 10px; cursor: pointer; text-decoration: none; font-size: 12px;">다운로드</button>
                            </div>
                        </div>
                        <div style="padding: 10px; text-align: center;">
                            <img src="${imageUrl}" alt="캡처 이미지" style="max-width: 100%; cursor: pointer;" onclick="showFullImage('${imageUrl}')">
                        </div>
                    </div>
                `;
                captureListContainer.appendChild(captureItem);
            });
        });
    }

    // 모달 닫기 함수
    window.closeCaptureListModal = function() {
        captureListModal.style.display = 'none';
    };

    // 캡처 목록에서 캡처 삭제 함수
    window.deleteCapture = function(captureId) {
        if (confirm('이 캡처를 삭제하시겠습니까?')) {
            fetch(`${BASE_URL}/api/captures/${captureId}`, {
                method: 'DELETE'
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    // 현재 적용된 필터 상태 가져오기
                    const category = document.getElementById('captureCategory')?.value || '전체';
                    const startDate = document.getElementById('captureStartDate')?.value || '';
                    const endDate = document.getElementById('captureEndDate')?.value || '';
                    
                    // 필터 상태 유지하면서 캡처 목록 다시 불러오기
                    loadCapturesFromServer(category, startDate, endDate);
                } else {
                    throw new Error(data.error || '삭제 실패');
                }
            })
            .catch(error => {
                console.error('캡처 삭제 중 오류 발생:', error);
                alert('캡처를 삭제하는데 실패했습니다.');
            });
        }
    };

    // 전체 이미지 보기 함수
    window.showFullImage = function(imageUrl) {
        const overlay = document.createElement('div');
        overlay.style.position = 'fixed';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.backgroundColor = 'rgba(0,0,0,0.9)';
        overlay.style.display = 'flex';
        overlay.style.justifyContent = 'center';
        overlay.style.alignItems = 'center';
        overlay.style.zIndex = '9999';
        overlay.style.cursor = 'zoom-out';
        
        const img = document.createElement('img');
        img.src = imageUrl;
        img.style.maxWidth = '90%';
        img.style.maxHeight = '90%';
        img.style.objectFit = 'contain';
        img.style.border = '1px solid #ddd';
        img.style.borderRadius = '5px';
        img.style.boxShadow = '0 0 20px rgba(255,255,255,0.2)';
        
        overlay.appendChild(img);
        document.body.appendChild(overlay);
        
        overlay.addEventListener('click', function() {
            document.body.removeChild(overlay);
        });
    };
    
    // 이미지 다운로드 함수
    window.downloadImage = function(imageUrl) {
        console.log('다운로드 시도:', imageUrl);
        
        // 파일명 추출
        const filename = imageUrl.split('/').pop();
        
        // 새 창에서 다운로드 API 호출
        window.open(`${BASE_URL}/api/download/${filename}`, '_blank');
    };

    // 이전 이벤트 제거
    searchBtn.onclick = null;
    
    // 랭킹 버튼 클릭 이벤트 처리
    searchBtn.addEventListener('click', function(e) {
        // 이벤트 기본 동작 방지
        if (e) e.preventDefault();
        
        // 데이터 가져오기
        fetchRankingData();
        
        // 기본 동작 차단
        return false;
    });
    
    // 제품명 검색 버튼 클릭 이벤트 처리
    productSearchBtn.addEventListener('click', function(e) {
        // 이벤트 기본 동작 방지
        if (e) e.preventDefault();
        
        // 제품명 검색 실행
        searchProductByName();
        
        // 기본 동작 차단
        return false;
    });
    
    // 제품명 엑셀 다운로드 버튼 클릭 이벤트
    productSearchDownloadBtn.addEventListener('click', function(e) {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        
        if (searchResultData.length === 0) {
            alert('먼저 제품명 검색을 실행해주세요.');
            return;
        }
        
        downloadExcel(searchResultData, '올리브영_제품검색결과');
        return false;
    });
    
    // 랭킹 엑셀 다운로드 버튼 클릭 이벤트
    downloadExcelBtn.addEventListener('click', function(e) {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        
        if (rankingData.length === 0) {
            alert('먼저 랭킹 데이터를 조회해주세요.');
            return;
        }
        
        downloadExcel(rankingData, '올리브영_랭킹데이터');
        return false;
    });
    
    // 엑셀 다운로드 함수
    async function downloadExcel(data, fileName) {
        try {
            // ExcelJS가 로드되지 않았을 경우에 대한 처리
            if (typeof ExcelJS === 'undefined') {
                console.error('ExcelJS library is not loaded');
                alert('엑셀 라이브러리가 로드되지 않았습니다. 페이지를 새로고침한 후 다시 시도해주세요.');
                return;
            }
            
            // FileSaver가 로드되지 않았을 경우에 대한 처리
            if (typeof saveAs === 'undefined') {
                console.error('FileSaver library is not loaded');
                alert('파일 저장 라이브러리가 로드되지 않았습니다. 페이지를 새로고침한 후 다시 시도해주세요.');
                return;
            }
            
            console.log('엑셀 다운로드 시작', data.length + '개 항목');
            
            // 데이터 정렬: 날짜 내림차순, 시간 내림차순 (순위는 신경쓰지 않음)
            const sortedData = [...data].sort((a, b) => {
                // 날짜 내림차순 (최신 날짜가 위)
                const dateCompare = (b.date || '').localeCompare(a.date || '');
                if (dateCompare !== 0) return dateCompare;

                // 시간 내림차순 (최신 시간이 위)
                const timeCompare = (b.time || '').localeCompare(a.time || '');
                if (timeCompare !== 0) return timeCompare;

                // 순위는 신경쓰지 않음
                return 0;
            });
            
            // ExcelJS 워크북 생성
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Sheet1');
            
            // 헤더 설정
            worksheet.columns = [
                { header: '날짜', key: 'date', width: 12 },
                { header: '시간', key: 'time', width: 8 },
                { header: '카테고리', key: 'category', width: 15 },
                { header: '순위', key: 'rank', width: 8, style: { numFmt: '0', alignment: { horizontal: 'center' } } },
                { header: '브랜드', key: 'brand', width: 20 },
                { header: '제품명', key: 'name', width: 50 },
                { header: '소비자가', key: 'originalPrice', width: 12, style: { numFmt: '#,##0"원"', alignment: { horizontal: 'right' } } },
                { header: '판매가', key: 'salePrice', width: 12, style: { numFmt: '#,##0"원"', alignment: { horizontal: 'right' } } },
                { header: '행사', key: 'promotion', width: 25 }
            ];
            
            // 헤더 스타일 설정
            worksheet.getRow(1).eachCell(cell => {
                cell.font = { bold: true };
                cell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFE0E0E0' }
                };
                cell.border = {
                    top: { style: 'thin' },
                    left: { style: 'thin' },
                    bottom: { style: 'thin' },
                    right: { style: 'thin' }
                };
                cell.alignment = { vertical: 'middle', horizontal: 'center' };
            });
            
            // 데이터 추가
            sortedData.forEach(item => {
                // 가격에서 숫자만 추출하는 함수
                const extractNumber = (price) => {
                    if (!price || price === '없음') return null;
                    const num = parseInt(price.toString().replace(/[^0-9]/g, ''));
                    return isNaN(num) ? null : num;
                };
                
                // 순위를 숫자로 변환
                const rankNum = parseInt(item.rank) || null;
                
                // 가격 데이터 변환
                const originalPrice = extractNumber(item.originalPrice);
                const salePrice = extractNumber(item.salePrice);
                
                // 행사 정보 가공
                let formattedPromotion = '';
                if (item.promotion && item.promotion !== '없음' && item.promotion !== '-') {
                    const promotion = item.promotion.toLowerCase();
                    const promotionList = [];
                    
                    if (promotion.includes('쿠폰')) promotionList.push('쿠폰');
                    if (promotion.includes('증정')) promotionList.push('증정');
                    if (promotion.includes('세일')) promotionList.push('세일');
                    if (promotion.includes('오늘드림') || promotion.includes('드림')) promotionList.push('오늘드림');
                    
                    formattedPromotion = promotionList.length > 0 ? promotionList.join(', ') : item.promotion.trim();
                }
                
                // 행 추가
                const row = worksheet.addRow({
                    date: item.date || '',
                    time: item.time || '',
                    category: item.category || '',
                    rank: rankNum,
                    brand: item.brand || '',
                    name: item.name || '',
                    originalPrice: originalPrice || '없음',
                    salePrice: salePrice || '없음',
                    promotion: formattedPromotion || '-'
                });
                
                // 셀 스타일 적용
                row.eachCell((cell, colNumber) => {
                    cell.border = {
                        top: { style: 'thin' },
                        left: { style: 'thin' },
                        bottom: { style: 'thin' },
                        right: { style: 'thin' }
                    };
                    
                    // 컬럼별 특수 스타일 적용
                    switch(colNumber) {
                        case 4: // 순위
                            cell.alignment = { horizontal: 'center', vertical: 'middle' };
                            if (typeof cell.value === 'number') {
                                cell.numFmt = '0';
                            }
                            break;
                        case 7: // 소비자가
                        case 8: // 판매가
                            cell.alignment = { horizontal: 'right', vertical: 'middle' };
                            if (typeof cell.value === 'number') {
                                cell.numFmt = '#,##0"원"';
                            }
                            break;
                        default:
                            cell.alignment = { vertical: 'middle' };
                    }
                });
            });
            
            // FileSaver.js를 사용하여 엑셀 파일 다운로드
            const today = new Date().toISOString().split('T')[0];
            const excelFileName = `${fileName}_${today}.xlsx`;
            
            // 엑셀 파일 생성
            workbook.xlsx.writeBuffer().then(buffer => {
                const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                saveAs(blob, excelFileName);
                alert(`${excelFileName} 파일이 다운로드 되었습니다.`);
            });
            
        } catch (error) {
            console.error('Excel download error:', error);
            alert('엑셀 다운로드 중 오류가 발생했습니다: ' + error.message);
        }
    }
    
    // Enter 키로 검색 가능하도록 설정
    productSearchInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            searchProductByName();
        }
    });
    
    // 제품명으로 검색하는 함수
    async function searchProductByName() {
        const searchTerm = productSearchInput.value.trim();
        if (searchTerm === '') {
            alert('검색어를 입력해주세요.');
            return;
        }
        if (isLoading) return;
        try {
            isLoading = true;
            productSearchBtn.disabled = true;
            // 로딩 오버레이 표시
            document.getElementById('loadingOverlay').style.display = 'flex';
            // 로딩 표시
            productSearchTable.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align: center; padding: 20px;">
                        검색 중...
                    </td>
                </tr>
            `;
            const category = categorySelect.value;
            const startDate = startDateInput.value;
            const endDate = endDateInput.value;
            // yearMonth 파라미터 추가 (startDate 기준)
            let url = `${BASE_URL}/api/search?keyword=${encodeURIComponent(searchTerm)}&startDate=${startDate}&endDate=${endDate}&category=${encodeURIComponent(category)}`;
            if (startDate) url += `&yearMonth=${startDate.slice(0, 7)}`;
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'Cache-Control': 'no-cache'
                }
            });
            if (!response.ok) {
                throw new Error(`서버 오류: ${response.status}`);
            }
            const result = await response.json();
            if (!result.success) {
                throw new Error(result.error || '검색 실패');
            }
            // 전역 데이터 저장
            searchResultData = result.data;
            // 검색 결과 표시
            displaySearchResults(result.data);
        } catch (error) {
            console.error('Search Error:', error);
            // 에러 표시
            productSearchTable.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align: center; color: red; padding: 20px;">
                        ${error.message}
                    </td>
                </tr>
            `;
            // 검색 결과 데이터 초기화
            searchResultData = [];
        } finally {
            isLoading = false;
            productSearchBtn.disabled = false;
            // 로딩 오버레이 숨기기
            document.getElementById('loadingOverlay').style.display = 'none';
        }
    }
    
    // 검색 결과 표시 함수 - 제품명 전체 표시
    function displaySearchResults(data) {
        productSearchTable.innerHTML = '';
        
        // 현재 시간 표시 업데이트는 제거 (크롤링 시간만 표시)
        
        if (!data || data.length === 0) {
            productSearchTable.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align: center; padding: 20px;">
                        검색 결과가 없습니다.
                    </td>
                </tr>
            `;
            return;
        }
        
        // 데이터 정렬: 날짜 내림차순, 시간 내림차순 (순위, 카테고리 등은 신경쓰지 않음)
        const sortedData = [...data].sort((a, b) => {
            // 날짜 내림차순 (최신 날짜가 위)
            const dateCompare = (b.date || '').localeCompare(a.date || '');
            if (dateCompare !== 0) return dateCompare;

            // 시간 내림차순 (최신 시간이 위)
            const timeCompare = (b.time || '').localeCompare(a.time || '');
            if (timeCompare !== 0) return timeCompare;

            // 그 외는 신경쓰지 않음
            return 0;
        });
        
        // 검색어 가져오기
        const searchTerm = productSearchInput.value.trim();
        
        sortedData.forEach((product, index) => {
            // 행사 정보 포맷팅
            let promotionDisplay = '';
            
            // 행사 정보를 개별 태그로 분리하여 표시
            if (product.promotion && product.promotion !== '없음' && product.promotion !== '-') {
                const promotion = product.promotion.toLowerCase();
                const promotions = promotion.split(',').map(p => p.trim());
                
                promotions.forEach(p => {
                    // 쿠폰 체크
                    if (p.includes('쿠폰')) {
                        promotionDisplay += `<span style="display: inline-block; background-color: #96D165; color: white; padding: 4px 12px; border-radius: 20px; margin-right: 5px; font-size: 12px; font-weight: bold;">쿠폰</span>`;
                    }
                    
                    // 증정 체크
                    if (p.includes('증정')) {
                        promotionDisplay += `<span style="display: inline-block; background-color: #82CAFA; color: white; padding: 4px 12px; border-radius: 20px; margin-right: 5px; font-size: 12px; font-weight: bold;">증정</span>`;
                    }
                    
                    // 오늘드림 체크
                    if (p.includes('오늘드림') || p.includes('드림')) {
                        promotionDisplay += `<span style="display: inline-block; background-color: #F574B8; color: white; padding: 4px 12px; border-radius: 20px; margin-right: 5px; font-size: 12px; font-weight: bold;">오늘드림</span>`;
                    }
                    
                    // 세일 체크
                    if (p.includes('세일')) {
                        promotionDisplay += `<span style="display: inline-block; background-color: #FF6B6B; color: white; padding: 4px 12px; border-radius: 20px; margin-right: 5px; font-size: 12px; font-weight: bold;">세일</span>`;
                    }
                });
                
                // 기타 행사가 있는 경우 (위 조건에 해당하지 않는 경우)
                if (!promotionDisplay && product.promotion.trim()) {
                    promotionDisplay = `<span style="display: inline-block; background-color: #ADB5BD; color: white; padding: 4px 12px; border-radius: 20px; margin-right: 5px; font-size: 12px; font-weight: bold;">${product.promotion}</span>`;
                }
            }
            
            if (!promotionDisplay) {
                promotionDisplay = `<span style="color: #999; font-size: 12px;">-</span>`;
            }
            
            const row = productSearchTable.insertRow();
            const date = product.date || new Date().toISOString().split('T')[0];
            
            // 날짜와 시간을 한 줄로 표시
            const dateTimeStr = product.time ? `${date} ${product.time}` : date;
            
            // 제품명 길이 제한 제거 - 전체 표시
            const displayName = product.name || '';
            
            // 검색어 강조 표시 (제품명에만 적용)
            let highlightedName = displayName;
            if (searchTerm && product.name) {
                // 대소문자 구분 없이 검색 (case insensitive)
                const regex = new RegExp(searchTerm, 'gi');
                highlightedName = displayName.replace(regex, match => 
                    `<span style="color: #0066CC; font-weight: bold;">${match}</span>`
                );
            }
            
            row.innerHTML = `
                <td style="width: 140px; text-align: center; font-weight: bold; color: #333;">${dateTimeStr}</td>
                <td style="width: 120px; text-align: center;"><span style="background-color: #12B886; color: white; padding: 3px 8px; border-radius: 4px; font-size: 12px; font-weight: bold;">${product.category || '전체'}</span></td>
                <td style="width: 60px; text-align: center;">${product.rank || (index + 1)}</td>
                <td style="width: 120px; text-align: left; font-weight: bold; color: #333;">${product.brand || ''}</td>
                <td style="min-width: 400px; text-align: left; white-space: normal; word-break: break-word;">${highlightedName}</td>
                <td style="width: 85px; text-align: left; padding-left: 15px;">${formatPrice(product.originalPrice)}</td>
                <td style="width: 85px; text-align: left; padding-left: 15px; font-weight: bold; color: #333; font-size: 0.85rem;">${formatPrice(product.salePrice || product.price)}</td>
                <td style="width: 180px; text-align: left;">${promotionDisplay}</td>
            `;
        });
    }
    
    // 랭킹 데이터 가져오기 함수
    async function fetchRankingData() {
        if (isLoading) return;

        try {
            isLoading = true;
            searchBtn.disabled = true;
            searchBtn.textContent = '로딩 중...';

            const category = categorySelect.value;
            // 선택된 날짜 값 가져오기 (선택하지 않았다면 빈 문자열)
            const startDate = startDateInput.value || '';
            const endDate = endDateInput.value || '';
            
            console.log('요청 날짜 범위:', startDate, endDate);
            
            // URL 매개변수 생성
            let url = `${BASE_URL}/api/ranking?category=${category}`;
            if (startDate) url += `&startDate=${startDate}`;
            if (endDate) url += `&endDate=${endDate}`;
            // yearMonth 파라미터 추가 (startDate 기준)
            if (startDate) url += `&yearMonth=${startDate.slice(0, 7)}`;

            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'Cache-Control': 'no-cache'
                }
            });
            
            if (!response.ok) {
                throw new Error(`서버 오류: ${response.status}`);
            }
            
            const result = await response.json();

            if (!result.success) {
                throw new Error(result.error || '데이터 로드 실패');
            }

            // 전역 데이터 저장
            rankingData = result.data;
            
            // 데이터가 없는 경우 메시지 표시
            if (result.data.length === 0) {
                displayRankingError('선택한 날짜에 해당하는 데이터가 없습니다.');
                rankingData = [];
                return;
            }
            
            // 테이블에 데이터 표시
            displayRankingData(result.data, category);
            
            // 마지막 크롤링 시간 가져오기 (랭킹 데이터 업데이트마다 다시 가져오지는 않음)
            // fetchLastCrawlTime(); // 제거: 크롤링 시에만 업데이트되도록

        } catch (error) {
            console.error('Error:', error);
            displayRankingError(error.message);
            // 랭킹 데이터 초기화
            rankingData = [];
        } finally {
            isLoading = false;
            searchBtn.disabled = false;
            searchBtn.textContent = '랭킹 데이터';
        }
    }

    // 랭킹 데이터 표시 - 제품명 전체 표시
    function displayRankingData(data, category) {
        rankingTable.innerHTML = '';
        
        // 시간 업데이트 제거 (크롤링 시간만 표시)
        
        if (!data || data.length === 0) {
            rankingTable.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align: center; padding: 20px;">
                        데이터가 없습니다.
                    </td>
                </tr>
            `;
            return;
        }

        // 데이터 정렬: 날짜 내림차순, 시간 내림차순 (순위는 신경쓰지 않음)
        const sortedData = [...data].sort((a, b) => {
            // 날짜 내림차순 (최신 날짜가 위)
            const dateCompare = (b.date || '').localeCompare(a.date || '');
            if (dateCompare !== 0) return dateCompare;

            // 시간 내림차순 (최신 시간이 위)
            const timeCompare = (b.time || '').localeCompare(a.time || '');
            if (timeCompare !== 0) return timeCompare;

            // 순위는 신경쓰지 않음
            return 0;
        });

        sortedData.forEach((product, index) => {
            // 행사 정보 포맷팅
            let promotionDisplay = '';
            
            // 행사 정보를 개별 태그로 분리하여 표시
            if (product.promotion && product.promotion !== '없음' && product.promotion !== '-') {
                const promotion = product.promotion.toLowerCase();
                const promotions = promotion.split(',').map(p => p.trim());
                
                promotions.forEach(p => {
                    // 쿠폰 체크
                    if (p.includes('쿠폰')) {
                        promotionDisplay += `<span style="display: inline-block; background-color: #96D165; color: white; padding: 4px 12px; border-radius: 20px; margin-right: 5px; font-size: 12px; font-weight: bold;">쿠폰</span>`;
                    }
                    
                    // 증정 체크
                    if (p.includes('증정')) {
                        promotionDisplay += `<span style="display: inline-block; background-color: #82CAFA; color: white; padding: 4px 12px; border-radius: 20px; margin-right: 5px; font-size: 12px; font-weight: bold;">증정</span>`;
                    }
                    
                    // 오늘드림 체크
                    if (p.includes('오늘드림') || p.includes('드림')) {
                        promotionDisplay += `<span style="display: inline-block; background-color: #F574B8; color: white; padding: 4px 12px; border-radius: 20px; margin-right: 5px; font-size: 12px; font-weight: bold;">오늘드림</span>`;
                    }
                    
                    // 세일 체크
                    if (p.includes('세일')) {
                        promotionDisplay += `<span style="display: inline-block; background-color: #FF6B6B; color: white; padding: 4px 12px; border-radius: 20px; margin-right: 5px; font-size: 12px; font-weight: bold;">세일</span>`;
                    }
                });
                
                // 기타 행사가 있는 경우 (위 조건에 해당하지 않는 경우)
                if (!promotionDisplay && product.promotion.trim()) {
                    promotionDisplay = `<span style="display: inline-block; background-color: #ADB5BD; color: white; padding: 4px 12px; border-radius: 20px; margin-right: 5px; font-size: 12px; font-weight: bold;">${product.promotion}</span>`;
                }
            }
            
            if (!promotionDisplay) {
                promotionDisplay = `<span style="color: #999; font-size: 12px;">-</span>`;
            }
            
            const row = rankingTable.insertRow();
            
            // 날짜와 시간을 한 줄로 표시
            const dateTimeStr = product.time ? `${product.date}<br>${product.time}` : product.date;
            
            // 제품명 길이 제한 제거 - 전체 표시
            const displayName = product.name || '';
            
            // 판매가 셀에 더 큰 글자 크기와 강조 적용
            row.innerHTML = `
                <td style="width: 140px; text-align: center; font-weight: bold; color: #333; white-space: pre-line;">${dateTimeStr}</td>
                <td style="width: 120px; text-align: center;"><span style="background-color: #12B886; color: white; padding: 3px 8px; border-radius: 4px; font-size: 12px; font-weight: bold;">${product.category || '전체'}</span></td>
                <td style="width: 60px; text-align: center;">${product.rank || (index + 1)}</td>
                <td style="width: 120px; text-align: left; font-weight: bold; color: #333;">${product.brand || ''}</td>
                <td style="min-width: 400px; text-align: left; white-space: normal; word-break: break-word;">${displayName}</td>
                <td style="width: 85px; text-align: left; padding-left: 15px;">${formatPrice(product.originalPrice)}</td>
                <td style="width: 85px; text-align: left; padding-left: 15px; font-weight: bold; color: #333; font-size: 0.85rem;">${formatPrice(product.salePrice || product.price)}</td>
                <td style="width: 180px; text-align: left;">${promotionDisplay}</td>
            `;
        });

        // 테이블 헤더도 동일한 스타일 적용
        const tableHeader = document.querySelector('#rankingTable thead tr') || document.querySelector('#productSearchTable thead tr');
        if (tableHeader) {
            tableHeader.innerHTML = `
                <th style="width: 140px; text-align: center;">날짜/시간</th>
                <th style="width: 120px; text-align: center;">카테고리</th>
                <th style="width: 60px; text-align: left;">순위</th>
                <th style="width: 120px; text-align: left;">브랜드</th>
                <th style="min-width: 400px; text-align: left;">제품명</th>
                <th style="width: 85px; text-align: left;">소비자가</th>
                <th style="width: 85px; text-align: left;">판매가</th>
                <th style="width: 180px; text-align: left;">행사</th>
            `;
        }
    }

    // 랭킹 에러 표시
    function displayRankingError(message) {
        rankingTable.innerHTML = `
            <tr>
                <td colspan="8" style="text-align: center; color: red; padding: 20px;">
                    ${message}
                </td>
            </tr>
        `;
    }

    // 버튼 호버 효과 추가
    const buttons = document.querySelectorAll('.button-container button');
    buttons.forEach(button => {
        button.addEventListener('mouseover', function() {
            this.style.transform = 'translateY(-3px)';
            this.style.boxShadow = '0 6px 8px rgba(0,0,0,0.2)';
        });
        
        button.addEventListener('mouseout', function() {
            this.style.transform = '';
            this.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)';
        });
        
        button.addEventListener('mousedown', function() {
            this.style.transform = 'translateY(1px)';
            this.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
        });
        
        button.addEventListener('mouseup', function() {
            this.style.transform = 'translateY(-3px)';
            this.style.boxShadow = '0 6px 8px rgba(0,0,0,0.2)';
        });
    });

    // 초기 캡처 목록 로드 (숨겨둠)
    loadCapturesFromServer();
});

// 캡처 목록 불러오기 함수 수정
async function fetchCaptureList() {
    const res = await fetch('/api/captures');
    const result = await res.json();
    if (!result.success) return;
    const captures = result.data;
    // 날짜별로 그룹화 (카테고리 무시)
    const grouped = {};
    for (const cap of captures) {
        if (!grouped[cap.date]) grouped[cap.date] = [];
        grouped[cap.date].push(cap);
    }
    // 최신 날짜 우선 정렬
    const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));
    const captureList = document.getElementById('captureList');
    captureList.innerHTML = '';
    for (const date of sortedDates) {
        const dateBlock = document.createElement('div');
        dateBlock.className = 'capture-date-block';
        const dateTitle = document.createElement('h3');
        dateTitle.textContent = date;
        dateBlock.appendChild(dateTitle);
        // 시간순(최신순) 정렬
        grouped[date].sort((a, b) => b.time.localeCompare(a.time));
        for (const cap of grouped[date]) {
            const item = document.createElement('div');
            item.className = 'capture-item';
            item.innerHTML = `
                <div><b>${cap.time}</b></div>
                <img src="${cap.imageUrl}" style="max-width: 400px; display: block; margin: 8px 0;" />
                <a href="${cap.imageUrl}" download>다운로드</a>
            `;
            dateBlock.appendChild(item);
        }
        captureList.appendChild(dateBlock);
    }
}
