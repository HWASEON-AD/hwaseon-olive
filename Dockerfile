FROM node:18.20.1-bullseye-slim

# Create app directory
WORKDIR /app

# Copy package.json and lock
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production \
    && npm audit fix --force \
    && npm prune --production

# Copy rest of the code
COPY . .

# Puppeteer 기본 Chromium 설치
RUN npx puppeteer install --with-deps

# Postinstall scripts (Puppeteer Chrome cache)
RUN npx puppeteer browsers install chrome \
 && mkdir -p chromium \
 && cp -r /opt/render/.cache/puppeteer/chrome/* ./chromium

# Environment variables for Puppeteer
ENV PUPPETEER_CACHE_DIR=/opt/render/.cache/puppeteer
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=false

# Expose port and run
EXPOSE 5001
CMD ["npm", "start"] 