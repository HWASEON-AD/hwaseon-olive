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
            `https://hwaseonad.onrender.com/api/search-range?keyword=${encodeURIComponent(keyword)}&startDate=${startDate}&endDate=${endDate}`
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



function updateSearchTable(results) {
    const tbody = document.querySelector('#productSearchTable tbody');
    tbody.innerHTML = '';

    if (!Array.isArray(results) || results.length === 0) {
        const row = document.createElement('tr');
        row.innerHTML = `<td colspan="7">검색 결과가 없습니다.</td>`;
        tbody.appendChild(row);
        return;
    }

    
    results.forEach(item => {
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



async function fetchRankings(category, date) {
    try {
        const res = await fetch(`https://hwaseonad.onrender.com/api/rankings?category=${category}&date=${date}`);
        const data = await res.json();
        updateTable(data);
    } catch (err) {
        console.error("오류 발생:", err);
    }
}   



async function fetchRankingsByRange(category, startDate, endDate) {
    try {
        const res = await fetch(
            `https://hwaseonad.onrender.com/api/rankings-range?category=${encodeURIComponent(category)}&startDate=${startDate}&endDate=${endDate}`
        );
        const data = await res.json();
        updateTable(data);
    } catch (err) {
        console.error("날짜 범위 검색 오류:", err);
    }
}



function updateTable(rankings) {
    const tbody = document.querySelector('#rankingTable tbody');
    tbody.innerHTML = '';

    if (!Array.isArray(rankings) || rankings.length === 0) {
        const row = document.createElement('tr');
        row.innerHTML = `<td colspan="7">데이터가 없습니다.</td>`;
        tbody.appendChild(row);
        return;
    }

    // 날짜 오름차순 정렬
    rankings.sort((a, b) => new Date(a.date) - new Date(b.date));

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



document.getElementById('downloadExcelBtn').addEventListener('click', () => {
    const category = document.getElementById('category').value;
    const startDate = document.getElementById('startDate').value;
    const endDate = document.getElementById('endDate').value;

    if (!category || !startDate || !endDate) {
        alert('카테고리와 날짜 범위를 선택하세요.');
        return;
    }

    const url = `https://hwaseonad.onrender.com/api/download?category=${encodeURIComponent(category)}&startDate=${startDate}&endDate=${endDate}`;

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
        const url = `https://hwaseonad.onrender.com/api/download-search?keyword=${encodeURIComponent(keyword)}&startDate=${startDate}&endDate=${endDate}`;

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
// 당일 랭킹 업데이트
    fetchRankings(categoryEl.value, startDateEl.value);
});



document.getElementById('productSearchInput').addEventListener('click', searchByProductName);
document.getElementById('productSearchInput').addEventListener('keydown', function (event) {
    if (event.key === 'Enter') {
        searchByProductName();
    }
});


