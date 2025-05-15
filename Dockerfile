FROM node:20-slim

# Install Chrome and ChromeDriver
RUN apt-get update && apt-get install -y \
    wget \
    unzip \
    chromium \
    chromium-driver \
    && apt-get update && apt-get upgrade -y && apt-get clean && rm -rf /var/lib/apt/lists/*

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