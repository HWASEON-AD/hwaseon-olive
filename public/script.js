// Disable debug logs
console.log = function() {};

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
        // 서버에 요청 보내기
        const res = await fetch(
            `/api/search-range?keyword=${encodeURIComponent(keyword)}&startDate=${startDate}&endDate=${endDate}`
        );
        if (!res.ok) {
            const errorText = await res.text();  // 서버에서 반환한 오류 메시지 확인
            console.error('서버 오류:', errorText); 
            throw new Error('서버 오류');
        }
        const data = await res.json();
        updateSearchTable(data);  // 테이블에 결과 출력
    } catch (err) {
        console.error("검색 오류:", err);
    }
}


async function showLastUpdatedTime() {
    try {
        const res = await fetch('/api/last-updated');
        const data = await res.json();

        const updatedAt = new Date(data.last_updated);
        const now = new Date();

        const diffMs = now - updatedAt;
        const diffMin = Math.floor(diffMs / 1000 / 60);

        const diffHours = Math.floor(diffMin / 60);
        const remainingMinutes = diffMin % 60;

        const hh = updatedAt.getHours().toString().padStart(2, '0');
        const mm = updatedAt.getMinutes().toString().padStart(2, '0');

        let message = '';
        if (diffHours > 0) {
            message = `${diffHours}시간 ${remainingMinutes}분 전 업데이트 (${hh}:${mm})`;
        } else {
            message = `${remainingMinutes}분 전 업데이트 (${hh}:${mm})`;
        }

        document.getElementById('lastUpdatedText').textContent = message;
    } catch (err) {
        console.error('업데이트 시간 불러오기 실패:', err);
        document.getElementById('lastUpdatedText').textContent = '정보 없음';
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
        .split(/[,\n\/]+/)  // 쉼표, 줄바꿈, 슬래시로 분리
        .map(item => item.trim())
        .filter(item => item);
    
    if (items.length === 0) return '-';
    
    // 단일 또는 다중 행사 항목 모두에 스타일된 span을 적용
    return items.map(item => `<span class="event-item">${item}</span>`).join(' ');
}

// 랭킹 업데이트
async function fetchRankings(category, date) {
    try {
        const res = await fetch(`/api/rankings?category=${encodeURIComponent(category)}&date=${encodeURIComponent(date)}`);
        const data = await res.json();
        updateTable(data);
    } catch (err) {
        console.error("오류 발생:", err);
    }
}   


// ... existing code ...
async function fetchRankingsByRange(category, startDate, endDate) {
    console.log('카테고리 값:', category); // 디버깅 로그 추가
    try {
        const res = await fetch(
            `/api/rankings-range?category=${encodeURIComponent(category)}&startDate=${startDate}&endDate=${endDate}`
        );
        const data = await res.json();
        console.log('서버 응답 데이터:', data); // 디버깅 로그 추가
        updateTable(data);
    } catch (err) {
        console.error("날짜 범위 검색 오류:", err);
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

function updateTable(rankings) {
    console.log("업데이트할 랭킹 데이터:", rankings);
    const tbody = document.querySelector('#rankingTable tbody');
    tbody.innerHTML = '';

    if (!Array.isArray(rankings) || rankings.length === 0) {
        const row = document.createElement('tr');
        row.innerHTML = `<td colspan="8">데이터가 없습니다.</td>`;
        tbody.appendChild(row);
        return;
    }

    rankings.forEach(item => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${formatDate(item.date)}</td>
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

        fetchRankingsByRange(category, startDate, endDate);
    });

    // 초기 로드 시 모바일 앱의 실시간 랭킹 표시
    fetchLiveRanking();
    showLastUpdatedTime();
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
    
    // 행사 아이템의 스타일 추가
    const style = document.createElement('style');
    style.textContent = `
        .event-item {
            display: inline-block;
            background-color: #f8f4ff;
            color: #5f2eea;
            padding: 4px 8px;
            border-radius: 5px;
            margin: 4px 6px;
            font-size: 1.1em;
            font-weight: 600;
            border: 1.5px solid #e0d3ff;
            min-width: 60px;
            text-align: center;
        }
    `;
    document.head.appendChild(style);
    
    // IndexedDB 초기화
    initIndexedDB().catch(error => console.error('IndexedDB 초기화 오류:', error));

    const liveBtn = document.getElementById('liveRankingBtn');
    if (liveBtn) {
        liveBtn.addEventListener('click', fetchLiveRanking);
    }
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
    console.log(`캡처 다운로드 요청: ${captureId}`);
    
    if (!captureId) {
        console.error('다운로드할 캡처 ID가 제공되지 않았습니다.');
        alert('다운로드할 캡처를 찾을 수 없습니다.');
        return;
    }
    
    // IndexedDB에서 캡처 데이터 가져오기
    if (db) {
        try {
            const transaction = db.transaction(['captures'], 'readonly');
            const store = transaction.objectStore('captures');
            const request = store.get(captureId);
            
            request.onsuccess = (event) => {
                const capture = event.target.result;
                if (capture) {
                    console.log('캡처 데이터를 성공적으로 로드했습니다:', capture.id);
                    
                    // 파일 이름 설정
                    const downloadFileName = fileName || capture.fileName || `capture_${new Date().toISOString().replace(/:/g, '-').replace(/\./g, '_')}.png`;
                    
                    // 다운로드 링크 생성 및 클릭
                    triggerDownload(capture.imageData, downloadFileName);
                } else {
                    console.error(`ID ${captureId}에 해당하는 캡처를 찾을 수 없습니다.`);
                    alert('다운로드할 캡처를 찾을 수 없습니다.');
                }
            };
            
            request.onerror = (event) => {
                console.error('캡처 데이터 로드 중 오류:', event.target.error);
                alert('캡처 로드 중 오류가 발생했습니다. 다시 시도해주세요.');
                
                // 로컬 스토리지 백업에서 시도
                tryDownloadFromLocalStorage(captureId, fileName);
            };
        } catch (error) {
            console.error('캡처 다운로드 중 오류:', error);
            alert('캡처 다운로드 중 오류가 발생했습니다. 다시 시도해주세요.');
            
            // 로컬 스토리지 백업에서 시도
            tryDownloadFromLocalStorage(captureId, fileName);
        }
    } else {
        console.warn('IndexedDB가 초기화되지 않았습니다. 로컬 스토리지에서 다운로드를 시도합니다.');
        tryDownloadFromLocalStorage(captureId, fileName);
    }
}

// 로컬 스토리지에서 캡처 다운로드 시도
function tryDownloadFromLocalStorage(captureId, fileName) {
    try {
        const captures = JSON.parse(localStorage.getItem('captures') || '[]');
        const capture = captures.find(item => item.id === captureId);
        
        if (capture) {
            console.log('로컬 스토리지에서 캡처 데이터를 찾았습니다:', capture.id);
            
            // 파일 이름 설정
            const downloadFileName = fileName || capture.fileName || `capture_${new Date().toISOString().replace(/:/g, '-').replace(/\./g, '_')}.png`;
            
            // 다운로드 링크 생성 및 클릭
            triggerDownload(capture.imageData, downloadFileName);
        } else {
            console.error(`ID ${captureId}에 해당하는 캡처를 로컬 스토리지에서도 찾을 수 없습니다.`);
            alert('다운로드할 캡처를 찾을 수 없습니다.');
        }
    } catch (error) {
        console.error('로컬 스토리지에서 캡처 로드 중 오류:', error);
        alert('캡처 로드 중 오류가 발생했습니다. 다시 시도해주세요.');
    }
}

// 다운로드 트리거 헬퍼 함수
function triggerDownload(imageData, fileName) {
    if (!imageData) {
        console.error('다운로드할 이미지 데이터가 없습니다.');
        alert('이미지 데이터가 손상되었습니다. 다시 시도해주세요.');
        return;
    }
    
    try {
        // 다운로드 링크 생성
        const downloadLink = document.createElement('a');
        downloadLink.href = imageData;
        downloadLink.download = fileName;
        downloadLink.style.display = 'none';
        
        // 링크를 DOM에 추가하고 클릭 이벤트 발생
        document.body.appendChild(downloadLink);
        downloadLink.click();
        
        // 일정 시간 후 링크 제거
        setTimeout(() => {
            document.body.removeChild(downloadLink);
        }, 100);
        
        console.log(`캡처 다운로드 성공: ${fileName}`);
    } catch (error) {
        console.error('다운로드 링크 생성 중 오류:', error);
        alert('다운로드 중 오류가 발생했습니다. 다시 시도해주세요.');
    }
}

// 캡처 삭제 함수 완전히 재구현
function deleteCapture(captureId) {
    console.log(`캡처 삭제 시작 - ID: ${captureId}`);
    
    // 확인 대화상자 표시
    if (!confirm('이 캡처를 삭제하시겠습니까?')) {
        console.log('사용자가 삭제를 취소했습니다.');
        return;
    }
    
    try {
        // 로컬 스토리지에서 캡처 목록 가져오기
        const capturesStr = localStorage.getItem('captures');
        if (!capturesStr) {
            showNotification('저장된 캡처가 없습니다.');
            return;
        }
        
        let captures = JSON.parse(capturesStr);
        if (!Array.isArray(captures)) {
            captures = [];
        }
        
        // 삭제 전 캡처 수
        const initialCount = captures.length;
        console.log(`삭제 전 캡처 수: ${initialCount}`);
        
        // ID로 항목 필터링 (문자열과 숫자 모두 고려)
        const newCaptures = captures.filter(item => {
            // id가 없는 항목 필터링
            if (!item || !item.id) return false;
            
            // ID 비교 (문자열 또는 숫자 형태 모두 처리)
            const itemId = String(item.id);
            const targetId = String(captureId);
            return itemId !== targetId;
        });
        
        // 삭제 후 캡처 수
        console.log(`삭제 후 캡처 수: ${newCaptures.length}`);
        
        // 실제로 항목이 삭제되었는지 확인
        if (newCaptures.length === initialCount) {
            console.warn(`ID '${captureId}'에 해당하는 캡처를 찾을 수 없습니다.`);
            showNotification('해당 캡처를 찾을 수 없습니다.');
            return;
        }
        
        // 변경된 목록 저장
        localStorage.setItem('captures', JSON.stringify(newCaptures));
        console.log('새 캡처 목록이 저장되었습니다.');
        
        // 화면에서 해당 요소 제거 (data-id 속성 사용)
        const captureElement = document.querySelector(`.capture-item[data-id="${captureId}"]`);
        if (captureElement) {
            captureElement.remove();
            console.log('화면에서 캡처 항목이 제거되었습니다.');
            
            // 목록이 비어있는지 확인
            const container = document.getElementById('captureListContainer');
            if (container && container.children.length === 0) {
                container.innerHTML = '<p style="text-align: center; padding: 20px; color: #888;">저장된 캡처가 없습니다.</p>';
            }
        } else {
            // 요소를 찾지 못했다면 전체 목록 새로고침
            console.log('화면에서 요소를 찾지 못했습니다. 목록을 새로고침합니다.');
            showCaptureList();
        }
    } catch (error) {
        console.error('캡처 삭제 중 오류 발생:', error);
    }
}

// 전체 화면 캡처 함수 수정 - 파일명 먼저 입력 요청
function captureScreen() {
    // 현재 시간을 이용한 기본 파일명 생성 (YYYYMMDD_HHMM 형식)
    const now = new Date();
    const defaultFileName = `캡처_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
    
    // 캡처 전에 사용자에게 파일명 입력 요청
    let customName = prompt('캡처 파일 이름을 작성하세요 (취소하면 자동 생성):', '');
    let fileName = defaultFileName + '.jpg';
    
    // 사용자가 취소를 눌렀는지 확인
    if (customName === null) {
        if (!confirm('자동 생성된 파일명으로 캡처하시겠습니까?')) {
            return; // 취소 시 함수 종료
        }
    } else if (customName.trim() !== '') {
        // 확장자가 없으면 .jpg 추가
        if (!customName.toLowerCase().endsWith('.jpg') && 
            !customName.toLowerCase().endsWith('.jpeg') && 
            !customName.toLowerCase().endsWith('.png')) {
            customName += '.jpg';
        }
        fileName = customName;
    }
    
    // 알림 표시
    showNotification('화면을 캡처하는 중...');
    
    // 전체 화면 캡처 설정
    html2canvas(document.querySelector('.container'), {
        windowWidth: window.innerWidth,
        windowHeight: document.body.scrollHeight,
        scrollX: 0,
        scrollY: 0,
        allowTaint: true,
        useCORS: true,
        logging: false
    }).then(function(canvas) {
        // 캔버스를 데이터 URL로 변환
        const dataUrl = canvas.toDataURL('image/jpeg');
        
        // 고유 ID 생성
        const captureId = 'capture_' + new Date().getTime();
        
        // 캡처 정보 객체 생성
        const captureData = {
            id: captureId,
            dataUrl: dataUrl,
            fileName: fileName,
            customName: customName !== null && customName.trim() !== '' ? customName : null,
            timestamp: new Date().toISOString()
        };
        
        // 기존 캡처 목록에 추가
        let captures = [];
        try {
            const capturesStr = localStorage.getItem('captures');
            if (capturesStr) {
                captures = JSON.parse(capturesStr);
            }
        } catch (e) {
            console.error('캡처 목록 로드 오류:', e);
        }
        
        // 배열 확인 및 추가
        if (!Array.isArray(captures)) {
            captures = [];
        }
        
        captures.push(captureData);
        
        // 로컬 스토리지에 저장
        try {
            localStorage.setItem('captures', JSON.stringify(captures));
            console.log('캡처가 저장되었습니다:', fileName);
        } catch (e) {
            console.error('캡처 저장 오류:', e);
            alert('캡처 저장 중 오류가 발생했습니다: ' + e.message);
        }
    }).catch(function(err) {
        console.error('화면 캡처 오류:', err);
        if (typeof html2canvas === 'undefined') {
            console.error('html2canvas 라이브러리가 로드되지 않았습니다.');
        }
    });
}

// 저장 공간 확보를 위해 오래된 캡처 정리
function cleanupOldCaptures(maxCount = 3) {
    try {
        console.log(`저장 공간 확보를 위해 오래된 캡처 정리 시작 (최대 ${maxCount}개 유지)`);
        
        // 다른 불필요한 데이터 삭제
        localStorage.removeItem('captureList');
        localStorage.removeItem('savedCaptures');
        
        // 현재 캡처 목록 가져오기
        const capturesStr = localStorage.getItem('captures');
        if (!capturesStr) return;
        
        const captures = JSON.parse(capturesStr);
        if (!Array.isArray(captures) || captures.length <= maxCount) return;
        
        // 최신 항목만 유지
        const newCaptures = captures.slice(0, maxCount);
        localStorage.setItem('captures', JSON.stringify(newCaptures));
        
        console.log(`오래된 캡처 정리 완료 (${captures.length} → ${newCaptures.length})`);
    } catch (error) {
        console.error('캡처 정리 중 오류:', error);
    }
}

// 캡처 데이터 초기화 함수 개선 및 전역으로 노출
function resetCaptureData() {
    console.log('캡처 데이터 초기화 시작');
    
    try {
        // 이전에 사용했던 모든 저장소 키 삭제
        localStorage.removeItem('captures');
        localStorage.removeItem('captureList');
        localStorage.removeItem('savedCaptures');
        
        // 새 캡처 배열 초기화
        localStorage.setItem('captures', JSON.stringify([]));
        
        console.log('모든 캡처 데이터가 초기화되었습니다');
        return true;
    } catch (error) {
        console.error('캡처 데이터 초기화 중 오류:', error);
        showNotification('데이터 초기화 중 오류가 발생했습니다.');
        return false;
    }
}

// 전역 함수로 등록
window.resetCaptureData = resetCaptureData;
window.closeCaptureListModal = closeCaptureListModal;
window.deleteCapture = deleteCapture;
window.downloadCapture = downloadCapture;

// 모바일 앱 API용 카테고리 코드 매핑
const mobileCategoryCodes = {
    '스킨케어': '10000010001',
    '마스크팩': '10000010009',
    '클렌징': '10000010010',
    '선케어': '10000010011',
    '메이크업': '10000010002',
    '네일': '10000010012',
    '뷰티소품': '10000010006',
    '더모_코스메틱': '10000010008',
    '맨즈케어': '10000010007',
    '향수_디퓨저': '10000010005',
    '헤어케어': '10000010004',
    '바디케어': '10000010003',
    '건강식품': '10000020001',
    '푸드': '10000020002',
    '구강용품': '10000020003',
    '헬스_건강용품': '10000020005',
    '여성_위생용품': '10000020004',
    '패션': '10000030007',
    '리빙_가전': '10000030005',
    '취미_팬시': '10000030006'
};

// 모바일 앱 실시간 랭킹 조회 함수
async function fetchLiveRanking() {
    const category = document.getElementById('category').value;
    const code = mobileCategoryCodes[category];
    if (!code) {
        alert('알 수 없는 카테고리입니다.');
        return;
    }
    try {
        const url = `/api/mobile-ranking?dispCatNo=900000100100001&fltDispCatNo=${code}&pageIdx=1&rowsPerPage=100`;
        console.log('🔗 실시간 랭킹 요청 URL:', url);
        const res = await fetch(url);
        const data = await res.json();
        const list = data.resultList || data.list || data;
        if (!Array.isArray(list)) {
            console.error('실시간 랭킹 데이터 형식 오류:', data);
            alert('실시간 랭킹 데이터를 불러오지 못했습니다.');
            return;
        }
        const mapped = list.map((item, idx) => ({
            date: new Date().toISOString(),
            category,
            rank: item.rank || idx + 1,
            brand: item.brand || item.makerNm || '',
            product: item.prdNm || item.product || '',
            originalPrice: item.orglSale ? formatPrice(item.orglSale) : '-',
            salePrice: item.prdSale ? formatPrice(item.prdSale) : '-',
            event: item.eventFlags || item.eventTag || '-'
        }));
        updateTable(mapped);
    } catch (err) {
        console.error('실시간 랭킹 조회 오류:', err);
        alert('실시간 랭킹 조회 중 오류가 발생했습니다.');
    }
}

// 전역 바인딩
window.fetchLiveRanking = fetchLiveRanking;





