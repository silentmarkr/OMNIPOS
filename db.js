

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

// BUG FIX: dating laging path.join(__dirname, 'database') ang DB_DIR —
// ibig sabihin nasa LOOB ng app code folder mismo ang buong database
// (kasama ang installationId, hardwareFingerprint, deviceSeed sa
// featureUnlocks). Sa Render (walang Persistent Disk), ephemeral ang
// buong filesystem kada bagong deploy — bagong container, blangkong
// disk — kaya mawawala ang database/ folder na ito at magge-generate
// ng BAGONG installationId tuwing may git push + Render deploy, kahit
// parehong service/parehong "device" naman ito.
//
// Ayos: pwede na ngayong i-override ang lokasyon ng database gamit ang
// OMNIPOS_DATA_DIR env var — itakda ito sa mount path ng isang Render
// Persistent Disk (hal. "/var/data") sa Render dashboard, para hindi
// nasa loob ng ephemeral code folder ang database at hindi mawawala
// kada deploy. Kung walang naka-set na OMNIPOS_DATA_DIR (hal. sa
// Termux/local install), gagana pa rin ito nang eksaktong kagaya ng
// dati (database/ sa loob ng app folder) — walang epekto sa mga
// existing na installation.
const DB_DIR = process.env.OMNIPOS_DATA_DIR
    ? path.join(process.env.OMNIPOS_DATA_DIR, 'database')
    : path.join(__dirname, 'database');
if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
}
const DB_PATH = path.join(DB_DIR, 'omnipos.db');

const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
    CREATE TABLE IF NOT EXISTS store (
        module     TEXT PRIMARY KEY,
        data       TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
`);

const selectStmt = db.prepare('SELECT data FROM store WHERE module = ?');
const upsertStmt = db.prepare(`
    INSERT INTO store (module, data, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(module) DO UPDATE SET
        data = excluded.data,
        updated_at = excluded.updated_at
`);

// Product photos are stored separately from the catalog JSON so stock/price writes
// never rewrite megabytes of base64 image data. The table is inside the same SQLite
// database, so local/offline backups remain self-contained.
db.exec(`
    CREATE TABLE IF NOT EXISTS product_images (
        code       TEXT PRIMARY KEY,
        image      TEXT NOT NULL DEFAULT '',
        images     TEXT NOT NULL DEFAULT '[]',
        image_ver  TEXT,
        updated_at TEXT NOT NULL
    );
`);
const productImageSelectAllStmt = db.prepare('SELECT code, image, images, image_ver FROM product_images');
const productImageSelectVersionsStmt = db.prepare('SELECT code, image_ver FROM product_images');
// Magaan na metadata lang (walang base64): ver + bilang ng photo. Hindi binabasa ang HD image/images.
const productImageSelectMetaStmt = db.prepare(`
    SELECT code, image_ver,
           CASE WHEN length(image) > 0 THEN 1 ELSE 0 END AS has_main,
           CASE WHEN json_valid(images) THEN json_array_length(images) ELSE 0 END AS gallery_count
    FROM product_images
`);
const productImageSelectMainCodesStmt = db.prepare("SELECT code FROM product_images WHERE length(image) > 0");
const productImageSelectOneStmt = db.prepare('SELECT image, images FROM product_images WHERE code = ?');
const productImageDeleteStmt = db.prepare('DELETE FROM product_images WHERE code = ?');
const productImageUpsertStmt = db.prepare(`
    INSERT INTO product_images (code, image, images, image_ver, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET
        image = excluded.image,
        images = excluded.images,
        image_ver = excluded.image_ver,
        updated_at = excluded.updated_at
`);

function productImageVersion(image, images) {
    const hash = crypto.createHash('md5');
    if (typeof image === 'string') hash.update(image);
    if (Array.isArray(images)) images.forEach((value) => {
        if (typeof value === 'string') hash.update(value);
    });
    return hash.digest('hex').slice(0, 12);
}
function isProductImagePayloadPresent(product) {
    return !!product && typeof product === 'object' &&
        (Object.prototype.hasOwnProperty.call(product, 'image') ||
         Object.prototype.hasOwnProperty.call(product, 'images'));
}
function stripProductImagesForStorage(products) {
    return (Array.isArray(products) ? products : []).map((product) => {
        if (!product || typeof product !== 'object') return product;
        const copy = { ...product };
        delete copy.image;
        delete copy.images;
        // Derived (galing sa product_images) — hindi dapat maisave sa catalog JSON dahil lumalang stale.
        delete copy.imageVer;
        delete copy.imageCount;
        return copy;
    });
}
function syncProductImages(products, now) {
    const list = Array.isArray(products) ? products : [];
    const incomingCodes = new Set();
    const existingVersions = new Map(productImageSelectVersionsStmt.all().map((row) => [String(row.code), row.image_ver || '']));

    for (const product of list) {
        if (!product || product.code == null) continue;
        const code = String(product.code);
        incomingCodes.add(code);
        if (!isProductImagePayloadPresent(product)) continue;
        const hasMainKey = Object.prototype.hasOwnProperty.call(product, 'image');
        const hasGalleryKey = Object.prototype.hasOwnProperty.call(product, 'images');
        let image = typeof product.image === 'string' ? product.image : '';
        let images = Array.isArray(product.images) ? product.images : [];
        // Kapag isa lang sa image/images ang kasama sa payload (hal. lite product na binago
        // lang ang main photo), HUWAG burahin ang kabila — kunin ito mula sa kasalukuyang row.
        if (hasMainKey !== hasGalleryKey) {
            const current = productImageSelectOneStmt.get(code);
            if (current) {
                if (!hasMainKey) image = current.image || '';
                if (!hasGalleryKey) {
                    try {
                        const parsedGallery = JSON.parse(current.images || '[]');
                        images = Array.isArray(parsedGallery) ? parsedGallery : [];
                    } catch (_) { images = []; }
                }
            }
        }
        const ver = productImageVersion(image, images);
        // Avoid rewriting the HD base64 payload when a stock/price/product write did not
        // actually change the photo. This is especially important for product edits and
        // void/refund/restock operations on a catalog containing many large images.
        if (existingVersions.get(code) !== ver) {
            productImageUpsertStmt.run(code, image, JSON.stringify(images), ver, now);
        }
    }

    // Product add/edit/delete/restore writes are authoritative and must clean up image
    // rows for deleted products even when the remaining catalog happens to contain no
    // image fields. High-frequency photo-free transaction writes bypass this function's
    // image sync entirely in writeDataDirectInTransaction() below.
    if (incomingCodes.size === 0) {
        db.exec('DELETE FROM product_images');
    } else {
        const placeholders = Array.from(incomingCodes, () => '?').join(',');
        db.prepare(`DELETE FROM product_images WHERE code NOT IN (${placeholders})`).run(...incomingCodes);
    }
}
function loadProductImagesMap() {
    const map = new Map();
    for (const row of productImageSelectAllStmt.all()) {
        let images = [];
        try { images = JSON.parse(row.images || '[]'); } catch (_) {}
        map.set(String(row.code), {
            ver: row.image_ver || productImageVersion(row.image || '', images),
            image: row.image || '',
            images: Array.isArray(images) ? images : []
        });
    }
    return map;
}
function mergeProductImages(products) {
    const imageMap = loadProductImagesMap();
    return (Array.isArray(products) ? products : []).map((product) => {
        if (!product || typeof product !== 'object' || product.code == null) return product;
        const entry = imageMap.get(String(product.code));
        return entry ? { ...product, image: entry.image, images: entry.images, imageVer: entry.ver } : product;
    });
}

const ROW_NORMALIZED_MODULES = new Set(['transactions', 'userlogs']);

db.exec(`
    CREATE TABLE IF NOT EXISTS row_store (
        module     TEXT NOT NULL,
        record_id  TEXT NOT NULL,
        seq        INTEGER NOT NULL,
        data       TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (module, record_id)
    );
`);
db.exec('CREATE INDEX IF NOT EXISTS idx_row_store_module_seq ON row_store(module, seq);');

const rowSelectAllStmt = db.prepare('SELECT data FROM row_store WHERE module = ? ORDER BY seq DESC');
const rowSelectIdsStmt = db.prepare('SELECT record_id FROM row_store WHERE module = ?');
const rowMaxSeqStmt = db.prepare('SELECT COALESCE(MAX(seq), 0) as maxSeq FROM row_store WHERE module = ?');
const rowUpsertStmt = db.prepare(`
    INSERT INTO row_store (module, record_id, seq, data, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(module, record_id) DO UPDATE SET
        data = excluded.data,
        updated_at = excluded.updated_at
`);
const rowDeleteStmt = db.prepare('DELETE FROM row_store WHERE module = ? AND record_id = ?');
const rowCountStmt = db.prepare('SELECT COUNT(*) as cnt FROM row_store WHERE module = ?');

function readRowNormalizedData(moduleName) {
    const rows = rowSelectAllStmt.all(moduleName);
    return rows.map((r) => JSON.parse(r.data));
}

function writeRowNormalizedData(moduleName, data) {
    const list = Array.isArray(data) ? data : [];
    const now = new Date().toISOString();

    const existingIds = new Set(rowSelectIdsStmt.all(moduleName).map((r) => r.record_id));
    const incomingIds = new Set();

    let baseSeq = (rowMaxSeqStmt.get(moduleName) || { maxSeq: 0 }).maxSeq;

    db.exec('BEGIN IMMEDIATE');
    try {
        list.forEach((item, index) => {

            

            
            
            const recordId = item && item.id != null
                ? String(item.id)
                : `__noid_${Date.now()}_${index}`;
            incomingIds.add(recordId);

            const candidateSeq = baseSeq + (list.length - index);
            rowUpsertStmt.run(moduleName, recordId, candidateSeq, JSON.stringify(item), now);
        });

        
        for (const oldId of existingIds) {
            if (!incomingIds.has(oldId)) {
                rowDeleteStmt.run(moduleName, oldId);
            }
        }
        db.exec('COMMIT');
    } catch (err) {
        db.exec('ROLLBACK');
        console.error(`Error writing row-normalized data para sa module "${moduleName}":`, err);
    }
}

function migrateBlobToRowStoreIfNeeded(moduleName) {
    try {
        const alreadyMigrated = rowCountStmt.get(moduleName).cnt > 0;
        if (alreadyMigrated) return;

        const legacyRow = selectStmt.get(moduleName);
        if (!legacyRow || !legacyRow.data || legacyRow.data.trim() === '') return;

        const legacyArray = JSON.parse(legacyRow.data);
        if (!Array.isArray(legacyArray) || legacyArray.length === 0) {
            db.prepare('DELETE FROM store WHERE module = ?').run(moduleName);
            return;
        }

        writeRowNormalizedData(moduleName, legacyArray);
        db.prepare('DELETE FROM store WHERE module = ?').run(moduleName);

        console.log(`✅ Na-migrate ang module "${moduleName}" mula sa JSON blob patungo sa ${legacyArray.length} indibidwal na SQL rows.`);
    } catch (err) {
        console.error(`⚠️ Hindi na-migrate ang module "${moduleName}" papunta sa row_store:`, err);
    }
}

ROW_NORMALIZED_MODULES.forEach((moduleName) => migrateBlobToRowStoreIfNeeded(moduleName));

const blobStringCache = new Map();
// Lite products view cache (tingnan ang "PRODUCTS LITE VIEW" section sa baba).
// Nakadeklara dito sa taas para hindi ma-TDZ kapag tinawag ang writeData nang maaga.
let productsViewCache = null;
let productImageMapTimer = null;

function readData(moduleName, defaultData = []) {
    if (ROW_NORMALIZED_MODULES.has(moduleName)) {
        try {
            const hasAnyRows = rowCountStmt.get(moduleName).cnt > 0;
            if (!hasAnyRows) {
                writeRowNormalizedData(moduleName, defaultData);
                return defaultData;
            }
            return readRowNormalizedData(moduleName);
        } catch (err) {
            console.error(`⚠️ May sira sa row-normalized data ng module "${moduleName}". Ibinalik ang default data.`, err);
            return defaultData;
        }
    }
    try {
        let rawData = blobStringCache.get(moduleName);
        if (rawData === undefined) {
            const row = selectStmt.get(moduleName);
            if (!row) {
                writeData(moduleName, defaultData);
                return moduleName === 'products' ? mergeProductImages(defaultData) : defaultData;
            }
            rawData = row.data;
            blobStringCache.set(moduleName, rawData);
        }
        if (!rawData || rawData.trim() === '') return defaultData;
        const parsed = JSON.parse(rawData);
        return moduleName === 'products' && Array.isArray(parsed) ? mergeProductImages(parsed) : parsed;
    } catch (err) {
        console.error(`⚠️ May sira sa SQLite data ng module "${moduleName}". Ibinalik ang default data.`, err);
        return defaultData;
    }
}

function loadProductImageMetaMap() {
    const map = new Map();
    let missingVerCodes = null;
    for (const row of productImageSelectMetaStmt.all()) {
        const gallery = Number(row.gallery_count) || 0;
        const code = String(row.code);
        map.set(code, {
            ver: row.image_ver || '',
            imageCount: gallery + (Number(row.has_main) ? 1 : 0)
        });
        if (!row.image_ver) (missingVerCodes || (missingVerCodes = [])).push(code);
    }
    // Bihirang kaso (lumang row na walang image_ver): kuwentahin ang version para hindi maging
    // walang-imageVer ang product at hindi na kailanman makuha ng client ang photo nito.
    // Ang mga row lang na ito ang binabasa nang buo.
    if (missingVerCodes) {
        for (let i = 0; i < missingVerCodes.length; i += 100) {
            const chunk = missingVerCodes.slice(i, i + 100);
            const fixed = getProductImagesByCodes(chunk);
            for (const code of chunk) {
                const entry = fixed[code];
                if (entry) map.get(code).ver = entry.ver;
            }
        }
    }
    return map;
}

// Products catalog nang WALANG anumang photo at WALANG binabasang HD base64 mula sa
// product_images. Para sa mga operasyong stock/price/list lang ang kailangan.
// Ligtas itong isulat pabalik gamit ang writeData(): walang image/images key kaya hindi
// nagagalaw ang photo table (tanging pagtanggal ng product code ang naglilinis ng photo row).
function readProductsNoImages(defaultData = []) {
    try {
        let rawData = blobStringCache.get('products');
        if (rawData === undefined) {
            const row = selectStmt.get('products');
            if (!row) return Array.isArray(defaultData) ? defaultData : [];
            rawData = row.data;
            blobStringCache.set('products', rawData);
        }
        if (!rawData || rawData.trim() === '') return Array.isArray(defaultData) ? defaultData : [];
        const parsed = JSON.parse(rawData);
        if (!Array.isArray(parsed)) return Array.isArray(defaultData) ? defaultData : [];
        // Defensive: kung may natirang legacy image sa blob, tanggalin sa returned copy lang
        // (hindi ito mawawala sa database dahil ang product_images table ang source of truth).
        return parsed.map((product) => {
            if (!product || typeof product !== 'object') return product;
            if (!('image' in product) && !('images' in product) && !('imageVer' in product) && !('imageCount' in product)) return product;
            const copy = { ...product };
            delete copy.image; delete copy.images; delete copy.imageVer; delete copy.imageCount;
            return copy;
        });
    } catch (err) {
        console.error('⚠️ Hindi mabasa ang products (walang photo):', err);
        return Array.isArray(defaultData) ? defaultData : [];
    }
}

function readDataLite(moduleName, defaultData = []) {
    if (moduleName !== 'products') return readData(moduleName, defaultData);
    try {
        let rawData = blobStringCache.get('products');
        if (rawData === undefined) {
            const row = selectStmt.get('products');
            if (!row) return Array.isArray(defaultData) ? defaultData : [];
            rawData = row.data;
            blobStringCache.set('products', rawData);
        }
        if (!rawData || rawData.trim() === '') return [];
        const parsed = JSON.parse(rawData);
        if (!Array.isArray(parsed)) return [];
        const metaMap = loadProductImageMetaMap();
        return parsed.map((product) => {
            if (!product || typeof product !== 'object') return product;
            const copy = { ...product };
            delete copy.image; delete copy.images;
            const entry = metaMap.get(String(product.code));
            if (entry) { copy.imageVer = entry.ver; copy.imageCount = entry.imageCount; }
            else { delete copy.imageVer; delete copy.imageCount; }
            return copy;
        });
    } catch (err) {
        console.error('⚠️ Hindi mabasa ang lite products data:', err);
        return Array.isArray(defaultData) ? defaultData : [];
    }
}

function writeData(moduleName, data) {
    if (ROW_NORMALIZED_MODULES.has(moduleName)) {
        writeRowNormalizedData(moduleName, data);
        return true;
    }
    if (moduleName === 'products') {
        const now = new Date().toISOString();
        try {
            const list = Array.isArray(data) ? data : [];
            db.exec('BEGIN IMMEDIATE');
            syncProductImages(list, now);
            const json = JSON.stringify(stripProductImagesForStorage(list));
            upsertStmt.run(moduleName, json, now);
            db.exec('COMMIT');
            blobStringCache.set(moduleName, json);
            invalidateProductsViewCache();
            return true;
        } catch (error) {
            try { db.exec('ROLLBACK'); } catch (_) {}
            console.error(`Error writing SQLite data para sa module "${moduleName}":`, error);
            return false;
        }
    }
    try {
        const json = JSON.stringify(data);
        upsertStmt.run(moduleName, json, new Date().toISOString());
        blobStringCache.set(moduleName, json);
        return true;
    } catch (error) {
        console.error(`Error writing SQLite data para sa module "${moduleName}":`, error);
        return false;
    }
}

/**
 * Execute a group of module writes inside one real SQLite transaction.
 * This is used by multi-module financial operations (VOID/REFUND/stock-return)
 * so either every module is committed or SQLite rolls the entire operation back.
 *
 * IMPORTANT: this function intentionally bypasses writeData() because some
 * modules use row_store, whose normal writer opens its own transaction.
 */
function writeDataDirectInTransaction(moduleName, data, now) {
    if (ROW_NORMALIZED_MODULES.has(moduleName)) {
        const list = Array.isArray(data) ? data : [];
        const existingIds = new Set(rowSelectIdsStmt.all(moduleName).map((r) => r.record_id));
        const incomingIds = new Set();
        const baseSeq = (rowMaxSeqStmt.get(moduleName) || { maxSeq: 0 }).maxSeq;

        list.forEach((item, index) => {
            const recordId = item && item.id != null
                ? String(item.id)
                : `__noid_${Date.now()}_${index}`;
            incomingIds.add(recordId);
            const candidateSeq = baseSeq + (list.length - index);
            rowUpsertStmt.run(moduleName, recordId, candidateSeq, JSON.stringify(item), now);
        });

        for (const oldId of existingIds) {
            if (!incomingIds.has(oldId)) rowDeleteStmt.run(moduleName, oldId);
        }
        return JSON.stringify(list);
    }

    if (moduleName === 'products') {
        const list = Array.isArray(data) ? data : [];
        // Sales/stock transactions intentionally pass a photo-free lite catalog.
        // There is no image mutation in that path, so skip all image-table work.
        // Full product writes still synchronize and clean up the photo table.
        const hasImagePayload = list.some(isProductImagePayloadPresent);
        if (hasImagePayload) syncProductImages(list, now);
        const json = JSON.stringify(stripProductImagesForStorage(list));
        upsertStmt.run(moduleName, json, now);
        return json;
    }
    const json = JSON.stringify(data);
    upsertStmt.run(moduleName, json, now);
    return json;
}

/**
 * Atomically replace multiple logical data modules in the same SQLite
 * transaction. The callback receives a small transaction writer so callers
 * can prepare all new module states first and then commit them together.
 */
function runDatabaseTransaction(changes) {
    const list = Array.isArray(changes) ? changes.filter(c => c && c.module) : [];
    if (!list.length) return true;

    const now = new Date().toISOString();
    const cacheUpdates = new Map();
    db.exec('BEGIN IMMEDIATE');
    try {
        for (const change of list) {
            const json = writeDataDirectInTransaction(change.module, change.data, now);
            cacheUpdates.set(change.module, json);
        }
        db.exec('COMMIT');
        for (const [moduleName, json] of cacheUpdates.entries()) {
            if (!ROW_NORMALIZED_MODULES.has(moduleName)) {
                blobStringCache.set(moduleName, json);
                if (moduleName === 'products') invalidateProductsViewCache();
            }
        }
        return true;
    } catch (error) {
        try { db.exec('ROLLBACK'); } catch (rollbackError) {
            console.error('[DB-TRANSACTION] SQLite rollback failed:', rollbackError);
        }
        throw error;
    }
}

function vacuumDatabase() {
    try {
        db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
        db.exec('VACUUM;');

        

        

        

        
        
        db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
        return { success: true };
    } catch (error) {
        console.error('⚠️ Hindi na-vacuum ang database pagkatapos ng reset:', error);
        return { success: false, message: error.message };
    }
}

const BACKUP_DIR = path.join(DB_DIR, 'backups');
if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

const BACKUP_STATUS_MODULE = 'system_backup_status';

function recordBackupStatus(result) {
    try {
        const prev = (() => {
            try {
                const row = selectStmt.get(BACKUP_STATUS_MODULE);
                return row && row.data ? JSON.parse(row.data) : null;
            } catch (e) { return null; }
        })();

        const now = new Date().toISOString();
        const status = {
            lastAttemptAt: now,
            lastSuccessAt: result.success ? now : (prev && prev.lastSuccessAt) || null,
            lastFailureAt: result.success ? (prev && prev.lastFailureAt) || null : now,
            lastFailureMessage: result.success ? (prev && prev.lastFailureMessage) || null : (result.message || 'Unknown error'),
            consecutiveFailures: result.success ? 0 : ((prev && prev.consecutiveFailures) || 0) + 1
        };

        upsertStmt.run(BACKUP_STATUS_MODULE, JSON.stringify(status), now);
    } catch (err) {

        console.error('⚠️ Hindi ma-record ang backup status:', err);
    }
}

function getBackupStatus() {
    try {
        const row = selectStmt.get(BACKUP_STATUS_MODULE);
        return row && row.data ? JSON.parse(row.data) : null;
    } catch (err) {
        return null;
    }
}

function runLocalDatabaseBackup(maxBackupsToKeep = 14) {
    try {

        
        
        db.exec('PRAGMA wal_checkpoint(FULL);');

        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const destPath = path.join(BACKUP_DIR, `omnipos-${stamp}.db`);
        fs.copyFileSync(DB_PATH, destPath);

        
        const files = fs.readdirSync(BACKUP_DIR)
            .filter(f => f.startsWith('omnipos-') && f.endsWith('.db'))
            .sort();
        while (files.length > maxBackupsToKeep) {
            const oldest = files.shift();
            fs.unlinkSync(path.join(BACKUP_DIR, oldest));
        }

        console.log(`✅ Local database backup created: ${destPath} (${files.length}/${maxBackupsToKeep} kept)`);

        // BUG FIX: dati, RAW SQLite (.db) file copy lang ang ginagawa ng
        // auto local backup na ito — kaya WALANG paraan para gamitin ito
        // sa loob mismo ng app kapag walang internet. Ang "System
        // Recovery & Database Restore" card (triggerSystemRestore() sa
        // app.js, #recoveryFileInput accept=".json") ay JSON.parse() lang
        // ang ginagawa sa napiling file bago ipadala sa POST
        // /api/restore-backup — kaya kung ito rin lang ang piliin, palya
        // ito agad (hindi valid JSON ang raw SQLite binary). Ibig sabihin,
        // hindi talaga magagamit ang lokal na backup na ito sa "System
        // Recovery" flow, kahit ito mismo ang layunin nito (offline na
        // restore). Idinagdag ngayon, sabay sa .db copy sa itaas, ang
        // isa ring JSON snapshot (parehong shape ng
        // omnipos_full_backup_<timestamp>.json na ipinapadala sa email
        // tuwing Hard Reset — {timestamp, ...modules}) — kaya pareho na
        // silang tugma sa /api/restore-backup at maaaring piliin sa
        // parehong "System Recovery" file picker, online man o offline.
        // Hindi ito nagpapalit/nag-aalis sa .db copy sa itaas — hiwalay
        // pa rin itong ginagawa bilang huling paraan (manual file-level
        // swap) kung sakaling masira/hindi na makabukas ang app mismo,
        // dahil hindi kailangang tumakbo ang app para gamitin iyon.
        let jsonSnapshotPath = null;
        try {
            const snapshot = getFullDatabaseSnapshot();
            const backupPayload = { timestamp: snapshot.generatedAt, ...snapshot.modules };
            jsonSnapshotPath = path.join(BACKUP_DIR, `omnipos-${stamp}.json`);
            fs.writeFileSync(jsonSnapshotPath, JSON.stringify(backupPayload));

            const jsonFiles = fs.readdirSync(BACKUP_DIR)
                .filter(f => f.startsWith('omnipos-') && f.endsWith('.json'))
                .sort();
            while (jsonFiles.length > maxBackupsToKeep) {
                const oldestJson = jsonFiles.shift();
                fs.unlinkSync(path.join(BACKUP_DIR, oldestJson));
            }
            console.log(`✅ Local JSON snapshot backup created: ${jsonSnapshotPath} (${jsonFiles.length}/${maxBackupsToKeep} kept) — usable with System Recovery even offline.`);
        } catch (jsonErr) {
            // Hindi dapat mag-fail ang buong local backup kung nagawa
            // naman ang .db copy sa itaas — i-log lang, huwag i-throw.
            console.error('⚠️ Nagawa ang .db copy pero nabigo ang JSON snapshot na bahagi ng local backup:', jsonErr.message);
        }

        const result = { success: true, path: destPath, jsonSnapshotPath };
        recordBackupStatus(result);
        return result;
    } catch (err) {
        console.error('⚠️ Nabigo ang local database backup:', err);
        const result = { success: false, message: err.message };
        recordBackupStatus(result);
        return result;
    }
}

function resolveDownloadBackupDir() {
    const override = (process.env.RELAY_BACKUP_DOWNLOAD_DIR || '').trim();
    if (override) return path.join(override, 'RELAY_BACKUP');

    const candidates = [
        path.join(os.homedir(), 'storage', 'downloads'), 
        '/storage/emulated/0/Download',                   
        path.join(os.homedir(), 'Downloads'),              
    ];
    const found = candidates.find((p) => {
        try { return fs.existsSync(p); } catch (err) { return false; }
    });

    

    return path.join(found || path.join(DB_DIR, 'relay-backup-fallback'), 'RELAY_BACKUP');
}

const RELAY_BACKUP_FILENAME = 'omnipos_database_backup.db';

function mirrorBackupToDownloads() {
    try {
        const destDir = resolveDownloadBackupDir();
        if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

        const destPath = path.join(destDir, RELAY_BACKUP_FILENAME);

        const existedBefore = fs.existsSync(destPath);

        
        db.exec('PRAGMA wal_checkpoint(FULL);');
        fs.copyFileSync(DB_PATH, destPath); 

        const stat = fs.statSync(destPath);
        return { success: true, path: destPath, sizeBytes: stat.size, existedBefore };
    } catch (err) {
        console.error('⚠️ Nabigo ang RELAY_BACKUP mirror papunta sa Download folder:', err);
        return { success: false, message: err.message };
    }
}

// BUG FIX / COST FIX: dating 'sessions' lang ang naka-exclude dito.
// Idinagdag ang 'aiAssistantLogs' at 'aiAssistantUsage' — operational
// telemetry lang ito ng AI Assistant feature (mga tanong, timing,
// error, buwanang credit usage), WALANG halaga bilang "backup" ng
// negosyo ng client, pero patuloy itong lumalaki (hanggang 1000 entries,
// kasama ang buong text ng bawat tanong) at kasama pa rin sa Cloud
// Backup snapshot kung hindi dito i-exclude — ibig sabihin dagdag na
// storage sa Neon Postgres ng developer (shared cloud-backup database
// sa maraming client) kada successful sync, nang walang benepisyo sa
// client. Sa halip, hayaan na lang itong manatiling lokal (SQLite) sa
// bawat device/server ng client.
// SECURITY BUGFIX: idinagdag ang 'cloudflareTunnelConfig' — ang bagong
// Cloudflare Remote Access Link (Named Tunnel) module ay naglalaman ng
// isang RAW SECRET credential (ang Cloudflare Tunnel Token — functionally
// kapareho ng isang password/API key), pareho ang klase ng 'sessions'
// (session token) na nasa listahan na ito dati. Kung hindi ito i-exclude,
// aktwal na naisasama ang totoong Tunnel Token ng client sa Cloud Backup
// payload na ipinapadala patungong SHARED na Neon Postgres database ng
// developer (kasama ang backup data ng maraming ibang client) tuwing
// successful ang cloud sync — isang totoong credential leak sa isang
// shared na storage. Ang getFullDatabaseSnapshot() (para sa LOCAL na
// backup file/Hard Reset email papunta mismo sa sariling email ng
// client) ay sinasadyang hindi apektado nito — doon dapat kasama pa rin
// ang config na ito para gumana ang restore.
// UPDATE (Custom / Any-Provider Tunnel support): 'cloudflareTunnelConfig'
// can now also hold a raw custom tunnel Command instead of a Cloudflare
// Tunnel Token, whenever the admin picks "Custom / Any Provider" for the
// Remote Access Link's custom domain (see server.js). That command can
// itself embed a secret belonging to some other provider (e.g. an ngrok
// or Pinggy auth token) — it must be treated with the exact same care as
// the Cloudflare Tunnel Token above, which is why it stays inside this
// SAME excluded key rather than a separate one.
// 'onlinePaymentGatewayCredentials' holds raw Secret Keys for the
// additional (non-PayMongo) Online Payment gateways added alongside
// PayMongo (e.g. Xendit) — same class of secret as 'paymongoCredentials'
// above, so it is excluded here for the exact same reason.
const ALWAYS_EXCLUDED_FROM_CLOUD_SYNC = new Set(['sessions', 'aiAssistantLogs', 'aiAssistantUsage', 'cloudflareTunnelConfig', 'lanAccessConfig', 'paymongoCredentials', 'onlinePaymentGatewayCredentials', 'deviceFingerprintCache']);
const REDACTED_FIELDS_BY_MODULE = { users: ['password'] };
// BUG FIX: dating ginagamit ng AI Assistant database snapshot (see
// getAiKnowledgeSnapshot() sa ibaba) ang PAREHONG
// REDACTED_FIELDS_BY_MODULE/stripRedactedFields na para sa cloud
// backup — pero magkaiba ang pangangailangan ng dalawa: kailangan ng
// buong fidelity (kasama ang webauthnCredentials/webauthnUserHandle)
// ng cloud backup para hindi mawala ang fingerprint/biometric login
// setup pagkatapos mag-restore, samantalang ang AI snapshot ay hindi
// dapat maglaman ng ANUMANG authentication material — kahit hindi ito
// literal na "password" — dahil ipinapadala ito papunta sa isang
// third-party AI provider (Cloudflare Workers AI). Kaya hiwalay na
// listahan ito, dagdag lang sa REDACTED_FIELDS_BY_MODULE sa itaas, at
// GINAGAMIT LANG sa AI snapshot path — hindi nito naaapektuhan ang
// cloud backup.
const AI_SNAPSHOT_EXTRA_REDACTED_FIELDS_BY_MODULE = { users: ['webauthnCredentials', 'webauthnUserHandle'], attendanceRecords: ['timeInSelfie', 'timeOutSelfie'] };
// Per-day attendance selfie modules hold staff face photos; they must never reach the third-party AI provider.
const AI_ASSISTANT_EXCLUDED_MODULE_PREFIXES = ['attendanceSelfies_'];
function stripFieldsForAiSnapshot(moduleName, data) {
    const extraFields = AI_SNAPSHOT_EXTRA_REDACTED_FIELDS_BY_MODULE[moduleName];
    if (!extraFields || !Array.isArray(data)) return data;
    return data.map((record) => {
        if (!record || typeof record !== 'object') return record;
        const clone = { ...record };
        extraFields.forEach((field) => { delete clone[field]; });
        return clone;
    });
}

function getAllModuleNames() {
    const blobModules = db.prepare('SELECT DISTINCT module FROM store').all().map((r) => r.module);
    const rowModules = db.prepare('SELECT DISTINCT module FROM row_store').all().map((r) => r.module);
    return Array.from(new Set([...blobModules, ...rowModules, ...ROW_NORMALIZED_MODULES]));
}

function stripRedactedFields(moduleName, data) {
    const redactedFields = REDACTED_FIELDS_BY_MODULE[moduleName];
    if (!redactedFields || !Array.isArray(data)) return data;
    return data.map((record) => {
        if (!record || typeof record !== 'object') return record;
        const clone = { ...record };
        redactedFields.forEach((field) => { delete clone[field]; });
        return clone;
    });
}

// BACKUP COMPLETENESS FIX: ang mga module ay ginagawa lang sa SQLite kapag
// unang na-sulat (lazy). Kaya ang isang backup na kinuha bago pa nagamit ang
// isang feature (hal. BIR Compliance: birState/birVoids/birZReadingHistory/
// birResetHistory) ay WALANG laman para sa module na iyon, at ang 'birState'
// ay maaaring nakasave pa bilang literal na `null` (getBirState() reads it with
// a `null` default, which readData() persists) — na nilalaktawan naman ng
// restore. Resulta: hindi nababalik ang BIR data (AGT, invoice numbering)
// mula sa auto-backup. Ang registry na ito ay nagbibigay ng "nothing saved
// yet" default para sa bawat kilalang module para SIYA ay laging kasama sa
// backup (gamit ang default, walang isinusulat sa database).
const KNOWN_MODULE_DEFAULTS = new Map();
function registerModuleDefaults(defaultsByModule) {
    Object.entries(defaultsByModule || {}).forEach(([moduleName, def]) => {
        KNOWN_MODULE_DEFAULTS.set(moduleName, def);
    });
}
function resolveModuleDefault(moduleName) {
    const def = KNOWN_MODULE_DEFAULTS.get(moduleName);
    const value = typeof def === 'function' ? def() : def;
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}
function moduleExistsInStore(moduleName) {
    if (ROW_NORMALIZED_MODULES.has(moduleName)) return true;
    try { return !!selectStmt.get(moduleName); } catch (err) { return false; }
}
function readModuleForBackup(moduleName) {
    const hasKnownDefault = KNOWN_MODULE_DEFAULTS.has(moduleName);
    if (hasKnownDefault && !moduleExistsInStore(moduleName)) {
        return resolveModuleDefault(moduleName);
    }
    let data = readData(moduleName, hasKnownDefault ? resolveModuleDefault(moduleName) : []);
    if ((data === null || data === undefined) && hasKnownDefault) {
        data = resolveModuleDefault(moduleName);
    }
    return data;
}
function getBackupModuleNames(excludedSet) {
    const names = new Set(getAllModuleNames());
    KNOWN_MODULE_DEFAULTS.forEach((_def, moduleName) => names.add(moduleName));
    return Array.from(names).filter((m) => !(excludedSet && excludedSet.has(m)));
}

function getCloudBackupPayload() {
    const moduleNames = getBackupModuleNames(ALWAYS_EXCLUDED_FROM_CLOUD_SYNC);
    const modules = {};
    let totalRecords = 0;

    for (const moduleName of moduleNames) {
        const data = stripRedactedFields(moduleName, readModuleForBackup(moduleName));
        modules[moduleName] = data;
        if (Array.isArray(data)) totalRecords += data.length;
    }

    return {
        modules,
        moduleNames,
        totalRecords,
        excludedModules: Array.from(ALWAYS_EXCLUDED_FROM_CLOUD_SYNC),
        redactedFieldsByModule: REDACTED_FIELDS_BY_MODULE,
        generatedAt: new Date().toISOString()
    };
}

function getFullDatabaseSnapshot(options = {}) {
    const excludeProductImages = !!(options && options.excludeProductImages);
    const moduleNames = getBackupModuleNames(null);
    const modules = {};
    let totalRecords = 0;
    let productsWithImagesExcluded = 0;

    for (const moduleName of moduleNames) {
        let data;
        if (excludeProductImages && moduleName === 'products' && moduleExistsInStore('products')) {
            // Hindi na binabasa ang HD photo kung itatapon lang din. Binibilang ang mga product
            // na may photo (main o gallery) mula sa magaang metadata para tama ang "excluded" count.
            data = readProductsNoImages([]);
            const metaMap = loadProductImageMetaMap();
            for (const product of data) {
                if (!product || typeof product !== 'object' || product.code == null) continue;
                const entry = metaMap.get(String(product.code));
                if (entry && entry.imageCount > 0) productsWithImagesExcluded++;
            }
        } else {
            data = readModuleForBackup(moduleName);
        }
        modules[moduleName] = data;
        if (Array.isArray(data)) totalRecords += data.length;
    }

    return {
        modules,
        moduleNames,
        totalRecords,
        productsWithImagesExcluded,
        generatedAt: new Date().toISOString()
    };
}

// ===================================================================
// AI ASSISTANT KNOWLEDGE SNAPSHOT
// ===================================================================
// Ginagamit ito ng /api/ai-assistant/ask (server.js) para bigyan ang AI
// Assistant ng kaalaman tungkol sa AKTWAL na laman ng database (hindi
// lang FAQ knowledge base) — pero naka-gate pa rin base sa role ng
// naka-login na user:
//   - scope 'full'    (Admin / authorized user) -> LAHAT ng modules
//   - scope 'limited' (regular/non-admin user)   -> catalog-level lang
// Kahit 'full' scope, laging tinatanggal ang mga field na walang saysay
// (o mapanganib) na ipadala sa isang third-party AI provider — hindi ito
// "impormasyon tungkol sa system" na kailangan ng tao, kundi raw na
// security secret (password hash, session token, license/activation key).
const AI_ASSISTANT_ALWAYS_EXCLUDED_MODULES = new Set([
    'sessions', 'featureUnlocks', 'cloudTokenPrefs',
    'aiAssistantLogs', 'aiAssistantUsage', 'aiSupportTickets',
    // SECURITY BUGFIX: 'cloudflareTunnelConfig' holds a raw credential
    // for the Remote Access Link feature — a Cloudflare Tunnel Token, or
    // (since the Custom / Any-Provider option was added) a raw tunnel
    // Command that can itself embed another provider's secret — same
    // class of secret as 'sessions', so it must never be handed to the
    // third-party AI provider as context either, even for a full-scope
    // Admin snapshot.
    // SECURITY: 'paymongoCredentials' holds a raw PayMongo Secret Key
    // (test and/or live) used for Online Payments (QR Ph) — same class of
    // secret as the Cloudflare Tunnel Token above, so it must never be
    // handed to the third-party AI provider as context either.
    // SECURITY: 'onlinePaymentGatewayCredentials' holds raw Secret Keys for
    // any additional (non-PayMongo) Online Payment gateway connected
    // (e.g. Xendit) — same class of secret as 'paymongoCredentials' above.
    'cloudflareTunnelConfig', 'paymongoCredentials', 'onlinePaymentGatewayCredentials',
    // Device-specific hardware identifiers (model/build fingerprint/serial) used only for the anti-clone check.
    'deviceFingerprintCache'
]);
// Kapag hindi Admin/authorized ang naka-login, ito lang ang mga module na
// isasama — basic catalog/store info, walang financial totals, walang
// data ng ibang user, walang debts/fraud/security config.
const AI_ASSISTANT_LIMITED_ROLE_MODULES = new Set(['products', 'categories', 'promocodes', 'storeSettings', 'roles']);
// BUG FIX: dating 300 ang cap na ito — masyadong marami kapag pinagsama-
// samang mga module (lalo na ang mabibigat gaya ng transactions), kaya
// isa sa mga naging dahilan kung bakit palaging na-e-exceed ang context
// budget ng AI model (see buildAiDatabaseContextMessage() sa server.js).
// Mas maliit na cap dito, at ang FINAL na safety ay ang per-module size
// budget sa buildAiDatabaseContextMessage() — pareho itong ginagawa
// para dalawang layer ng proteksyon laban sa sobrang laking context.
// UPDATE: dating 30 ito, pero masyado namang MALIIT kumpara sa TUNAY na
// context budget ng AI model — kinumpirma na 24,000 tokens ang context
// window ng @cf/meta/llama-3.3-70b-instruct-fp8-fast (server.js), at
// dinagdagan na rin ang per-request na size budget sa
// buildAiDatabaseContextMessage() (MAX_CONTEXT_CHARS, 6000 -> 16000) para
// tugma dito. Dahil ang MAX_CONTEXT_CHARS na iyon pa rin ang FINAL na
// safety net (kahit tumaas ang cap na ito, hindi pa rin papayagang
// lumagpas ang KABUUANG snapshot sa budget na iyon), ligtas na itaas din
// ang per-module cap papuntang 60 — mas malaking porsyento ng isang
// average/typical na module (hal. products) ang makikita nang buo bago
// pa man kailanganing mag-truncate, sa halip na laging 30 lang kahit may
// pang natitirang espasyo.
const AI_ASSISTANT_MAX_RECORDS_PER_MODULE = 60;

// BUG FIX: dati laging "data.slice(-CAP)" (kunin ang HULING N item ng array)
// ang ginagamit sa ibaba kapag lumagpas sa cap ang isang module, sa
// palagay na laging "oldest-first / naka-append gamit ang .push()" ang
// pagkakasunod-sunod ng bawat module array — kaya "ang huling N" ay
// palaging katumbas ng "ang pinakabagong N". PERO maraming module sa
// buong app ang gumagamit ng .unshift() sa BAWAT bagong record (bagong
// record laging pumupunta sa UNAHAN, index 0) — ibig sabihin NEWEST-FIRST
// na talaga ang pagkakasunod-sunod: 'transactions' at 'userlogs' mismo ay
// row-normalized pa at ORDER BY seq DESC sa SQL query (readRowNormalizedData
// sa itaas), kaya newest-first din doon sa level ng database. Para sa mga
// module na ito, ang dating "slice(-CAP)" ay kumukuha ng PINAKALUMANG N
// records sa halip na pinakabago — kabaligtaran mismo ng layunin nito
// (tingnan ang paliwanag sa AI_ASSISTANT_MAX_RECORDS_PER_MODULE sa itaas)
// kaya kung minsan luma/hindi kasalukuyang customer/debt/refund/shift/
// promo/attendance record ang nakikita/nababanggit ng AI sa halip na ang
// mga totoong pinakabago, kapag lumagpas na sa 30 records ang module.
const NEWEST_FIRST_MODULES = new Set([
    'transactions', 'userlogs', 'customers', 'debts', 'refunds', 'stockReturns',
    'shifts', 'promocodes', 'attendanceRecords', 'inventoryCounts', 'wasteLog',
    'consignments', 'fraudAlerts'
]);

function getAiKnowledgeSnapshot(scope, focusModules) {
    const isFull = scope === 'full';
    const allModuleNames = getAllModuleNames().filter((m) => !AI_ASSISTANT_ALWAYS_EXCLUDED_MODULES.has(m) && !AI_ASSISTANT_EXCLUDED_MODULE_PREFIXES.some((prefix) => m.startsWith(prefix)));
    const allowedSet = isFull ? new Set(allModuleNames) : new Set(allModuleNames.filter((m) => AI_ASSISTANT_LIMITED_ROLE_MODULES.has(m)));

    // AI context routing: kapag may explicit na listahan ng relevant modules,
    // huwag nang isama ang buong database. Mas maraming useful records ang
    // kasya sa maliit na model context window at mas mababa ang chance na
    // maputol/ma-omit ang mismong data na tinatanong ng user.
    const requested = Array.isArray(focusModules)
        ? focusModules.filter((m) => typeof m === 'string' && allowedSet.has(m))
        : [];
    const moduleNames = requested.length
        ? Array.from(new Set(requested))
        : allModuleNames.filter((m) => allowedSet.has(m));
    const allowedModules = isFull ? moduleNames : moduleNames.filter((m) => AI_ASSISTANT_LIMITED_ROLE_MODULES.has(m));
    const modules = {};
    const truncatedModules = [];
    let totalRecords = 0;

    for (const moduleName of allowedModules) {
        // Ang AI ay walang pakinabang sa HD base64 photo (sinasayang lang nito ang context budget),
        // kaya ang products ay binabasa nang walang photo at hindi hinahawakan ang product_images.
        let data = stripRedactedFields(moduleName, moduleName === 'products' ? readProductsNoImages([]) : readData(moduleName, []));
        data = stripFieldsForAiSnapshot(moduleName, data);
        if (Array.isArray(data)) {
            totalRecords += data.length;
            if (data.length > AI_ASSISTANT_MAX_RECORDS_PER_MODULE) {
                truncatedModules.push(moduleName);
                // Panatilihin ang PINAKABAGONG records (mas kapaki-pakinabang
                // sa karaniwang tanong kaysa sa pinakauna) — alamin muna kung
                // newest-first (index 0 = bago) o oldest-first/append (dulo =
                // bago) ang pagkakasunod-sunod ng module bago mag-slice, para
                // laging tama ang direksyon (see NEWEST_FIRST_MODULES sa itaas).
                data = NEWEST_FIRST_MODULES.has(moduleName)
                    ? data.slice(0, AI_ASSISTANT_MAX_RECORDS_PER_MODULE)
                    : data.slice(-AI_ASSISTANT_MAX_RECORDS_PER_MODULE);
            }
        }
        modules[moduleName] = data;
    }

    return {
        scope: isFull ? 'full' : 'limited',
        modules,
        moduleNames: allowedModules,
        focused: requested.length > 0,
        focusedModules: requested,
        totalRecords,
        truncatedModules,
        recordCapPerModule: AI_ASSISTANT_MAX_RECORDS_PER_MODULE,
        generatedAt: new Date().toISOString()
    };
}

// ---------------------------------------------------------------------------
// PRODUCTS "LITE" VIEW
// Ang mga product photo ay nakasave bilang base64 data URL mismo sa loob ng
// products JSON, kaya ang bawat GET /api/products ay nagpapadala (at ang
// browser ay nagpa-parse) ng lahat ng HD image kahit table lang ang
// kailangan. Ang "lite" view ay ang parehong listahan pero WALANG mabibigat
// na image (image/images), may dagdag lang na imageVer/imageCount para
// malaman ng client kung kailangan pang kunin ang photo. Ang mga photo ay
// kinukuha nang paunti-unti gamit ang getProductImagesByCodes().
//
// Naka-cache ang lite view (at ang naka-serialize na JSON nito) hangga't hindi
// nagbabago ang products blob (ini-invalidate sa writeData/runDatabaseTransaction),
// kaya hindi na kailangang i-parse/i-stringify ang buong HD blob sa bawat request.
// ---------------------------------------------------------------------------
const PRODUCT_INLINE_IMAGE_MAX_CHARS = 2048;
const PRODUCT_IMAGE_MAP_TTL_MS = 60 * 1000;
function invalidateProductsViewCache() {
    productsViewCache = null;
    if (productImageMapTimer) {
        clearTimeout(productImageMapTimer);
        productImageMapTimer = null;
    }
}

function isHeavyProductImage(value) {
    return typeof value === 'string' && value.length > PRODUCT_INLINE_IMAGE_MAX_CHARS;
}

function buildProductsView(list, keepImages) {
    const imageMap = keepImages ? new Map() : null;
    const lite = list.map((p) => {
        if (!p || typeof p !== 'object') return p;
        const gallery = Array.isArray(p.images) ? p.images : null;
        const heavyMain = isHeavyProductImage(p.image);
        const heavyGallery = !!gallery && gallery.some(isHeavyProductImage);
        if (!heavyMain && !heavyGallery) return p;

        const hash = crypto.createHash('md5');
        if (typeof p.image === 'string') hash.update(p.image);
        if (gallery) gallery.forEach((g) => { if (typeof g === 'string') hash.update(g); });
        const imageVer = hash.digest('hex').slice(0, 12);

        const copy = { ...p, imageVer };
        if (heavyMain) copy.image = '';
        if (heavyGallery) {
            copy.imageCount = gallery.filter(Boolean).length;
            copy.images = [];
        }
        if (imageMap && p.code != null) {
            imageMap.set(String(p.code), {
                ver: imageVer,
                image: typeof p.image === 'string' ? p.image : '',
                images: gallery || []
            });
        }
        return copy;
    });
    return { lite, imageMap };
}

function getProductsBlobString() {
    if (blobStringCache.has('products')) return blobStringCache.get('products');
    const row = selectStmt.get('products');
    if (!row) return null;
    blobStringCache.set('products', row.data);
    return row.data;
}

// Ibinabalik ang NAKA-SERIALIZE nang products JSON (parehong laman ng readData('products'))
// nang hindi pa ito pina-parse/ini-stringify ulit — para sa mabilis na buong /api/products.
function getProductsRawJson() {
    try {
        const raw = getProductsBlobString();
        if (typeof raw !== 'string' || raw.length <= 1 || raw.trimStart().charAt(0) !== '[') return null;
        return JSON.stringify(mergeProductImages(JSON.parse(raw)));
    } catch (e) {
        return null;
    }
}

function touchProductImageMapTimer() {
    if (productImageMapTimer) clearTimeout(productImageMapTimer);
    productImageMapTimer = setTimeout(() => {
        productImageMapTimer = null;
        if (productsViewCache) productsViewCache.imageMap = null;
    }, PRODUCT_IMAGE_MAP_TTL_MS);
    if (typeof productImageMapTimer.unref === 'function') productImageMapTimer.unref();
}

/**
 * Ibinabalik ang { lite, liteJson, imageMap } o null kung hindi magamit
 * (walang products row / sira ang JSON) — sa ganoong kaso, ang caller ay
 * bumabalik sa normal na readData('products').
 */
function getProductsView(needImages) {
    try {
        const raw = getProductsBlobString();
        if (typeof raw !== 'string' || raw.length === 0) return null;
        const cache = productsViewCache;
        if (cache && cache.rawLength === raw.length && (!needImages || cache.imageMap)) {
            if (cache.imageMap) touchProductImageMapTimer();
            return cache;
        }
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return null;
        const metaMap = loadProductImageMetaMap();
        const imageMap = needImages ? loadProductImagesMap() : null;
        const lite = parsed.map((product) => {
            if (!product || typeof product !== 'object') return product;
            const entry = metaMap.get(String(product.code));
            if (!entry) {
                if (!('imageVer' in product) && !('imageCount' in product)) return product;
                const stale = { ...product };
                delete stale.imageVer; delete stale.imageCount;
                return stale;
            }
            return { ...product, image: '', images: [], imageVer: entry.ver, imageCount: entry.imageCount };
        });
        productsViewCache = {
            rawLength: raw.length,
            lite,
            liteJson: JSON.stringify(lite),
            imageMap: needImages ? imageMap : null
        };
        if (needImages) touchProductImageMapTimer();
        return productsViewCache;
    } catch (err) {
        console.error('⚠️ Hindi nabuo ang lite products view:', err);
        return null;
    }
}

// Set ng product code na may MAIN photo — walang binabasang base64 (length() lang).
function getProductCodesWithMainImage() {
    return new Set(productImageSelectMainCodesStmt.all().map((row) => String(row.code)));
}

function getProductImagesByCodes(codes) {
    const wanted = Array.from(new Set((Array.isArray(codes) ? codes : [])
        .filter((code) => code !== null && code !== undefined)
        .map((code) => String(code)))).slice(0, 100);
    const out = {};
    if (!wanted.length) return out;

    // Query only the requested product codes. The previous implementation scanned and
    // JSON-parsed the entire photo table for every 40-code background request, which
    // became another hidden bottleneck as the catalog grew.
    const placeholders = wanted.map(() => '?').join(',');
    const rows = db.prepare(`SELECT code, image, images, image_ver FROM product_images WHERE code IN (${placeholders})`).all(...wanted);
    for (const row of rows) {
        let images = [];
        try { images = JSON.parse(row.images || '[]'); } catch (_) {}
        out[String(row.code)] = {
            ver: row.image_ver || productImageVersion(row.image || '', images),
            image: row.image || '',
            images: Array.isArray(images) ? images : []
        };
    }
    return out;
}


function migrateLegacyProductImages() {
    try {
        const row = selectStmt.get('products');
        if (!row || typeof row.data !== 'string' || !row.data.trim()) return;
        const parsed = JSON.parse(row.data);
        if (!Array.isArray(parsed)) return;
        const hasImages = parsed.some((p) => isProductImagePayloadPresent(p) &&
            ((typeof p.image === 'string' && p.image.length > 0) || (Array.isArray(p.images) && p.images.length > 0)));
        if (!hasImages) return;
        const now = new Date().toISOString();
        db.exec('BEGIN IMMEDIATE');
        try {
            syncProductImages(parsed, now);
            const json = JSON.stringify(stripProductImagesForStorage(parsed));
            upsertStmt.run('products', json, now);
            db.exec('COMMIT');
            blobStringCache.set('products', json);
            console.log('✅ Migrated product HD photos to product_images.');
        } catch (err) {
            try { db.exec('ROLLBACK'); } catch (_) {}
            throw err;
        }
    } catch (err) {
        console.error('⚠️ Product photo migration failed; legacy product data was left untouched:', err);
    }
}
migrateLegacyProductImages();

module.exports = { getProductsView, getProductsRawJson, getProductImagesByCodes, db, readData, readDataLite, readProductsNoImages, getProductCodesWithMainImage, writeData, runDatabaseTransaction, vacuumDatabase, DB_DIR, DB_PATH, BACKUP_DIR, runLocalDatabaseBackup, mirrorBackupToDownloads, getCloudBackupPayload, getFullDatabaseSnapshot, getAiKnowledgeSnapshot, ALWAYS_EXCLUDED_FROM_CLOUD_SYNC, getBackupStatus, registerModuleDefaults };

function checkModuleBlobSizes(warnThresholdBytes = 20 * 1024 * 1024) {
    try {

        
        
        const rows = db.prepare('SELECT module, length(data) as len FROM store').all();
        const flagged = rows.filter((r) => r.len >= warnThresholdBytes);
        flagged.forEach((r) => {
            console.warn(
                `⚠️ [DB SIZE WATCH] Ang module "${r.module}" ay lumagpas na sa ${(warnThresholdBytes / 1024 / 1024).toFixed(1)} MB ` +
                `(kasalukuyan: ${(r.len / 1024 / 1024).toFixed(2)} MB). Isaalang-alang ang pag-archive/normalize nito bago ito ` +
                `mag-cause ng nakikitang pagbagal sa bawat pagsulat.`
            );
        });

        

        
        const rowNormalizedSizes = db.prepare(`
            SELECT module, COUNT(*) as rowCount, COALESCE(SUM(length(data)), 0) as totalLen
            FROM row_store
            GROUP BY module
        `).all();
        rowNormalizedSizes.forEach((r) => {
            if (r.totalLen >= warnThresholdBytes) {
                console.log(
                    `ℹ️ [DB SIZE WATCH] Ang row-normalized na module "${r.module}" ay may ${r.rowCount} rows ` +
                    `(kabuuang laki: ${(r.totalLen / 1024 / 1024).toFixed(2)} MB). Hindi na ito nagre-rewrite ng ` +
                    `buong history kada isulat, pero isaalang-alang pa ring mag-archive ng lumang records paminsan-minsan.`
                );
            }
        });

        return {
            checked: rows.length + rowNormalizedSizes.length,
            flagged: flagged.map((r) => r.module)
        };
    } catch (err) {
        console.error('⚠️ Hindi na-check ang blob sizes:', err);
        return { checked: 0, flagged: [] };
    }
}

module.exports.checkModuleBlobSizes = checkModuleBlobSizes;
