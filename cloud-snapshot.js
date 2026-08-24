'use strict';

// ============================================================================
// cloud-snapshot.js
//
// BUG FIX: sa Render Free plan, walang Persistent Disk, kaya ephemeral ang
// buong filesystem (kasama na ang buong SQLite database ng OMNIPOS —
// products, sales, transactions, users, installationId, atbp.) kada
// bagong deploy (git push). Bagong container, blangkong disk.
//
// AYOS: gamitin ang Postgres (DATABASE_URL, parehong klase ng DB na
// ginagamit na ng RELAY) bilang "durable backstop":
//   1. Sa pag-start ng server, kung mukhang bago/blangko ang lokal na
//      SQLite (walang laman), i-restore muna ang pinakahuling snapshot
//      mula sa Postgres BAGO tumanggap ng traffic.
//   2. Habang tumatakbo, regular (bawat 5 minuto) at sa tuwing
//      makakatanggap ng SIGTERM (ipinapadala ng Render bago patayin ang
//      lumang container sa susunod na deploy), i-push ang kasalukuyang
//      buong snapshot papunta sa Postgres.
//
// Ang SQLite pa rin ang GINAGAMIT habang tumatakbo ang server (mabilis,
// synchronous) — ang Postgres ay backup/restore lang, hindi live query
// path, kaya walang kailangang baguhin sa ibang parte ng server.js.
//
// Kailangan lang: OMNIPOS_FIXED_INSTALLATION_ID at DATABASE_URL na env
// vars, parehong naka-set sa Render dashboard ng OMNIPOS service.
// ============================================================================

const { Pool } = require('pg');

let pool = null;
function getPool() {
    if (!process.env.DATABASE_URL) return null;
    if (!pool) {
        pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            // Render-managed Postgres ay gumagamit ng self-signed cert sa
            // internal na connections — kailangan ito para gumana ang SSL.
            ssl: { rejectUnauthorized: false }
        });
        pool.on('error', (err) => {
            console.error('⚠️  [cloud-snapshot] Postgres pool error (hindi fatal):', err.message);
        });
    }
    return pool;
}

function getSnapshotKey() {
    // Sinasadyang IISANG env var lang (hindi ang volatile na lokal na
    // installationId) ang gamit bilang "susi" papunta sa Postgres row,
    // dahil ito mismo ang laging pare-pareho kahit ma-wipe ang disk.
    return (process.env.OMNIPOS_FIXED_INSTALLATION_ID || '').trim() || null;
}

let tableEnsured = false;
async function ensureTable(p) {
    if (tableEnsured) return;
    await p.query(`
        CREATE TABLE IF NOT EXISTS omnipos_snapshots (
            installation_key TEXT PRIMARY KEY,
            snapshot          JSONB NOT NULL,
            updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
        );
    `);
    tableEnsured = true;
}

async function restoreFromCloudIfNeeded() {
    const key = getSnapshotKey();
    const p = getPool();
    if (!key || !p) {
        console.log('ℹ️  [cloud-snapshot] Walang OMNIPOS_FIXED_INSTALLATION_ID at/o DATABASE_URL na naka-set — nilaktawan ang cloud restore.');
        return;
    }

    // require dito (hindi sa taas) para maiwasan ang circular require sa
    // pagitan ng db.js at server.js.
    const dbModule = require('./db');

    try {
        await ensureTable(p);

        const localModules = dbModule.getAllModuleNames ? dbModule.getAllModuleNames() : [];
        const hasLocalInstallationId = (() => {
            try {
                const fu = dbModule.readData('featureUnlocks', {});
                return !!(fu && fu.installationId);
            } catch (e) { return false; }
        })();

        if (localModules.length > 0 && hasLocalInstallationId) {
            console.log('ℹ️  [cloud-snapshot] May laman na at may installationId na ang lokal na DB — nilaktawan ang restore (hindi ito bagong/blangkong container).');
            return;
        }

        const { rows } = await p.query(
            'SELECT snapshot, updated_at FROM omnipos_snapshots WHERE installation_key = $1',
            [key]
        );

        if (rows.length === 0) {
            console.log('ℹ️  [cloud-snapshot] Walang naitalang cloud snapshot pa para sa key na ito — malamang unang deploy pagkatapos ilagay ang fix.');
            return;
        }

        const snap = rows[0].snapshot || {};
        const modules = snap.modules || {};
        const moduleNames = Object.keys(modules);

        moduleNames.forEach((moduleName) => {
            dbModule.writeData(moduleName, modules[moduleName]);
        });

        console.log(
            `✅ [cloud-snapshot] Na-restore mula sa Postgres: ${moduleNames.length} modules ` +
            `(huling na-save: ${rows[0].updated_at}).`
        );
    } catch (err) {
        console.error('⚠️  [cloud-snapshot] Nabigo ang pag-restore mula sa Postgres — magpapatuloy nang walang restore:', err.message);
    }
}

async function pushSnapshotToCloud() {
    const key = getSnapshotKey();
    const p = getPool();
    if (!key || !p) return;

    const dbModule = require('./db');

    try {
        await ensureTable(p);
        const snapshot = dbModule.getFullDatabaseSnapshot();

        await p.query(
            `INSERT INTO omnipos_snapshots (installation_key, snapshot, updated_at)
             VALUES ($1, $2::jsonb, now())
             ON CONFLICT (installation_key)
             DO UPDATE SET snapshot = excluded.snapshot, updated_at = excluded.updated_at`,
            [key, JSON.stringify(snapshot)]
        );

        console.log(
            `✅ [cloud-snapshot] Na-push papunta sa Postgres: ${snapshot.totalRecords} records ` +
            `sa ${snapshot.moduleNames.length} modules.`
        );
    } catch (err) {
        console.error('⚠️  [cloud-snapshot] Nabigo ang pag-push papunta sa Postgres:', err.message);
    }
}

module.exports = { restoreFromCloudIfNeeded, pushSnapshotToCloud };
