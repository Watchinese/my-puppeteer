# Use a standard Node.js base image
FROM FROM ghcr.io/puppeteer/puppeteer:latest

# 設定工作目錄
WORKDIR /app

# 複製 package.json 和 package-lock.json (如果存在)
COPY package*.json ./
RUN npm ci
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
# IMPORTANT: Tell Puppeteer to skip browser download
ENV PUPPETEER_SKIP_DOWNLOAD=true

# 安裝 Node.js 依賴
RUN npm install

# 複製應用程序代碼
COPY . .

# 暴露應用程序端口 (Hugging Face Spaces 主要看 README.md 的 app_port)
EXPOSE 10000

# 啟動應用程序
CMD ["npm", "start"]
