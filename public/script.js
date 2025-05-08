// 메시지 억제: console.log, console.error, alert 비활성화
console.log = () => {};
console.error = () => {};
window.alert = () => {};

// Disable debug logs
console.log = function() {};

// API 엔드포인트 설정 제거 (상대경로 사용)

// 특정 에러 메시지 로깅 억제
;(function() {
    const origConsoleError = console.error;
    console.error = function(msg, ...args) {
        if (typeof msg === 'string' && msg.includes('실시간 랭킹 조회 오류')) {
            return; // 억제
        }
        origConsoleError.call(console, msg, ...args);
    };
})();

async function searchByProductName() {
    const keyword = document.getElementById('productSearchInput').value.trim();
    const startDate = document.getElementById('startDate').value;
    const endDate = document.getElementById('endDate').value;
    const tbody = document.querySelector('#productSearchTable tbody');
    tbody.innerHTML = '';

    if (!keyword) {
        const row = document.createElement('tr');
        row.innerHTML = `<td colspan="7">검색 결과가 없습니다.</td>`;
        tbody.appendChild(row);
        return;
    }
    try {
        // 서버에 요청 보내기 (상대경로 사용)
        const res = await fetch(
            `/api/search-range?keyword=${encodeURIComponent(keyword)}&startDate=${startDate}&endDate=${endDate}`
        );
        if (!res.ok) {
            const errorText = await res.text();
            console.error('서버 오류:', errorText); 
            throw new Error('서버 오류');
        }
        const data = await res.json();
        updateSearchTable(data);
    } catch (err) {
        console.error("검색 오류:", err);
    }
}




// 제품명 검색 테이블
function updateSearchTable(results) {
    const tbody = document.querySelector('#productSearchTable tbody');
    tbody.innerHTML = '';

    if (!Array.isArray(results) || results.length === 0) {
        const row = document.createElement('tr');
        row.innerHTML = `<td colspan="8">검색 결과가 없습니다.</td>`;
        tbody.appendChild(row);
        return;
    }

    results.forEach(item => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${formatDate(item.date)}</td>
            <td>${item.category || '미분류'}</td>
            <td>${item.rank || '-'}</td>
            <td>${item.brand || '-'}</td>
            <td>${item.product}</td>
            <td>${formatPrice(item.originalPrice)}</td>
            <td>${formatPrice(item.salePrice)}</td>
            <td>${formatEvent(item.event || '-')}</td>
        `;
        tbody.appendChild(row);
    });
}

// 가격 포맷팅 함수 추가
function formatPrice(price) {
    if (!price || price === '-' || price === 'X') return '-';
    // 숫자만 추출
    const numStr = price.toString().replace(/\D/g, '');
    if (!numStr) return '-';
    // 천 단위 콤마 추가
    const formatted = numStr.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `${formatted}원`;
}

// 행사 정보 포맷팅 함수 추가
function formatEvent(event) {
    if (!event || event === '-' || event === 'X') return '-';
    // 슬래시(/), 줄바꿈, 쉼표, 슬래시로 구분된 항목들을 분리
    const items = event
        .split(/[\,\n\/]+/)  // 쉼표, 줄바꿈, 슬래시로 분리
        .map(item => item.trim())
        .filter(item => item);
    if (items.length === 0) return '-';
    // pill 스타일로 통일
    return items.map(item => `<span class="event-pill">${item}</span>`).join(' ');
}

// 랭킹 업데이트
async function fetchRankings(category, date) {
    try {
        const res = await fetch(`/api/rankings?category=${encodeURIComponent(category)}&date=${encodeURIComponent(date)}`);
        const data = await res.json();
        updateTable(data.rankings, data.latestCrawl);
    } catch (err) {
        console.error("오류 발생:", err);
    }
}

// 랭킹 테이블 업데이트
function updateTable(rankings, latestCrawl) {
    const tbody = document.querySelector('#rankingTable tbody');
    tbody.innerHTML = '';

    if (!Array.isArray(rankings) || rankings.length === 0) {
        const row = document.createElement('tr');
        row.innerHTML = `<td colspan="8">데이터가 없습니다.</td>`;
        tbody.appendChild(row);
        return;
    }

    // 업데이트 시간 표시
    if (latestCrawl) {
        const updateTimeDiv = document.getElementById('rankingUpdateTime');
        updateTimeDiv.textContent = formatTimeAgo(latestCrawl);
    }

    // 가장 최근 크롤링 데이터만 표시
    const latestCrawlTime = rankings[0]?.crawled_at;
    const latestRankings = rankings.filter(item => item.crawled_at === latestCrawlTime);

    latestRankings.forEach(item => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${formatDate(item.date)} ${item.crawled_at_formatted}</td>
            <td>${item.category}</td>
            <td>${item.rank}</td>
            <td>${item.brand}</td>
            <td>${item.product}</td>
            <td>${formatPrice(item.originalPrice)}</td>
            <td>${formatPrice(item.salePrice)}</td>
            <td>${formatEvent(item.event)}</td>
        `;
        tbody.appendChild(row);
    });
}

// 시간 경과 표시 함수
function formatTimeAgo(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffInSeconds = Math.floor((now - date) / 1000);
    
    if (diffInSeconds < 60) {
        return '방금 전 업데이트';
    } else if (diffInSeconds < 3600) {
        const minutes = Math.floor(diffInSeconds / 60);
        return `${minutes}분 전 업데이트`;
    } else if (diffInSeconds < 86400) {
        const hours = Math.floor(diffInSeconds / 3600);
        const minutes = Math.floor((diffInSeconds % 3600) / 60);
        return `${hours}시간 ${minutes}분 전 업데이트`;
    } else {
        const days = Math.floor(diffInSeconds / 86400);
        return `${days}일 전 업데이트`;
    }
}

// 랭킹 테이블
function formatDate(dateString) {
    const date = new Date(dateString);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}.<br>${month}.${day}`;
}

function getRankChangeHTML(rankChange, amount) {
    if (!rankChange) return '';
    
    const colors = {
        up: '#28a745',    // 초록색
        down: '#dc3545',  // 빨간색
        same: '#6c757d',  // 회색
        new: '#0d6efd'    // 파란색
    };
    
    const arrows = {
        up: '▲',
        down: '▼',
        same: '−',
        new: 'NEW'
    };
    
    const color = colors[rankChange];
    const arrow = arrows[rankChange];
    
    return `<span style="color: ${color}; margin-left: 5px; font-weight: bold;">${arrow}${amount ? `(${amount})` : ''}</span>`;
}

async function fetchRankingsByRange(category, startDate, endDate) {
    // 파라미터 유효성 검사
    if (!category || !startDate || !endDate) {
        alert('카테고리와 날짜를 모두 선택하세요.');
        return;
    }
    console.log('카테고리/날짜 범위:', category, startDate, endDate);
    try {
        const res = await fetch(
            `/api/rankings-range?category=${encodeURIComponent(category)}&startDate=${startDate}&endDate=${endDate}`
        );
        if (!res.ok) {
            const errorText = await res.text();
            console.error('실시간 랭킹 조회 오류:', errorText);
            showNotification(`실시간 랭킹 조회 오류: ${errorText}`, 3000);
            return;
        }
        let data;
        try {
            data = await res.json();
        } catch (parseError) {
            console.error('실시간 랭킹 조회 오류: 응답 파싱 실패', parseError);
            showNotification('실시간 랭킹 조회 오류: 응답 파싱 실패', 3000);
            return;
        }
        console.log('서버 응답 데이터:', data);
        updateTable(data.rankings, data.latestCrawl);
    } catch (err) {
        console.error('실시간 랭킹 조회 오류:', err);
        showNotification('실시간 랭킹 조회 오류', 3000);
    }
}

document.getElementById('downloadExcelBtn').addEventListener('click', () => {
    const category = document.getElementById('category').value;
    const startDate = document.getElementById('startDate').value;
    const endDate = document.getElementById('endDate').value;

    if (!category || !startDate || !endDate) {
        alert('카테고리와 날짜 범위를 선택하세요.');
        return;
    }

    const url = `/api/download?category=${encodeURIComponent(category)}&startDate=${startDate}&endDate=${endDate}`;

    fetch(url)
        .then(response => {
            if (!response.ok) {
                throw new Error('엑셀 다운로드 실패');
            }
            return response.blob();
        })
        .then(blob => {
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `Oliveyoung_ranking_${startDate}~${endDate}.xlsx`;
            link.click();
        })
        .catch(error => {
            console.error('엑셀 다운로드 실패:', error);
            alert('엑셀 다운로드 실패');
        });
});

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('productSearchDownloadBtn')?.addEventListener('click', () => {
        const keyword = document.getElementById('productSearchInput').value.trim();
        const startDate = document.getElementById('startDate').value;
        const endDate = document.getElementById('endDate').value;

        if (!keyword || !startDate || !endDate) {
            alert('검색어와 날짜 범위를 모두 입력하세요.');
            return;
        }
        const url = `/api/download-search?keyword=${encodeURIComponent(keyword)}&startDate=${startDate}&endDate=${endDate}`;

        fetch(url)
            .then(response => {
                if (!response.ok) throw new Error('엑셀 다운로드 실패');
                return response.blob();
            })
            .then(blob => {
                const link = document.createElement('a');
                link.href = URL.createObjectURL(blob);
                link.download = `제품명_검색_${startDate}~${endDate}.xlsx`;
                link.click();
            })
            .catch(error => {
                console.error('엑셀 다운로드 실패:', error);
                alert('엑셀 다운로드 실패');
            });
    });
});

document.addEventListener('DOMContentLoaded', () => {
    const categoryEl = document.getElementById('category');
    const startDateEl = document.getElementById('startDate');
    const endDateEl = document.getElementById('endDate');
    const searchBtn = document.getElementById('searchBtn');

    const today = new Date(new Date().getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    if (!startDateEl.value) startDateEl.value = today;
    if (!endDateEl.value) endDateEl.value = today;

    searchBtn.addEventListener('click', () => {
        const category = categoryEl.value;
        const startDate = startDateEl.value;
        const endDate = endDateEl.value;

        // 날짜 유효성 검사
        if (new Date(startDate) > new Date(endDate)) {
            alert('시작일이 종료일보다 늦을 수 없습니다.');
            return;
        }

        fetchRankingsByRange(category, startDate, endDate);
    });
});

document.getElementById('productSearchBtn').addEventListener('click', searchByProductName);
document.getElementById('productSearchInput').addEventListener('keydown', function (event) {
    if (event.key === 'Enter') {
        searchByProductName();
    }
});

// DOM이 로드된 후에 이벤트 리스너 등록
document.addEventListener('DOMContentLoaded', function() {
    console.log('문서 로드 완료');
    
    // 캡처 버튼 이벤트 리스너
    const captureBtn = document.getElementById('captureBtn');
    if (captureBtn) {
        console.log('캡처 버튼 초기화');
        captureBtn.addEventListener('click', captureScreen);
    } else {
        console.error('캡처 버튼을 찾을 수 없습니다');
    }
    
    // 캡처 목록 버튼 이벤트 리스너
    const showCapturesBtn = document.getElementById('showCapturesBtn');
    if (showCapturesBtn) {
        console.log('캡처 목록 버튼 초기화');
        showCapturesBtn.addEventListener('click', showCaptureList);
    } else {
        console.error('캡처 목록 버튼을 찾을 수 없습니다');
    }
    
    // 모달 닫기 버튼 이벤트 설정
    const closeModalBtn = document.querySelector('#captureListModal .btn-close');
    if (closeModalBtn) {
        console.log('모달 닫기 버튼 초기화');
        closeModalBtn.addEventListener('click', closeCaptureListModal);
    }
    
    // 모달 닫기 푸터 버튼 이벤트 설정
    const closeModalFooterBtn = document.querySelector('#captureListModal .btn-close-modal');
    if (closeModalFooterBtn) {
        console.log('모달 푸터 닫기 버튼 초기화');
        closeModalFooterBtn.addEventListener('click', closeCaptureListModal);
    }
    
    // IndexedDB 초기화
    initIndexedDB().catch(error => console.error('IndexedDB 초기화 오류:', error));

    // 날짜 선택 input 초기화
    const today = new Date();
    
    // endDate input에 오늘 날짜 설정
    const endDateInput = document.getElementById('endDate');
    endDateInput.value = today.toISOString().split('T')[0];
    
    // startDate input에 3일 전 날짜 설정
    const startDateInput = document.getElementById('startDate');
    const threeDaysAgo = new Date(today);
    threeDaysAgo.setDate(today.getDate() - 3);
    startDateInput.value = threeDaysAgo.toISOString().split('T')[0];
});

// 타임스탬프를 사용자 친화적인 형식으로 포맷팅하는 함수
function formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    
    // 날짜 및 시간 형식: YYYY-MM-DD HH:MM:SS
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

// 캡처를 IndexedDB에 저장하는 함수
function saveCaptureToDB(imageData, fileName, id) {
    return new Promise((resolve, reject) => {
        if (!db) {
            console.error('IndexedDB가 초기화되지 않았습니다.');
            return reject(new Error('IndexedDB가 초기화되지 않았습니다.'));
        }
        
        try {
            console.log('IndexedDB에 캡처 저장 시작');
            const transaction = db.transaction(['captures'], 'readwrite');
            const store = transaction.objectStore('captures');
            
            // 저장할 데이터 구성
            const dataToStore = {
                id: id || Date.now(),
                imageData: imageData,
                fileName: fileName,
                timestamp: new Date().toISOString(),
                created: new Date().toISOString()
            };
            
            console.log('저장할 데이터:', {
                id: dataToStore.id,
                fileName: dataToStore.fileName,
                timestamp: dataToStore.timestamp
            });
            
            const request = store.put(dataToStore);
            
            request.onsuccess = () => {
                console.log('캡처가 IndexedDB에 성공적으로 저장되었습니다.');
                // 오래된 데이터 정리
                cleanupOldCaptures().then(() => resolve());
            };
            
            request.onerror = (event) => {
                console.error('IndexedDB 저장 오류:', event.target.error);
                reject(event.target.error);
            };
            
            transaction.oncomplete = () => {
                console.log('IndexedDB 트랜잭션이 완료되었습니다.');
            };
            
            transaction.onerror = (event) => {
                console.error('IndexedDB 트랜잭션 오류:', event.target.error);
                reject(event.target.error);
            };
        } catch (error) {
            console.error('IndexedDB 작업 중 오류:', error);
            reject(error);
        }
    });
}

// 알림 메시지 표시 함수 개선
function showNotification(message, duration = 2000) {
    // 기존 알림 제거
    const existingNotification = document.querySelector('.notification');
    if (existingNotification) {
        existingNotification.remove();
    }
    
    // 새 알림 생성
    const notification = document.createElement('div');
    notification.className = 'notification';
    notification.textContent = message;
    
    // 문서에 추가
    document.body.appendChild(notification);
    
    // 표시 애니메이션
    setTimeout(() => {
        notification.classList.add('show');
    }, 10);
    
    // 일정 시간 후 제거
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => {
            notification.remove();
        }, 300);
    }, duration);
}

// 캡처 목록을 보여주는 함수 업데이트 - 미리보기 버튼 제거
function showCaptureList() {
    console.log('캡처 목록 표시 함수 호출됨');
    
    const modal = document.getElementById('captureListModal');
    const container = document.getElementById('captureListContainer');
    
    if (!modal || !container) {
        console.error('캡처 목록 모달 또는 컨테이너를 찾을 수 없습니다');
        return;
    }
    
    // 모달 표시 (애니메이션 효과 적용)
    modal.classList.add('show');
    modal.style.display = 'block';
    
    // 컨테이너 초기화
    container.innerHTML = '<p style="text-align: center; padding: 20px; color: #888;">캡처 목록을 불러오는 중...</p>';
    
    try {
        // 로컬 스토리지에서 캡처 목록 불러오기
        let captures = [];
        const capturesJSON = localStorage.getItem('captures');
        
        if (capturesJSON) {
            captures = JSON.parse(capturesJSON);
            console.log(`로컬 스토리지에서 ${captures.length}개의 캡처 항목을 불러왔습니다:`, captures);
        }
        
        // 컨테이너 내용 업데이트
        container.innerHTML = '';
        
        // 전체 삭제 버튼 추가
        const headerDiv = document.createElement('div');
        headerDiv.style.display = 'flex';
        headerDiv.style.justifyContent = 'space-between';
        headerDiv.style.alignItems = 'center';
        headerDiv.style.marginBottom = '15px';
        headerDiv.style.padding = '10px';
        headerDiv.style.borderBottom = '1px solid #ddd';
        
        headerDiv.innerHTML = `
            <h3 style="margin: 0; font-size: 18px;"></h3>
            <button onclick="resetCaptureData()" style="background-color: #ff4444; color: white; border: none; border-radius: 4px; padding: 8px 15px; cursor: pointer;">전체 삭제</button>
        `;
        container.appendChild(headerDiv);
        
        if (!captures || captures.length === 0) {
            // 캡처 없을 경우 메시지 표시
            container.innerHTML += '<p style="text-align: center; padding: 20px; color: #888;">저장된 캡처가 없습니다.</p>';
            return;
        }
        
        // 각 캡처 항목 렌더링
        captures.forEach((capture, index) => {
            // 이미지 데이터 접근 - 여러 가능한 필드명 대응
            const imageUrl = capture.dataUrl || capture.imageData || capture.data;
            if (!imageUrl) {
                console.warn(`캡처 #${index}에 이미지 데이터가 없습니다:`, capture);
                return;
            }
            
            // 캡처 ID 설정
            const captureId = capture.id || Date.now() + index;
            
            // 파일명 가져오기
            let displayFileName = '이름 없음';
            if (capture.customName) {
                displayFileName = capture.customName;
            } else if (capture.fileName) {
                displayFileName = capture.fileName;
            }
            
            // 날짜 포맷팅
            let timestamp;
            try {
                timestamp = new Date(capture.timestamp || capture.created || Date.now());
            } catch (e) {
                timestamp = new Date();
            }
            
            const formattedDate = `${timestamp.getFullYear()}-${String(timestamp.getMonth() + 1).padStart(2, '0')}-${String(timestamp.getDate()).padStart(2, '0')} ${String(timestamp.getHours()).padStart(2, '0')}:${String(timestamp.getMinutes()).padStart(2, '0')}:${String(timestamp.getSeconds()).padStart(2, '0')}`;
            
            // 캡처 항목 생성
            const item = document.createElement('div');
            item.className = 'capture-item';
            item.setAttribute('data-id', captureId);
            
            item.innerHTML = `
                <img src="${imageUrl}" alt="Capture ${index + 1}" onclick="enlargeImage(this.src)">
                <div class="capture-info">
                    <p class="capture-filename"><strong>파일명:</strong> ${displayFileName}</p>
                    <p class="capture-timestamp"><strong>캡처 날짜:</strong> ${formattedDate}</p>
                </div>
                <div class="capture-actions">
                    <button class="btn-download" onclick="downloadCapture('${captureId}')">다운로드</button>
                    <button class="btn-delete" onclick="deleteCapture('${captureId}')">삭제</button>
                </div>
            `;
            
            container.appendChild(item);
        });
        
        // ESC 키로 모달 닫기 기능 추가
        document.addEventListener('keydown', closeModalOnEscape);
        
        // 모달 외부 클릭 시 닫기 기능 추가
        modal.addEventListener('click', closeModalOnOutsideClick);
        
    } catch (error) {
        console.error('캡처 목록 표시 중 오류 발생:', error);
        container.innerHTML = `<p style="text-align: center; padding: 20px; color: #ff4444;">
            캡처 목록을 불러오는 중 오류가 발생했습니다.<br>
            ${error.message}
        </p>`;
    }
}

// 모달 닫기 함수 개선
function closeCaptureListModal() {
    console.log('캡처 목록 모달 닫기 시도');
    
    const modal = document.getElementById('captureListModal');
    if (modal) {
        // 클래스와 스타일 모두 변경하여 확실히 닫히도록 함
        modal.classList.remove('show');
        modal.style.display = 'none';
        
        // 이벤트 리스너 제거
        document.removeEventListener('keydown', closeModalOnEscape);
        modal.removeEventListener('click', closeModalOnOutsideClick);
        
        // 스크롤 복원
        document.body.style.overflow = '';
        
        console.log('캡처 목록 모달 닫기 완료');
    } else {
        console.error('캡처 목록 모달 요소를 찾을 수 없습니다');
    }
}

// ESC 키로 모달 닫기
function closeModalOnEscape(event) {
    if (event.key === 'Escape') {
        closeCaptureListModal();
    }
}

// 모달 외부 클릭 시 닫기
function closeModalOnOutsideClick(event) {
    const modal = document.getElementById('captureListModal');
    const modalContent = modal.querySelector('.modal-content');
    
    if (modal && modalContent && !modalContent.contains(event.target)) {
        closeCaptureListModal();
    }
}

// 이미지 확대 표시 함수 추가
function enlargeImage(src) {
    const modal = document.createElement('div');
    modal.className = 'img-enlarged-modal';
    modal.style.position = 'fixed';
    modal.style.top = '0';
    modal.style.left = '0';
    modal.style.width = '100%';
    modal.style.height = '100%';
    modal.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
    modal.style.zIndex = '2000';
    modal.style.display = 'flex';
    modal.style.justifyContent = 'center';
    modal.style.alignItems = 'center';
    modal.style.opacity = '0';
    modal.style.transition = 'opacity 0.3s ease';
    
    const img = document.createElement('img');
    img.src = src;
    img.style.maxWidth = '90%';
    img.style.maxHeight = '90%';
    img.style.border = '2px solid white';
    img.style.borderRadius = '5px';
    img.style.boxShadow = '0 0 20px rgba(0, 0, 0, 0.7)';
    img.style.transform = 'scale(0.9)';
    img.style.transition = 'transform 0.3s ease';
    
    modal.appendChild(img);
    document.body.appendChild(modal);
    
    // 애니메이션 효과
    setTimeout(() => {
        modal.style.opacity = '1';
        img.style.transform = 'scale(1)';
    }, 10);
    
    // 클릭 시 닫기
    modal.addEventListener('click', () => {
        modal.style.opacity = '0';
        img.style.transform = 'scale(0.9)';
        setTimeout(() => {
            document.body.removeChild(modal);
        }, 300);
    });
}

// IndexedDB를 초기화하는 함수
let db;
function initIndexedDB() {
    return new Promise((resolve, reject) => {
        console.log('IndexedDB 초기화 시작');
        
        // 기존 로컬 스토리지의 captureList 항목 삭제 (이전 데이터로 인한 충돌 방지)
        try {
            localStorage.removeItem('captureList');
            console.log('로컬 스토리지의 captureList 항목이 삭제되었습니다.');
        } catch (e) {
            console.warn('로컬 스토리지 삭제 실패:', e);
        }
        
        // 이미 열려있는 연결이 있는지 확인
        if (db) {
            console.log('기존 IndexedDB 연결이 있습니다. 이 연결을 사용합니다.');
            return resolve(db);
        }
        
        // IndexedDB 열기
        const request = indexedDB.open('CaptureDB', 1);
        
        request.onerror = (event) => {
            console.error('IndexedDB 오류:', event.target.error);
            reject(new Error('IndexedDB를 열 수 없습니다: ' + event.target.error));
        };
        
        request.onupgradeneeded = (event) => {
            console.log('IndexedDB 업그레이드 중...');
            const db = event.target.result;
            
            // 객체 저장소(테이블) 생성, id를 키로 사용
            if (!db.objectStoreNames.contains('captures')) {
                const store = db.createObjectStore('captures', { keyPath: 'id', autoIncrement: true });
                // 인덱스 생성
                store.createIndex('timestamp', 'timestamp', { unique: false });
                console.log('captures 객체 저장소 생성됨');
            }
        };
        
        request.onsuccess = (event) => {
            db = event.target.result;
            console.log('IndexedDB가 성공적으로 열렸습니다.');
            
            // DB 연결 오류 시 이벤트 핸들러
            db.onerror = (event) => {
                console.error('IndexedDB 오류:', event.target.error);
            };
            
            resolve(db);
        };
    });
}

// IndexedDB에서 모든 캡처를 가져오는 함수
function loadCapturesFromDB() {
    return new Promise((resolve, reject) => {
        if (!db) {
            console.error('IndexedDB가 초기화되지 않았습니다.');
            return reject(new Error('IndexedDB가 초기화되지 않았습니다.'));
        }
        
        try {
            console.log('IndexedDB에서 캡처 데이터 로드 시작');
            const transaction = db.transaction(['captures'], 'readonly');
            const store = transaction.objectStore('captures');
            
            // 모든 캡처 가져오기
            const request = store.getAll();
            
            request.onsuccess = () => {
                const captures = request.result || [];
                
                // 타임스탬프로 정렬 (최신 순)
                captures.sort((a, b) => {
                    return new Date(b.timestamp || 0) - new Date(a.timestamp || 0);
                });
                
                console.log(`IndexedDB에서 ${captures.length}개의 캡처를 로드했습니다.`);
                
                if (captures.length === 0) {
                    // 데이터가 없는 경우 로컬 스토리지 확인
                    try {
                        const localCaptures = JSON.parse(localStorage.getItem('captureList') || '[]');
                        if (localCaptures.length > 0) {
                            console.log(`로컬 스토리지에서 ${localCaptures.length}개의 캡처를 찾았습니다.`);
                            // 로컬 스토리지 데이터를 IndexedDB로 이전
                            localCaptures.forEach(capture => {
                                saveCaptureToDB({
                                    ...capture,
                                    timestamp: capture.timestamp || new Date().toISOString()
                                }).catch(e => console.warn('로컬 데이터 이전 실패:', e));
                            });
                            return resolve(localCaptures);
                        }
                    } catch (e) {
                        console.warn('로컬 스토리지 확인 실패:', e);
                    }
                }
                
                resolve(captures);
            };
            
            request.onerror = (event) => {
                console.error('캡처 로드 중 오류:', event.target.error);
                reject(new Error('캡처 데이터를 로드할 수 없습니다: ' + event.target.error));
            };
            
            transaction.oncomplete = () => {
                console.log('IndexedDB 읽기 트랜잭션 완료');
            };
            
            transaction.onerror = (event) => {
                console.error('IndexedDB 트랜잭션 오류:', event.target.error);
                reject(new Error('IndexedDB 트랜잭션 오류: ' + event.target.error));
            };
        } catch (error) {
            console.error('캡처 로드 중 오류:', error);
            reject(new Error('캡처 데이터 로드 중 예외 발생: ' + error.message));
        }
    });
}

// 데이터베이스 초기화 함수 (긴급 상황용)
function resetCaptureDB() {
    if (confirm('주의: 이 작업은 모든 캡처 데이터를 삭제합니다. 계속하시겠습니까?')) {
        // 전역 DB 변수 초기화
        if (db) {
            db.close();
            db = null;
        }
        
        // IndexedDB 삭제
        const deleteRequest = indexedDB.deleteDatabase('CaptureDB');
        
        deleteRequest.onsuccess = () => {
            console.log('IndexedDB 삭제 성공');
            alert('데이터베이스가 초기화되었습니다. 페이지를 새로고침 합니다.');
            // 페이지 새로고침
            window.location.reload();
        };
        
        deleteRequest.onerror = (event) => {
            console.error('IndexedDB 삭제 오류:', event.target.error);
            alert('데이터베이스 초기화 중 오류가 발생했습니다: ' + event.target.error);
        };
    }
}

// 전역 함수로 등록
window.resetCaptureDB = resetCaptureDB;

// 오래된 캡처를 정리하는 함수 (최신 5개만 유지)
function cleanupOldCaptures() {
    return new Promise((resolve, reject) => {
        if (!db) {
            return resolve(); // DB가 초기화되지 않았으면 건너뜀
        }
        
        try {
            const transaction = db.transaction(['captures'], 'readwrite');
            const store = transaction.objectStore('captures');
            const index = store.index('timestamp');
            
            // 모든 캡처 가져오기
            const request = index.getAll();
            
            request.onsuccess = () => {
                const captures = request.result;
                
                if (captures.length > 5) {
                    console.log(`총 ${captures.length}개 캡처 중 오래된 항목 정리 중...`);
                    
                    // 타임스탬프로 정렬 (최신 순)
                    captures.sort((a, b) => {
                        return new Date(b.timestamp) - new Date(a.timestamp);
                    });
                    
                    // 오래된 항목 삭제 (최신 5개 이후의 항목)
                    const keysToDelete = captures.slice(5).map(item => item.id);
                    
                    keysToDelete.forEach(key => {
                        store.delete(key);
                    });
                    
                    console.log(`${keysToDelete.length}개의 오래된 캡처가 삭제되었습니다.`);
                }
                
                resolve();
            };
            
            request.onerror = (event) => {
                console.error('캡처 정리 중 오류:', event.target.error);
                reject(event.target.error);
            };
        } catch (error) {
            console.error('캡처 정리 중 오류:', error);
            resolve(); // 오류가 있어도 진행
        }
    });
}

// 캡처 다운로드 함수
function downloadCapture(captureId, fileName) {
    console.log('캡처 다운로드 시작:', captureId);
}

// 크롤링 시각 표시 함수 개선
async function showLastCrawled() {
    try {
        const res = await fetch('/api/last-crawled');
        if (!res.ok) {
            throw new Error('Failed to fetch last crawled time');
        }
        const data = await res.json();
        const last = data.lastCrawled;
        
        // 제품명 검색 테이블과 랭킹 테이블 위에 크롤링 시각 표시
        const tables = ['productSearchTable', 'rankingTable'];
        
        tables.forEach(tableId => {
            const table = document.getElementById(tableId);
            if (!table) return;
            
            let infoDiv = document.getElementById(`${tableId}LastCrawled`);
            if (!infoDiv) {
                infoDiv = document.createElement('div');
                infoDiv.id = `${tableId}LastCrawled`;
                infoDiv.className = 'last-crawled-info';
                table.parentNode.insertBefore(infoDiv, table);
            }

            if (!last) {
                infoDiv.innerHTML = `
                    <div class="crawl-status">
                        <span class="crawl-icon">🔄</span>
                        <span class="crawl-text">크롤링 정보 없음</span>
                    </div>
                `;
                return;
            }

            const lastDate = new Date(last);
            const now = new Date();
            const diffMs = now - lastDate;
            const diffMin = Math.floor(diffMs / 60000);
            
            let statusText = '';
            let statusClass = '';
            
            if (diffMin <= 1) {
                statusText = '방금 전 업데이트';
                statusClass = 'recent';
            } else if (diffMin < 60) {
                statusText = `${diffMin}분 전 업데이트`;
                statusClass = 'recent';
            } else {
                const h = Math.floor(diffMin / 60);
                const m = diffMin % 60;
                statusText = `${h}시간 ${m}분 전 업데이트`;
                statusClass = diffMin > 180 ? 'outdated' : 'normal'; // 3시간 이상이면 outdated
            }

            const formattedTime = lastDate.toLocaleTimeString('ko-KR', {
                hour: '2-digit',
                minute: '2-digit'
            });

            infoDiv.innerHTML = `
                <div class="crawl-status ${statusClass}">
                    <span class="crawl-icon">🔄</span>
                    <span class="crawl-text">${statusText}</span>
                    <span class="crawl-time">(${formattedTime} 기준)</span>
                    ${statusClass === 'outdated' ? '<span class="crawl-warning">⚠️ 3시간 이상 경과</span>' : ''}
                </div>
            `;
        });
    } catch (error) {
        console.error('Error showing last crawled time:', error);
    }
}

// 페이지 로드시와 주기적으로 크롤링 시각 업데이트
document.addEventListener('DOMContentLoaded', () => {
    showLastCrawled();
    // 1분마다 크롤링 시각 업데이트
    setInterval(showLastCrawled, 60000);
});

// 크롤링 시각 표시를 위한 스타일 추가
const style = document.createElement('style');
style.textContent = `
    .last-crawled-info {
        margin: 10px 0;
        padding: 8px 12px;
        border-radius: 6px;
        background-color: #f8f9fa;
        font-size: 14px;
    }

    .crawl-status {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .crawl-icon {
        animation: spin 2s linear infinite;
    }

    .crawl-text {
        font-weight: 500;
    }

    .crawl-time {
        color: #666;
    }

    .crawl-warning {
        color: #dc3545;
        margin-left: auto;
    }

    .crawl-status.recent .crawl-text {
        color: #28a745;
    }

    .crawl-status.normal .crawl-text {
        color: #0d6efd;
    }

    .crawl-status.outdated .crawl-text {
        color: #dc3545;
    }

    @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }
`;
document.head.appendChild(style);