// sidepanel.js

// ── DOM refs ──────────────────────────────────────────────────────────────────
const urlInput         = document.getElementById('urlInput');
const startBtn         = document.getElementById('startBtn');
const stopBtn          = document.getElementById('stopBtn');
const clearProgressBtn = document.getElementById('clearProgressBtn');
const clearLogBtn      = document.getElementById('clearBtn');

const resumeBanner     = document.getElementById('resumeBanner');
const resumeSub        = document.getElementById('resumeSub');
const resumeBtn        = document.getElementById('resumeBtn');
const freshBtn         = document.getElementById('freshBtn');

const botAlert         = document.getElementById('botAlert');
const botAlertSub      = document.getElementById('botAlertSub');

const statRecords      = document.getElementById('statRecords');
const statBatch        = document.getElementById('statBatch');
const statTotal        = document.getElementById('statTotal');

const statusDot        = document.getElementById('statusDot');
const statusLabel      = document.getElementById('statusLabel');
const pctLabel         = document.getElementById('pctLabel');
const outerFill        = document.getElementById('outerFill');
const outerSub         = document.getElementById('outerSub');
const innerFill        = document.getElementById('innerFill');
const innerSub         = document.getElementById('innerSub');

const logBox           = document.getElementById('logBox');
const logEmpty         = document.getElementById('logEmpty');

// ── Init ──────────────────────────────────────────────────────────────────────
chrome.tabs.query({ active: true, currentWindow: true }, async ([tab]) => {
    if (tab?.url?.includes('tripadvisor.com')) urlInput.value = tab.url;
    await checkForSavedSession(urlInput.value.trim());
    log('info', '💡', 'Paste a TripAdvisor search URL and click Start.');
});

urlInput.addEventListener('change', async () => checkForSavedSession(urlInput.value.trim()));

// ── Saved session ─────────────────────────────────────────────────────────────
async function checkForSavedSession(url) {
    if (!url?.includes('tripadvisor.com')) { hideSaved(); return; }
    const res   = await chrome.storage.local.get(storageKey(url));
    const saved = res[storageKey(url)];
    if (saved?.nextOffset > 0 && saved.completed?.length) {
        resumeSub.textContent =
            `${saved.completed.length} records · offset ${saved.nextOffset}` +
            (saved.totalHits ? ` / ${saved.totalHits}` : '');
        resumeBanner.classList.add('visible');
        clearProgressBtn.classList.add('visible');
    } else {
        hideSaved();
    }
}

function hideSaved() {
    resumeBanner.classList.remove('visible');
    clearProgressBtn.classList.remove('visible');
}

function storageKey(url) {
    return 'sp_' + btoa(unescape(encodeURIComponent(url)))
        .replace(/[^a-zA-Z0-9]/g, '').slice(0, 80);
}

// ── Resume / Fresh ────────────────────────────────────────────────────────────
resumeBtn.addEventListener('click', () => {
    resumeBanner.classList.remove('visible');
    doStart(urlInput.value.trim());
});
freshBtn.addEventListener('click', async () => {
    const url = urlInput.value.trim();
    if (url) await chrome.runtime.sendMessage({ action: 'clearProgress', url });
    hideSaved();
    botAlert.classList.remove('visible');
    log('warn', '🗑', 'Saved progress cleared — starting fresh.');
    doStart(url);
});
clearProgressBtn.addEventListener('click', async () => {
    const url = urlInput.value.trim();
    if (url) await chrome.runtime.sendMessage({ action: 'clearProgress', url });
    hideSaved();
    botAlert.classList.remove('visible');
    log('warn', '🗑', 'Saved progress cleared.');
});
clearLogBtn.addEventListener('click', () => {
    logBox.innerHTML = '';
    const e = document.createElement('div');
    e.className = 'log-empty'; e.textContent = 'Log cleared.';
    logBox.appendChild(e);
});

// ── Start ─────────────────────────────────────────────────────────────────────
startBtn.addEventListener('click', () => {
    const url = urlInput.value.trim();
    if (!url)                             { flashError('Please enter a TripAdvisor URL.'); return; }
    if (!url.includes('tripadvisor.com')) { flashError('URL must be on tripadvisor.com'); return; }
    doStart(url);
});

async function doStart(url) {
    resetUI();
    setRunning(true);
    botAlert.classList.remove('visible');
    setStatus('running', 'Starting…');
    setProgress(null);
    log('info',  '🚀', 'Scraper started');
    log('fetch', '🌐', `URL: ${trimUrl(url)}`);

    try {
        const response = await chrome.runtime.sendMessage({ action: 'startScraping', url });

        if (response?.stopped) {
            setStatus('idle', `Stopped — ${response.count} records saved`);
            setProgress(0);
            clearProgressBtn.classList.add('visible');
            log('warn', '⛔', response.error || 'Stopped by user — progress saved.');

        } else if (response?.botDetected) {
            setStatus('error', 'Bot check detected');
            setProgress(0);
            botAlert.classList.add('visible');
            botAlertSub.textContent =
                `Stopped at offset ${statBatch.textContent}. ` +
                `Open TripAdvisor, solve the CAPTCHA, then click Start to resume.`;
            clearProgressBtn.classList.add('visible');
            log('error', '🤖', 'Bot check — progress saved. Resume after solving CAPTCHA.');

        } else if (response?.success) {
            setStatus('success', `Done — ${response.count} records`);
            setProgress(100);
            statRecords.textContent = response.count;
            hideSaved();
            log('success', '✅', `Complete! ${response.count} records exported.`);
            log('success', '💾', 'tripadvisor_data.csv saved.');

        } else {
            setStatus('error', response?.error || 'Unknown error');
            setProgress(0);
            log('error', '❌', response?.error || 'No data returned.');
        }

    } catch (err) {
        setStatus('error', 'Extension error');
        setProgress(0);
        log('error', '❌', err.message);
    } finally {
        setRunning(false);
    }
}

// ── Stop ──────────────────────────────────────────────────────────────────────
stopBtn.addEventListener('click', async () => {
    stopBtn.disabled   = true;
    stopBtn.innerHTML  = '<span>⏳</span> Stopping…';
    log('warn', '⛔', 'Stop requested — will halt after current page…');
    await chrome.runtime.sendMessage({ action: 'stopScraping' });
});

// ── Progress messages ─────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener(async (msg) => {

    // ── Live progress from background (re-broadcast of injected script relay) ─
    if (msg.type === 'progress') {
        const { text, pct, count, offset, total, logType, isResume, botDetected } = msg;

        if (text) setStatus('running', text);
        if (pct  != null)         setProgress(pct);
        if (count !== undefined)  statRecords.textContent = count;
        if (total !== undefined)  statTotal.textContent   = total;
        if (offset !== undefined) {
            statBatch.textContent = offset;
            outerSub.textContent  = total
                ? `${Math.floor(offset / 30) + 1} / ${Math.ceil(total / 30)} pages`
                : '';
            // Inner bar pulses on each page fetch
            innerFill.style.transition = 'none';
            innerFill.style.width = '0%';
            requestAnimationFrame(() => {
                innerFill.style.transition = '';
                innerFill.style.width = '100%';
            });
            innerSub.textContent = `offset ${offset}`;
        }

        if (isResume) {
            resumeBanner.classList.remove('visible');
            log('success', '🔄', text);
            return;
        }
        if (botDetected) {
            botAlert.classList.add('visible');
            clearProgressBtn.classList.add('visible');
        }

        const type = logType || guessType(text);
        if (text) log(type, guessIcon(text, type), text);
        return;
    }

    // ── Periodic save relayed from injected script ────────────────────────────
    // Injected MAIN-world script can call chrome.storage, but we double-persist
    // here as a safety net via the sidepanel (which always has storage access).
    if (msg.type === 'saveProgress') {
        const url = urlInput.value.trim();
        if (url && msg.completed?.length) {
            await chrome.storage.local.set({
                [storageKey(url)]: {
                    completed:  msg.completed,
                    nextOffset: msg.nextOffset,
                    totalHits:  msg.totalHits
                }
            });
            log('info', '💾', `Auto-saved ${msg.completed.length} records (offset ${msg.nextOffset})`);
        }
    }
});

// ── UI helpers ────────────────────────────────────────────────────────────────
function setRunning(on) {
    startBtn.disabled  = on;
    stopBtn.disabled   = !on;
    startBtn.innerHTML = on
        ? '<span>⏳</span> Running…'
        : '<span>⚡</span> Start';
    stopBtn.innerHTML  = '<span>⛔</span> Stop';
}

function setStatus(state, text) {
    statusDot.className     = `status-dot ${state}`;
    statusLabel.textContent = text;
}

function setProgress(pct) {
    if (pct === null) {
        outerFill.classList.add('indeterminate');
        outerFill.style.width = '';
        pctLabel.textContent  = '';
    } else {
        outerFill.classList.remove('indeterminate');
        outerFill.style.width = `${pct}%`;
        pctLabel.textContent  = pct > 0 ? `${Math.round(pct)}%` : '';
    }
}

function resetUI() {
    statRecords.textContent = '—';
    statBatch.textContent   = '—';
    statTotal.textContent   = '—';
    outerSub.textContent    = '';
    innerFill.style.width   = '0%';
    innerSub.textContent    = '—';
    if (logEmpty) logEmpty.style.display = 'none';
}

function flashError(msg) {
    setStatus('error', msg);
    log('error', '⚠️', msg);
}

// ── Logging ───────────────────────────────────────────────────────────────────
function log(type, icon, message) {
    if (logEmpty) logEmpty.style.display = 'none';
    const entry = document.createElement('div');
    const isMilestone = message?.startsWith('──');
    entry.className = 'log-entry' + (isMilestone ? ' milestone' : '');
    entry.append(
        Object.assign(document.createElement('div'), { className: 'log-ts',   textContent: now() }),
        Object.assign(document.createElement('div'), { className: 'log-icon', textContent: icon }),
        Object.assign(document.createElement('div'), { className: `log-msg ${type}`, textContent: message })
    );
    logBox.appendChild(entry);
    logBox.scrollTop = logBox.scrollHeight;
}

function now() {
    return [new Date().getHours(), new Date().getMinutes(), new Date().getSeconds()]
        .map(n => String(n).padStart(2, '0')).join(':');
}
function trimUrl(url) {
    try { const u = new URL(url); return u.hostname + (u.pathname.length > 36 ? u.pathname.slice(0,34)+'…' : u.pathname); }
    catch { return url.slice(0, 50); }
}
function guessType(text) {
    if (!text) return 'info';
    const t = text.toLowerCase();
    if (t.includes('error') || t.includes('fail') || t.includes('🤖') || t.includes('❌') || t.includes('not found')) return 'error';
    if (t.includes('stop') || t.includes('cooldown') || t.includes('pause') || (t.includes('saved') && !t.includes('auto-saved'))) return 'warn';
    if (t.startsWith('──') || t.includes('records done') || t.includes('complete') || t.includes('done') || t.includes('✅')) return 'success';
    if (t.includes('[diag]')) return t.includes('❌') || t.includes('not found') ? 'error' : 'info';
    if (t.includes('page') || t.includes('offset') || t.includes('fetch')) return 'fetch';
    if (t.includes('✓') || t.includes('items →') || t.includes('records')) return 'data';
    return 'info';
}
function guessIcon(text, type) {
    if (!text) return '·';
    const t = text.toLowerCase();
    if (t.includes('stop') || t.includes('⛔'))                      return '⛔';
    if (t.includes('cooldown') || t.includes('pause'))               return '⏸';
    if (t.includes('auto-saved') || t.includes('💾'))                return '💾';
    if (t.startsWith('──'))                                          return '🏁';
    if (t.includes('[diag]') && (t.includes('❌') || t.includes('not found'))) return '🔍';
    if (t.includes('[diag]'))                                        return '🔬';
    if (t.includes('✓') && t.includes('page'))                      return '✓';
    if (t.includes('found') || t.includes('results'))               return '🎯';
    if (type === 'error')   return '❌';
    if (type === 'success') return '✅';
    if (type === 'warn')    return '⚡';
    if (type === 'data')    return '📊';
    if (type === 'fetch')   return '📡';
    return '›';
}