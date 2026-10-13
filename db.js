

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const sqliteModule = require('node:sqlite');
const { DatabaseSync } = sqliteModule;

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

// PERFORMANCE: SQLite tuning para sa POS workload (maraming maliliit na write + malalaking JSON blob read).
// - busy_timeout: maghintay muna (hanggang 5s) imbes na agad mag-"database is locked" kapag may kasabay
//   na write (hal. backup/VACUUM/checkpoint habang may checkout).
// - synchronous=NORMAL: ligtas sa WAL mode (hindi masisira ang database kahit biglang mamatay ang app/Termux);
//   mas mabilis ang bawat commit dahil hindi na nag-fsync sa bawat transaction, kundi sa checkpoint lang.
//   Kung gusto mo ang pinakamahigpit na durability (kahit biglang mawalan ng kuryente), itakda sa .env:
//   OMNIPOS_SQLITE_SYNCHRONOUS=FULL
// - temp_store=MEMORY, cache_size=-16000 (~16 MB), mmap_size=64 MB: mas mabilis ang sort/index/read.
// - wal_autocheckpoint=1000 pages: hindi lumalaki nang walang hanggan ang -wal file.
// Lahat ay nasa try/catch: kung may hindi suportado, tahimik na lilipas at gagamitin ang default ng SQLite.
(function applySqliteTuning() {
    const syncRaw = String(process.env.OMNIPOS_SQLITE_SYNCHRONOUS || 'NORMAL').trim().toUpperCase();
    const syncMode = ['NORMAL', 'FULL', 'EXTRA'].includes(syncRaw) ? syncRaw : 'NORMAL';
    const pragmas = [
        'PRAGMA busy_timeout = 5000;',
        `PRAGMA synchronous = ${syncMode};`,
        'PRAGMA temp_store = MEMORY;',
        'PRAGMA cache_size = -16000;',
        'PRAGMA mmap_size = 67108864;',
        'PRAGMA wal_autocheckpoint = 1000;',
        // Limitahan ang laki ng -wal file sa disk pagkatapos ng checkpoint (64 MB) — mahalaga sa phone storage.
        'PRAGMA journal_size_limit = 67108864;'
    ];
    for (const sql of pragmas) {
        try { db.exec(sql); } catch (_) { /* hindi suportado — gamitin ang default */ }
    }
    // Hayaan ang SQLite na i-update ang query statistics kung kailangan (mabilis; walang ginagawa kung hindi kailangan).
    try { db.exec('PRAGMA optimize;'); } catch (_) { /* opsyonal */ }
})();

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

// SCALE FIX (malaking database): mga statement para sa "isang row lang" na operasyon, para hindi na
// kailangang basahin/i-parse/isulat muli ang BUONG module sa bawat benta o log entry.
const rowSelectOneStmt = db.prepare('SELECT data FROM row_store WHERE module = ? AND record_id = ? LIMIT 1');
const rowExistsStmt = db.prepare('SELECT 1 AS found FROM row_store WHERE module = ? AND record_id = ? LIMIT 1');
// Bagong row = pinakamataas na seq ng module + 1 (newest-first ang basa: ORDER BY seq DESC).
const rowInsertNewestStmt = db.prepare(`
    INSERT INTO row_store (module, record_id, seq, data, updated_at)
    VALUES (?, ?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM row_store WHERE module = ?), ?, ?)
    ON CONFLICT(module, record_id) DO UPDATE SET
        data = excluded.data,
        updated_at = excluded.updated_at
`);
// Pinakalumang rows lang ang binubura, at may limit kada tawag para hindi mag-block ang server nang matagal.
const rowTrimOldestStmt = db.prepare(`
    DELETE FROM row_store WHERE rowid IN (
        SELECT rowid FROM row_store WHERE module = ? ORDER BY seq ASC LIMIT ?
    )
`);
// Index para sa mabilis na syncId lookup ng offline sales (dati: binabasa lahat ng transactions).
// Kung mabigo ang pagawa nito, tama pa rin ang resulta ng query — mas mabagal lang.
try {
    db.exec("CREATE INDEX IF NOT EXISTS idx_row_store_tx_syncid ON row_store(json_extract(data, '$.syncId')) WHERE module = 'transactions';");
} catch (err) {
    console.warn('⚠️ Hindi nagawa ang syncId index ng transactions (mas mabagal ang offline-sale lookup, pero gumagana pa rin):', err.message);
}

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
 * Magdagdag ng bagong row(s) sa harap (newest) ng isang row-normalized module — nasa loob ng
 * umiiral nang SQLite transaction (hindi ito nagbubukas ng sarili). items[0] ang pinakabago
 * (kapareho ng dating array.unshift), kaya ito ang may pinakamataas na seq.
 */
function prependRowsInTransaction(moduleName, items, now) {
    if (!ROW_NORMALIZED_MODULES.has(moduleName)) {
        throw new Error(`prependRows: ang module "${moduleName}" ay hindi row-normalized.`);
    }
    const list = Array.isArray(items) ? items : [];
    let seq = (rowMaxSeqStmt.get(moduleName) || { maxSeq: 0 }).maxSeq;
    for (let index = list.length - 1; index >= 0; index--) {
        const item = list[index];
        const recordId = item && item.id != null
            ? String(item.id)
            : `__noid_${Date.now()}_${index}`;
        seq += 1;
        rowUpsertStmt.run(moduleName, recordId, seq, JSON.stringify(item), now);
    }
}

// I-update ang umiiral na row (nananatili ang pwesto/seq niya) o magdagdag ng bago sa harap kung wala pa.
function upsertRowsInTransaction(moduleName, items, now) {
    const list = Array.isArray(items) ? items : [];
    let seq = (rowMaxSeqStmt.get(moduleName) || { maxSeq: 0 }).maxSeq;
    for (const item of list) {
        if (!item || item.id == null) throw new Error('upsertRows: kailangan ng id ang bawat record.');
        const recordId = String(item.id);
        const isNew = !rowExistsStmt.get(moduleName, recordId);
        if (isNew) seq += 1;
        rowUpsertStmt.run(moduleName, recordId, isNew ? seq : 0, JSON.stringify(item), now);
    }
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
            // SCALE FIX: { module, prependRows: [item, ...] } = magdagdag lang ng bagong row(s) sa
            // row-normalized module (hal. isang bagong sale) — hindi na kailangang isulat muli ang buong module.
            if (Array.isArray(change.prependRows)) {
                prependRowsInTransaction(change.module, change.prependRows, now);
                continue;
            }
            // SCALE FIX: { module, upsertRows: [item] } = i-update ang umiiral na row (hal. refund: nadagdagan ang
            // totalRefunded) o magdagdag kung wala pa; { module, deleteRowIds: [id] } = burahin ang mga row na iyon (hal. void).
            // Hindi na kailangang basahin at isulat muli ang BUONG module.
            if (Array.isArray(change.upsertRows) || Array.isArray(change.deleteRowIds)) {
                if (!ROW_NORMALIZED_MODULES.has(change.module)) {
                    throw new Error(`upsertRows/deleteRowIds: ang module "${change.module}" ay hindi row-normalized.`);
                }
                if (Array.isArray(change.upsertRows)) upsertRowsInTransaction(change.module, change.upsertRows, now);
                if (Array.isArray(change.deleteRowIds)) {
                    for (const id of change.deleteRowIds) rowDeleteStmt.run(change.module, String(id));
                }
                continue;
            }
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

// ---------------------------------------------------------------------------
// BACKUP SA MALAKING DATABASE (SCALE FIX)
// Dati: (1) fs.copyFileSync ng BUONG .db (blocking ang buong server habang kinokopya, at 14 kopya = 14x ang laki
// ng DB sa disk), (2) kasama ang isang JSON snapshot na naglo-load ng LAHAT ng module sa RAM (OOM / "Invalid
// string length" kapag ilang daang MB na), (3) kapag naubusan ng disk sa gitna ng kopya, naiiwan ang putol na
// file at nasasagasaan pati ang mga benta, (4) ang RELAY_BACKUP mirror ay sinusulat nang direkta sa umiiral na
// file (kapag naputol, sira na rin ang nag-iisang kopya).
// Ngayon: gumagamit ng SQLite online backup (node:sqlite backup(), hindi blocking, consistent kahit may sale na
// pumapasok), isinusulat muna sa .tmp saka ire-rename, may free-disk check, at kapag malaki ang DB ay
// 2 kopya na lang ang itinatabi at nilalaktawan ang JSON snapshot (ang .db ang totoong backup).
// Pwedeng baguhin sa .env: BACKUP_LARGE_DB_MB (default 256), BACKUP_LARGE_KEEP (default 2),
// BACKUP_JSON_MAX_DB_MB (default 256), BACKUP_DISK_MARGIN_MB (default 64).
// ---------------------------------------------------------------------------
const sqliteBackupFn = (typeof sqliteModule.backup === 'function') ? sqliteModule.backup : null;

function envMegabytes(name, fallbackMb) {
    const raw = process.env[name];
    if (raw === undefined || String(raw).trim() === '') return fallbackMb * 1024 * 1024;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n * 1024 * 1024 : fallbackMb * 1024 * 1024;
}
function envCount(name, fallback) {
    const raw = process.env[name];
    if (raw === undefined || String(raw).trim() === '') return fallback;
    const n = Math.floor(Number(raw));
    return Number.isFinite(n) && n >= 1 ? n : fallback;
}

// Laki ng database sa disk (main file + WAL) — ito ang pinakamataas na posibleng laki ng isang kopya.
function getDatabaseFileBytes() {
    let total = 0;
    for (const file of [DB_PATH, DB_PATH + '-wal']) {
        try { total += fs.statSync(file).size; } catch (_) {}
    }
    return total;
}
// Libreng espasyo (bytes) ng disk na kinalalagyan ng `dir`; null kung hindi matukoy (hindi dapat harangan ang backup).
function getFreeDiskBytes(dir) {
    try {
        if (typeof fs.statfsSync !== 'function') return null;
        const st = fs.statfsSync(dir);
        return Number(st.bavail) * Number(st.bsize);
    } catch (_) { return null; }
}
function listBackupFiles(dir, prefix, ext) {
    try {
        return fs.readdirSync(dir).filter(f => f.startsWith(prefix) && f.endsWith(ext)).sort();
    } catch (_) { return []; }
}
function pruneBackupFiles(dir, prefix, ext, keep) {
    const files = listBackupFiles(dir, prefix, ext);
    while (files.length > keep) {
        const oldest = files.shift();
        try { fs.unlinkSync(path.join(dir, oldest)); } catch (_) {}
    }
    return files.length;
}
function removeStaleTmpFiles(dir) {
    try {
        for (const f of fs.readdirSync(dir)) {
            if (f.endsWith('.tmp')) { try { fs.unlinkSync(path.join(dir, f)); } catch (_) {} }
        }
    } catch (_) {}
}

// Isang backup/mirror lang ang sabay na tumatakbo (hindi nagsasapawan ang daily backup at RELAY mirror).
let backupJobChain = Promise.resolve();
function runBackupJobExclusive(job) {
    const next = backupJobChain.then(job, job);
    backupJobChain = next.catch(() => {});
    return next;
}

// Kopyahin ang BUONG database sa `destPath` nang atomic: .tmp muna, saka rename. Consistent na snapshot.
async function snapshotDatabaseTo(destPath) {
    const tmpPath = destPath + '.tmp';
    try { fs.rmSync(tmpPath, { force: true }); } catch (_) {}
    try {
        if (sqliteBackupFn) {
            // 1024 pages/step (~4 MB) — bumabalik sa event loop pagkatapos ng bawat step kaya hindi naka-freeze ang server.
            await sqliteBackupFn(db, tmpPath, { rate: 1024 });
        } else {
            // Lumang Node na walang backup(): checkpoint + file copy (blocking, pero consistent dahil sync ang lahat ng write).
            db.exec('PRAGMA wal_checkpoint(FULL);');
            fs.copyFileSync(DB_PATH, tmpPath);
        }
        const size = fs.statSync(tmpPath).size;
        if (!(size > 0)) throw new Error('Walang laman ang nagawang backup file.');
        fs.renameSync(tmpPath, destPath);
        return size;
    } catch (err) {
        try { fs.rmSync(tmpPath, { force: true }); } catch (_) {}
        throw err;
    }
}

function runLocalDatabaseBackup(maxBackupsToKeep = 14) {
    return runBackupJobExclusive(() => runLocalDatabaseBackupNow(maxBackupsToKeep));
}

async function runLocalDatabaseBackupNow(maxBackupsToKeep) {
    try {
        removeStaleTmpFiles(BACKUP_DIR);

        const dbBytes = getDatabaseFileBytes();
        const isLargeDb = dbBytes > envMegabytes('BACKUP_LARGE_DB_MB', 256);
        const keep = isLargeDb ? Math.min(maxBackupsToKeep, envCount('BACKUP_LARGE_KEEP', 2)) : maxBackupsToKeep;

        // Free-disk check: kailangan ng kasing-laki ng DB (+ margin). Kung kulang, burahin muna ang pinakalumang
        // kopya (laging may natitira kahit isa) bago sumuko — mas mabuting walang bagong backup kaysa mapuno ang disk.
        const needed = dbBytes + envMegabytes('BACKUP_DISK_MARGIN_MB', 64);
        let freeDisk = getFreeDiskBytes(BACKUP_DIR);
        if (freeDisk !== null && freeDisk < needed) {
            const existing = listBackupFiles(BACKUP_DIR, 'omnipos-', '.db');
            while (existing.length > 1 && freeDisk < needed) {
                try { fs.unlinkSync(path.join(BACKUP_DIR, existing.shift())); } catch (_) { break; }
                freeDisk = getFreeDiskBytes(BACKUP_DIR);
            }
            if (freeDisk !== null && freeDisk < needed) {
                throw new Error(`Kulang ang libreng espasyo sa disk para sa backup (kailangan ~${Math.ceil(needed / 1048576)} MB, libre ~${Math.floor(freeDisk / 1048576)} MB). Walang nasirang kopya.`);
            }
        }

        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const destPath = path.join(BACKUP_DIR, `omnipos-${stamp}.db`);
        await snapshotDatabaseTo(destPath);
        const keptDb = pruneBackupFiles(BACKUP_DIR, 'omnipos-', '.db', keep);
        console.log(`✅ Local database backup created: ${destPath} (${keptDb}/${keep} kept${isLargeDb ? ', malaking DB' : ''})`);

        // JSON snapshot (parehong shape ng omnipos_full_backup_<timestamp>.json, tugma sa /api/restore-backup at sa
        // "System Recovery" file picker kahit offline). Naglo-load ito ng LAHAT ng module sa RAM kaya nilalaktawan
        // kapag malaki na ang DB — ang .db copy sa itaas ang backup na gagamitin (manual file swap).
        let jsonSnapshotPath = null;
        let jsonSkippedReason = null;
        if (dbBytes > envMegabytes('BACKUP_JSON_MAX_DB_MB', 256)) {
            jsonSkippedReason = `Nilaktawan ang JSON snapshot: ${(dbBytes / 1048576).toFixed(0)} MB ang database (masyadong malaki para sa RAM). Gamitin ang .db backup.`;
            console.log(`ℹ️ ${jsonSkippedReason}`);
        } else {
            try {
                const snapshot = getFullDatabaseSnapshot();
                const backupPayload = { timestamp: snapshot.generatedAt, ...snapshot.modules };
                const jsonTmp = path.join(BACKUP_DIR, `omnipos-${stamp}.json.tmp`);
                jsonSnapshotPath = path.join(BACKUP_DIR, `omnipos-${stamp}.json`);
                fs.writeFileSync(jsonTmp, JSON.stringify(backupPayload));
                fs.renameSync(jsonTmp, jsonSnapshotPath);
                console.log(`✅ Local JSON snapshot backup created: ${jsonSnapshotPath} — usable with System Recovery even offline.`);
            } catch (jsonErr) {
                jsonSnapshotPath = null;
                try { fs.rmSync(path.join(BACKUP_DIR, `omnipos-${stamp}.json.tmp`), { force: true }); } catch (_) {}
                // Hindi dapat mag-fail ang buong local backup kung nagawa naman ang .db copy.
                console.error('⚠️ Nagawa ang .db copy pero nabigo ang JSON snapshot na bahagi ng local backup:', jsonErr.message);
            }
        }
        pruneBackupFiles(BACKUP_DIR, 'omnipos-', '.json', keep);

        const result = { success: true, path: destPath, jsonSnapshotPath, jsonSkippedReason };
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

// Last-resort location inside the app's own (always writable) data folder.
// Same path resolveDownloadBackupDir() falls back to when no Download folder exists.
const RELAY_BACKUP_FALLBACK_DIR = path.join(DB_DIR, 'relay-backup-fallback', 'RELAY_BACKUP');
let relayBackupMirrorWarned = false;
// Tanda ng huling matagumpay na mirror (laki + oras ng DB/WAL file) — kapag walang nagbago mula noon at nandoon pa
// ang kopya, hindi na ulit kokopyahin ang buong DB (dati: buong kopya kada RELAY check-in).
let lastMirrorSignature = null;

function getDatabaseChangeSignature() {
    const parts = [];
    for (const file of [DB_PATH, DB_PATH + '-wal']) {
        try { const st = fs.statSync(file); parts.push(`${st.size}:${st.mtimeMs}`); } catch (_) { parts.push('none'); }
    }
    return parts.join('|');
}

async function copyDatabaseTo(destDir) {
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    const destPath = path.join(destDir, RELAY_BACKUP_FILENAME);
    const existedBefore = fs.existsSync(destPath);
    const signature = `${destDir}|${getDatabaseChangeSignature()}`;
    if (existedBefore && lastMirrorSignature === signature) {
        const st = fs.statSync(destPath);
        return { success: true, path: destPath, sizeBytes: st.size, existedBefore, unchanged: true };
    }
    removeStaleTmpFiles(destDir);
    const needed = getDatabaseFileBytes() + envMegabytes('BACKUP_DISK_MARGIN_MB', 64);
    const freeDisk = getFreeDiskBytes(destDir);
    if (freeDisk !== null && freeDisk < needed) {
        throw new Error(`Kulang ang libreng espasyo sa ${destDir} (kailangan ~${Math.ceil(needed / 1048576)} MB, libre ~${Math.floor(freeDisk / 1048576)} MB).`);
    }
    const sizeBytes = await snapshotDatabaseTo(destPath);
    lastMirrorSignature = signature;
    return { success: true, path: destPath, sizeBytes, existedBefore };
}

function mirrorBackupToDownloads() {
    return runBackupJobExclusive(mirrorBackupToDownloadsNow);
}

async function mirrorBackupToDownloadsNow() {
    // FIX: in OmniPOS.apk mode Termux has no storage permission, so
    // /storage/emulated/0/Download "exists" but copying into it fails with
    // EACCES. That failure used to abort the whole RELAY_BACKUP sync (so the
    // device never checked in to RELAY). Now we fall back to the app's own
    // data folder, and only report failure if that fails too.
    const primaryDir = resolveDownloadBackupDir();
    const dirs = primaryDir === RELAY_BACKUP_FALLBACK_DIR ? [primaryDir] : [primaryDir, RELAY_BACKUP_FALLBACK_DIR];
    let primaryError = null;
    for (const destDir of dirs) {
        try {
            const result = await copyDatabaseTo(destDir);
            if (primaryError) {
                result.usedFallback = true;
                result.primaryError = primaryError;
                if (!relayBackupMirrorWarned) {
                    relayBackupMirrorWarned = true;
                    console.warn(`ℹ️ RELAY_BACKUP: hindi masulatan ang Download folder (${primaryError}) — sa loob ng app na lang naka-save ang kopya: ${result.path}`);
                }
            }
            return result;
        } catch (err) {
            if (!primaryError) primaryError = err.message;
        }
    }
    if (!relayBackupMirrorWarned) {
        relayBackupMirrorWarned = true;
        console.error('⚠️ Nabigo ang RELAY_BACKUP mirror (pati ang fallback):', primaryError);
    }
    return { success: false, message: primaryError };
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

// ---------------------------------------------------------------------------
// SINGLE-ROW HELPERS para sa row-normalized modules (transactions, userlogs)
// Para hindi na kailangang i-load ang buong module (milyon-milyong row sa malaking database).
// ---------------------------------------------------------------------------
const JSON_FIELD_NAME_RE = /^[A-Za-z0-9_]+$/;
const jsonFieldStmtCache = new Map();

function normalizeJsonFieldValue(value) {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    return undefined;
}

function rowStoreHas(moduleName, recordId) {
    if (recordId === undefined || recordId === null) return false;
    return !!rowExistsStmt.get(String(moduleName), String(recordId));
}

function getJsonFieldStmt(kind, fieldName) {
    const key = `${kind}:${fieldName}`;
    let stmt = jsonFieldStmtCache.get(key);
    if (!stmt) {
        // "seq + 0": para hindi piliin ng SQLite ang (module, seq) index para sa ORDER BY — kapag walang match
        // (karaniwang kaso), mapipilitan itong mag-scan ng BUONG module. Ang field index ang dapat gamitin.
        stmt = kind === 'one'
            ? db.prepare(`SELECT data FROM row_store WHERE module = ? AND json_extract(data, '$.${fieldName}') = ? ORDER BY seq + 0 DESC LIMIT 1`)
            : db.prepare(`SELECT data FROM row_store WHERE module = ? AND json_extract(data, '$.${fieldName}') = ? AND record_id != ? ORDER BY seq DESC LIMIT ?`);
        jsonFieldStmtCache.set(key, stmt);
    }
    return stmt;
}

// Pinakabagong record ng module na ang top-level field ay eksaktong katumbas ng value (string/number lang).
function findRowByJsonField(moduleName, fieldName, value) {
    const bound = normalizeJsonFieldValue(value);
    if (bound === undefined || !JSON_FIELD_NAME_RE.test(String(fieldName))) return null;
    const row = getJsonFieldStmt('one', String(fieldName)).get(String(moduleName), bound);
    if (!row) return null;
    try { return JSON.parse(row.data); } catch (_) { return null; }
}

// Hanggang `limit` na pinakabagong records (newest-first) na tugma ang field, maliban sa excludeRecordId.
function readRecentRowsByJsonField(moduleName, fieldName, value, limit, excludeRecordId) {
    const bound = normalizeJsonFieldValue(value);
    const max = Math.floor(Number(limit));
    if (bound === undefined || !Number.isFinite(max) || max < 1 || !JSON_FIELD_NAME_RE.test(String(fieldName))) return [];
    const rows = getJsonFieldStmt('many', String(fieldName)).all(
        String(moduleName), bound, excludeRecordId == null ? '' : String(excludeRecordId), max
    );
    const out = [];
    for (const row of rows) {
        try { out.push(JSON.parse(row.data)); } catch (_) {}
    }
    return out;
}

// Isang "pahina" ng row-normalized module (newest-first) — SQL ang nag-LIMIT/OFFSET, hindi na kailangang i-parse ang
// buong module. Opsyonal na filter: eksaktong field = value (string/number) na hindi sensitibo sa laki ng titik (ASCII).
// Kumukuha ng limit+1 row para malaman kung may susunod pang pahina (hasMore).
function readRowsPage(moduleName, options) {
    const opts = options || {};
    const limit = Math.max(1, Math.min(Math.floor(Number(opts.limit)) || 100, 20000));
    const offset = Math.max(0, Math.floor(Number(opts.offset)) || 0);
    let rows;
    if (opts.field !== undefined) {
        const bound = normalizeJsonFieldValue(opts.value);
        if (bound === undefined || !JSON_FIELD_NAME_RE.test(String(opts.field))) return { rows: [], hasMore: false };
        const key = `page:${opts.field}`;
        let stmt = jsonFieldStmtCache.get(key);
        if (!stmt) {
            stmt = db.prepare(`SELECT data FROM row_store WHERE module = ? AND json_extract(data, '$.${opts.field}') = ? COLLATE NOCASE ORDER BY seq DESC LIMIT ? OFFSET ?`);
            jsonFieldStmtCache.set(key, stmt);
        }
        rows = stmt.all(String(moduleName), bound, limit + 1, offset);
    } else {
        let stmt = jsonFieldStmtCache.get('page:all');
        if (!stmt) {
            stmt = db.prepare('SELECT data FROM row_store WHERE module = ? ORDER BY seq DESC LIMIT ? OFFSET ?');
            jsonFieldStmtCache.set('page:all', stmt);
        }
        rows = stmt.all(String(moduleName), limit + 1, offset);
    }
    const hasMore = rows.length > limit;
    const out = [];
    for (const row of rows.slice(0, limit)) {
        try { out.push(JSON.parse(row.data)); } catch (_) {}
    }
    return { rows: out, hasMore };
}

// Lahat ng record ng module na ang field ay katumbas ng value (hindi sensitibo sa laki ng titik, ASCII), newest-first.
// Para sa mga user na hindi "view all": SQL ang nagsasala, hindi na kailangang i-load ang buong module sa memory.
function readRowsByJsonFieldNoCase(moduleName, fieldName, value) {
    const bound = normalizeJsonFieldValue(value);
    if (bound === undefined || !JSON_FIELD_NAME_RE.test(String(fieldName))) return [];
    const key = `nocase:${fieldName}`;
    let stmt = jsonFieldStmtCache.get(key);
    if (!stmt) {
        stmt = db.prepare(`SELECT data FROM row_store WHERE module = ? AND json_extract(data, '$.${fieldName}') = ? COLLATE NOCASE ORDER BY seq DESC`);
        jsonFieldStmtCache.set(key, stmt);
    }
    const out = [];
    for (const row of stmt.all(String(moduleName), bound)) {
        try { out.push(JSON.parse(row.data)); } catch (_) {}
    }
    return out;
}

// PAGINATION + SEARCH: isang pahina ng mga record na ang `id` o `cashier` ay may laman na q (hindi sensitibo sa laki ng
// titik para sa ASCII, kapareho ng dating includes() sa app.js). SQL ang nagsasala at nag-LIMIT/OFFSET kaya hindi na
// kailangang hilahin ang buong history sa phone para lang makapaghanap. Opsyonal na `field`/`value` para sa user na
// hindi "view all" (sariling benta lang).
function readRowsSearchPage(moduleName, options) {
    const opts = options || {};
    const limit = Math.max(1, Math.min(Math.floor(Number(opts.limit)) || 100, 20000));
    const offset = Math.max(0, Math.floor(Number(opts.offset)) || 0);
    const q = String(opts.q === undefined || opts.q === null ? '' : opts.q).trim();
    const like = '%' + q.replace(/[\\%_]/g, m => '\\' + m) + '%';
    const scoped = opts.field !== undefined;
    if (scoped) {
        const bound = normalizeJsonFieldValue(opts.value);
        if (bound === undefined || !JSON_FIELD_NAME_RE.test(String(opts.field))) return { rows: [], hasMore: false };
        const key = `searchpage:${opts.field}`;
        let stmt = jsonFieldStmtCache.get(key);
        if (!stmt) {
            stmt = db.prepare(`SELECT data FROM row_store WHERE module = ? AND json_extract(data, '$.${opts.field}') = ? COLLATE NOCASE AND (json_extract(data, '$.id') LIKE ? ESCAPE '\\' OR json_extract(data, '$.cashier') LIKE ? ESCAPE '\\') ORDER BY seq DESC LIMIT ? OFFSET ?`);
            jsonFieldStmtCache.set(key, stmt);
        }
        return finishSearchPage(stmt.all(String(moduleName), bound, like, like, limit + 1, offset), limit);
    }
    let stmt = jsonFieldStmtCache.get('searchpage:all');
    if (!stmt) {
        stmt = db.prepare(`SELECT data FROM row_store WHERE module = ? AND (json_extract(data, '$.id') LIKE ? ESCAPE '\\' OR json_extract(data, '$.cashier') LIKE ? ESCAPE '\\') ORDER BY seq DESC LIMIT ? OFFSET ?`);
        jsonFieldStmtCache.set('searchpage:all', stmt);
    }
    return finishSearchPage(stmt.all(String(moduleName), like, like, limit + 1, offset), limit);
}
function finishSearchPage(rows, limit) {
    const hasMore = rows.length > limit;
    const out = [];
    for (const row of rows.slice(0, limit)) {
        try { out.push(JSON.parse(row.data)); } catch (_) {}
    }
    return { rows: out, hasMore };
}

// DEAD-STOCK: ang "huling benta ng bawat item code" ay kinakalkula na ng SQLite (json_each + GROUP BY) sa halip na
// i-parse ng JavaScript ang bawat transaksyon. Ang mga row na may malinis na UTC ISO isoDate lang ang dumadaan sa SQL
// (kaya eksaktong pareho ang oras na lalabas); ang LAHAT ng iba pa (walang/kakaibang isoDate) ay ibinabalik bilang
// `otherRows` para ang caller ang magproseso gamit ang dating lohika. Kaya pareho pa rin ang resulta.
function readLastSoldAggregates(moduleName) {
    let aggStmt = jsonFieldStmtCache.get('lastsold:agg');
    if (!aggStmt) {
        aggStmt = db.prepare(`SELECT trim(json_extract(i.value, '$.code')) AS code, json_extract(r.data, '$.isoDate') AS iso, MAX(julianday(json_extract(r.data, '$.isoDate'))) AS jd
            FROM row_store r, json_each(r.data, '$.items') i
            WHERE r.module = ? AND json_type(r.data, '$.items') = 'array'
              AND typeof(json_extract(r.data, '$.isoDate')) = 'text'
              AND json_extract(r.data, '$.isoDate') GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z'
              AND julianday(json_extract(r.data, '$.isoDate')) IS NOT NULL
              AND json_extract(i.value, '$.code') IS NOT NULL
            GROUP BY trim(json_extract(i.value, '$.code'))`);
        jsonFieldStmtCache.set('lastsold:agg', aggStmt);
    }
    let otherStmt = jsonFieldStmtCache.get('lastsold:other');
    if (!otherStmt) {
        otherStmt = db.prepare(`SELECT data FROM row_store r WHERE r.module = ? AND NOT (
            typeof(json_extract(r.data, '$.isoDate')) = 'text'
            AND json_extract(r.data, '$.isoDate') GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z'
            AND julianday(json_extract(r.data, '$.isoDate')) IS NOT NULL)`);
        jsonFieldStmtCache.set('lastsold:other', otherStmt);
    }
    const byCode = aggStmt.all(String(moduleName)).map(r => ({ code: r.code, iso: r.iso }));
    const otherRows = [];
    for (const row of otherStmt.all(String(moduleName))) {
        try { otherRows.push(JSON.parse(row.data)); } catch (_) {}
    }
    return { byCode, otherRows };
}

// ISANG record ng row-normalized module ayon sa id (primary key lookup) — hindi na kailangang i-load ang buong module.
function getRowById(moduleName, recordId) {
    if (recordId === undefined || recordId === null) return null;
    const row = rowSelectOneStmt.get(String(moduleName), String(recordId));
    if (!row) return null;
    try { return JSON.parse(row.data); } catch (_) { return null; }
}

// Average ng numeric na top-level field ng lahat ng record (kinakalkula sa SQL; ang walang/di-numeric na value ay 0,
// kapareho ng dating parseFloat(x) || 0). Walang record = 0.
function averageRowNumberField(moduleName, fieldName) {
    if (!JSON_FIELD_NAME_RE.test(String(fieldName))) return 0;
    const key = `avg:${fieldName}`;
    let stmt = jsonFieldStmtCache.get(key);
    if (!stmt) {
        stmt = db.prepare(`SELECT AVG(COALESCE(CAST(json_extract(data, '$.${fieldName}') AS REAL), 0)) AS avg FROM row_store WHERE module = ?`);
        jsonFieldStmtCache.set(key, stmt);
    }
    const row = stmt.get(String(moduleName));
    return row && Number.isFinite(Number(row.avg)) ? Number(row.avg) : 0;
}

// ---------------------------------------------------------------------------
// MGA "WINDOW" READER para sa reports (shift summary, atbp.): SQL ang nagtatapon ng mga row na tiyak na LABAS sa
// panahong hinahanap, para hindi na ipa-parse sa JavaScript ang buong history. Ang resulta ay SUPERSET lang —
// ang caller ay dapat pa ring maglapat ng eksaktong dating filter nito (kaya pareho pa rin ang kinalalabasan).
// Ang mga row na hindi matiyak (walang/kakaibang field) ay IBINABALIK, hindi itinatapon. Newest-first ang ayos.
// ---------------------------------------------------------------------------
const WINDOW_MARGIN_MS = 2 * 24 * 60 * 60 * 1000; // sapat para sa kahit anong timezone offset (hanggang ±14h)
function readRowsInIsoWindow(moduleName, fieldName, startMs, endMs) {
    if (!JSON_FIELD_NAME_RE.test(String(fieldName))) return null;
    const lo = new Date(Number(startMs) - WINDOW_MARGIN_MS);
    const hi = new Date(Number(endMs) + WINDOW_MARGIN_MS);
    // Hindi mahulaan ang window (invalid/sobrang layo na petsa): ibalik ang null para ang caller ang bahala (buong basa).
    if (isNaN(lo.getTime()) || isNaN(hi.getTime()) || lo.getUTCFullYear() < 1000 || hi.getUTCFullYear() > 9998) return null;
    const key = `isowin:${fieldName}`;
    let stmt = jsonFieldStmtCache.get(key);
    if (!stmt) {
        const f = `json_extract(data, '$.${fieldName}')`;
        // Itinatapon LAMANG ang text na hugis-ISO (YYYY-MM-DDT...) na malinaw na wala sa pagitan ng lo at hi.
        stmt = db.prepare(`SELECT data FROM row_store WHERE module = ? AND NOT (typeof(${f}) = 'text' AND ${f} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*' AND (${f} < ? OR ${f} > ?)) ORDER BY seq DESC`);
        jsonFieldStmtCache.set(key, stmt);
    }
    const out = [];
    for (const row of stmt.all(String(moduleName), lo.toISOString(), hi.toISOString())) {
        try { out.push(JSON.parse(row.data)); } catch (_) {}
    }
    return out;
}
// Para sa numeric na field (hal. userlogs.id = Date.now()): itinatapon LAMANG ang numeric na value na malinaw na labas sa (lo, hi].
function readRowsInNumberWindow(moduleName, fieldName, lo, hi) {
    if (!JSON_FIELD_NAME_RE.test(String(fieldName)) || !Number.isFinite(Number(lo)) || !Number.isFinite(Number(hi))) return null;
    const key = `numwin:${fieldName}`;
    let stmt = jsonFieldStmtCache.get(key);
    if (!stmt) {
        const f = `json_extract(data, '$.${fieldName}')`;
        stmt = db.prepare(`SELECT data FROM row_store WHERE module = ? AND NOT (typeof(${f}) IN ('integer', 'real') AND (${f} <= ? OR ${f} > ?)) ORDER BY seq DESC`);
        jsonFieldStmtCache.set(key, stmt);
    }
    const out = [];
    for (const row of stmt.all(String(moduleName), Number(lo), Number(hi))) {
        try { out.push(JSON.parse(row.data)); } catch (_) {}
    }
    return out;
}

const approxRowCounts = new Map();
const ROW_TRIM_MAX_PER_CALL = 20000;

function trimRowsIfNeeded(moduleName, maxRows) {
    let count = approxRowCounts.get(moduleName);
    count = (count === undefined) ? rowCountStmt.get(moduleName).cnt : count + 1;
    const slack = Math.max(500, Math.floor(maxRows * 0.01));
    if (count > maxRows + slack) {
        count = rowCountStmt.get(moduleName).cnt;
        if (count > maxRows) {
            rowTrimOldestStmt.run(moduleName, Math.min(ROW_TRIM_MAX_PER_CALL, count - maxRows));
            count = rowCountStmt.get(moduleName).cnt;
        }
    }
    approxRowCounts.set(moduleName, count);
}

/**
 * Magdagdag ng ISANG bagong record sa harap ng row-normalized module (hal. user log) nang hindi
 * binabasa/isinusulat ang buong module. options.uniqueId: kung numeric ang id at may kapareho na,
 * dagdagan ng 1 hanggang maging unique (dati, nao-overwrite ang log na pareho ang millisecond).
 * options.maxRows: kung naka-set at lumagpas, buburahin ang pinakalumang records (paunti-unti).
 */
function addNewestRow(moduleName, item, options) {
    if (!ROW_NORMALIZED_MODULES.has(moduleName)) {
        throw new Error(`addNewestRow: ang module "${moduleName}" ay hindi row-normalized.`);
    }
    if (!item || typeof item !== 'object') {
        throw new Error('addNewestRow: object ang kailangang record.');
    }
    const opts = options || {};
    let recordId;
    if (item.id != null) {
        if (opts.uniqueId && typeof item.id === 'number') {
            let guard = 0;
            while (rowExistsStmt.get(moduleName, String(item.id)) && guard < 10000) {
                item.id += 1;
                guard += 1;
            }
        }
        recordId = String(item.id);
    } else {
        recordId = `__noid_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }
    rowInsertNewestStmt.run(moduleName, recordId, moduleName, JSON.stringify(item), new Date().toISOString());
    const maxRows = Math.floor(Number(opts.maxRows));
    if (Number.isFinite(maxRows) && maxRows > 0) trimRowsIfNeeded(moduleName, maxRows);
    return true;
}

module.exports = { readRowsSearchPage, readLastSoldAggregates, readRowsInIsoWindow, readRowsInNumberWindow, getRowById, averageRowNumberField, readRowsPage, readRowsByJsonFieldNoCase, findRowByJsonField, readRecentRowsByJsonField, rowStoreHas, addNewestRow, getProductsView, getProductsRawJson, getProductImagesByCodes, db, readData, readDataLite, readProductsNoImages, getProductCodesWithMainImage, writeData, runDatabaseTransaction, vacuumDatabase, DB_DIR, DB_PATH, BACKUP_DIR, runLocalDatabaseBackup, mirrorBackupToDownloads, getCloudBackupPayload, getFullDatabaseSnapshot, getAiKnowledgeSnapshot, ALWAYS_EXCLUDED_FROM_CLOUD_SYNC, getBackupStatus, registerModuleDefaults };

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
