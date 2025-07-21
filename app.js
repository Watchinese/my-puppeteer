const express = require('express');
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 10000 ; // Render 默認使用 10000 端口

app.use(express.json()); // 啟用 JSON body 解析

app.get('/', (req, res) => {
    res.send('Puppeteer screenshot service is running. Use POST /screenshot with a URL.');
});

app.post('/screenshot', async (req, res) => {
    const { url } = req.body;

    if (!url) {
        return res.status(400).send('Please provide a "url" in the request body.');
    }

    let browser;
    try {
        // Launch Puppeteer with necessary arguments for a Docker/Linux environment
        browser = await puppeteer.launch({
            headless: true, // 必須是無頭模式
            args: [
                '--no-sandbox', // Docker 環境必須
                '--disable-setuid-sandbox', // Docker 環境必須
                '--disable-dev-shm-usage', // 避免 /dev/shm 內存不足問題
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--no-zygote' // 避免 Zygote 進程的問題
            ]
        });
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 }); // 設置視窗大小

        await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 }); // 等待網絡空閒或超時30秒

        const screenshotPath = path.join('/tmp', `screenshot-${Date.now()}.png`); // 截圖暫存到 /tmp
        await page.screenshot({ path: screenshotPath, fullPage: true });

        // 將截圖作為響應發送
        res.sendFile(screenshotPath, (err) => {
            if (err) {
                console.error('Error sending file:', err);
                res.status(500).send('Error sending screenshot.');
            }
            // 清理臨時文件
            fs.unlink(screenshotPath, (unlinkErr) => {
                if (unlinkErr) console.error('Error deleting temp file:', unlinkErr);
            });
        });

    } catch (error) {
        console.error('Puppeteer operation failed:', error);
        res.status(500).json({ error: 'Failed to take screenshot', details: error.message });
    } finally {
        if (browser) {
            await browser.close(); // 確保瀏覽器關閉
        }
    }
});

app.listen(PORT, () => {
    console.log(`Puppeteer service listening on port ${PORT}`);
});
