// main.js - Electron main process for FolderVault
// Implements folder traversal, encryption/decryption, secure delete, and IPC handlers.

const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const util = require('util');
const stream = require('stream');

// Enable live-reload in development when source files change.
// Only enable when NODE_ENV is not 'production' and the app is not packaged.
if (process.env.NODE_ENV !== 'production' && !app.isPackaged) {
    try {
        // Require electron-reload and watch the project directory
        // Ignore node_modules, logs, dist, and test folders to avoid reloads during file operations
        require('electron-reload')(__dirname, {
            electron: require('electron'),
            ignored: [
                /node_modules/,
                /logs/,
                /dist/,
                /test_tmp/,
                /test_tmp2/,
                /test_many/,
                /\.log$/
            ]
        });
        console.log('Live reload enabled (development)');
    } catch (e) {
        // If electron-reload is not installed, ignore silently.
        console.log('electron-reload not available:', e.message);
    }
}

const pipeline = util.promisify(stream.pipeline);
const scrypt = util.promisify(crypto.scrypt);

const MAGIC = Buffer.from('ELECTRON'); // 8 bytes
const SALT_LEN = 16;
const IV_LEN = 12;
const AUTH_TAG_LEN = 16;

let mainWindow = null;
let cancelRequested = false;
// Controller for cooperative cancellation of long-running operations
let activeOpController = null;
// Simple log file for diagnostics (appends)
const LOG_DIR = path.join(__dirname, 'logs');
try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (e) { /* ignore */ }

// Global error handlers to capture unexpected crashes and surface them to the UI/logs
process.on('uncaughtException', (err) => {
    try { sendLog('uncaughtException:', err && err.stack ? err.stack : err && err.message ? err.message : String(err)); } catch (e) { console.error(e); }
});

process.on('unhandledRejection', (reason) => {
    try { sendLog('unhandledRejection:', reason && reason.stack ? reason.stack : String(reason)); } catch (e) { console.error(e); }
});

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            enableRemoteModule: false
        }
    });

    mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit();
});

// Utility to send log messages to renderer
function sendLog(...parts) {
    const msg = parts.join(' ');
    if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('vault-log', msg);
    }
    console.log(msg);
    // Append to a log file for support (best-effort)
    try {
        const stamp = new Date().toISOString();
        fs.appendFile(path.join(LOG_DIR, 'app.log'), `[${stamp}] ${msg}\n`, () => { });
    } catch (e) { /* ignore */ }
}

function sendProgress(data) {
    if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('vault-progress', data);
    }
}

// Transform stream that counts bytes and reports progress via a callback
const { Transform } = require('stream');
class CountingTransform extends Transform {
    constructor(total = 0, onProgress = () => { }) {
        super();
        this.total = total;
        this.seen = 0;
        this.onProgress = onProgress;
    }
    _transform(chunk, encoding, callback) {
        this.seen += chunk.length;
        try { this.onProgress(this.seen, this.total); } catch (e) { /* ignore */ }
        this.push(chunk);
        callback();
    }
}

// Async generator to walk a directory recursively
async function* walk(dir) {
    const dirents = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const dirent of dirents) {
        const res = path.resolve(dir, dirent.name);
        if (dirent.isDirectory()) {
            yield* walk(res);
        } else if (dirent.isFile()) {
            yield res;
        }
    }
}

// Secure delete: overwrite file with random data multiple times and unlink (best-effort)
async function secureDelete(filePath, passes = 3) {
    try {
        const stats = await fs.promises.stat(filePath);
        const size = stats.size;
        const fd = await fs.promises.open(filePath, 'r+');
        try {
            const chunk = 64 * 1024; // 64KB buffer
            // Reuse a single buffer and fill it with random bytes to avoid many allocations
            const buf = Buffer.allocUnsafe(chunk);
            for (let pass = 0; pass < passes; pass++) {
                let written = 0;
                while (written < size) {
                    const toWrite = Math.min(chunk, size - written);
                    // Fill only the needed portion with random bytes
                    crypto.randomFillSync(buf, 0, toWrite);
                    await fd.write(buf, 0, toWrite, written);
                    written += toWrite;
                }
                // fs.promises.FileHandle may or may not expose sync(); use whichever is available
                if (typeof fd.sync === 'function') {
                    await fd.sync();
                } else {
                    // fallback to fsync on the numeric fd
                    await fs.promises.fsync(fd.fd);
                }
            }
        } finally {
            await fd.close();
        }
        await fs.promises.unlink(filePath);
        sendLog('secureDelete: removed', filePath);
    } catch (err) {
        sendLog('secureDelete failed for', filePath, '-', err.message);
    }
}

// Encrypt a single file -> creates filePath + '.enc'
// encryptFile supports an options object { signal } to support abortion
async function encryptFile(filePath, password, options = {}) {
    const salt = crypto.randomBytes(SALT_LEN);
    const iv = crypto.randomBytes(IV_LEN);
    // Derive key with scrypt parameters N=16384, r=8, p=1
    const key = await scrypt(password, salt, 32, { N: 16384, r: 8, p: 1 });
    try {
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        const outPath = `${filePath}.enc`;
        const writeStream = fs.createWriteStream(outPath);

        // Write header: MAGIC | SALT | IV
        writeStream.write(MAGIC);
        writeStream.write(salt);
        writeStream.write(iv);

        // Stream the file through the cipher into output (respect optional signal)
        // Create read stream (support signal option in Node >= 16.7)
        const readOpts = options.signal ? { signal: options.signal } : undefined;
        const readStream = fs.createReadStream(filePath, readOpts);

        // counting transform for per-file byte progress
        const stats = await fs.promises.stat(filePath);
        const totalBytes = stats.size;
        const counter = new CountingTransform(totalBytes, (seen) => {
            sendProgress({ type: 'file-progress', file: filePath, seen, total: totalBytes });
        });

        // wire abort to destroy streams quickly
        const abortHandler = () => {
            try { readStream.destroy(new Error('aborted')); } catch (e) { }
            try { cipher.destroy(new Error('aborted')); } catch (e) { }
            try { writeStream.destroy(new Error('aborted')); } catch (e) { }
        };
        if (options.signal) options.signal.addEventListener('abort', abortHandler, { once: true });

        await pipeline(readStream, counter, cipher, writeStream);

        // After pipeline completes, retrieve auth tag and append it
        const authTag = cipher.getAuthTag();
        await fs.promises.appendFile(outPath, authTag);

        sendLog('Encrypted', filePath, '->', outPath);
        return outPath;
    } finally {
        // Zero the key buffer to reduce leakage window
        try { if (key && typeof key.fill === 'function') key.fill(0); } catch (e) { /* best-effort */ }
    }
}

// Decrypt a .enc file (expects header MAGIC|SALT|IV and trailing AUTH_TAG)
// decryptFile supports options { signal } and uses an atomic write (temp+rename)
async function decryptFile(encPath, password, options = {}) {
    const handle = await fs.promises.open(encPath, 'r');
    try {
        const stat = await handle.stat();
        const fileSize = stat.size;

        // Read header
        const headerLen = MAGIC.length + SALT_LEN + IV_LEN;
        if (fileSize < headerLen + AUTH_TAG_LEN) {
            throw new Error('File too small to be valid');
        }

        const headerBuf = Buffer.alloc(headerLen);
        await handle.read(headerBuf, 0, headerLen, 0);

        const magic = headerBuf.slice(0, MAGIC.length);
        if (!magic.equals(MAGIC)) {
            throw new Error('Invalid file magic');
        }

        const salt = headerBuf.slice(MAGIC.length, MAGIC.length + SALT_LEN);
        const iv = headerBuf.slice(MAGIC.length + SALT_LEN, headerLen);

        // Read auth tag (last 16 bytes)
        const authTagBuf = Buffer.alloc(AUTH_TAG_LEN);
        await handle.read(authTagBuf, 0, AUTH_TAG_LEN, fileSize - AUTH_TAG_LEN);

        const key = await scrypt(password, salt, 32, { N: 16384, r: 8, p: 1 });
        try {
            const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
            decipher.setAuthTag(authTagBuf);

            const outPath = encPath.endsWith('.enc') ? encPath.slice(0, -4) : `${encPath}.dec`;
            const tmpPath = outPath + '.tmp-' + crypto.randomBytes(6).toString('hex');

            const start = headerLen;
            const end = fileSize - AUTH_TAG_LEN - 1; // inclusive

            // Stream decrypted output to a temp file, then fsync & rename atomically
            const readOpts = Object.assign({ start, end }, options.signal ? { signal: options.signal } : {});
            const readStream = fs.createReadStream(encPath, readOpts);

            // counting transform for per-file byte progress during decrypt
            const totalBytes = end - start + 1;
            const counter = new CountingTransform(totalBytes, (seen) => {
                sendProgress({ type: 'file-progress', file: encPath, seen, total: totalBytes });
            });

            // wire abort to destroy streams quickly
            const abortHandler = () => {
                try { readStream.destroy(new Error('aborted')); } catch (e) { }
                try { decipher.destroy(new Error('aborted')); } catch (e) { }
            };
            if (options.signal) options.signal.addEventListener('abort', abortHandler, { once: true });

            try {
                await pipeline(readStream, counter, decipher, fs.createWriteStream(tmpPath));

                // Ensure data is flushed to disk (best-effort)
                try {
                    const fd = await fs.promises.open(tmpPath, 'r+');
                    try {
                        if (typeof fd.sync === 'function') await fd.sync();
                        else await fs.promises.fsync(fd.fd);
                    } finally {
                        await fd.close();
                    }
                } catch (e) {
                    // ignore fsync failures but log
                    sendLog('fsync failed for', tmpPath, '-', e.message);
                }

                await fs.promises.rename(tmpPath, outPath);

                sendLog('Decrypted', encPath, '->', outPath);
                return outPath;
            } catch (err) {
                // If decryption fails (e.g., wrong password), clean up the temp file
                try {
                    await fs.promises.unlink(tmpPath).catch(() => { });
                    sendLog('Cleaned up temp file after decryption error:', tmpPath);
                } catch (e) { /* ignore cleanup errors */ }
                throw err; // re-throw the original error
            }
        } finally {
            // Zero key buffer
            try { if (key && typeof key.fill === 'function') key.fill(0); } catch (e) { /* best-effort */ }
        }
    } finally {
        await handle.close();
    }
}

// IPC handlers
ipcMain.handle('choose-folder', async () => {
    const res = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
    if (res.canceled || res.filePaths.length === 0) return null;
    return res.filePaths[0];
});

ipcMain.handle('open-app-folder', async () => {
    try {
        // Open the directory where the main script is located
        const dir = __dirname;
        await shell.openPath(dir);
        sendLog('Opened app folder:', dir);
        return { opened: true, path: dir };
    } catch (err) {
        sendLog('open-app-folder failed:', err.message);
        return { opened: false, error: err.message };
    }
});

ipcMain.handle('show-confirm', async (event, { title, message }) => {
    try {
        const res = await dialog.showMessageBox(mainWindow, {
            type: 'warning',
            buttons: ['Yes', 'No'],
            defaultId: 1,
            cancelId: 1,
            title: title || 'Confirm',
            message: message || ''
        });
        return res.response === 0;
    } catch (err) {
        sendLog('show-confirm failed:', err.message);
        return false;
    }
});

ipcMain.handle('cancel-operation', async () => {
    cancelRequested = true;
    // If there's an active controller, abort it to attempt to stop streaming operations
    try {
        if (activeOpController && typeof activeOpController.abort === 'function') {
            activeOpController.abort();
        }
    } catch (e) { /* ignore */ }
    sendLog('Operation cancellation requested');
    return { cancelled: true };
});

ipcMain.handle('encrypt-folder', async (event, { folder, password, options = {} }) => {
    // options: { keepOriginals: boolean, secureDelete: boolean }
    cancelRequested = false;
    sendLog('Starting encryption for', folder);
    // create a controller for this operation to support cooperative cancellation
    const controller = new AbortController();
    activeOpController = controller;
    let count = 0;
    try {
        let total = 0;
        for await (const _ of walk(folder)) total++;
        let processed = 0;
        for await (const file of walk(folder)) {
            if (cancelRequested) {
                sendLog('Encryption cancelled by user');
                break;
            }
            // Skip already encrypted files
            if (file.endsWith('.enc')) {
                sendLog('Skipping (already .enc):', file);
                sendProgress({ type: 'file', file, action: 'skip' });
                processed++;
                continue;
            }
            sendProgress({ type: 'file', file, action: 'start', index: processed + 1, total });
            try {
                const encPath = await encryptFile(file, password, { signal: controller.signal });
                sendProgress({ type: 'file', file, action: 'done', out: encPath });
                if (!options.keepOriginals) {
                    if (options.secureDelete) await secureDelete(file);
                    else await fs.promises.unlink(file).catch(() => sendLog('unlink failed for', file));
                }
                count++;
            } catch (err) {
                sendLog('Error encrypting', file, '-', err.message);
                sendProgress({ type: 'file', file, action: 'error', error: err.message });
            }
            processed++;
            sendProgress({ type: 'progress', processed, total });
        }
        sendLog('Encryption complete. Files processed:', String(count));
        return { success: true, processed: count };
    } catch (err) {
        sendLog('Encryption failed:', err.message);
        return { success: false, error: err.message };
    } finally {
        // clear active controller for this operation
        try { activeOpController = null; } catch (e) { }
    }
});

ipcMain.handle('decrypt-folder', async (event, { folder, password, options = {} }) => {
    // options: { keepOriginals: boolean, secureDelete: boolean }
    cancelRequested = false;
    sendLog('Starting decryption for', folder);
    const controller = new AbortController();
    activeOpController = controller;
    let count = 0;
    try {
        let total = 0;
        for await (const _ of walk(folder)) total++;
        let processed = 0;
        for await (const file of walk(folder)) {
            if (cancelRequested) {
                sendLog('Decryption cancelled by user');
                break;
            }
            if (!file.endsWith('.enc')) {
                processed++;
                sendProgress({ type: 'file', file, action: 'skip' });
                continue;
            }
            sendProgress({ type: 'file', file, action: 'start', index: processed + 1, total });
            try {
                const outPath = await decryptFile(file, password, { signal: controller.signal });
                sendProgress({ type: 'file', file, action: 'done', out: outPath });
                if (!options.keepOriginals) {
                    if (options.secureDelete) await secureDelete(file);
                    else await fs.promises.unlink(file).catch(() => sendLog('unlink failed for', file));
                }
                count++;
            } catch (err) {
                sendLog('Error decrypting', file, '-', err.message);
                sendProgress({ type: 'file', file, action: 'error', error: err.message });
            }
            processed++;
            sendProgress({ type: 'progress', processed, total });
        }
        sendLog('Decryption complete. Files processed:', String(count));
        return { success: true, processed: count };
    } catch (err) {
        sendLog('Decryption failed:', err.message);
        return { success: false, error: err.message };
    } finally {
        try { activeOpController = null; } catch (e) { }
    }
});
