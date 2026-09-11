

const path = require('path');
const fs = require('fs');
const os = require('os');
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
        let rawData;
        if (blobStringCache.has(moduleName)) {
            rawData = blobStringCache.get(moduleName);
        } else {
            const row = selectStmt.get(moduleName);

            if (!row) {
                
                writeData(moduleName, defaultData);
                return defaultData;
            }

            rawData = row.data;
            blobStringCache.set(moduleName, rawData);
        }

        if (!rawData || rawData.trim() === '') {
            return defaultData;
        }

        return JSON.parse(rawData);
    } catch (err) {
        console.error(`⚠️ May sira sa SQLite data ng module "${moduleName}". Ibinalik ang default data.`, err);
        return defaultData;
    }
}

function writeData(moduleName, data) {
    if (ROW_NORMALIZED_MODULES.has(moduleName)) {
        writeRowNormalizedData(moduleName, data);
        return true;
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
            if (!ROW_NORMALIZED_MODULES.has(moduleName)) blobStringCache.set(moduleName, json);
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
const ALWAYS_EXCLUDED_FROM_CLOUD_SYNC = new Set(['sessions', 'aiAssistantLogs', 'aiAssistantUsage', 'cloudflareTunnelConfig']);
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
const AI_SNAPSHOT_EXTRA_REDACTED_FIELDS_BY_MODULE = { users: ['webauthnCredentials', 'webauthnUserHandle'] };
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

function getFullDatabaseSnapshot() {
    const moduleNames = getAllModuleNames();
    const modules = {};
    let totalRecords = 0;

    for (const moduleName of moduleNames) {
        const data = readData(moduleName, []);
        modules[moduleName] = data;
        if (Array.isArray(data)) totalRecords += data.length;
    }

    return {
        modules,
        moduleNames,
        totalRecords,
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
    'cloudflareTunnelConfig'
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
const AI_ASSISTANT_MAX_RECORDS_PER_MODULE = 30;

function getAiKnowledgeSnapshot(scope, focusModules) {
    const isFull = scope === 'full';
    const allModuleNames = getAllModuleNames().filter((m) => !AI_ASSISTANT_ALWAYS_EXCLUDED_MODULES.has(m));
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
        let data = stripRedactedFields(moduleName, readData(moduleName, []));
        data = stripFieldsForAiSnapshot(moduleName, data);
        if (Array.isArray(data)) {
            totalRecords += data.length;
            if (data.length > AI_ASSISTANT_MAX_RECORDS_PER_MODULE) {
                truncatedModules.push(moduleName);
                // Panatilihin ang PINAKABAGONG records (mas kapaki-pakinabang
                // sa karaniwang tanong kaysa sa pinakauna).
                data = data.slice(-AI_ASSISTANT_MAX_RECORDS_PER_MODULE);
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

module.exports = { db, readData, writeData, runDatabaseTransaction, vacuumDatabase, DB_DIR, DB_PATH, BACKUP_DIR, runLocalDatabaseBackup, mirrorBackupToDownloads, getCloudBackupPayload, getFullDatabaseSnapshot, getAiKnowledgeSnapshot, ALWAYS_EXCLUDED_FROM_CLOUD_SYNC, getBackupStatus };

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
