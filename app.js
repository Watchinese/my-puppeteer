const express = require('express');
const puppeteer = require('puppeteer');
// puppeteer-extra and StealthPlugin will be conditionally loaded inside the route

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());

// --- API Token Validation Middleware (using query string) ---
const EXPECTED_API_TOKEN = process.env.API_TOKEN;

if (!EXPECTED_API_TOKEN) {
    console.warn('WARNING: API_TOKEN environment variable is not set. Your service will be unprotected!');
}

app.use((req, res, next) => {
    const apiToken = req.query.token;

    if (EXPECTED_API_TOKEN && apiToken !== EXPECTED_API_TOKEN) {
        return res.status(401).send('Unauthorized: Invalid API Token');
    }
    next();
});
// --- End API Token Validation Middleware ---


app.get('/', (req, res) => {
    res.send('Puppeteer scraping service is running. Use POST /scrape for advanced HTML scraping and POST /screenshot for page screenshots.');
});

app.post('/scrape', async (req, res) => {
    const { url, elements, gotoOptions, rejectResourceTypes, rejectRequestPattern, proxy, loginDetails } = req.body;
    const enableStealth = req.query.stealth === 'true';

    console.log('Received URL for scraping:', url);
    console.log('Received elements config:', elements);
    console.log('Received gotoOptions:', gotoOptions);
    console.log('Stealth mode requested:', enableStealth);
    console.log('Reject Resource Types:', rejectResourceTypes);
    console.log('Reject Request Patterns:', rejectRequestPattern);
    console.log('Proxy requested:', proxy);


    if (!url || !elements || !Array.isArray(elements) || elements.length === 0) {
        return res.status(400).send('Please provide "url" and a non-empty "elements" array in the request body.');
    }

    let browser;
    let browserLauncher;

    try {
        if (enableStealth) {
            console.log('Enabling Stealth Mode for this request.');
            const puppeteerExtra = require('puppeteer-extra');
            const StealthPlugin = require('puppeteer-extra-plugin-stealth');
            puppeteerExtra.use(StealthPlugin());
            browserLauncher = puppeteerExtra;
        } else {
            console.log('Stealth Mode is OFF for this request (default).');
            browserLauncher = puppeteer;
        }

        const browserArgs = [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--no-zygote'
        ];

        if (proxy) {
            console.log(`Adding proxy server argument: --proxy-server=${proxy}`);
            browserArgs.push(`--proxy-server=${proxy}`);
        }

        browser = await browserLauncher.launch({
            headless: true,
            executablePath: '/home/pptruser/.cache/puppeteer/chrome/linux-127.0.6533.88/chrome-linux64/chrome',
            args: browserArgs
        });
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });

        let processedUrl = url;
        if (typeof processedUrl !== 'string') {
            return res.status(400).json({ error: 'Invalid URL format', details: 'URL must be a string.' });
        }
        if (!processedUrl.startsWith('http://') && !processedUrl.startsWith('https://')) {
            processedUrl = 'https://' + processedUrl;
            console.log(`No protocol found, defaulting to HTTPS: ${processedUrl}`);
        }

        await page.setRequestInterception(true);

        const resourceTypesToReject = new Set(rejectResourceTypes || []);
        const urlPatternsToReject = (rejectRequestPattern || []).map(pattern => new RegExp(pattern));

        page.on('request', (request) => {
            const resourceType = request.resourceType();
            const requestUrl = request.url();

            if (resourceTypesToReject.has(resourceType)) {
                request.abort();
                return;
            }

            for (const pattern of urlPatternsToReject) {
                if (pattern.test(requestUrl)) {
                    request.abort();
                    return;
                }
            }

            request.continue();
        });

        const actualGotoOptions = {
            timeout: gotoOptions?.timeout || 60000,
            waitUntil: gotoOptions?.waitUntil || 'networkidle2'
        };
        console.log('Using page.goto options:', actualGotoOptions);
        console.log('Navigating to:', processedUrl);

        // --- NEW MULTI-STEP LOGIN LOGIC ---
        if (loginDetails && loginDetails.loginUrl && Array.isArray(loginDetails.steps) && loginDetails.steps.length > 0) {
            console.log(`Attempting multi-step login to: ${loginDetails.loginUrl}`);
            await page.goto(loginDetails.loginUrl, actualGotoOptions); // Navigate to the initial login page

            for (let i = 0; i < loginDetails.steps.length; i++) {
                const step = loginDetails.steps[i];
                console.log(`Executing login step ${i + 1}:`);

                if (!step.selector || !step.value || !step.clickSelector) {
                    console.error(`Login step ${i + 1} is missing required fields (selector, value, or clickSelector).`);
                    throw new Error(`Incomplete login step configuration for step ${i + 1}.`);
                }

                try {
                    // Wait for the input field to be visible and enabled
                    await page.waitForSelector(step.selector, { visible: true, timeout: 10000 });
                    await page.type(step.selector, step.value);
                    console.log(`Typed into selector: ${step.selector}`);

                    // Wait for the button to be visible and enabled
                    await page.waitForSelector(step.clickSelector, { visible: true, timeout: 10000 });

                    // Click button and wait for navigation (assuming navigation after each step)
                    // We use Promise.all to ensure we wait for the click and the subsequent page change
                    await Promise.all([
                        page.waitForNavigation(actualGotoOptions),
                        page.click(step.clickSelector)
                    ]);
                    console.log(`Clicked selector: ${step.clickSelector}. Current URL: ${page.url()}`);

                } catch (stepError) {
                    console.error(`Failed at login step ${i + 1}:`, stepError.message);
                    throw new Error(`Login step ${i + 1} failed: ${stepError.message}`);
                }
            }

            console.log('All login steps completed. Final URL after login:', page.url());

            // Optional: Add a check for successful login (e.g., waiting for an element only visible when logged in)
            if (loginDetails.postLoginSelector) {
                try {
                    await page.waitForSelector(loginDetails.postLoginSelector, { timeout: 10000 });
                    console.log('Confirmed login by finding postLoginSelector.');
                } catch (e) {
                    console.warn('postLoginSelector not found after login, login might have failed or taken unexpected path:', e.message);
                    // You might want to throw an error here if postLoginSelector is critical for success
                }
            }

            // After successful login, navigate to the target URL for scraping if it's different from the final login page
            if (page.url() !== processedUrl) {
                console.log('Navigating to target URL after login:', processedUrl);
                await page.goto(processedUrl, actualGotoOptions);
            } else {
                console.log('Already on target URL after login (no further navigation needed).');
            }

        } else {
            // Original navigation if no login steps are provided (or if loginDetails is missing/invalid)
            console.log('No login steps provided or invalid loginDetails structure. Navigating directly to:', processedUrl);
            await page.goto(processedUrl, actualGotoOptions);
        }
        // --- END NEW MULTI-STEP LOGIN LOGIC ---

        const allScrapedData = [];

        for (const elementConfig of elements) {
            const { selector, type } = elementConfig;

            if (!selector) {
                console.warn('Skipping element configuration without a selector:', elementConfig);
                continue;
            }

            try {
                const resultsForSelector = await page.evaluate((config) => {
                    const sel = config.selector;
                    const selectorType = config.type || 'css';

                    let matchedElements = [];

                    if (selectorType === 'xpath') {
                        const xpathResult = document.evaluate(sel, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
                        for (let i = 0; i < xpathResult.snapshotLength; i++) {
                            matchedElements.push(xpathResult.snapshotItem(i));
                        }
                    } else {
                        matchedElements = Array.from(document.querySelectorAll(sel));
                    }

                    const elementDetails = [];
                    matchedElements.forEach(el => {
                        const result = {
                            html: el.innerHTML.trim(),
                            text: el.textContent.trim(),
                        };

                        result.attributes = [];
                        for (let i = 0; i < el.attributes.length; i++) {
                            const attr = el.attributes[i];
                            result.attributes.push({ name: attr.name, value: attr.value });
                        }
                        elementDetails.push(result);
                    });
                    return elementDetails;
                }, elementConfig);


                allScrapedData.push({
                    selector: selector,
                    type: type || 'css',
                    results: resultsForSelector
                });

            } catch (err) {
                console.error(`Error scraping selector '${selector}' (type: ${type || 'css'}):`, err);
                allScrapedData.push({
                    selector: selector,
                    type: type || 'css',
                    error: `Failed to scrape this selector: ${err.message}`
                });
            }
        }

        const finalScrapedData = allScrapedData.map(dataItem => {
            if (dataItem.results && Array.isArray(dataItem.results)) {
                const filteredResults = dataItem.results.filter(result => {
                    const hrefAttr = result.attributes?.find(attr => attr.name === 'href');

                    if (hrefAttr && hrefAttr.value && hrefAttr.value.includes("www.example.com/live/")) {
                        return false;
                    }
                    return true;
                });
                return { ...dataItem, results: filteredResults };
            }
            return dataItem;
        });

        res.json({
            data: finalScrapedData
        });

    } catch (error) {
        console.error('Puppeteer scrape operation failed:', error);
        res.status(500).json({ error: 'Failed to scrape page', details: error.message });
    } finally {
        if (browser) {
            await browser.close();
        }
    }
});

// --- /screenshot API Endpoint ---
app.post('/screenshot', async (req, res) => {
    const { url, gotoOptions, fullPage, type, quality, clip, omitBackground, proxy, rejectResourceTypes, rejectRequestPattern } = req.body;
    const enableStealth = req.query.stealth === 'true';

    console.log('Received URL for screenshot:', url);
    console.log('Screenshot options:', { fullPage, type, quality, clip, omitBackground });
    console.log('Stealth mode requested:', enableStealth);
    console.log('Proxy requested:', proxy);
    console.log('Reject Resource Types:', rejectResourceTypes);
    console.log('Reject Request Patterns:', rejectRequestPattern);


    if (!url) {
        return res.status(400).send('Please provide a "url" in the request body for screenshot.');
    }

    let browser;
    let browserLauncher;

    try {
        if (enableStealth) {
            console.log('Enabling Stealth Mode for this screenshot request.');
            const puppeteerExtra = require('puppeteer-extra');
            const StealthPlugin = require('puppeteer-extra-plugin-stealth');
            puppeteerExtra.use(StealthPlugin());
            browserLauncher = puppeteerExtra;
        } else {
            console.log('Stealth Mode is OFF for this screenshot request (default).');
            browserLauncher = puppeteer;
        }

        const browserArgs = [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--no-zygote'
        ];

        if (proxy) {
            console.log(`Adding proxy server argument: --proxy-server=${proxy}`);
            browserArgs.push(`--proxy-server=${proxy}`);
        }

        browser = await browserLauncher.launch({
            headless: true,
            args: browserArgs
        });
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 }); // Default viewport

        let processedUrl = url;
        if (typeof processedUrl !== 'string') {
            return res.status(400).json({ error: 'Invalid URL format', details: 'URL must be a string.' });
        }
        if (!processedUrl.startsWith('http://') && !processedUrl.startsWith('https://')) {
            processedUrl = 'https://' + processedUrl;
            console.log(`No protocol found, defaulting to HTTPS: ${processedUrl}`);
        }

        await page.setRequestInterception(true);
        const resourceTypesToRejectForScreenshot = new Set(rejectResourceTypes || []);
        const urlPatternsToRejectForScreenshot = (rejectRequestPattern || []).map(pattern => new RegExp(pattern));

        page.on('request', (request) => {
            const resourceType = request.resourceType();
            const requestUrl = request.url();

            if (resourceTypesToRejectForScreenshot.has(resourceType)) {
                request.abort();
                return;
            }

            for (const pattern of urlPatternsToRejectForScreenshot) {
                if (pattern.test(requestUrl)) {
                    request.abort();
                    return;
                }
            }
            request.continue();
        });

        const actualGotoOptions = {
            timeout: gotoOptions?.timeout || 60000,
            waitUntil: gotoOptions?.waitUntil || 'networkidle2'
        };
        console.log('Using page.goto options for screenshot:', actualGotoOptions);
        console.log('Navigating to:', processedUrl);

        await page.goto(processedUrl, actualGotoOptions);

        const screenshotOptions = {
            fullPage: fullPage || false,
            type: type || 'png',
            quality: type === 'jpeg' ? (quality || 80) : undefined,
            clip: clip,
            omitBackground: omitBackground || false
        };

        console.log('Taking screenshot with options:', screenshotOptions);
        const screenshotBuffer = await page.screenshot(screenshotOptions);

        res.setHeader('Content-Type', `image/${screenshotOptions.type}`);
        res.send(screenshotBuffer);

    } catch (error) {
        console.error('Puppeteer screenshot operation failed:', error);
        res.status(500).json({ error: 'Failed to take screenshot', details: error.message });
    } finally {
        if (browser) {
            await browser.close();
        }
    }
});
// --- END /screenshot API Endpoint ---

// --- NEW: /content API Endpoint ---
app.post('/content', async (req, res) => {
    const { url, gotoOptions, proxy, rejectResourceTypes, rejectRequestPattern } = req.body;
    const enableStealth = req.query.stealth === 'true';

    console.log('Received URL for content retrieval:', url);
    console.log('Received gotoOptions:', gotoOptions);
    console.log('Stealth mode requested:', enableStealth);
    console.log('Proxy requested:', proxy);
    console.log('Reject Resource Types:', rejectResourceTypes);
    console.log('Reject Request Patterns:', rejectRequestPattern);


    if (!url) {
        return res.status(400).send('Please provide a "url" in the request body for content retrieval.');
    }

    let browser;
    let browserLauncher;

    try {
        if (enableStealth) {
            console.log('Enabling Stealth Mode for this content request.');
            const puppeteerExtra = require('puppeteer-extra');
            const StealthPlugin = require('puppeteer-extra-plugin-stealth');
            puppeteerExtra.use(StealthPlugin());
            browserLauncher = puppeteerExtra;
        } else {
            console.log('Stealth Mode is OFF for this content request (default).');
            browserLauncher = puppeteer;
        }

        const browserArgs = [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--no-zygote'
        ];

        if (proxy) {
            console.log(`Adding proxy server argument: --proxy-server=${proxy}`);
            browserArgs.push(`--proxy-server=${proxy}`);
        }

        browser = await browserLauncher.launch({
            headless: true,
            args: browserArgs
        });
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });

        let processedUrl = url;
        if (typeof processedUrl !== 'string') {
            return res.status(400).json({ error: 'Invalid URL format', details: 'URL must be a string.' });
        }
        if (!processedUrl.startsWith('http://') && !processedUrl.startsWith('https://')) {
            processedUrl = 'https://' + processedUrl;
            console.log(`No protocol found, defaulting to HTTPS: ${processedUrl}`);
        }

        // --- Request Interception for content endpoint ---
        await page.setRequestInterception(true);
        const resourceTypesToRejectForContent = new Set(rejectResourceTypes || []);
        const urlPatternsToRejectForContent = (rejectRequestPattern || []).map(pattern => new RegExp(pattern));

        page.on('request', (request) => {
            const resourceType = request.resourceType();
            const requestUrl = request.url();

            if (resourceTypesToRejectForContent.has(resourceType)) {
                request.abort();
                return;
            }

            for (const pattern of urlPatternsToRejectForContent) {
                if (pattern.test(requestUrl)) {
                    request.abort();
                    return;
                }
            }
            request.continue();
        });
        // --- End Request Interception ---

        const actualGotoOptions = {
            timeout: gotoOptions?.timeout || 60000,
            waitUntil: gotoOptions?.waitUntil || 'networkidle2'
        };
        console.log('Using page.goto options for content retrieval:', actualGotoOptions);
        console.log('Navigating to:', processedUrl);

        await page.goto(processedUrl, actualGotoOptions);

        console.log('Retrieving page content...');
        const htmlContent = await page.content(); // Get the full HTML content

        res.setHeader('Content-Type', 'text/html; charset=utf-8'); // Set appropriate content type
        res.send(htmlContent); // Send the raw HTML

    } catch (error) {
        console.error('Puppeteer content retrieval operation failed:', error);
        res.status(500).json({ error: 'Failed to retrieve page content', details: error.message });
    } finally {
        if (browser) {
            await browser.close();
        }
    }
});
// --- END NEW: /content API Endpoint ---


app.listen(PORT, () => {
    console.log(`Puppeteer service listening on port ${PORT}`);
});
