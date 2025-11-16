// renderer.js - moved renderer logic from inline script to an external file
// This keeps the CSP strict (no 'unsafe-inline' for scripts) and makes behavior easier to test.
(function () {
    // Helper utilities
    function maskPath(p) {
        if (!p) return p;
        const parts = p.split(/[/\\]+/);
        if (parts.length <= 3) return p;
        return '...' + parts.slice(-3).join('\\');
    }

    function baseName(p) {
        if (!p) return p;
        const parts = p.split(/[/\\]+/);
        return parts[parts.length - 1];
    }

    // UI wiring
    const pick = document.getElementById('pick');
    const folderArea = document.getElementById('folderArea');
    const folderSpan = document.getElementById('folder');
    const pwdInput = document.getElementById('password');
    const encryptBtn = document.getElementById('encrypt');
    const decryptBtn = document.getElementById('decrypt');
    const cancelBtn = document.getElementById('cancel');
    const keepOriginals = document.getElementById('keepOriginals');
    const secureDelete = document.getElementById('secureDelete');
    const fileList = document.getElementById('fileList');
    const overallBar = document.getElementById('overallBar');
    const overallText = document.getElementById('overallText');
    const logEl = document.getElementById('log');
    const openDist = document.getElementById('openDist');

    // Map from file path -> <li> element
    const fileMap = new Map();
    // Map from file path -> tracking stats for ETA/speed
    const fileStats = new Map();

    let selectedFolder = null;
    let running = false;

    function appendLog(msg) {
        const time = new Date().toLocaleTimeString();
        logEl.textContent += `[${time}] ${msg}\n`;
        logEl.scrollTop = logEl.scrollHeight;
    }

    function setRunning(v) {
        running = v;
        encryptBtn.disabled = v;
        decryptBtn.disabled = v;
        pick.disabled = v;
        // cancel is enabled only while running
        cancelBtn.disabled = !v;
        if (!v) {
            cancelBtn.textContent = 'Cancel';
        }
    }

    // Hook IPC log/progress with guarded subscriptions and throttled UI updates
    let unsubLog = null;
    let unsubProgress = null;
    let queuedProgress = null;
    let progressTimer = null;
    const PROGRESS_THROTTLE_MS = 150; // throttle UI updates for overall progress

    function flushProgress() {
        if (!queuedProgress) return;
        const { processed, total } = queuedProgress;
        overallText.textContent = `${processed} / ${total}`;
        const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
        overallBar.style.width = pct + '%';
        queuedProgress = null;
        if (progressTimer) { clearTimeout(progressTimer); progressTimer = null; }
    }

    function initListeners() {
        if (window.vault && window.vault.onLog && !unsubLog) {
            unsubLog = window.vault.onLog((msg) => appendLog(msg));
        }
        if (window.vault && window.vault.onProgress && !unsubProgress) {
            unsubProgress = window.vault.onProgress((data) => {
                if (data.type === 'file') {
                    updateFileItem(data);
                    return;
                }
                if (data.type === 'file-progress') {
                    // data: { type:'file-progress', file, seen, total }
                    updateFileProgress(data);
                    return;
                }
                if (data.type === 'progress') {
                    queuedProgress = data;
                    if (!progressTimer) {
                        progressTimer = setTimeout(() => { flushProgress(); }, PROGRESS_THROTTLE_MS);
                    }
                    // If we've reached the end, ensure UI unblocks
                    try {
                        if (data.processed === data.total) setRunning(false);
                    } catch (e) { }
                }
            });
        }
    }

    // initialize listeners once
    initListeners();

    // ensure we clean up listeners (avoid leaks on reload / dev)
    window.addEventListener('beforeunload', () => {
        try { if (typeof unsubLog === 'function') unsubLog(); } catch (e) { /* ignore */ }
        try { if (typeof unsubProgress === 'function') unsubProgress(); } catch (e) { /* ignore */ }
    });

    // Add or update file item in list (show only basename to avoid leaking full paths in screenshots)
    function updateFileItem(data) {
        const { file, action, out, error, index, total } = data;
        let li = fileMap.get(file);
        if (!li) {
            li = document.createElement('li');
            li.className = 'file-item';
            li.dataset.file = file;
            li.innerHTML = `<div class="name">${baseName(file)}</div>` +
                `<div class="file-progress"><div class="bar"><i></i></div><div class="file-meta-small">0%</div></div>` +
                `<div class="meta" style="min-width:220px; text-align:right"></div>`;
            fileList.appendChild(li);
            fileMap.set(file, li);
        }
        const meta = li.querySelector('.meta');
        const small = li.querySelector('.file-meta-small');
        // initialize stats if not present
        if (!fileStats.has(file)) {
            fileStats.set(file, { seen: 0, total: total || 0, lastSeen: 0, lastTime: 0, speed: 0, domLast: 0 });
        }
        if (action === 'start') meta.textContent = `Processing (${index || '?'} of ${total || '?'})`;
        else if (action === 'done') {
            meta.textContent = `Done → ${out ? baseName(out) : ''}`;
            if (small) small.textContent = '';
            const bar = li.querySelector('.file-progress .bar>i');
            if (bar) bar.style.width = '100%';
            li.classList.add('done');
            // prune tracking stats after a short delay to free memory
            setTimeout(() => {
                try { fileStats.delete(file); } catch (e) { }
            }, 30_000);
        }
        else if (action === 'skip') {
            meta.textContent = `Skipped`;
            li.classList.add('skipped');
            setTimeout(() => { try { fileStats.delete(file); } catch (e) { } }, 30_000);
        }
        else if (action === 'error') {
            meta.textContent = `Error: ${error}`;
            li.classList.add('error');
            setTimeout(() => { try { fileStats.delete(file); } catch (e) { } }, 30_000);
        }
    }

    // Update per-file byte progress UI (throttled per-file)
    const LAST_UPDATE_MS = 80;
    function updateFileProgress({ file, seen, total }) {
        const li = fileMap.get(file);
        if (!li) return; // maybe not yet created
        const stats = fileStats.get(file) || { seen: 0, total };
        const now = Date.now();
        const lastTime = stats.lastTime || now;
        const lastSeen = stats.lastSeen || 0;

        // compute instantaneous speed and smooth it with EMA
        const dt = Math.max(1, now - lastTime) / 1000; // seconds
        const delta = Math.max(0, seen - lastSeen);
        const instSpeed = delta / dt; // bytes/sec
        const alpha = 0.25;
        const speed = (stats.speed || 0) * (1 - alpha) + instSpeed * alpha;

        stats.seen = seen;
        stats.total = total;
        stats.lastSeen = seen;
        stats.lastTime = now;
        stats.speed = speed;
        fileStats.set(file, stats);

        // throttle DOM updates per file
        const lastUpdate = stats.domLast || 0;
        if (now - lastUpdate < LAST_UPDATE_MS) return;
        stats.domLast = now;

        const bar = li.querySelector('.file-progress .bar>i');
        const small = li.querySelector('.file-meta-small');
        if (bar) {
            const pct = total > 0 ? Math.round((seen / total) * 100) : 0;
            bar.style.width = pct + '%';
        }
        if (small) {
            let meta = '';
            if (speed > 0) {
                const rem = Math.max(0, total - seen);
                const eta = rem / speed;
                const s = eta < 60 ? `${Math.round(eta)}s` : `${Math.round(eta / 60)}m`;
                const humanSpeed = humanBytes(speed) + '/s';
                meta = `${humanSpeed} · ${s}`;
            } else {
                meta = `${Math.round((seen / Math.max(total, 1)) * 100)}%`;
            }
            small.textContent = meta;
        }
    }

    function humanBytes(n) {
        if (n < 1024) return `${n}B`;
        if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`;
        if (n < 1024 * 1024 * 1024) return `${Math.round(n / (1024 * 1024))}MB`;
        return `${Math.round(n / (1024 * 1024 * 1024))}GB`;
    }

    pick.addEventListener('click', async () => {
        const folder = await window.vault.chooseFolder();
        if (folder) {
            selectedFolder = folder;
            folderSpan.textContent = maskPath(folder);
            appendLog('Selected folder: ' + maskPath(folder));
            fileList.innerHTML = '';
            fileMap.clear();
            overallBar.style.width = '0%'; overallText.textContent = '0 / 0';
        } else {
            appendLog('Folder selection canceled');
        }
    });

    // Drag & drop
    folderArea.addEventListener('dragover', (e) => { e.preventDefault(); folderArea.style.borderColor = '#888'; });
    folderArea.addEventListener('dragleave', (e) => { e.preventDefault(); folderArea.style.borderColor = '#bbb'; });
    folderArea.addEventListener('drop', (e) => {
        e.preventDefault(); folderArea.style.borderColor = '#bbb';
        const items = e.dataTransfer.files;
        if (items && items.length > 0) {
            const path = items[0].path;
            selectedFolder = path;
            folderSpan.textContent = maskPath(path);
            appendLog('Selected folder (drop): ' + maskPath(path));
            fileList.innerHTML = '';
            fileMap.clear();
        }
    });

    encryptBtn.addEventListener('click', async () => {
        if (!selectedFolder) { appendLog('Pick a folder first'); return; }
        const password = pwdInput.value;
        if (!password) { appendLog('Enter a password'); return; }

        // confirm destructive action if originals will be deleted (native dialog)
        if (!keepOriginals.checked) {
            const ok = await window.vault.showConfirm('Warning', 'You chose to delete originals after encryption. This is destructive and may be irreversible. Proceed?');
            if (!ok) return;
        }

        setRunning(true);
        appendLog('Starting encryption...');
        const options = { keepOriginals: keepOriginals.checked, secureDelete: secureDelete.checked };
        try {
            const res = await window.vault.encryptFolder(selectedFolder, password, options);
            appendLog('Result: ' + JSON.stringify(res));
        } catch (err) {
            appendLog('Encryption failed: ' + (err && err.message ? err.message : String(err)));
        } finally {
            // Always ensure we clear running state so UI is usable
            setRunning(false);
        }
    });

    decryptBtn.addEventListener('click', async () => {
        if (!selectedFolder) { appendLog('Pick a folder first'); return; }
        const password = pwdInput.value;
        if (!password) { appendLog('Enter a password'); return; }
        setRunning(true);
        appendLog('Starting decryption...');
        const options = { keepOriginals: keepOriginals.checked, secureDelete: secureDelete.checked };
        try {
            const res = await window.vault.decryptFolder(selectedFolder, password, options);
            appendLog('Result: ' + JSON.stringify(res));
        } catch (err) {
            appendLog('Decryption failed: ' + (err && err.message ? err.message : String(err)));
        } finally {
            setRunning(false);
        }
    });

    cancelBtn.addEventListener('click', async () => {
        if (!running) return;
        // disable cancel to indicate request sent
        cancelBtn.disabled = true;
        cancelBtn.textContent = 'Cancelling...';
        try {
            await window.vault.cancelOperation();
            appendLog('Cancel requested — waiting for current file to finish...');
            // we don't force-stop the UI here; setRunning(false) will be called when the operation completes
            // add a safety timeout to re-enable cancel if the main process doesn't respond
            setTimeout(() => {
                if (running) {
                    cancelBtn.disabled = false;
                    cancelBtn.textContent = 'Cancel';
                }
            }, 10_000);
        } catch (err) {
            appendLog('Cancel request failed: ' + (err && err.message ? err.message : String(err)));
            cancelBtn.disabled = false;
            cancelBtn.textContent = 'Cancel';
        }
    });

    openDist.addEventListener('click', async () => {
        try {
            const res = await window.vault.openAppFolder();
            if (res && res.opened) appendLog('Opened app folder: ' + res.path);
            else appendLog('Open app folder failed: ' + (res && res.error));
        } catch (e) {
            appendLog('openAppFolder error: ' + e.message);
        }
    });

})();
