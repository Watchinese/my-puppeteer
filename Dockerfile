# Use a standard Node.js base image (e.g., LTS version)
# You might need to add system dependencies for Chrome manually, which the puppeteer image handles.
# A good compromise is a Node image with essential tools like 'curl' or 'wget' for browser download.
FROM node:20-slim

# Install necessary system dependencies for Chrome Headless
# These are common dependencies for running Chromium on Debian-based systems.
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    unzip \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    ca-certificates \
    # Clean up apt caches to reduce image size
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package.json and install dependencies
COPY package*.json ./
RUN npm install

# Set Puppeteer cache directory and install Chrome
# This ensures Chrome is downloaded and placed where Puppeteer expects it.
ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer # Use a path within your WORKDIR
RUN npx puppeteer browsers install chrome

# Copy application code
COPY . .

# Expose port
EXPOSE 10000

# Start the application
CMD ["npm", "start"]
