FROM node:slim

# Puppeteer가 필요한 의존성 설치
RUN apt-get update && apt-get install -y \
    ca-certificates \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libgdk-pixbuf2.0-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    wget \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# 앱 디렉토리 생성 및 이동
WORKDIR /app

# 의존성 설치
COPY package*.json ./
RUN npm ci --only=production \
 && npm audit fix --force \
 && npm prune --production

# 소스 복사
COPY . .

# Puppeteer 브라우저 설치 (캐시 디렉토리를 /tmp로 설정)
ENV PUPPETEER_CACHE_DIR=/tmp/puppeteer
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=false

# Chrome 설치
RUN npx puppeteer browsers install chrome \
 && mkdir -p ./chromium \
 && cp -r /tmp/puppeteer/chrome/* ./chromium

# 포트 노출 및 실행
EXPOSE 5001
CMD ["npm", "start"]
