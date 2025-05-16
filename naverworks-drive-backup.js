require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');

// 1. 네이버웍스 OAuth2 토큰 발급
async function getAccessToken() {
  const res = await axios.post('https://auth.worksmobile.com/oauth2/v2.0/token', null, {
    params: {
      grant_type: 'client_credentials',
      client_id: process.env.NAVERWORKS_CLIENT_ID,
      client_secret: process.env.NAVERWORKS_CLIENT_SECRET,
      scope: 'drive'
    }
  });
  return res.data.access_token;
}

// 2. 폴더 생성 (없으면)
async function createFolderIfNotExists(token, parentId, folderName) {
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
  }
  return folder.id;
}

// 3. 파일 업로드
async function uploadFile(token, folderId, filePath) {
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
}

// 4. 날짜/카테고리별 폴더 구조 생성 및 파일 업로드
async function backupFiles() { 
  const token = await getAccessToken();

  // 1. hwaseon-olive 폴더 생성
  const rootFolderId = await createFolderIfNotExists(token, null, 'hwaseon-olive');

  // 2. 캡처본 폴더에서 날짜/카테고리별로 파일 업로드
  const baseDir = path.join(__dirname, 'public', 'captures');
  if (!fs.existsSync(baseDir)) {
    console.log('캡처본 폴더가 없습니다:', baseDir);
    return;
  }
  const dates = fs.readdirSync(baseDir);
  for (const date of dates) {
    const datePath = path.join(baseDir, date);
    if (!fs.statSync(datePath).isDirectory()) continue;
    const dateFolderId = await createFolderIfNotExists(token, rootFolderId, date);

    const categories = fs.readdirSync(datePath);
    for (const category of categories) {
      const categoryPath = path.join(datePath, category);
      if (!fs.statSync(categoryPath).isDirectory()) continue;
      const categoryFolderId = await createFolderIfNotExists(token, dateFolderId, category);

      const files = fs.readdirSync(categoryPath);
      for (const file of files) {
        const filePath = path.join(categoryPath, file);
        if (fs.statSync(filePath).isFile()) {
          await uploadFile(token, categoryFolderId, filePath);
          console.log(`업로드 완료: ${date}/${category}/${file}`);
        }
      }
    }
  }
}

backupFiles().catch(console.error); 