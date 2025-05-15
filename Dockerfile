FROM node:20.12.2-slim

# Install Chromium and dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    dumb-init \
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
    && apt-get clean && rm -rf /var/lib/apt/lists/*

ENV CHROME_BIN=/usr/bin/chromium

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install

COPY . .

RUN mkdir -p public/captures && chmod -R 777 public/captures

EXPOSE 5001

ENTRYPOINT ["dumb-init", "--"]
CMD [ "node", "server.js" ] 