# 使用包含 Chromium 的 Node.js 基礎映像檔
# 來自 Google 的 Headless Chrome 官方映像檔，但已包含 Node.js
# 確保這個映像檔版本支持你的 puppeteer 版本
FROM ghcr.io/puppeteer/puppeteer:22.12.0

# 設定工作目錄
WORKDIR /app

# 複製 package.json 和 package-lock.json (如果存在)
COPY package*.json ./

# 安裝 Node.js 依賴
RUN npm install

# 複製應用程序代碼
COPY . .

# 暴露應用程序端口 (Hugging Face Spaces 主要看 README.md 的 app_port)
EXPOSE 7860

# 啟動應用程序
CMD ["npm", "start"]