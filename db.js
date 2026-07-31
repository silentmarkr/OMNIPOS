// ====================================================================
// db.js — SQLite Data Layer (gamit ang BUILT-IN na node:sqlite module)
// ====================================================================
// Pinapalitan nito ang dating "isang JSON file per module" na storage.
// Lahat ng 7 modules (users, products, transactions, userlogs,
// requests, categories, carts) ay nakatira na ngayon sa IISANG
// SQLite file: database/omnipos.db
//
// BAKIT node:sqlite AT HINDI better-sqlite3:
// Ang better-sqlite3 ay isang "native module" — kailangan niyang
// i-compile gamit ang C++ compiler at (sa Android/Termux) ang Android
// NDK, na madalas hindi gumagana nang maayos sa Termux. Ang node:sqlite
// naman ay BUILT-IN NA SA NODE.JS MISMO (Node 22.5+) — walang kailangang
// i-npm install, walang compilation, gumagana kaagad kahit sa Termux.
//
// Bakit mas "pro" ito kumpara sa dating flat JSON files:
//   - Atomic writes — hindi na posible ang corrupted/half-written file
//     kapag nag-crash habang nagsusulat.
//   - Ligtas sa concurrent requests (WAL mode) — hindi na posibleng
//     mag-overwrite ang dalawang request na sabay-sabay sumusulat.
//   - Iisang file na lang ang binabackup, hindi 7 hiwalay na files.
//   - Mas madaling i-query/i-inspect gamit ang karaniwang SQLite tools.
//
// Paano gumagana: bawat "module" (hal. 'products') ay may isang row sa
// `store` table na naglalaman ng buong JSON blob nito. Ganito
// pinanatili ang parehong shape ng data (arrays/objects) na ginagamit
// na ng lahat ng existing endpoints sa server.js — kaya walang
// kailangang baguhin sa business logic, RBAC, validation, atbp.
//
// UPDATE: ang "transactions" at "userlogs" ay HINDI na iisang JSON blob
// (tingnan ang ROW-NORMALIZED STORAGE section sa ibaba) — bawat record
// (isang transaksyon, isang log entry) ay sarili nang ROW na ngayon sa
// isang tunay na SQL table, kaya bawat checkout/log ay isang maliit na
// per-row INSERT/UPDATE/DELETE na lang, hindi na muling pagsusulat ng
// buong history sa bawat pagkakataon. Ang ibang modules (users, products,
// atbp.) ay nananatili pa ring iisang JSON blob bawat isa, dahil maliit
// lang ang mga ito at bihirang tumaas nang sobra.
// ====================================================================

const path = require('path');
const fs = require('fs');
const os = require('os');
const { DatabaseSync } = require('node:sqlite');

const DB_DIR = path.join(__dirname, 'database');
if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR);
}
const DB_PATH = path.join(DB_DIR, 'omnipos.db');

const db = new DatabaseSync(DB_PATH);

// WAL mode = mas ligtas at mas mabilis sa concurrent reads/writes
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

// ====================================================================
// ROW-NORMALIZED STORAGE ("transactions" / "userlogs")
// ====================================================================
// Ito ang sagot sa babala ng checkModuleBlobSizes sa ibaba: sa halip na
// isang tumataas-nang-tumataas na JSON blob (isang TEXT column) na
// KAILANGANG buong ma-rewrite kada checkout/log, bawat indibidwal na
// record (isang transaksyon, isang log entry) ngayon ay SARILING ROW sa
// "row_store" table. Ang epekto:
//   - Bagong checkout/log        -> IISANG maliit na INSERT lang.
//   - Pag-void ng transaksyon    -> IISANG maliit na DELETE lang.
//   - HINDI na kailangang i-rewrite ang buong history sa bawat pagkakataon.
// Pinananatili pa rin ang EXACT SAME readData(module)/writeData(module,
// array) function signatures na ginagamit ng server.js — kaya walang
// kailangang baguhin doon; ang array-in/array-out na "shape" ng data ay
// pareho pa rin, "row-per-record" na lamang ang aktwal na paraan ng
// pag-iimbak sa ilalim nito.
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

/**
 * Basahin ang lahat ng rows ng isang row-normalized module, pabalik sa
 * ORDER na pinakabago-muna (kapareho ng dating shape: bawat bagong
 * record ay laging in-uunshift papunta sa harap ng array).
 */
function readRowNormalizedData(moduleName) {
    const rows = rowSelectAllStmt.all(moduleName);
    return rows.map((r) => JSON.parse(r.data));
}

/**
 * I-diff ang bagong buong array (`data`) laban sa kasalukuyang laman ng
 * row_store para sa module na ito, at mag-apply lamang ng TARGETED na
 * pagbabago: INSERT/UPDATE lang para sa mga records na bago o nagbago,
 * DELETE lang para sa mga records na wala nang laman sa bagong array
 * (hal. na-void na transaksyon). Hindi na kailangang i-rewrite ang buong
 * history sa bawat tawag.
 */
function writeRowNormalizedData(moduleName, data) {
    const list = Array.isArray(data) ? data : [];
    const now = new Date().toISOString();

    const existingIds = new Set(rowSelectIdsStmt.all(moduleName).map((r) => r.record_id));
    const incomingIds = new Set();

    let baseSeq = (rowMaxSeqStmt.get(moduleName) || { maxSeq: 0 }).maxSeq;

    db.exec('BEGIN IMMEDIATE');
    try {
        list.forEach((item, index) => {
            // Newest-first na array (dating unshift() behavior) -> ang
            // pinaka-unang item (index 0) ang dapat makakuha ng
            // PINAKAMATAAS na bagong seq (kung ito man ay bago), para
            // mananatili itong pinaka-una kapag binasa muli (ORDER BY
            // seq DESC). Kung existing na pala ang row na ito, hindi
            // ginagalaw ang seq nito sa DO UPDATE (di-nasasama sa SET),
            // kaya nananatili ang orihinal nitong pwesto sa history.
            const recordId = item && item.id != null
                ? String(item.id)
                : `__noid_${Date.now()}_${index}`;
            incomingIds.add(recordId);

            const candidateSeq = baseSeq + (list.length - index);
            rowUpsertStmt.run(moduleName, recordId, candidateSeq, JSON.stringify(item), now);
        });

        // Alisin ang mga rows na dati'y nandiyan pero wala na sa bagong
        // array (hal. na-void na transaksyon, o full clear tungo sa []).
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

/**
 * ISANG BESES lang tatakbo ito bawat module: kung may laman pa rin sa
 * LUMANG "store" blob table (mula bago pa ang row-normalization) at
 * WALA pang laman ang row_store, i-migrate ang laman ng blob papunta sa
 * mga indibidwal na rows, tapos alisin na ang lumang blob row (para
 * hindi na ito ma-flag pa ng checkModuleBlobSizes at hindi na dumoble
 * ang datos sa disk).
 */
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

/**
 * Basahin ang data ng isang module. Kapareho ng gamit ng dating
 * readData(filePath, defaultData) helper — pareho ang function signature
 * kaya walang kailangang baguhin kahit saan pa sa server.js.
 */
function readData(moduleName, defaultData = []) {
    if (ROW_NORMALIZED_MODULES.has(moduleName)) {
        try {
            const hasAnyRows = rowCountStmt.get(moduleName).cnt > 0;
            if (!hasAnyRows) {
                // Unang gamit ng module na ito (o na-clear na) — i-seed
                // ng default data, kapareho ng dating blob-based behavior.
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
        const row = selectStmt.get(moduleName);

        if (!row) {
            // Unang gamit ng module na ito — i-seed ng default data
            writeData(moduleName, defaultData);
            return defaultData;
        }

        if (!row.data || row.data.trim() === '') {
            return defaultData;
        }

        return JSON.parse(row.data);
    } catch (err) {
        console.error(`⚠️ May sira sa SQLite data ng module "${moduleName}". Ibinalik ang default data.`, err);
        return defaultData;
    }
}

/**
 * Isulat ang data ng isang module. Kapareho ng gamit ng dating
 * writeData(filePath, data) helper. Para sa "transactions"/"userlogs"
 * (ROW_NORMALIZED_MODULES), dumadaan ito sa row-per-record na storage
 * sa halip na muling isulat ang buong JSON blob.
 */
function writeData(moduleName, data) {
    if (ROW_NORMALIZED_MODULES.has(moduleName)) {
        writeRowNormalizedData(moduleName, data);
        return;
    }

    try {
        upsertStmt.run(moduleName, JSON.stringify(data), new Date().toISOString());
    } catch (error) {
        console.error(`Error writing SQLite data para sa module "${moduleName}":`, error);
    }
}

// ====================================================================
// LOCAL AUTOMATED DATABASE BACKUP (walang kailangang internet)
// ====================================================================
// Kinokopya nito ang buong omnipos.db papunta sa database/backups/ folder
// nang may timestamp, sa parehong device/server lang — hindi ito umaasa
// sa Gmail/internet gaya ng "Secondary Backup Email" feature. Awtomatiko
// itong tinatawag ng server.js paminsan-minsan (tingnan ang setInterval
// doon), pero pwede rin itong tawagin nang manual kung kailan man kailangan.
const BACKUP_DIR = path.join(DB_DIR, 'backups');
if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function runLocalDatabaseBackup(maxBackupsToKeep = 14) {
    try {
        // I-flush muna ang laman ng WAL file papunta mismo sa omnipos.db
        // bago ito kopyahin, para kumpleto/up-to-date ang backup (kung
        // hindi, posibleng may mga huling pagbabago pa sa WAL na hindi
        // masasama sa kinopya).
        db.exec('PRAGMA wal_checkpoint(FULL);');

        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const destPath = path.join(BACKUP_DIR, `omnipos-${stamp}.db`);
        fs.copyFileSync(DB_PATH, destPath);

        // Tanggalin ang mga pinakalumang backup kapag sumobra na sa limit,
        // para hindi puno ang storage habang tumatakbo nang matagal.
        const files = fs.readdirSync(BACKUP_DIR)
            .filter(f => f.startsWith('omnipos-') && f.endsWith('.db'))
            .sort();
        while (files.length > maxBackupsToKeep) {
            const oldest = files.shift();
            fs.unlinkSync(path.join(BACKUP_DIR, oldest));
        }

        console.log(`✅ Local database backup created: ${destPath} (${files.length}/${maxBackupsToKeep} kept)`);
        return { success: true, path: destPath };
    } catch (err) {
        console.error('⚠️ Nabigo ang local database backup:', err);
        return { success: false, message: err.message };
    }
}

// ====================================================================
// RELAY_BACKUP MIRROR — IISANG (1) file lang sa Download/RELAY_BACKUP
// ====================================================================
// HIWALAY ito sa BACKUP_DIR sa itaas (na dinaragdagan/naka-timestamp at
// na-a-auto-prune). Dito, IISANG file lang (laging pareho ang pangalan)
// ang laman ng Download/RELAY_BACKUP — bawat successful backup ay
// nag-o-OVERWRITE lang sa parehong file (hindi dumaragdag/hindi
// "dumadami"), dahil fs.copyFileSync ay nagre-replace na ng laman ng
// existing file kung parehong destination path/filename ang gamit.
//
// SAAN dinideliver: sa Android/Termux, kapag na-run na ang isang beses
// na `termux-setup-storage`, may symlink na gumagana papunta sa TUNAY
// na shared "Download" folder ng Android sa: ~/storage/downloads
// (kapareho ito ng makikita sa Files app / ibang apps bilang
// "Download"). Dahil DIREKTA itong sumusulat gamit ang Node.js
// (server-side, hindi browser), WALANG limitasyon ng browser File
// System Access API dito — gumagana ito kahit sa Android Chrome/WebView
// na walang directory-picker support.
//
// Override: kung ibang lokasyon/OS ang gusto mong gamitin (hal. VPS o
// desktop na walang "~/storage/downloads"), i-set na lang ang
// RELAY_BACKUP_DOWNLOAD_DIR env var papunta sa gustong parent folder
// (awtomatikong gagawa ito ng "RELAY_BACKUP" subfolder sa loob nito).
function resolveDownloadBackupDir() {
    const override = (process.env.RELAY_BACKUP_DOWNLOAD_DIR || '').trim();
    if (override) return path.join(override, 'RELAY_BACKUP');

    const candidates = [
        path.join(os.homedir(), 'storage', 'downloads'), // Termux, matapos ang `termux-setup-storage`
        '/storage/emulated/0/Download',                   // direktang Android shared storage path (fallback)
        path.join(os.homedir(), 'Downloads'),              // Windows/macOS/Linux desktop (dev/testing)
    ];
    const found = candidates.find((p) => {
        try { return fs.existsSync(p); } catch (err) { return false; }
    });

    // Kung wala man lang natagpuang tunay na Download folder (hal.
    // sandboxed/CI environment), huwag na lang sumabog — gumamit na
    // lang ng lokal na fallback folder sa loob mismo ng project, para
    // hindi bumagsak ang buong scheduled job dahil dito.
    return path.join(found || path.join(DB_DIR, 'relay-backup-fallback'), 'RELAY_BACKUP');
}

const RELAY_BACKUP_FILENAME = 'omnipos_database_backup.db';

/**
 * I-mirror ang kasalukuyang database papunta sa Download/RELAY_BACKUP,
 * sa IISANG (fixed na pangalan) file lang na palaging ino-overwrite.
 * Ibinabalik: { success, path, sizeBytes, existedBefore } kapag OK,
 * o { success:false, message } kapag nabigo (hal. walang write
 * permission, walang storage access, atbp.) — hindi ito nagtapon ng
 * exception papunta sa caller, ligtas itong tawagin sa loob ng isang
 * scheduled job nang walang try/catch sa panig noon.
 */
function mirrorBackupToDownloads() {
    try {
        const destDir = resolveDownloadBackupDir();
        if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

        const destPath = path.join(destDir, RELAY_BACKUP_FILENAME);
        // "Hahanapin automatic yung file" — malalaman kung ito ba ay
        // UNANG beses (walang file pa) o pag-uupdate lang ng existing.
        const existedBefore = fs.existsSync(destPath);

        // Parehong checkpoint gaya ng runLocalDatabaseBackup sa itaas,
        // para kumpleto/up-to-date ang laman ng kinopyang file.
        db.exec('PRAGMA wal_checkpoint(FULL);');
        fs.copyFileSync(DB_PATH, destPath); // OVERWRITE — laging iisang file lang

        const stat = fs.statSync(destPath);
        return { success: true, path: destPath, sizeBytes: stat.size, existedBefore };
    } catch (err) {
        console.error('⚠️ Nabigo ang RELAY_BACKUP mirror papunta sa Download folder:', err);
        return { success: false, message: err.message };
    }
}

// ====================================================================
// CLOUD BACKUP PAYLOAD (para sa Postgres sync sa pamamagitan ng RELAY)
// ====================================================================
// Ang layunin nito: buuin ang "buong database" na ise-sync papunta sa
// Postgres (via RELAY) — LAHAT ng modules ng tindahan, KASAMA na ngayon
// ang "featureUnlocks" (unlocked features/Pro themes) at "users" (user
// accounts), per kahilingan na i-backup na rin ang mga ito.
//
// Walang laging-excluded na module ngayon, pero may ISANG field lang na
// laging tinatanggal bago umalis ng device: ang "password" ng bawat
// user record sa "users" module. Hindi ito buong module exclusion —
// kasama pa rin ang username/role/avatar/atbp. para ma-restore ang mga
// account — pero ang password HASH mismo ay hindi dapat umalis sa
// device papunta sa isang Postgres na naka-host sa ibang lugar
// (defense-in-depth, kahit protektado na rin ito sa RELAY side —
// tingnan ang CLOUD_BACKUP mirroring doon). Kapag na-restore ang isang
// backup, gagamitin ang normal na "forgot password"/reset flow ng
// developer/admin para sa mga account na ito sa halip na yung lumang
// hash.
//
// Kinukuha ang listahan ng modules NANG DYNAMIC (mula mismo sa laman
// ng "store" at "row_store" tables) sa halip na i-hardcode, para
// awtomatikong kasama ang anumang BAGONG module sa hinaharap nang
// walang kailangang balikan pa ang file na ito.
// ====================================================================
const ALWAYS_EXCLUDED_FROM_CLOUD_SYNC = new Set(); // wala nang buong-module exclusion
const REDACTED_FIELDS_BY_MODULE = { users: ['password'] };

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

/**
 * Buuin ang buong payload na ise-sync papunta sa Postgres (via RELAY) —
 * ngayon ay TALAGANG buong database na, kasama na ang unlocked
 * features/themes ("featureUnlocks") at user accounts ("users", pero
 * walang password field — tingnan ang paliwanag sa itaas).
 * Ibinabalik: { modules: { [moduleName]: array }, moduleNames,
 * totalRecords, excludedModules, redactedFieldsByModule, generatedAt }.
 */
function getCloudBackupPayload() {
    const moduleNames = getAllModuleNames().filter((m) => !ALWAYS_EXCLUDED_FROM_CLOUD_SYNC.has(m));
    const modules = {};
    let totalRecords = 0;

    for (const moduleName of moduleNames) {
        const data = stripRedactedFields(moduleName, readData(moduleName, []));
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

module.exports = { db, readData, writeData, DB_DIR, DB_PATH, BACKUP_DIR, runLocalDatabaseBackup, mirrorBackupToDownloads, getCloudBackupPayload, ALWAYS_EXCLUDED_FROM_CLOUD_SYNC };

// ====================================================================
// BLOB-SIZE MONITOR (read-only, walang ginagalaw sa business logic)
// ====================================================================
// KONTEKSTO: bawat module dito ay IISANG JSON blob (tingnan comment sa
// itaas). Ibig sabihin, kapag lumaki ito (lalo na ang "transactions" at
// "userlogs", na patuloy na dumaragdag habang tumatakbo ang negosyo),
// bawat pagsulat (hal. bawat checkout) ay nagre-rewrite ng BUONG blob —
// unti-unting bumabagal ito, at dahil synchronous ang node:sqlite calls,
// pansamantalang na-b-block ang buong server habang isinusulat.
// Sa ngayon (testing phase), maliit pa lahat ng blob kaya hindi pa ito
// aktwal na problema. Ang function na ito ay isang MURANG, ZERO-RISK na
// babala lang — hindi nito ginagalaw ang paraan ng pagbasa/pagsulat ng
// datos — para maalertuhan tayo BAGO pa maging totoong bottleneck ito.
// Kapag lumabas na ang babalang ito, ang susunod na tamang hakbang ay
// isang hiwalay na proyekto: i-normalize ang mabibigat na modules
// (partikular ang transactions/userlogs) sa tunay na SQL tables na may
// sariling column bawat field (sa halip na iisang JSON blob), para
// paulit-ulit na basahin/isulat ang buong history sa bawat operation.
function checkModuleBlobSizes(warnThresholdBytes = 2 * 1024 * 1024) {
    try {
        // Ang mga IISANG-JSON-blob pa ring modules (users, products, atbp).
        // Kapag lumabas dito ang "transactions"/"userlogs", ibig sabihin
        // hindi pa na-migrate ang lumang blob nito — dapat wala na ito
        // dahil awtomatiko itong ini-migrate sa row_store sa startup.
        const rows = db.prepare('SELECT module, length(data) as len FROM store').all();
        const flagged = rows.filter((r) => r.len >= warnThresholdBytes);
        flagged.forEach((r) => {
            console.warn(
                `⚠️ [DB SIZE WATCH] Ang module "${r.module}" ay lumagpas na sa ${(warnThresholdBytes / 1024 / 1024).toFixed(1)} MB ` +
                `(kasalukuyan: ${(r.len / 1024 / 1024).toFixed(2)} MB). Isaalang-alang ang pag-archive/normalize nito bago ito ` +
                `mag-cause ng nakikitang pagbagal sa bawat pagsulat.`
            );
        });

        // Ang mga row-normalized modules (transactions/userlogs): hindi na
        // sila naaapektuhan ng "isang blob na paulit-ulit na nire-rewrite"
        // na problema (bawat record sariling row/write na), pero
        // pinapanatili pa rin dito ang kabuuang laki nila para may
        // visibility pa rin sa paglaki ng datos sa paglipas ng panahon.
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
