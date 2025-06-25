FROM node:20-slim

# Install Chrome and ChromeDriver
RUN apt-get update && apt-get install -y \
    wget \
    unzip \
    chromium \
    chromium-driver \
    && rm -rf /var/lib/apt/lists/*

# Set Chrome and ChromeDriver paths
ENV CHROME_BIN=/usr/bin/chromium
ENV CHROMEDRIVER_PATH=/usr/bin/chromedriver

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json ./
RUN npm install

# Bundle app source
COPY . .

# Create captures directory
RUN mkdir -p public/captures && chmod -R 777 public/captures

EXPOSE 5001

# Use dumb-init to handle signals properly
RUN apt-get update && apt-get install -y dumb-init && rm -rf /var/lib/apt/lists/*
ENTRYPOINT ["dumb-init", "--"]

CMD [ "node", "server.js" ]

# 크롬 137 설치
RUN apt-get update && apt-get install -y wget unzip
RUN wget https://storage.googleapis.com/chrome-for-testing-public/137.0.7012.124/linux64/chrome-linux64.zip
RUN unzip chrome-linux64.zip
RUN mv chrome-linux64 /opt/chrome
RUN ln -s /opt/chrome/chrome /usr/bin/google-chrome