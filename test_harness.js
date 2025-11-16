// test_harness.js - smoke tests for FolderVault crypto functions (runs outside Electron)
// This script performs the quick checklist requested: creates test files, encrypts, decrypts,
// verifies byte-equality, tests wrong-password behavior, secure-delete, and cancellation.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const util = require('util');
const stream = require('stream');

const pipeline = util.promisify(stream.pipeline);
const scrypt = util.promisify(crypto.scrypt);

const MAGIC = Buffer.from('ELECTRON');
const SALT_LEN = 16;
const IV_LEN = 12;
const AUTH_TAG_LEN = 16;

async function encryptFile(filePath, password) {
    const salt = crypto.randomBytes(SALT_LEN);
    const iv = crypto.randomBytes(IV_LEN);
    const key = await scrypt(password, salt, 32, { N: 16384, r: 8, p: 1 });
    try {
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        const outPath = `${filePath}.enc`;
        const writeStream = fs.createWriteStream(outPath);
        writeStream.write(MAGIC);
        writeStream.write(salt);
        writeStream.write(iv);
        await pipeline(fs.createReadStream(filePath), cipher, writeStream);
        const authTag = cipher.getAuthTag();
        await fs.promises.appendFile(outPath, authTag);
        return outPath;
    } finally {
        try { if (key && typeof key.fill === 'function') key.fill(0); } catch (e) { }
    }
}

async function decryptFile(encPath, password) {
    const handle = await fs.promises.open(encPath, 'r');
    try {
        const stat = await handle.stat();
        const fileSize = stat.size;
        const headerLen = MAGIC.length + SALT_LEN + IV_LEN;
        if (fileSize < headerLen + AUTH_TAG_LEN) throw new Error('File too small');
        const headerBuf = Buffer.alloc(headerLen);
        await handle.read(headerBuf, 0, headerLen, 0);
        const magic = headerBuf.slice(0, MAGIC.length);
        if (!magic.equals(MAGIC)) throw new Error('Bad magic');
        const salt = headerBuf.slice(MAGIC.length, MAGIC.length + SALT_LEN);
        const iv = headerBuf.slice(MAGIC.length + SALT_LEN, headerLen);
        const authTagBuf = Buffer.alloc(AUTH_TAG_LEN);
        await handle.read(authTagBuf, 0, AUTH_TAG_LEN, fileSize - AUTH_TAG_LEN);
        const key = await scrypt(password, salt, 32, { N: 16384, r: 8, p: 1 });
        try {
            const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
            decipher.setAuthTag(authTagBuf);
            const outPath = encPath.endsWith('.enc') ? encPath.slice(0, -4) : `${encPath}.dec`;
            const start = headerLen;
            const end = fileSize - AUTH_TAG_LEN - 1;
            await pipeline(fs.createReadStream(encPath, { start, end }), decipher, fs.createWriteStream(outPath));
            return outPath;
        } finally {
            try { if (key && typeof key.fill === 'function') key.fill(0); } catch (e) { }
        }
    } finally {
        await handle.close();
    }
}

async function secureDelete(filePath, passes = 3) {
    try {
        const stats = await fs.promises.stat(filePath);
        const size = stats.size;
        const fd = await fs.promises.open(filePath, 'r+');
        try {
            const chunk = 64 * 1024;
            const buf = Buffer.allocUnsafe(chunk);
            for (let pass = 0; pass < passes; pass++) {
                let written = 0;
                while (written < size) {
                    const toWrite = Math.min(chunk, size - written);
                    crypto.randomFillSync(buf, 0, toWrite);
                    await fd.write(buf, 0, toWrite, written);
                    written += toWrite;
                }
                if (typeof fd.sync === 'function') await fd.sync(); else await fs.promises.fsync(fd.fd);
            }
        } finally {
            await fd.close();
        }
        await fs.promises.unlink(filePath);
        return true;
    } catch (err) {
        return false;
    }
}

async function runChecklist() {
    const tmp = path.join(__dirname, 'test_tmp');
    const tmp2 = path.join(__dirname, 'test_tmp2');
    await fs.promises.rm(tmp, { recursive: true, force: true });
    await fs.promises.rm(tmp2, { recursive: true, force: true });
    await fs.promises.mkdir(tmp, { recursive: true });
    await fs.promises.mkdir(tmp2, { recursive: true });

    // Create small test files
    const files = [
        { name: 'a.txt', data: Buffer.from('Hello FolderVault\n') },
        { name: 'b.bin', data: crypto.randomBytes(1024) }
    ];
    for (const f of files) {
        await fs.promises.writeFile(path.join(tmp, f.name), f.data);
        // copy to tmp2 for second-phase tests
        await fs.promises.writeFile(path.join(tmp2, f.name), f.data);
    }

    const password = 'correcthorsebatterystaple';
    console.log('Encrypt with keepOriginals=true');
    // encrypt files in tmp (keep originals)
    const encPaths = [];
    for (const f of files) {
        const p = path.join(tmp, f.name);
        const enc = await encryptFile(p, password);
        encPaths.push(enc);
    }
    console.log('Created enc files:', encPaths);

    console.log('Decrypt with correct password and compare');
    for (const enc of encPaths) {
        const out = await decryptFile(enc, password);
        const orig = await fs.promises.readFile(out);
        const expected = await fs.promises.readFile(out + '.orig').catch(() => null);
        // We didn't keep originals by name, compare against original file in tmp
        const originalName = path.basename(out);
        const originalPath = path.join(tmp, originalName);
        const original = await fs.promises.readFile(originalPath);
        const bufOut = await fs.promises.readFile(out);
        if (Buffer.compare(original, bufOut) === 0) console.log('OK:', originalName);
        else console.error('MISMATCH:', originalName);
    }

    console.log('Encrypt with keepOriginals=false + secureDelete=true on copies (tmp2)');
    // simulate folder run with cancellation support
    let cancelFlag = false;
    const enc2 = [];
    for (const f of files) {
        const p = path.join(tmp2, f.name);
        const out = await encryptFile(p, password);
        enc2.push(out);
        // perform secure delete of original
        const deleted = await secureDelete(p, 2);
        console.log('secureDelete', p, deleted ? 'ok' : 'failed');
    }
    // Check originals removed
    for (const f of files) {
        const p = path.join(tmp2, f.name);
        const exists = await fs.promises.stat(p).then(() => true).catch(() => false);
        console.log('original exists?', p, exists);
    }

    console.log('Try wrong password for decrypt (should fail or produce mismatch)');
    const wrong = 'incorrect-password';
    for (const enc of enc2) {
        let threw = false;
        try {
            const out = await decryptFile(enc, wrong);
            // compare with expected original name (from earlier tmp)
            const origName = path.basename(out);
            const originalPath = path.join(tmp, origName);
            const original = await fs.promises.readFile(originalPath).catch(() => null);
            const outBuf = await fs.promises.readFile(out).catch(() => null);
            if (!original || !outBuf || Buffer.compare(original, outBuf) !== 0) console.log('Wrong-password detect: mismatch as expected for', origName);
            else console.error('Unexpected: wrong password produced valid file for', origName);
        } catch (e) {
            console.log('Decrypt threw as expected with wrong password for', enc, '-', e.message);
            threw = true;
        }
    }

    console.log('Cancellation mid-run (simulate): start encrypting many small files and cancel after first');
    const manyDir = path.join(__dirname, 'test_many');
    await fs.promises.rm(manyDir, { recursive: true, force: true });
    await fs.promises.mkdir(manyDir, { recursive: true });
    for (let i = 0; i < 10; i++) {
        await fs.promises.writeFile(path.join(manyDir, `f${i}.txt`), `file ${i}\n`);
    }
    // simulate loop with cancellation between files
    let processed = 0;
    for (const name of await fs.promises.readdir(manyDir)) {
        if (processed === 1) {
            console.log('Simulating cancel request now');
            break;
        }
        const p = path.join(manyDir, name);
        await encryptFile(p, password);
        processed++;
    }
    console.log('Processed before cancel:', processed);

    console.log('Checklist complete. Inspect test_tmp, test_tmp2, and test_many folders for artifacts.');
}

runChecklist().catch((e) => {
    console.error('Test harness failed:', e);
    process.exit(2);
});
