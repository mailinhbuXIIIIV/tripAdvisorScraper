// background.js — MV3 Service Worker

const WEBHOOK_URL = 'https://n8n.excelogy.net/webhook/08d6f11c-f215-4ffe-8937-969a9a8f45e1?data=Error';
const STOP_KEY    = 'taScraperStop';

// ── Side panel setup ──────────────────────────────────────────────────────────
chrome.action.onClicked.addListener((tab) => {
    chrome.sidePanel.open({ windowId: tab.windowId });
});

// ── Message router ────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'startScraping') {
        chrome.storage.local.remove(STOP_KEY).then(() => {
            handleScraping(msg.url)
                .then(r  => sendResponse(r))
                .catch(e => sendResponse({ success: false, error: e.message }));
        });
        return true;
    }

    if (msg.action === 'stopScraping') {
        chrome.storage.local.set({ [STOP_KEY]: true }).then(() => sendResponse({ ok: true }));
        return true;
    }

    if (msg.action === 'clearProgress') {
        chrome.storage.local.remove(storageKey(msg.url)).then(() => sendResponse({ ok: true }));
        return true;
    }
});

// ── Core Scraper Logic ────────────────────────────────────────────────────────
async function handleScraping(targetUrl) {
    let allResults = [];
    let resumeOffset = 0;

    // 1. Load Progress
    const saved = await loadProgress(targetUrl);
    if (saved?.nextOffset > 0) {
        resumeOffset = saved.nextOffset;
        allResults = saved.completed || [];
        pushProgress({
            text: `Resuming from offset ${resumeOffset}...`,
            count: allResults.length,
            isResume: true,
            logType: 'success'
        });
    }

    try {
        // 2. Initial Fetch for Total Hits
        pushProgress({ text: '📡 Connecting to TripAdvisor...', logType: 'fetch' });
        const initHtml = await rapidFetch(targetUrl);

        const totalHitsMatch = initHtml.match(/total_hits%5C%5C%5C%22%3A(\d+)/);
        const totalHits = totalHitsMatch ? parseInt(totalHitsMatch[1], 10) : 0;

        if (totalHits === 0) throw new Error('No results found. Verify the URL is a search page.');

        pushProgress({ text: `🎯 Target: ${totalHits} records.`, total: totalHits, logType: 'success' });

        // 3. Batch Loop
        for (let offset = resumeOffset; offset < totalHits; offset += 30) {
            // Manual Stop Check
            const s = await chrome.storage.local.get(STOP_KEY);
            if (s[STOP_KEY]) {
                return { stopped: true, count: allResults.length, nextOffset: offset };
            }

            const pageNum = Math.floor(offset / 30) + 1;
            const currentUrl = targetUrl.includes('offset=')
                ? targetUrl.replace(/offset=\d+/, `offset=${offset}`)
                : `${targetUrl}&offset=${offset}`;

            pushProgress({
                text: `Fetching page ${pageNum}...`,
                pct: Math.round((offset / totalHits) * 100),
                offset,
                logType: 'fetch'
            });

            const html = await rapidFetch(currentUrl);

            // Bot Detection
            if (isBot(html)) {
                await saveProgress(targetUrl, allResults, offset, totalHits);
                await notifyBotDetected(offset, totalHits);
                return { botDetected: true, nextOffset: offset, totalHits, completed: allResults };
            }

            // Data Extraction
            const items = parseJsonLd(html, offset);
            if (items.length > 0) {
                allResults.push(...items);
                pushProgress({
                    text: `✓ Page ${pageNum}: +${items.length} items`,
                    count: allResults.length,
                    logType: 'data'
                });
            }

            // Auto-save every 3 pages
            if (pageNum % 3 === 0) {
                await saveProgress(targetUrl, allResults, offset + 30, totalHits);
            }

            // Breather
            await new Promise(r => setTimeout(r, pageNum % 5 === 0 ? 1500 : 400));
        }

        // 4. Finish & Download
        pushProgress({ text: 'Building CSV export...', pct: 98 });
        const csv = buildCSV(allResults);
        await downloadCSV(csv, `tripadvisor_data_${Date.now()}.csv`);

        await chrome.storage.local.remove(storageKey(targetUrl));
        return { success: true, count: allResults.length };

    } catch (e) {
        return { success: false, error: e.message };
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function rapidFetch(url) {
    const resp = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0' }
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
    return await resp.text();
}

function parseJsonLd(html, offset) {
    let items = [];

    try {
        // 1. Target the specific div you identified
        // We use a regex that looks for the data-automation attribute and captures the script content inside
        const divPattern = /data-automation="restaurant-list-jsonld">.*?<script [^>]*>([\s\S]*?)<\/script>/i;
        const match = html.match(divPattern);

        if (match && match[1]) {
            let jsonString = match[1].trim();

            // 2. Parse the JSON (JSON.parse handles \u002F automatically)
            const data = JSON.parse(jsonString);

            if (data && data.itemListElement) {
                items = data.itemListElement.map((el, i) => {
                    const it = el.item || {};
                    const addr = it.address || {};
                    return {
                        index: offset + i + 1,
                        name: it.name || 'N/A',
                        rating: it.aggregateRating?.ratingValue || "N/A",
                        reviews: it.aggregateRating?.reviewCount || 0,
                        price: it.priceRange || 'N/A',
                        lat: it.geo?.latitude || 'N/A',
                        lng: it.geo?.longitude || 'N/A',
                        street: addr.streetAddress || 'N/A',
                        locality: addr.addressLocality || 'N/A',
                        country: addr.addressCountry || 'N/A',
                        url: it.url ? it.url.replace(/\\u002F/g, '/') : 'N/A'
                    };
                });
            }
        }
    } catch (e) {
        console.error("Extraction Error:", e.message);
        // Log a snippet of the HTML for debugging if it fails
        console.log("HTML Snippet:", html.substring(0, 500));
    }

    return items;
}

function isBot(html) {
    const check = html.toLowerCase();
    return check.includes('robot check') || check.includes('captcha') || check.includes('unusual traffic');
}

function buildCSV(data) {
    if (!data.length) return '';
    const headers = Object.keys(data[0]);
    const esc = v => `"${String(v).replace(/"/g, '""')}"`;
    return [headers.join(','), ...data.map(r => headers.map(h => esc(r[h])).join(','))].join('\r\n');
}

async function downloadCSV(content, filename) {
    const url = 'data:text/csv;charset=utf-8,' + encodeURIComponent(content);
    await chrome.downloads.download({ url, filename });
}

// ── Progress & Storage Helpers ────────────────────────────────────────────────

function storageKey(url) {
    return 'ta_' + btoa(unescape(encodeURIComponent(url))).replace(/[^a-z0-9]/gi, '').slice(0, 50);
}

async function loadProgress(url) {
    const res = await chrome.storage.local.get(storageKey(url));
    return res[storageKey(url)] || null;
}

async function saveProgress(url, completed, nextOffset, totalHits) {
    await chrome.storage.local.set({ [storageKey(url)]: { completed, nextOffset, totalHits } });
}

function pushProgress(payload) {
    chrome.runtime.sendMessage({ type: 'progress', ...payload }).catch(() => {});
}

async function notifyBotDetected(offset, total) {
    try { await fetch(WEBHOOK_URL); } catch(e) {}
}
