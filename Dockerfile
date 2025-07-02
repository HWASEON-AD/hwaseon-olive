FROM node:20-slim

# 1. 필요한 패키지 (wget, unzip, dumb-init) 설치
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget \
    unzip \
    dumb-init \
    && rm -rf /var/lib/apt/lists/*

# 2. 크롬 137 설치
RUN wget https://storage.googleapis.com/chrome-for-testing-public/137.0.7012.124/linux64/chrome-linux64.zip \
    && unzip chrome-linux64.zip \
    && mv chrome-linux64 /opt/chrome \
    && rm chrome-linux64.zip \
    && ln -s /opt/chrome/chrome /usr/bin/google-chrome

# 3. 앱 디렉토리 설정
WORKDIR /usr/src/app

# 4. 의존성 설치
COPY package*.json ./
RUN npm install

# 5. 소스 코드 복사
COPY . .

# 6. 캡처 디렉토리 생성
RUN mkdir -p public/captures && chmod -R 777 public/captures

# 7. 포트 설정
EXPOSE 5001

# 8. 앱 실행 (ENTRYPOINT와 CMD는 항상 마지막에)
ENTRYPOINT ["dumb-init", "--"]
CMD [ "node", "server.js" ]