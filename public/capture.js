// 캡처 목록 관련 기능
document.getElementById('captureBtn').addEventListener('click', function() {
    showCaptureList();
});

function showCaptureList() {
    // 모달 요소 가져오기
    const modal = document.getElementById('captureListModal');
    const modalBody = modal.querySelector('.modal-body');

    // 캡처 목록 데이터 가져오기
    fetch('/api/captures')
        .then(response => response.json())
        .then(captures => {
            // 캡처 목록 HTML 생성
            const capturesHtml = captures.map(capture => `
                <div class="capture-item">
                    <img src="${capture.imageUrl}" alt="Captured image" style="max-width: 200px;">
                    <div class="capture-info">
                        <p>캡처 시간: ${new Date(capture.timestamp).toLocaleString()}</p>
                        <button onclick="deleteCapture('${capture.id}')" class="btn btn-danger btn-sm">삭제</button>
                    </div>
                </div>
            `).join('');

            // 모달 내용 업데이트
            modalBody.innerHTML = capturesHtml || '<p>캡처된 이미지가 없습니다.</p>';

            // 모달 표시
            modal.classList.add('show');
        })
        .catch(error => {
            console.error('캡처 목록을 가져오는 중 오류 발생:', error);
            modalBody.innerHTML = '<p>캡처 목록을 불러오는데 실패했습니다.</p>';
            modal.classList.add('show');
        });
}

function deleteCapture(captureId) {
    if (confirm('이 캡처를 삭제하시겠습니까?')) {
        fetch(`/api/captures/${captureId}`, {
            method: 'DELETE'
        })
        .then(response => {
            if (response.ok) {
                showCaptureList(); // 목록 새로고침
            } else {
                throw new Error('삭제 실패');
            }
        })
        .catch(error => {
            console.error('캡처 삭제 중 오류 발생:', error);
            alert('캡처를 삭제하는데 실패했습니다.');
        });
    }
}

// 모달 닫기 버튼
document.querySelector('.btn-close').addEventListener('click', function() {
    document.getElementById('captureListModal').classList.remove('show');
});

// 모달 외부 클릭 시 닫기
window.addEventListener('click', function(event) {
    const modal = document.getElementById('captureListModal');
    if (event.target === modal) {
        modal.classList.remove('show');
    }
}); 