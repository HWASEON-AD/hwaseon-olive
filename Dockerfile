FROM node:18-bullseye-slim

# Create app directory
WORKDIR /app

# Install Chrome dependencies for Puppeteer
RUN apt-get update && apt-get install -y \
    gconf-service libasound2 libatk1.0-0 libc6 libgconf-2-4 libcairo2 \
    libdbus-1-3 libexpat1 libfontconfig1 libgcc1 libgdk-pixbuf2.0-0 \
    libglib2.0-0 libgtk-3-0 libnspr4 libpango-1.0-0 libpangocairo-1.0-0 \
    libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 \
    libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 \
    libxss1 libxtst6 ca-certificates fonts-liberation lsb-release \
    xdg-utils wget \
 && rm -rf /var/lib/apt/lists/*

# Copy package.json and lock
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy rest of the code
COPY . .

# Postinstall scripts (Puppeteer Chrome cache)
RUN npx puppeteer browsers install chrome \
 && mkdir -p chromium \
 && cp -r /opt/render/.cache/puppeteer/chrome/* ./chromium

# Environment variables for Puppeteer
ENV PUPPETEER_CACHE_DIR=/opt/render/.cache/puppeteer

# Expose port and run
EXPOSE 5001
CMD ["npm", "start"] 