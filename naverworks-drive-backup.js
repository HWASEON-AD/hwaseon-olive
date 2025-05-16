require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');

const BASE_URL = process.env.BASE_URL || 'http://localhost:5001'; // Render 환경이면 실제 도메인으로 변경

// 1. 네이버웍스 OAuth2 토큰 발급
async function getAccessToken() {
  try {
    const res = await axios.post('https://auth.worksmobile.com/oauth2/v2.0/token', null, {
      params: {
        grant_type: 'client_credentials',
        client_id: process.env.NAVERWORKS_CLIENT_ID,
        client_secret: process.env.NAVERWORKS_CLIENT_SECRET,
        scope: process.env.NAVERWORKS_DRIVE_SCOPE || 'drive'
      }
    });
    return res.data.access_token;
  } catch (err) {
    console.error('토큰 발급 실패:', err.response?.data || err.message);
    throw err;
  }
}

// 2. 폴더 생성 (없으면)
async function createFolderIfNotExists(token, parentId, folderName) {
  try {
    const url = parentId
      ? `https://www.worksapis.com/v1.0/drive/items/${parentId}/children`
      : 'https://www.worksapis.com/v1.0/drive/root/children';
    const listRes = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` }
    });
    let folder = listRes.data.files.find(f => f.name === folderName && f.type === 'folder');
    if (!folder) {
      const res = await axios.post(url, {
        name: folderName,
        type: 'folder'
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      folder = res.data;
      console.log(`폴더 생성: ${folderName}`);
    }
    return folder.id;
  } catch (err) {
    console.error(`폴더 생성 실패 (${folderName}):`, err.response?.data || err.message);
    throw err;
  }
}

// 3. 파일 업로드
async function uploadFile(token, folderId, filePath) {
  try {
    const fileName = path.basename(filePath);
    const form = new FormData();
    form.append('file', fs.createReadStream(filePath));
    form.append('name', fileName);

    await axios.post(`https://www.worksapis.com/v1.0/drive/items/${folderId}/children`, form, {
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${token}`
      }
    });
    console.log(`업로드 성공: ${fileName}`);
  } catch (err) {
    console.error(`업로드 실패 (${filePath}):`, err.response?.data || err.message);
    throw err;
  }
}

// 4. 캡처 파일이 없으면 서버에서 다운로드해서 임시 저장 후 업로드
async function downloadImageToTemp(imageUrl, tempPath) {
  try {
    const res = await axios.get(imageUrl, { responseType: 'stream' });
    const writer = fs.createWriteStream(tempPath);
    await new Promise((resolve, reject) => {
      res.data.pipe(writer);
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
    console.log(`이미지 다운로드 성공: ${imageUrl}`);
  } catch (err) {
    console.error(`이미지 다운로드 실패 (${imageUrl}):`, err.response?.data || err.message);
    throw err;
  }
}

// 5. 날짜/카테고리별 폴더 구조 생성 및 파일 업로드
async function backupFiles() {
  let token;
  try {
    token = await getAccessToken();
    const rootFolderId = await createFolderIfNotExists(token, null, 'hwaseon-olive');

    // 1. 서버에서 캡처 목록 받아오기
    const capturesRes = await axios.get(`${BASE_URL}/api/captures`);
    const captures = capturesRes.data.data;

    for (const capture of captures) {
      const { date, category, fileName, imageUrl } = capture;
      const localDir = path.join(__dirname, 'public', 'captures', date, category);
      const localPath = path.join(localDir, fileName);
      let fileToUpload = localPath;
      let isTemp = false;

      // 파일이 없으면 서버에서 다운로드
      if (!fs.existsSync(localPath)) {
        fs.mkdirSync(localDir, { recursive: true });
        const fullImageUrl = imageUrl.startsWith('http') ? imageUrl : `${BASE_URL}${imageUrl}`;
        await downloadImageToTemp(fullImageUrl, localPath);
        isTemp = true;
      }

      // 네이버웍스 드라이브 폴더 생성
      const dateFolderId = await createFolderIfNotExists(token, rootFolderId, date);
      const categoryFolderId = await createFolderIfNotExists(token, dateFolderId, category);
      await uploadFile(token, categoryFolderId, fileToUpload);

      // 임시로 다운로드한 파일은 삭제
      if (isTemp) {
        fs.unlinkSync(localPath);
      }
    }
  } catch (err) {
    console.error('전체 업로드 프로세스 실패:', err.message);
  }
}

backupFiles(); 